-- Valor da aula por empresa, e desconto por família.
--
-- Duas coisas que hoje estão cravadas no código:
--
--   1. R$ 220/h é um número literal em seis lugares (o DEFAULT desta tabela,
--      LessonDialog, BillingPage, o portal do aluno e o prompt do assistente).
--      Mudar o próprio preço obriga a reprogramar, e uma empresa nova nasce
--      cobrando o preço do Thiago.
--   2. Não existe desconto. O único jeito de cobrar menos de uma família é
--      lançar voucher na mão, uma aula de cada vez.
--
-- O que NÃO muda: toda aula entra pelo valor cheio e todo desconto é crédito
-- na carteira. A migration 20260912050000 já tinha rejeitado o caminho oposto
-- (reescrever lessons.price por família) porque aula reprecificada faz o
-- extrato deixar de fechar em zero. O desconto fixo daqui continua sendo
-- voucher - a diferença é que agora ele se lança sozinho.

-- ---------------------------------------------------------------------------
-- 1. O valor da aula é da empresa, não do código
-- ---------------------------------------------------------------------------

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS default_lesson_price numeric(10,2) NOT NULL DEFAULT 220.00;

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_default_lesson_price_positive;
ALTER TABLE public.settings
  ADD CONSTRAINT settings_default_lesson_price_positive CHECK (default_lesson_price > 0);

-- O preço da empresa dona da LINHA, e não o de quem está logado. A diferença
-- importa: o assistente de IA grava com chave mestra, sem usuário logado, e
-- uma função baseada em effective_account_id() devolveria nesse caso o preço
-- da empresa do endereço público - o preço do Thiago dentro da aula de outra
-- empresa. O coalesce cobre a empresa que ainda não tem linha em settings.
CREATE OR REPLACE FUNCTION public.account_lesson_price(_account uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT s.default_lesson_price FROM public.settings s WHERE s.account_id = _account),
    220.00
  )
$$;

REVOKE ALL ON FUNCTION public.account_lesson_price(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.account_lesson_price(uuid) TO authenticated, service_role;

-- A coluna perde o DEFAULT fixo. Não dá para trocá-lo por uma expressão: um
-- DEFAULT de coluna não enxerga as outras colunas da própria linha, e é
-- account_id que decide o preço. Por isso o preenchimento vira gatilho.
--
-- A coluna continua NOT NULL: gatilhos BEFORE rodam antes da checagem de
-- restrições, então um INSERT que omite o preço é preenchido aqui e passa.
ALTER TABLE public.lessons ALTER COLUMN price DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.fill_lesson_price()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.price IS NULL THEN
    NEW.price := public.account_lesson_price(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lessons_fill_price ON public.lessons;
CREATE TRIGGER lessons_fill_price
  BEFORE INSERT ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.fill_lesson_price();

-- ---------------------------------------------------------------------------
-- 2. Quem é "a conta" de uma aula
-- ---------------------------------------------------------------------------

-- Mesma regra que o app usa na tela (accountKey em src/lib/balance.ts): quando
-- há responsável, a conta é dele - é por isso que dois irmãos aparecem numa
-- carteira só. Sem responsável, a conta é do próprio aluno. Os prefixos
-- existem para que a responsável "Ana" e um aluno "Ana" sem responsável não
-- virem a mesma conta.
CREATE OR REPLACE FUNCTION public.account_key(_student text, _guardian text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN nullif(btrim(coalesce(_guardian, '')), '') IS NOT NULL
      THEN 'g:' || lower(btrim(_guardian))
    ELSE 's:' || lower(btrim(coalesce(_student, '')))
  END
$$;

REVOKE ALL ON FUNCTION public.account_key(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.account_key(text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. O desconto fixo de uma família
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) DEFAULT public.current_account_id(),
  student_name text NOT NULL,
  guardian_name text,
  -- 'percent': value é a porcentagem abatida de cada aula.
  -- 'amount':  value é quanto sai, em reais, de CADA aula (não do total).
  kind text NOT NULL CHECK (kind IN ('percent', 'amount')),
  value numeric(10,2) NOT NULL CHECK (value > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_discounts_percent_range CHECK (kind <> 'percent' OR value <= 100)
);

-- Um desconto fixo por família. A expressão repete account_key() em vez de
-- chamá-la: índice exige função IMMUTABLE e, mais que isso, exige que ela
-- continue existindo com a mesma definição para sempre - inline só usa
-- built-ins.
CREATE UNIQUE INDEX IF NOT EXISTS account_discounts_one_per_account
  ON public.account_discounts (
    account_id,
    (CASE
       WHEN nullif(btrim(coalesce(guardian_name, '')), '') IS NOT NULL
         THEN 'g:' || lower(btrim(guardian_name))
       ELSE 's:' || lower(btrim(student_name))
     END)
  );

ALTER TABLE public.account_discounts ENABLE ROW LEVEL SECURITY;

-- Só o admin da própria empresa. A família não lê esta tabela: o que ela
-- precisa ver é o crédito no extrato, e esse ela já enxerga na carteira.
DROP POLICY IF EXISTS "admins manage account_discounts" ON public.account_discounts;
CREATE POLICY "admins manage account_discounts" ON public.account_discounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND account_id = public.current_account_id())
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND account_id = public.current_account_id());

-- ---------------------------------------------------------------------------
-- 4. A cobrança e o desconto nascem juntos
-- ---------------------------------------------------------------------------

-- Duas mudanças em relação à versão anterior:
--
--   - além da cobrança da aula, lança o crédito do desconto fixo da família;
--   - o desconto é sempre RECALCULADO a partir do desconto vigente. Mudar o
--     percentual recalcula as aulas realizadas; tirar o desconto apaga esses
--     créditos. Essa é a diferença entre o desconto fixo e o voucher avulso:
--     o avulso (lançado na Cobrança, sem lesson_id) fica parado onde está e
--     esta função nunca encosta nele.
--
-- O que identifica o crédito do desconto é justamente o lesson_id: voucher
-- com aula é desta função, voucher sem aula é de quem lançou à mão.
CREATE OR REPLACE FUNCTION public.sync_lesson_wallet()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _charge numeric;    -- o que a aula custa, cheia
  _discount numeric;  -- quanto o desconto fixo abate dela, se houver
  _label text;
  _desc text;
BEGIN
  -- Deixou de ser realizada: some a cobrança e o desconto que veio com ela.
  IF TG_OP = 'UPDATE' AND OLD.status = 'realizada' AND NEW.status IS DISTINCT FROM 'realizada' THEN
    DELETE FROM public.wallet_transactions
     WHERE lesson_id = NEW.id AND kind IN ('lesson', 'voucher');
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM 'realizada' THEN
    RETURN NULL;
  END IF;

  _charge := ROUND((NEW.price * NEW.duration_minutes / 60.0)::numeric, 2);
  _desc := 'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
           || ' (' || NEW.duration_minutes || ' min)';

  -- O abatimento nunca passa do valor da aula: desconto maior que a cobrança
  -- viraria crédito do nada, e a conta fecharia com a família credora.
  SELECT LEAST(
           ROUND(CASE WHEN d.kind = 'percent' THEN _charge * d.value / 100 ELSE d.value END, 2),
           _charge
         ),
         -- FM come os zeros à direita e deixa o ponto solto ("10." para 10,00);
         -- o rtrim tira esse ponto. Cortar zeros com rtrim seria errado: em
         -- "10.00" ele levaria o zero do dez junto e sobraria "1".
         CASE WHEN d.kind = 'percent'
           THEN 'Desconto de '
                || replace(rtrim(trim(to_char(d.value, 'FM999990.99')), '.'), '.', ',') || '%'
           ELSE 'Desconto de R$ ' || replace(to_char(d.value, 'FM999999990.00'), '.', ',')
         END
    INTO _discount, _label
    FROM public.account_discounts d
   WHERE d.account_id = NEW.account_id
     AND public.account_key(d.student_name, d.guardian_name)
       = public.account_key(NEW.student_name, NEW.guardian_name);

  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'realizada' THEN
    INSERT INTO public.wallet_transactions
      (guardian_name, student_name, amount, kind, lesson_id, description, account_id)
    VALUES (NULLIF(trim(NEW.guardian_name), ''), NEW.student_name, -_charge, 'lesson', NEW.id,
            _desc, NEW.account_id);
  ELSE
    UPDATE public.wallet_transactions
       SET amount = -_charge,
           guardian_name = NULLIF(trim(NEW.guardian_name), ''),
           student_name = NEW.student_name,
           description = _desc
     WHERE lesson_id = NEW.id AND kind = 'lesson';
  END IF;

  IF _discount IS NULL OR _discount <= 0 THEN
    DELETE FROM public.wallet_transactions WHERE lesson_id = NEW.id AND kind = 'voucher';
  ELSE
    UPDATE public.wallet_transactions
       SET amount = _discount,
           guardian_name = NULLIF(trim(NEW.guardian_name), ''),
           student_name = NEW.student_name,
           description = _label || ' - ' || _desc
     WHERE lesson_id = NEW.id AND kind = 'voucher';
    IF NOT FOUND THEN
      INSERT INTO public.wallet_transactions
        (guardian_name, student_name, amount, kind, lesson_id, description, account_id)
      VALUES (NULLIF(trim(NEW.guardian_name), ''), NEW.student_name, _discount, 'voucher', NEW.id,
              _label || ' - ' || _desc, NEW.account_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Definir (ou tirar) o desconto fixo de uma família
-- ---------------------------------------------------------------------------

-- _kind nulo apaga o desconto. Em qualquer dos casos as aulas já realizadas
-- são reprocessadas: o UPDATE no fim não muda nada de verdade, ele existe para
-- fazer sync_lesson_wallet correr de novo em cada aula e recalcular o crédito.
-- Assim o desconto nunca fica valendo pela metade - com aulas antigas
-- carregando um percentual que não é mais o da família.
CREATE OR REPLACE FUNCTION public.set_account_discount(
  _student text,
  _guardian text,
  _kind text DEFAULT NULL,
  _value numeric DEFAULT NULL,
  _note text DEFAULT NULL,
  _account uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := btrim(coalesce(_student, ''));
  _acct uuid := coalesce(_account, public.current_account_id());
  _key text;
  _touched int;
BEGIN
  -- session_user, e não current_user: ver a seção 6 no fim deste arquivo.
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR session_user IN ('postgres', 'supabase_admin')
          OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'account is required';
  END IF;
  IF _s = '' THEN
    RAISE EXCEPTION 'student_name is required';
  END IF;
  IF _kind IS NOT NULL THEN
    IF _kind NOT IN ('percent', 'amount') THEN
      RAISE EXCEPTION 'invalid kind %', _kind;
    END IF;
    IF coalesce(_value, 0) <= 0 THEN
      RAISE EXCEPTION 'value must be positive';
    END IF;
    IF _kind = 'percent' AND _value > 100 THEN
      RAISE EXCEPTION 'percent cannot exceed 100';
    END IF;
  END IF;

  _key := public.account_key(_s, _g);

  DELETE FROM public.account_discounts d
   WHERE d.account_id = _acct
     AND public.account_key(d.student_name, d.guardian_name) = _key;

  IF _kind IS NOT NULL THEN
    INSERT INTO public.account_discounts
      (account_id, student_name, guardian_name, kind, value, note)
    VALUES (_acct, _s, _g, _kind, _value, nullif(btrim(coalesce(_note, '')), ''));
  END IF;

  UPDATE public.lessons l
     SET updated_at = now()
   WHERE l.account_id = _acct
     AND l.status = 'realizada'
     AND public.account_key(l.student_name, l.guardian_name) = _key;
  GET DIAGNOSTICS _touched = ROW_COUNT;

  RETURN jsonb_build_object('removed', _kind IS NULL, 'lessons_recalculated', _touched);
END;
$$;

REVOKE ALL ON FUNCTION public.set_account_discount(text, text, text, numeric, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_account_discount(text, text, text, numeric, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. A guarda de register_payment não estava guardando nada
-- ---------------------------------------------------------------------------

-- Achado ao testar a função acima, que nasceu copiando esta guarda:
--
--   IF NOT (has_role(auth.uid(), 'admin')
--           OR current_user IN ('postgres', 'service_role', 'supabase_admin')
--           OR <claim role = service_role>) THEN RAISE EXCEPTION 'not allowed';
--
-- Dentro de uma função SECURITY DEFINER, `current_user` é o DONO da função -
-- postgres -, nunca quem chamou. A segunda condição é portanto sempre
-- verdadeira, e a guarda inteira passa para qualquer um. Na prática: qualquer
-- responsável logado podia chamar register_payment pela API e creditar o que
-- quisesse na própria carteira, zerando a dívida. Reproduzido no espelho local
-- (scripts/espelho-testes.sql, seção 9) com o papel `authenticated` e
-- session_user `authenticator`, que é exatamente como o PostgREST chama.
--
-- Quem sabe de verdade quem chamou:
--   - session_user  -> o login da conexão ('authenticator' vindo da API,
--                      'postgres' vindo do painel de SQL)
--   - o claim role  -> 'service_role' quando quem chama é uma edge function
--                      com a chave mestra
--
-- Fora isso, só é admin quem has_role diz que é. A função abaixo é idêntica à
-- da migration 20260919050000 salvo essa linha.
CREATE OR REPLACE FUNCTION public.register_payment(
  _student text,
  _guardian text,
  _amount numeric,
  _kind text DEFAULT 'adjustment'::text,
  _description text DEFAULT NULL::text,
  _voucher numeric DEFAULT 0,
  _voucher_description text DEFAULT NULL::text,
  _account uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := btrim(coalesce(_student, ''));
  _acct uuid := coalesce(_account, public.current_account_id());
  _payment_id uuid;
  _voucher_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR session_user IN ('postgres', 'supabase_admin')
          OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'account is required';
  END IF;
  IF _s = '' THEN
    RAISE EXCEPTION 'student_name is required';
  END IF;
  IF _kind NOT IN ('package', 'adjustment', 'voucher') THEN
    RAISE EXCEPTION 'invalid kind %', _kind;
  END IF;
  IF coalesce(_amount, 0) = 0 AND coalesce(_voucher, 0) = 0 THEN
    RAISE EXCEPTION 'nothing to register';
  END IF;
  IF coalesce(_voucher, 0) < 0 THEN
    RAISE EXCEPTION 'voucher must be positive';
  END IF;

  IF coalesce(_amount, 0) <> 0 THEN
    INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description, account_id)
    VALUES (_s, _g, _amount, CASE WHEN _amount < 0 THEN 'adjustment' ELSE _kind END,
            nullif(btrim(coalesce(_description, '')), ''), _acct)
    RETURNING id INTO _payment_id;
  END IF;

  IF coalesce(_voucher, 0) > 0 THEN
    INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description, account_id)
    VALUES (_s, _g, _voucher, 'voucher',
            coalesce(nullif(btrim(coalesce(_voucher_description, '')), ''), 'Voucher'), _acct)
    RETURNING id INTO _voucher_id;
  END IF;

  RETURN jsonb_build_object('payment_id', _payment_id, 'voucher_id', _voucher_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.register_payment(text, text, numeric, text, text, numeric, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_payment(text, text, numeric, text, text, numeric, text, uuid) TO authenticated, service_role;

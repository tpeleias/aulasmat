-- Cronys Essencial e Cronys Pro.
--
-- Até aqui toda empresa tinha tudo. Agora o plano decide, e a decisão mora no
-- BANCO, não na tela. Isso não é preciosismo: a tela some do caminho de quem
-- chama a API direto com o próprio token, e este projeto já viu isso acontecer
-- duas vezes (o robô do Google Play criando 55 aulas, e a guarda de
-- register_payment que não guardava nada). Esconder o botão não é a trava.
--
-- O que cada plano tem está em plan_features(), num lugar só, para não virar
-- regra espalhada por quinze arquivos.
--
-- O que NÃO acontece: nenhuma empresa perde o que já criou. Os limites valem
-- para CRIAR coisa nova. Uma empresa que já tem 8 alunos e cai para o
-- Essencial continua com os 8 - ela só não cria o nono.

-- ---------------------------------------------------------------------------
-- 1. O plano de cada empresa
-- ---------------------------------------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'essencial';

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_plan_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_plan_check CHECK (plan IN ('essencial', 'pro'));

-- Nulo = segue o plano. true/false = o gestor forçou, para cortesia ou teste.
-- Existe porque "dar o assistente para essa empresa por um mês" é uma decisão
-- comercial que não deveria obrigar a mudar o plano inteiro dela.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS assistant_override boolean;

-- A empresa do endereço público é a de produção, que já roda com 15 alunos e
-- 2 professores: ela é Pro. A "Demonstração" também, de propósito - é a conta
-- que o revisor do Google Play usa, e mostrar uma tela de venda para ele
-- convida a uma discussão sobre cobrança dentro do app que não queremos ter.
UPDATE public.accounts SET plan = 'pro' WHERE is_public_default OR slug = 'demo';

-- ---------------------------------------------------------------------------
-- 2. O cardápio, num lugar só
-- ---------------------------------------------------------------------------

-- Limite nulo quer dizer ILIMITADO (e não zero).
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _plan
    WHEN 'pro' THEN jsonb_build_object(
      'nome',              'Cronys Pro',
      'max_teachers',      null,
      'max_students',      null,
      'assistant',         true,
      'packages',          true,
      'recurring_blocks',  true
    )
    ELSE jsonb_build_object(
      'nome',              'Cronys Essencial',
      'max_teachers',      1,
      'max_students',      5,
      'assistant',         false,
      'packages',          false,
      -- Bloqueio pontual continua valendo no Essencial: dizer "dia 14 não dou
      -- aula" é função básica de agenda, e sem ela a vitrine pública ofereceria
      -- horário que o professor não tem. O que se paga é não repetir o
      -- trabalho toda semana.
      'recurring_blocks',  false
    )
  END
$$;

REVOKE ALL ON FUNCTION public.plan_features(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.plan_features(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.account_plan(_account uuid DEFAULT NULL)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT a.plan FROM public.accounts a
      WHERE a.id = coalesce(_account, public.current_account_id())),
    'essencial')
$$;

-- A resposta para "esta empresa pode X?". O override do assistente entra aqui,
-- e só aqui, para não haver dois lugares dizendo coisas diferentes.
CREATE OR REPLACE FUNCTION public.account_can(_capability text, _account uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _capability = 'assistant' THEN coalesce(
      (SELECT a.assistant_override FROM public.accounts a
        WHERE a.id = coalesce(_account, public.current_account_id())),
      coalesce((public.plan_features(public.account_plan(_account)) ->> 'assistant')::boolean, false))
    ELSE coalesce((public.plan_features(public.account_plan(_account)) ->> _capability)::boolean, false)
  END
$$;

-- Nulo = sem limite.
CREATE OR REPLACE FUNCTION public.account_limit(_what text, _account uuid DEFAULT NULL)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT (public.plan_features(public.account_plan(_account)) ->> ('max_' || _what))::int
$$;

REVOKE ALL ON FUNCTION public.account_plan(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.account_can(text, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.account_limit(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.account_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_can(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_limit(text, uuid) TO authenticated, service_role;

-- O app precisa saber o que mostrar sem ter direito de ler a tabela accounts.
-- Devolve só o plano de quem está logado e o que ele permite - nada de outra
-- empresa.
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.plan_features(public.account_plan(NULL))
      || jsonb_build_object(
           'plano', public.account_plan(NULL),
           'assistant', public.account_can('assistant'))
$$;

REVOKE ALL ON FUNCTION public.my_plan() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Os limites de quantidade
-- ---------------------------------------------------------------------------

-- Só no INSERT: quem já existe continua existindo. Rebaixar uma empresa não
-- pode apagar o oitavo aluno dela nem travar a edição dos que ela já tem.
CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _limit int;
  _atual int;
BEGIN
  _limit := public.account_limit(TG_ARGV[0], NEW.account_id);
  IF _limit IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_ARGV[0] = 'teachers' THEN
    -- O limite é de professor ATIVO. Cadastrar um já desativado (para guardar
    -- o histórico das aulas dele, por exemplo) não consome vaga - quem cobra
    -- isso é o gatilho de reativação, logo abaixo.
    IF NEW.active IS NOT TRUE THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO _atual FROM public.teachers
     WHERE account_id = NEW.account_id AND active;
    IF _atual >= _limit THEN
      RAISE EXCEPTION 'O plano Cronys Essencial permite % professor(es) ativo(s). Para ter mais, mude para o Cronys Pro.', _limit
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT count(*) INTO _atual FROM public.students
     WHERE account_id = NEW.account_id;
    IF _atual >= _limit THEN
      RAISE EXCEPTION 'O plano Cronys Essencial permite % alunos. Para cadastrar mais, mude para o Cronys Pro.', _limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teachers_plan_limit ON public.teachers;
CREATE TRIGGER teachers_plan_limit
  BEFORE INSERT ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('teachers');

DROP TRIGGER IF EXISTS students_plan_limit ON public.students;
CREATE TRIGGER students_plan_limit
  BEFORE INSERT ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_limit('students');

-- Reativar um professor desativado é o mesmo que criar um, para efeito de
-- limite - senão o Essencial teria quantos professores quisesse, bastando
-- desligar e religar.
CREATE OR REPLACE FUNCTION public.enforce_teacher_reactivation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _limit int := public.account_limit('teachers', NEW.account_id);
  _atual int;
BEGIN
  IF _limit IS NULL OR NEW.active IS NOT TRUE OR OLD.active IS TRUE THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _atual FROM public.teachers
   WHERE account_id = NEW.account_id AND active AND id <> NEW.id;
  IF _atual >= _limit THEN
    RAISE EXCEPTION 'O plano Cronys Essencial permite % professor(es) ativo(s). Desative outro antes, ou mude para o Cronys Pro.', _limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teachers_plan_reactivation ON public.teachers;
CREATE TRIGGER teachers_plan_reactivation
  BEFORE UPDATE OF active ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_teacher_reactivation();

-- ---------------------------------------------------------------------------
-- 4. Bloqueio que se repete toda semana
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_recurring_block_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.block_type = 'recurring' AND NOT public.account_can('recurring_blocks', NEW.account_id) THEN
    RAISE EXCEPTION 'Bloqueio que se repete toda semana é do Cronys Pro. No Essencial dá para bloquear uma data específica.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS blocks_plan_recurring ON public.blocks;
CREATE TRIGGER blocks_plan_recurring
  BEFORE INSERT OR UPDATE OF block_type ON public.blocks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_recurring_block_plan();

-- ---------------------------------------------------------------------------
-- 5. Pacotes, vouchers e desconto
-- ---------------------------------------------------------------------------

-- Os três são a mesma família: abatimento combinado com a família. Ficam
-- juntos no Pro. Registrar dinheiro recebido continua no Essencial - cobrar é
-- o mínimo que o app precisa fazer.
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
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR session_user IN ('postgres', 'supabase_admin')
          OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'account is required';
  END IF;
  -- Tirar um desconto continua livre: se a empresa foi rebaixada, ela precisa
  -- conseguir desfazer o que já tinha.
  IF _kind IS NOT NULL AND NOT public.account_can('packages', _acct) THEN
    RAISE EXCEPTION 'Desconto por família é do Cronys Pro.'
      USING ERRCODE = 'check_violation';
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
  -- Registrar o dinheiro que entrou é do Essencial. Pacote e voucher, não:
  -- são o desconto combinado, e esse é o que se paga para ter.
  IF (_kind IN ('package', 'voucher') OR coalesce(_voucher, 0) > 0)
     AND NOT public.account_can('packages', _acct) THEN
    RAISE EXCEPTION 'Pacotes e vouchers são do Cronys Pro. No Essencial dá para registrar o pagamento recebido.'
      USING ERRCODE = 'check_violation';
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

-- ---------------------------------------------------------------------------
-- 6. O gestor muda o plano
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_set_account_plan(
  _account uuid,
  _plan text DEFAULT NULL,
  _assistant_override boolean DEFAULT NULL,
  _clear_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.accounts;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _plan IS NOT NULL AND _plan NOT IN ('essencial', 'pro') THEN
    RAISE EXCEPTION 'plano inválido: %', _plan;
  END IF;

  UPDATE public.accounts
     SET plan = coalesce(_plan, plan),
         assistant_override = CASE WHEN _clear_override THEN NULL
                                   ELSE coalesce(_assistant_override, assistant_override) END
   WHERE id = _account
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'plan', _row.plan,
                            'assistant_override', _row.assistant_override,
                            'assistant', public.account_can('assistant', _row.id));
END;
$$;

REVOKE ALL ON FUNCTION public.platform_set_account_plan(uuid, text, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_account_plan(uuid, text, boolean, boolean) TO authenticated, service_role;

-- O painel passa a mostrar o plano e se o assistente está ligado.
DROP FUNCTION IF EXISTS public.platform_accounts_overview();
CREATE OR REPLACE FUNCTION public.platform_accounts_overview()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  active boolean,
  is_public_default boolean,
  created_at timestamptz,
  plan text,
  assistant boolean,
  assistant_override boolean,
  responsaveis bigint,
  alunos bigint,
  professores bigint,
  aulas bigint,
  logins bigint,
  ultima_aula timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT a.id, a.name, a.slug, a.active, a.is_public_default, a.created_at,
         a.plan,
         public.account_can('assistant', a.id),
         a.assistant_override,
         (SELECT count(DISTINCT lower(btrim(s.guardian_name))) FROM public.students s
           WHERE s.account_id = a.id AND nullif(btrim(coalesce(s.guardian_name, '')), '') IS NOT NULL),
         (SELECT count(*) FROM public.students s WHERE s.account_id = a.id),
         (SELECT count(*) FROM public.teachers t WHERE t.account_id = a.id AND t.active),
         (SELECT count(*) FROM public.lessons l WHERE l.account_id = a.id),
         (SELECT count(*) FROM public.user_roles r WHERE r.account_id = a.id),
         (SELECT max(l.start_at) FROM public.lessons l WHERE l.account_id = a.id)
    FROM public.accounts a
   ORDER BY a.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_accounts_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_accounts_overview() TO authenticated, service_role;

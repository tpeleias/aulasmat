-- Pacote que abate AULAS, não valor (08/10, pedido do Thiago).
--
-- Antes: o pacote era dinheiro + um voucher com a diferença para o valor
-- cheio, e o crédito ia pagando as aulas pelo preço de cada uma. Funcionava,
-- mas era difícil de explicar ("sobra R$ 660").
--
-- Agora: vender um pacote cria uma COMPRA com N aulas (blocos de X minutos,
-- 60 por padrão ou a duração do serviço do pacote). Cada aula realizada da
-- conta gasta duração / X blocos da compra mais antiga com saldo, e a aula
-- passa a custar zero em dinheiro (ou só a parte que o pacote não cobriu). O
-- pacote em si vira uma cobrança no valor do pacote, paga como qualquer outra.
--
-- Quais aulas o pacote cobre: as realizadas a partir de `valid_from`, que na
-- venda é logo depois da última aula já paga em dinheiro - ou seja, o pacote
-- quita também as aulas que estavam em aberto (escolha do Thiago).
--
-- Tudo é recalculado por conta (reassign_packages) a cada mudança de aula ou
-- de compra, em ordem de data da aula: excluir uma compra devolve as aulas ao
-- valor cheio; desmarcar uma aula devolve o bloco.

-- ---------------------------------------------------------------------------
-- Tamanho do bloco no cadastro do pacote
-- ---------------------------------------------------------------------------
ALTER TABLE public.lesson_packages
  ADD COLUMN IF NOT EXISTS minutes integer CHECK (minutes IS NULL OR minutes BETWEEN 5 AND 600);

COMMENT ON COLUMN public.lesson_packages.minutes IS
  'Minutos de cada aula do pacote. Nulo: a duração do serviço do pacote, ou 60.';

-- ---------------------------------------------------------------------------
-- Compras de pacote e o que cada aula gastou
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.package_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL DEFAULT public.current_account_id() REFERENCES public.accounts(id) ON DELETE CASCADE,
  student_name text NOT NULL,
  guardian_name text,
  package_id uuid REFERENCES public.lesson_packages(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  sessions numeric(8,2) NOT NULL CHECK (sessions > 0 AND sessions <= 500),
  minutes integer NOT NULL DEFAULT 60 CHECK (minutes BETWEEN 5 AND 600),
  price numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  valid_from timestamptz NOT NULL DEFAULT '-infinity',
  converted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_purchases_key_idx
  ON public.package_purchases (account_id, public.account_key(student_name, guardian_name), created_at);

CREATE TABLE IF NOT EXISTS public.package_uses (
  purchase_id uuid NOT NULL REFERENCES public.package_purchases(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  sessions numeric(10,4) NOT NULL CHECK (sessions > 0),
  PRIMARY KEY (purchase_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS package_uses_lesson_idx ON public.package_uses (lesson_id);

-- A cobrança do pacote (e o ajuste da conversão) apontam para a compra.
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS package_purchase_id uuid REFERENCES public.package_purchases(id) ON DELETE SET NULL;

ALTER TABLE public.package_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_uses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage own purchases" ON public.package_purchases
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id());
CREATE POLICY "students read own purchases" ON public.package_purchases
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND public.student_account_matches(student_name, guardian_name));

-- Usos: só leitura pela tela; quem escreve é reassign_packages.
CREATE POLICY "read uses of visible purchases" ON public.package_uses
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.package_purchases p WHERE p.id = purchase_id));

REVOKE ALL ON public.package_purchases FROM anon;
REVOKE ALL ON public.package_uses FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.package_uses FROM authenticated;

-- ---------------------------------------------------------------------------
-- O valor de uma aula (a mesma conta de sync_lesson_wallet)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lesson_charge_parts(_l public.lessons, OUT charge numeric, OUT discount numeric, OUT label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  charge := ROUND((_l.price * _l.duration_minutes / 60.0)::numeric, 2);
  SELECT LEAST(ROUND(CASE WHEN d.kind = 'percent' THEN charge * d.value / 100 ELSE d.value END, 2), charge),
         CASE WHEN d.kind = 'percent'
           THEN 'Desconto de ' || replace(rtrim(trim(to_char(d.value, 'FM999990.99')), '.'), '.', ',') || '%'
           ELSE 'Desconto de R$ ' || replace(to_char(d.value, 'FM999999990.00'), '.', ',')
         END
    INTO discount, label
    FROM public.account_discounts d
   WHERE d.account_id = _l.account_id
     AND public.account_key(d.student_name, d.guardian_name) = public.account_key(_l.student_name, _l.guardian_name);
  discount := coalesce(discount, 0);
END $$;
REVOKE ALL ON FUNCTION public.lesson_charge_parts(public.lessons) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recalcula os pacotes de uma conta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_packages(_account uuid, _key text, _force boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _rem jsonb := '{}'::jsonb;
  _l public.lessons;
  _p record;
  _r numeric; _need numeric; _take numeric; _uncovered numeric;
  _charge numeric; _disc numeric; _label text; _amt numeric; _v numeric; _desc text;
  _who record;
BEGIN
  IF _account IS NULL OR _key IS NULL THEN RETURN; END IF;
  -- Sem compra e sem uso não há o que refazer - exceto logo depois de apagar
  -- uma compra (_force): os usos saíram junto, mas as aulas ainda estão a zero.
  IF NOT _force AND NOT EXISTS (SELECT 1 FROM public.package_purchases p
                  WHERE p.account_id = _account AND public.account_key(p.student_name, p.guardian_name) = _key)
     AND NOT EXISTS (SELECT 1 FROM public.package_uses u JOIN public.lessons l ON l.id = u.lesson_id
                      WHERE l.account_id = _account AND public.account_key(l.student_name, l.guardian_name) = _key) THEN
    RETURN;
  END IF;

  DELETE FROM public.package_uses u USING public.package_purchases p
   WHERE u.purchase_id = p.id AND p.account_id = _account AND public.account_key(p.student_name, p.guardian_name) = _key;
  DELETE FROM public.package_uses u USING public.lessons l
   WHERE u.lesson_id = l.id AND l.account_id = _account AND public.account_key(l.student_name, l.guardian_name) = _key;

  FOR _p IN SELECT id, sessions FROM public.package_purchases
             WHERE account_id = _account AND public.account_key(student_name, guardian_name) = _key LOOP
    _rem := _rem || jsonb_build_object(_p.id::text, _p.sessions);
  END LOOP;

  FOR _l IN
    SELECT l.* FROM public.lessons l
     WHERE l.account_id = _account AND l.status = 'realizada'
       AND public.account_key(l.student_name, l.guardian_name) = _key
       AND EXISTS (SELECT 1 FROM public.wallet_transactions w WHERE w.lesson_id = l.id AND w.kind = 'lesson')
     ORDER BY l.start_at, l.id
  LOOP
    SELECT c.charge, c.discount, c.label INTO _charge, _disc, _label FROM public.lesson_charge_parts(_l) c;
    _uncovered := 1;   -- fração da aula ainda sem pacote
    FOR _p IN
      SELECT p.id, p.minutes FROM public.package_purchases p
       WHERE p.account_id = _account AND public.account_key(p.student_name, p.guardian_name) = _key
         AND p.valid_from <= _l.start_at
         AND (p.service_id IS NULL OR _l.service_id IS NULL OR p.service_id = _l.service_id)
       ORDER BY p.created_at, p.id
    LOOP
      EXIT WHEN _uncovered <= 0;
      _r := coalesce((_rem ->> _p.id::text)::numeric, 0);
      CONTINUE WHEN _r <= 0;
      _need := round(_uncovered * _l.duration_minutes / _p.minutes, 4);
      _take := least(_r, _need);
      IF _take <= 0 THEN CONTINUE; END IF;
      INSERT INTO public.package_uses (purchase_id, lesson_id, sessions) VALUES (_p.id, _l.id, _take);
      _rem := _rem || jsonb_build_object(_p.id::text, _r - _take);
      _uncovered := CASE WHEN _take >= _need THEN 0 ELSE greatest(0, _uncovered - _take * _p.minutes / _l.duration_minutes) END;
    END LOOP;

    _amt := -round(_charge * _uncovered, 2);
    _v := round(_disc * _uncovered, 2);
    UPDATE public.wallet_transactions SET amount = _amt
     WHERE lesson_id = _l.id AND kind = 'lesson' AND amount IS DISTINCT FROM _amt;
    IF _v <= 0 THEN
      DELETE FROM public.wallet_transactions WHERE lesson_id = _l.id AND kind = 'voucher';
    ELSE
      _desc := _label || ' - Aula em ' || to_char(_l.start_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
               || ' (' || _l.duration_minutes || ' min)';
      UPDATE public.wallet_transactions SET amount = _v
       WHERE lesson_id = _l.id AND kind = 'voucher' AND amount IS DISTINCT FROM _v;
      IF NOT EXISTS (SELECT 1 FROM public.wallet_transactions WHERE lesson_id = _l.id AND kind = 'voucher') THEN
        INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description, account_id)
        VALUES (nullif(btrim(_l.guardian_name), ''), _l.student_name, _v, 'voucher', _l.id, _desc, _l.account_id);
      END IF;
    END IF;
  END LOOP;

  -- Aula coberta inteira não tem débito: o "pago" dela vem do pacote.
  SELECT student_name, guardian_name INTO _who FROM (
    SELECT student_name, guardian_name FROM public.package_purchases
     WHERE account_id = _account AND public.account_key(student_name, guardian_name) = _key
    UNION ALL
    SELECT student_name, guardian_name FROM public.lessons
     WHERE account_id = _account AND public.account_key(student_name, guardian_name) = _key
  ) x LIMIT 1;
  IF FOUND THEN PERFORM public.recompute_payment_status(_who.student_name, _who.guardian_name, _account); END IF;
END $$;
REVOKE ALL ON FUNCTION public.reassign_packages(uuid, text, boolean) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Pago" também para a aula que o pacote cobriu (sem débito em dinheiro)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_payment_status(_student text, _guardian text, _account uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := lower(btrim(coalesce(_student, '')));
  _acct uuid := coalesce(_account, public.current_account_id());
  _pool numeric;
BEGIN
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'account is required';
  END IF;

  PERFORM set_config('app.recompute_payment_status', '1', true);

  SELECT coalesce(sum(w.amount), 0) INTO _pool
  FROM public.wallet_transactions w
  WHERE w.account_id = _acct
    AND w.amount > 0
    AND ((_g IS NOT NULL AND lower(btrim(coalesce(w.guardian_name, ''))) = lower(_g))
      OR (_g IS NULL AND nullif(btrim(coalesce(w.guardian_name, '')), '') IS NULL AND lower(btrim(w.student_name)) = _s));

  WITH charges AS (
    SELECT w.lesson_id,
           sum(-w.amount) OVER (ORDER BY coalesce(l.start_at, w.created_at), w.id
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado
    FROM public.wallet_transactions w
    LEFT JOIN public.lessons l ON l.id = w.lesson_id
    WHERE w.account_id = _acct
      AND w.amount < 0
      AND ((_g IS NOT NULL AND lower(btrim(coalesce(w.guardian_name, ''))) = lower(_g))
        OR (_g IS NULL AND nullif(btrim(coalesce(w.guardian_name, '')), '') IS NULL AND lower(btrim(w.student_name)) = _s))
  ),
  computed AS (
    SELECT lesson_id, CASE WHEN acumulado <= _pool + 0.005 THEN 'pago' ELSE 'pendente' END AS st
    FROM charges WHERE lesson_id IS NOT NULL
  )
  UPDATE public.lessons l SET payment_status = c.st
  FROM computed c
  WHERE l.id = c.lesson_id AND l.account_id = _acct AND l.payment_status IS DISTINCT FROM c.st;

  -- Sem débito: coberta pelo pacote fica "pago"; o resto (não realizada), "pendente".
  UPDATE public.lessons l
     SET payment_status = CASE WHEN EXISTS (SELECT 1 FROM public.package_uses u WHERE u.lesson_id = l.id) THEN 'pago' ELSE 'pendente' END
  WHERE l.account_id = _acct
    AND ((_g IS NOT NULL AND lower(btrim(coalesce(l.guardian_name, ''))) = lower(_g))
      OR (_g IS NULL AND nullif(btrim(coalesce(l.guardian_name, '')), '') IS NULL AND lower(btrim(l.student_name)) = _s))
    AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions w WHERE w.lesson_id = l.id AND w.amount < 0)
    AND l.payment_status IS DISTINCT FROM
        CASE WHEN EXISTS (SELECT 1 FROM public.package_uses u WHERE u.lesson_id = l.id) THEN 'pago' ELSE 'pendente' END;

  PERFORM set_config('app.recompute_payment_status', '', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Gatilhos: aula mudou -> recalcula a conta; compra mudou -> idem
-- ---------------------------------------------------------------------------
-- Só a marca de pago/pendente mudou: a carteira não tem nada a refazer (e
-- refazer aqui escreveria o valor cheio por cima do que o pacote cobriu).
CREATE OR REPLACE FUNCTION public.lesson_only_payment_status_changed(_new public.lessons, _old public.lessons)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _new.payment_status IS DISTINCT FROM _old.payment_status
     AND (to_jsonb(_new) - 'payment_status' - 'updated_at') = (to_jsonb(_old) - 'payment_status' - 'updated_at')
$$;

CREATE OR REPLACE FUNCTION public.sync_lesson_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _charge numeric;
  _discount numeric;
  _label text;
  _desc text;
BEGIN
  -- set_account_discount recalcula "tocando" a aula sem mudar nada (só
  -- updated_at): esse caso continua passando. Só o serviço mudado é pulado.
  IF TG_OP = 'UPDATE' AND NEW.service_id IS DISTINCT FROM OLD.service_id
     AND (to_jsonb(NEW) - 'service_id' - 'updated_at') = (to_jsonb(OLD) - 'service_id' - 'updated_at') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND public.lesson_only_payment_status_changed(NEW, OLD) THEN
    RETURN NULL;
  END IF;

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

  SELECT LEAST(
           ROUND(CASE WHEN d.kind = 'percent' THEN _charge * d.value / 100 ELSE d.value END, 2),
           _charge
         ),
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

-- Roda depois de lessons_wallet_sync (os gatilhos vão em ordem alfabética).
CREATE OR REPLACE FUNCTION public.lessons_packages_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'realizada' THEN
      PERFORM public.reassign_packages(OLD.account_id, public.account_key(OLD.student_name, OLD.guardian_name));
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND public.lesson_only_payment_status_changed(NEW, OLD) THEN RETURN NULL; END IF;
  IF NEW.status = 'realizada' OR (TG_OP = 'UPDATE' AND OLD.status = 'realizada') THEN
    PERFORM public.reassign_packages(NEW.account_id, public.account_key(NEW.student_name, NEW.guardian_name));
    IF TG_OP = 'UPDATE' AND public.account_key(NEW.student_name, NEW.guardian_name) IS DISTINCT FROM public.account_key(OLD.student_name, OLD.guardian_name) THEN
      PERFORM public.reassign_packages(OLD.account_id, public.account_key(OLD.student_name, OLD.guardian_name));
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.lessons_packages_sync() FROM public, anon, authenticated;

CREATE TRIGGER lessons_wallet_zz_packages
  AFTER INSERT OR UPDATE OR DELETE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_packages_sync();

CREATE OR REPLACE FUNCTION public.package_purchases_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_WHEN = 'BEFORE' THEN
    -- A cobrança do pacote (e o ajuste da conversão) saem junto; pagamento recebido fica.
    DELETE FROM public.wallet_transactions WHERE package_purchase_id = OLD.id AND amount < 0;
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public.reassign_packages(OLD.account_id, public.account_key(OLD.student_name, OLD.guardian_name), true);
    RETURN NULL;
  END IF;
  PERFORM public.reassign_packages(NEW.account_id, public.account_key(NEW.student_name, NEW.guardian_name));
  IF TG_OP = 'UPDATE' AND public.account_key(NEW.student_name, NEW.guardian_name) IS DISTINCT FROM public.account_key(OLD.student_name, OLD.guardian_name) THEN
    PERFORM public.reassign_packages(OLD.account_id, public.account_key(OLD.student_name, OLD.guardian_name), true);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.package_purchases_sync() FROM public, anon, authenticated;

-- Antes de apagar, a cobrança sai com a compra; depois de qualquer mudança, recalcula.
CREATE TRIGGER package_purchases_before_delete
  BEFORE DELETE ON public.package_purchases
  FOR EACH ROW EXECUTE FUNCTION public.package_purchases_sync();
CREATE TRIGGER package_purchases_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.package_purchases
  FOR EACH ROW EXECUTE FUNCTION public.package_purchases_sync();

-- ---------------------------------------------------------------------------
-- Vender um pacote
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sell_package(
  _student text, _guardian text, _package uuid,
  _paid numeric DEFAULT 0, _paid_description text DEFAULT NULL,
  _account uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := coalesce(_account, public.current_account_id());
  _s text := btrim(coalesce(_student, ''));
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _pk record;
  _from timestamptz;
  _id uuid;
BEGIN
  IF NOT public.caller_can_touch_account(_acct) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _s = '' THEN RAISE EXCEPTION 'student_name is required'; END IF;
  IF NOT public.account_can('packages', _acct) THEN
    RAISE EXCEPTION 'Pacotes são do Cronys Pro.' USING ERRCODE = 'check_violation', HINT = 'pacote_pro';
  END IF;
  IF coalesce(_paid, 0) < 0 THEN RAISE EXCEPTION 'paid must be positive'; END IF;

  SELECT p.id, p.name, p.lessons, p.price, p.service_id,
         coalesce(p.minutes, s.duration_minutes, 60) AS minutes
    INTO _pk
    FROM public.lesson_packages p LEFT JOIN public.services s ON s.id = p.service_id
   WHERE p.id = _package AND p.account_id = _acct;
  IF NOT FOUND THEN RAISE EXCEPTION 'package not found'; END IF;

  -- Cobre as aulas em aberto: começa logo depois da última aula já paga em
  -- dinheiro (as cobertas por outro pacote não contam).
  SELECT max(l.start_at) + interval '1 second' INTO _from
    FROM public.lessons l
   WHERE l.account_id = _acct AND l.status = 'realizada' AND l.payment_status = 'pago'
     AND public.account_key(l.student_name, l.guardian_name) = public.account_key(_s, _g)
     AND NOT EXISTS (SELECT 1 FROM public.package_uses u WHERE u.lesson_id = l.id);

  INSERT INTO public.package_purchases (account_id, student_name, guardian_name, package_id, service_id, name, sessions, minutes, price, valid_from)
  VALUES (_acct, _s, _g, _pk.id, _pk.service_id, _pk.name, _pk.lessons, _pk.minutes, _pk.price, coalesce(_from, '-infinity'))
  RETURNING id INTO _id;

  INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description, account_id, package_purchase_id)
  VALUES (_s, _g, -_pk.price, 'package', _pk.name, _acct, _id);

  IF coalesce(_paid, 0) > 0 THEN
    INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description, account_id)
    VALUES (_s, _g, _paid, 'adjustment', coalesce(nullif(btrim(coalesce(_paid_description, '')), ''), 'Pagamento - ' || _pk.name), _acct);
  END IF;

  RETURN jsonb_build_object('purchase_id', _id, 'valid_from', _from);
END $$;
REVOKE ALL ON FUNCTION public.sell_package(text, text, uuid, numeric, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sell_package(text, text, uuid, numeric, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Pacote acabando: agora também quando a aula é coberta por pacote (débito zero)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.package_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _prefs jsonb;
BEGIN
  BEGIN
    IF NEW.amount > 0 OR NEW.kind <> 'lesson' OR NEW.account_id IS NULL THEN RETURN NULL; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.wallet_transactions w
       WHERE w.account_id = NEW.account_id AND w.kind = 'package'
         AND public.account_key(w.student_name, w.guardian_name) = public.account_key(NEW.student_name, NEW.guardian_name)
    ) AND NOT EXISTS (
      SELECT 1 FROM public.package_purchases p
       WHERE p.account_id = NEW.account_id
         AND public.account_key(p.student_name, p.guardian_name) = public.account_key(NEW.student_name, NEW.guardian_name)
    ) THEN RETURN NULL; END IF;
    SELECT st.email_notifications INTO _prefs FROM public.settings st WHERE st.account_id = NEW.account_id;
    IF NOT public.email_pref(_prefs, 'package_low') OR NOT public.account_can('email_billing', NEW.account_id) THEN RETURN NULL; END IF;
    INSERT INTO public.email_event_outbox (account_id, kind, ref_id, process_after)
    VALUES (NEW.account_id, 'package', NEW.id, now() + interval '1 minute')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_event_outbox package: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

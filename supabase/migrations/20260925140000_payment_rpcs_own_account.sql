-- Falha de segurança achada na revisão geral (25/09): register_payment e
-- set_account_discount recebem a empresa (_account) como parâmetro e só
-- conferiam se quem chama é admin de ALGUMA empresa. Como qualquer um cria
-- uma empresa pelo cadastro e vira admin dela, dava para lançar pagamento,
-- voucher ou desconto (e apagar desconto) na empresa de outro, sabendo o id
-- dela. Agora: login de admin só mexe na própria empresa; a empresa passada
-- à mão fica só para o servidor (assistente, com a chave de serviço).

CREATE OR REPLACE FUNCTION public.caller_can_touch_account(_acct uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT session_user IN ('postgres', 'supabase_admin')
      OR coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      OR (public.has_role(auth.uid(), 'admin') AND _acct IS NOT NULL AND _acct = public.current_account_id())
$$;

REVOKE ALL ON FUNCTION public.caller_can_touch_account(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_payment(_student text, _guardian text, _amount numeric, _kind text DEFAULT 'adjustment'::text, _description text DEFAULT NULL::text, _voucher numeric DEFAULT 0, _voucher_description text DEFAULT NULL::text, _account uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := btrim(coalesce(_student, ''));
  _acct uuid := coalesce(_account, public.current_account_id());
  _payment_id uuid;
  _voucher_id uuid;
BEGIN
  IF NOT public.caller_can_touch_account(_acct) THEN
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

CREATE OR REPLACE FUNCTION public.set_account_discount(_student text, _guardian text, _kind text DEFAULT NULL::text, _value numeric DEFAULT NULL::numeric, _note text DEFAULT NULL::text, _account uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := btrim(coalesce(_student, ''));
  _acct uuid := coalesce(_account, public.current_account_id());
  _key text;
  _touched int;
BEGIN
  IF NOT public.caller_can_touch_account(_acct) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'account is required';
  END IF;
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
$function$;

-- Higiene apontada pelo verificador do Supabase: funções sem search_path fixo.
ALTER FUNCTION public.lesson_span(timestamp with time zone, integer) SET search_path TO 'public';
ALTER FUNCTION public.account_key(text, text) SET search_path TO 'public';

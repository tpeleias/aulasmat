-- Os links curtos de pagamento de várias contas de uma vez (10/10). O
-- Financeiro busca todos quando abre, e o "copiar cobrança" / "copiar link"
-- fica instantâneo: antes cada toque esperava a função "pay" responder (e, se
-- ela estivesse fria, demorava), e o Thiago sentia o botão lento.
--
-- Só o admin da empresa com o pagamento on-line ligado e conectado; devolve
-- {"g:ana": "abcd2345", ...} pela chave de conta do Financeiro.

CREATE OR REPLACE FUNCTION public.admin_pay_links(_accounts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _provider text; _ok boolean := false;
  _a jsonb; _student text; _guardian text; _key text;
  _out jsonb := '{}'::jsonb; _n int := 0;
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT online_provider INTO _provider FROM public.accounts WHERE id = _acct AND online_payments;
  IF _provider IS NULL THEN RETURN _out; END IF;
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)$q$ INTO _ok USING _provider || '_key:' || _acct::text;
  END IF;
  IF NOT _ok THEN RETURN _out; END IF;
  IF jsonb_typeof(_accounts) <> 'array' THEN RAISE EXCEPTION 'invalid accounts'; END IF;
  FOR _a IN SELECT value FROM jsonb_array_elements(_accounts) LOOP
    _n := _n + 1;
    EXIT WHEN _n > 1000;
    _student := btrim(coalesce(_a ->> 'student', ''));
    _guardian := nullif(btrim(coalesce(_a ->> 'guardian', '')), '');
    CONTINUE WHEN _student = '';
    _key := CASE WHEN _guardian IS NOT NULL THEN 'g:' || lower(_guardian) ELSE 's:' || lower(_student) END;
    _out := _out || jsonb_build_object(_key, public.pay_link_code(_acct, _student, _guardian));
  END LOOP;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION public.admin_pay_links(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pay_links(jsonb) TO authenticated;

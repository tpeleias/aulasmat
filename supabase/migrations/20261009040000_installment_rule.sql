-- Parcelas por faixa de valor no Asaas (09/10, pedido do Thiago): até R$ 300
-- em até 2x, até R$ 500 em até 3x, até R$ 1.000 em até 4x e, acima disso, em
-- até 4x. Editável na tela. Formato:
--   {"tiers": [{"up_to": 300, "max": 2}, ...], "above": 4}
-- Sem regra (nulo), vale o online_max_installments de sempre.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS online_installment_rule jsonb;

UPDATE public.accounts
SET online_installment_rule = '{"tiers":[{"up_to":300,"max":2},{"up_to":500,"max":3},{"up_to":1000,"max":4}],"above":4}'::jsonb,
    online_max_installments = 4
WHERE slug = 'portaldeaulas';

-- Quantas parcelas para um valor, pela regra da empresa.
CREATE OR REPLACE FUNCTION public.installments_for(_rule jsonb, _fallback integer, _amount numeric)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _rule IS NULL OR jsonb_typeof(_rule) <> 'object' THEN greatest(1, least(12, coalesce(_fallback, 1)))
    ELSE coalesce(
      (SELECT (t ->> 'max')::int FROM jsonb_array_elements(coalesce(_rule -> 'tiers', '[]'::jsonb)) t
        WHERE _amount <= (t ->> 'up_to')::numeric ORDER BY (t ->> 'up_to')::numeric LIMIT 1),
      (_rule ->> 'above')::int,
      greatest(1, least(12, coalesce(_fallback, 1))))
  END
$$;
GRANT EXECUTE ON FUNCTION public.installments_for(jsonb, integer, numeric) TO authenticated, service_role;

-- O admin grava a regra (confere tudo antes).
CREATE OR REPLACE FUNCTION public.set_online_installment_rule(_rule jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _t jsonb; _prev numeric := 0; _up numeric; _max int; _above int; _n int := 0;
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF NOT coalesce((SELECT online_payments FROM public.accounts WHERE id = _acct), false) THEN RAISE EXCEPTION 'not enabled'; END IF;
  IF _rule IS NULL OR jsonb_typeof(_rule) <> 'object' OR jsonb_typeof(coalesce(_rule -> 'tiers', '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'invalid rule'; END IF;
  _above := (_rule ->> 'above')::int;
  IF _above IS NULL OR _above < 1 OR _above > 12 THEN RAISE EXCEPTION 'invalid rule'; END IF;
  FOR _t IN SELECT value FROM jsonb_array_elements(coalesce(_rule -> 'tiers', '[]'::jsonb)) ORDER BY (value ->> 'up_to')::numeric LOOP
    _n := _n + 1;
    _up := (_t ->> 'up_to')::numeric; _max := (_t ->> 'max')::int;
    IF _n > 10 OR _up IS NULL OR _up <= _prev OR _max IS NULL OR _max < 1 OR _max > 12 THEN RAISE EXCEPTION 'invalid rule'; END IF;
    _prev := _up;
  END LOOP;
  UPDATE public.accounts
  SET online_installment_rule = jsonb_build_object('tiers', coalesce((
        SELECT jsonb_agg(jsonb_build_object('up_to', (v ->> 'up_to')::numeric, 'max', (v ->> 'max')::int) ORDER BY (v ->> 'up_to')::numeric)
        FROM jsonb_array_elements(coalesce(_rule -> 'tiers', '[]'::jsonb)) v), '[]'::jsonb), 'above', _above),
      online_max_installments = _above
  WHERE id = _acct;
END $$;
REVOKE ALL ON FUNCTION public.set_online_installment_rule(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_online_installment_rule(jsonb) TO authenticated;

-- A tela recebe a regra (ou monta uma a partir do máximo antigo).
CREATE OR REPLACE FUNCTION public.online_payments_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _allowed boolean; _provider text; _inst integer; _rule jsonb;
  _stripe boolean := false; _asaas boolean := false;
BEGIN
  IF _acct IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'connected', false, 'provider', null, 'stripe', false, 'asaas', false, 'installments', 1,
      'installment_rule', jsonb_build_object('tiers', '[]'::jsonb, 'above', 1));
  END IF;
  SELECT online_payments, online_provider, online_max_installments, online_installment_rule
    INTO _allowed, _provider, _inst, _rule FROM public.accounts WHERE id = _acct;
  _allowed := coalesce(_allowed, false);
  IF _allowed AND to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)$q$ INTO _stripe USING 'stripe_key:' || _acct::text;
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)$q$ INTO _asaas USING 'asaas_key:' || _acct::text;
  END IF;
  IF NOT _allowed THEN _provider := NULL; END IF;
  RETURN jsonb_build_object(
    'allowed', _allowed,
    'provider', _provider,
    'stripe', _stripe,
    'asaas', _asaas,
    'installments', coalesce(_inst, 1),
    'installment_rule', coalesce(_rule, jsonb_build_object('tiers', '[]'::jsonb, 'above', coalesce(_inst, 1))),
    'connected', CASE _provider WHEN 'stripe' THEN _stripe WHEN 'asaas' THEN _asaas ELSE false END);
END $$;
REVOKE ALL ON FUNCTION public.online_payments_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.online_payments_status() TO authenticated;

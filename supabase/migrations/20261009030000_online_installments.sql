-- Parcelamento no cartão pelo Asaas (09/10, pedido do Thiago: "até 12x").
-- O número de parcelas vai em cada link que a função "pay" cria no Asaas;
-- aqui fica o máximo que a empresa aceita (1 = só à vista). O Pix é sempre
-- à vista. O Stripe segue à vista.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS online_max_installments integer NOT NULL DEFAULT 1
  CHECK (online_max_installments BETWEEN 1 AND 12);

UPDATE public.accounts SET online_max_installments = 12 WHERE slug = 'portaldeaulas';

-- A tela também precisa saber o máximo de parcelas.
CREATE OR REPLACE FUNCTION public.online_payments_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _allowed boolean; _provider text; _inst integer;
  _stripe boolean := false; _asaas boolean := false;
BEGIN
  IF _acct IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'connected', false, 'provider', null, 'stripe', false, 'asaas', false, 'installments', 1);
  END IF;
  SELECT online_payments, online_provider, online_max_installments INTO _allowed, _provider, _inst FROM public.accounts WHERE id = _acct;
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
    'connected', CASE _provider WHEN 'stripe' THEN _stripe WHEN 'asaas' THEN _asaas ELSE false END);
END $$;
REVOKE ALL ON FUNCTION public.online_payments_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.online_payments_status() TO authenticated;

-- O admin escolhe o máximo de parcelas (1 a 12).
CREATE OR REPLACE FUNCTION public.set_online_installments(_n integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acct uuid := public.current_account_id();
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF NOT coalesce((SELECT online_payments FROM public.accounts WHERE id = _acct), false) THEN RAISE EXCEPTION 'not enabled'; END IF;
  IF _n IS NULL OR _n < 1 OR _n > 12 THEN RAISE EXCEPTION 'invalid installments'; END IF;
  UPDATE public.accounts SET online_max_installments = _n WHERE id = _acct;
END $$;
REVOKE ALL ON FUNCTION public.set_online_installments(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_online_installments(integer) TO authenticated;

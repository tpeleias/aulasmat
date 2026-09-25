-- A assinatura do Cronys é cobrada na moeda da empresa (função billing). O
-- Stripe não troca a moeda de uma assinatura em andamento, então enquanto
-- houver assinatura ativa a moeda fica travada: mudar exigiria cancelar e
-- assinar de novo. A língua continua livre.
CREATE OR REPLACE FUNCTION public.set_account_locale(_locale text, _currency text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _row public.accounts%ROWTYPE;
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT * INTO _row FROM public.accounts WHERE id = _acct;
  IF _currency IS NOT NULL AND _currency IS DISTINCT FROM _row.currency
     AND _row.stripe_subscription_id IS NOT NULL
     AND _row.billing_status IN ('active', 'past_due') THEN
    RAISE EXCEPTION 'currency locked while subscribed'
      USING HINT = 'moeda_assinatura';
  END IF;
  UPDATE public.accounts
     SET locale = coalesce(_locale, locale),
         currency = coalesce(_currency, currency)
   WHERE id = _acct;
  RETURN public.my_vocabulary();
END;
$$;

REVOKE ALL ON FUNCTION public.set_account_locale(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_account_locale(text, text) TO authenticated;

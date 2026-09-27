-- Moeda com símbolo livre (Thiago, 27/09): além de R$, US$, € e £, a empresa
-- pode escrever o símbolo que usa (S/, MT, ₹, CHF...). É só como os valores
-- aparecem no app, nas mensagens e nos recibos; a assinatura do Cronys segue
-- cobrada em accounts.currency, uma das quatro.

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS currency_symbol text;
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_currency_symbol_valid;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_currency_symbol_valid
  CHECK (currency_symbol IS NULL OR (char_length(currency_symbol) BETWEEN 1 AND 6 AND currency_symbol !~ '[0-9]'));
COMMENT ON COLUMN public.accounts.currency_symbol IS
  'Símbolo livre da moeda na tela (nulo = o da moeda de accounts.currency).';

CREATE OR REPLACE FUNCTION public.my_vocabulary()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
           'business_model', a.business_model,
           'active', public.account_can('vocabulary', a.id),
           'custom', CASE WHEN public.account_can('vocabulary', a.id)
                          THEN a.vocabulary END,
           'custom_saved', a.vocabulary IS NOT NULL,
           'locale', a.locale,
           'currency', a.currency,
           'currency_symbol', a.currency_symbol)
    FROM public.accounts a
   WHERE a.id = public.effective_account_id()
$function$;

-- Só o admin da própria empresa. Nulo ou vazio volta ao símbolo da moeda.
CREATE OR REPLACE FUNCTION public.set_account_currency_symbol(_symbol text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _s text := nullif(btrim(coalesce(_symbol, '')), '');
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _s IS NOT NULL AND (char_length(_s) > 6 OR _s ~ '[0-9]') THEN
    RAISE EXCEPTION 'Símbolo inválido' USING ERRCODE = 'check_violation', HINT = 'simbolo_moeda';
  END IF;
  UPDATE public.accounts SET currency_symbol = _s WHERE id = _acct;
  RETURN public.my_vocabulary();
END;
$$;

REVOKE ALL ON FUNCTION public.set_account_currency_symbol(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_account_currency_symbol(text) TO authenticated;

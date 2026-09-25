-- App em inglês para vender fora do Brasil (Thiago, 25/09). A empresa escolhe
-- a língua e a moeda; vale para todos dela: equipe, portal da família,
-- mensagens e a página pública.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL';

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_locale_valid;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_locale_valid CHECK (locale IN ('pt-BR', 'en'));
ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_currency_valid;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_currency_valid CHECK (currency IN ('BRL', 'USD', 'EUR', 'GBP'));

COMMENT ON COLUMN public.accounts.locale IS 'Língua da empresa no app: pt-BR ou en.';
COMMENT ON COLUMN public.accounts.currency IS 'Moeda dos valores (preço, cobrança, recibo): BRL, USD, EUR, GBP.';

-- Vai junto com as palavras do ramo: é o que o app lê antes de desenhar a tela
-- (e o que a página pública, sem login, lê da empresa do endereço).
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
           'currency', a.currency)
    FROM public.accounts a
   WHERE a.id = public.effective_account_id()
$function$;

-- Só o admin da própria empresa troca.
CREATE OR REPLACE FUNCTION public.set_account_locale(_locale text, _currency text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not allowed';
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

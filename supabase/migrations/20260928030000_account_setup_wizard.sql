-- Configuração guiada no primeiro acesso (Thiago, 28/09): o admin de uma
-- empresa nova passa pelas etapas (negócio, agenda, serviços; pagamento e
-- primeiro cliente com "pular") antes de chegar ao app.
--
-- accounts.setup_done_at nulo = ainda não passou. As empresas que já existem
-- ficam como feitas - menos as que nem escolheram o ramo, que já caíam na
-- tela de boas-vindas e agora caem no guia inteiro.

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS setup_done_at timestamptz;
UPDATE public.accounts SET setup_done_at = now()
 WHERE setup_done_at IS NULL AND business_model IS NOT NULL;
COMMENT ON COLUMN public.accounts.setup_done_at IS
  'Quando o admin terminou a configuração guiada do primeiro acesso (nulo = ainda não).';

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
           'currency_symbol', a.currency_symbol,
           'setup_done', a.setup_done_at IS NOT NULL)
    FROM public.accounts a
   WHERE a.id = public.effective_account_id()
$function$;

-- O admin terminou o guia.
CREATE OR REPLACE FUNCTION public.complete_account_setup()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  UPDATE public.accounts SET setup_done_at = coalesce(setup_done_at, now()) WHERE id = _acct;
  RETURN public.my_vocabulary();
END;
$$;
REVOKE ALL ON FUNCTION public.complete_account_setup() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_account_setup() TO authenticated;

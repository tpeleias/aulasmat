-- Quem entrou (pelo Google) e ainda não tem empresa recebia de my_vocabulary a
-- empresa do endereço público (Portal de Aulas, em português), e o app trocava
-- a língua para português - um testador em inglês viu "Bem-vindo ao Cronys!"
-- (29/09). Agora a resposta diz se a pessoa é de alguma empresa; sem empresa,
-- o app fica na língua do aparelho.

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
           'setup_done', a.setup_done_at IS NOT NULL,
           'member', public.current_account_id() IS NOT NULL)
    FROM public.accounts a
   WHERE a.id = public.effective_account_id()
$function$;

-- Pro com 100 mensagens de IA por mês (10/10, Thiago): no lugar da amostra
-- de 20. Continua só para quem paga (no teste grátis, sem IA). Teto de
-- gasto de US$ 3/mês por empresa, como o adicional. Com o adicional, 200.

-- >>> plan_features: GERADO por `npm run gen:plans` a partir de supabase/functions/_shared/plans.ts. Não edite à mão.
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'start' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":true,"email_branding":false,"email_custom":false,"extra_teachers_allowed":false,"google_calendar":false,"included_teachers":1,"max_active_clients":25,"max_students":null,"max_teachers":1,"nome":"Cronys Start","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro_solo' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":3,"assistant_included":true,"assistant_messages":100,"assistant_needs_payment":true,"auto_messages_quota":null,"email_billing":true,"email_branding":true,"email_custom":false,"extra_teachers_allowed":true,"google_calendar":true,"included_teachers":1,"max_active_clients":null,"max_students":null,"max_teachers":3,"nome":"Cronys Pro","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro' THEN '{"active_client_days":60,"any_teacher":true,"arrival_location":true,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":5,"assistant_included":true,"assistant_messages":200,"assistant_needs_payment":true,"auto_messages_quota":null,"email_billing":true,"email_branding":true,"email_custom":true,"extra_teachers_allowed":true,"google_calendar":true,"included_teachers":5,"max_active_clients":null,"max_students":null,"max_teachers":null,"nome":"Cronys Max","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":true,"vocabulary":true,"whatsapp_auto":true,"whatsapp_link":true}'::jsonb
    ELSE '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":false,"email_branding":false,"email_custom":false,"extra_teachers_allowed":false,"google_calendar":false,"included_teachers":1,"max_active_clients":10,"max_students":null,"max_teachers":1,"nome":"Cronys Essencial","packages":false,"recurring_blocks":false,"services_multi":false,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":false}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public.plan_trial_days()
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT 14 $$;
-- <<< plan_features

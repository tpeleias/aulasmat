-- Google Agenda por plano (Thiago, 04/10). Importar o ocupado de lá é um
-- bloqueio automático: segue o bloqueio semanal (recurring_blocks) e fica do
-- Start em diante (google_calendar_import). Conectar e exportar os
-- agendamentos passa a valer em todos os planos (google_calendar).
--
-- A função google-calendar continua chamando google_calendar_replace_busy
-- igual; quem não pode importar só não ganha os bloqueios (e perde os que
-- tinha, se o plano baixou).

-- >>> plan_features: GERADO por `npm run gen:plans` a partir de supabase/functions/_shared/plans.ts. Não edite à mão.
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'start' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":true,"email_branding":false,"email_custom":false,"extra_teachers_allowed":false,"google_calendar":true,"google_calendar_import":true,"included_teachers":1,"max_active_clients":25,"max_students":null,"max_teachers":1,"nome":"Cronys Start","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro_solo' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0.6,"assistant_included":true,"assistant_messages":20,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":true,"email_branding":true,"email_custom":false,"extra_teachers_allowed":true,"google_calendar":true,"google_calendar_import":true,"included_teachers":1,"max_active_clients":null,"max_students":null,"max_teachers":3,"nome":"Cronys Pro","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro' THEN '{"active_client_days":60,"any_teacher":true,"arrival_location":true,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":5,"assistant_included":true,"assistant_messages":200,"assistant_needs_payment":true,"auto_messages_quota":null,"email_billing":true,"email_branding":true,"email_custom":true,"extra_teachers_allowed":true,"google_calendar":true,"google_calendar_import":true,"included_teachers":5,"max_active_clients":null,"max_students":null,"max_teachers":null,"nome":"Cronys Max","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":true,"vocabulary":true,"whatsapp_auto":true,"whatsapp_link":true}'::jsonb
    ELSE '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":false,"email_branding":false,"email_custom":false,"extra_teachers_allowed":false,"google_calendar":true,"google_calendar_import":false,"included_teachers":1,"max_active_clients":10,"max_students":null,"max_teachers":1,"nome":"Cronys Essencial","packages":false,"recurring_blocks":false,"services_multi":false,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":false}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public.plan_trial_days()
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT 14 $$;
-- <<< plan_features

CREATE OR REPLACE FUNCTION public.google_calendar_set(_teacher uuid, _import boolean, _export boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _c public.google_calendar_connections;
BEGIN
  IF NOT public.google_calendar_can_manage(_teacher) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege', HINT = 'google_sem_permissao';
  END IF;
  IF (_import OR _export) AND NOT public.account_can('google_calendar') THEN
    RAISE EXCEPTION 'O Google Agenda não está disponível no seu plano.' USING ERRCODE = 'check_violation', HINT = 'plano:google_calendar';
  END IF;
  IF _import AND NOT public.account_can('google_calendar_import') THEN
    RAISE EXCEPTION 'Trazer o ocupado do Google faz parte do Start, do Pro e do Max.' USING ERRCODE = 'check_violation', HINT = 'plano:google_calendar_import';
  END IF;
  UPDATE public.google_calendar_connections
     SET import_enabled = _import, export_enabled = _export, updated_at = now()
   WHERE teacher_id = _teacher
  RETURNING * INTO _c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conecte o Google Agenda primeiro.' USING HINT = 'google_conecte_primeiro';
  END IF;
  IF NOT _import THEN
    DELETE FROM public.blocks b USING public.teachers t
     WHERE t.id = _teacher AND b.account_id = t.account_id AND b.source = 'google'
       AND b.teacher = public.teacher_slug(t.name);
  END IF;
  INSERT INTO public.google_sync_queue (teacher_id) VALUES (_teacher) ON CONFLICT DO NOTHING;
END $$;

-- Sem o plano que importa, a passada da função só apaga o ocupado antigo.
CREATE OR REPLACE FUNCTION public.google_calendar_replace_busy(_teacher uuid, _from timestamptz, _to timestamptz, _ranges jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _t public.teachers; _n integer;
BEGIN
  SELECT * INTO _t FROM public.teachers WHERE id = _teacher;
  IF NOT FOUND THEN RETURN 0; END IF;
  DELETE FROM public.blocks
   WHERE account_id = _t.account_id AND source = 'google'
     AND teacher = public.teacher_slug(_t.name)
     AND (start_at < _to AND end_at > _from OR NOT public.account_can('google_calendar_import', _t.account_id));
  IF NOT public.account_can('google_calendar_import', _t.account_id) THEN RETURN 0; END IF;
  INSERT INTO public.blocks (account_id, teacher, title, block_type, start_at, end_at, source)
  SELECT _t.account_id, public.teacher_slug(_t.name), 'Ocupado (Google)', 'one_off',
         greatest((r->>'start')::timestamptz, _from), least((r->>'end')::timestamptz, _to), 'google'
    FROM jsonb_array_elements(coalesce(_ranges, '[]'::jsonb)) r
   WHERE (r->>'end')::timestamptz > (r->>'start')::timestamptz;
  GET DIAGNOSTICS _n = ROW_COUNT;
  DELETE FROM public.blocks
   WHERE account_id = _t.account_id AND source = 'google'
     AND teacher = public.teacher_slug(_t.name) AND end_at < now() - interval '2 days';
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.google_calendar_replace_busy(uuid, timestamptz, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_replace_busy(uuid, timestamptz, timestamptz, jsonb) TO service_role;

-- Max IA (11/10, Thiago): o conector de IA (Claude, ChatGPT...) passa a ser
-- do Max, que muda de nome para "Max IA" ("Max AI" em inglês). No teste
-- grátis do Pro ele vale só nos 3 primeiros dias, para dar o gosto. Pro pago,
-- Start e Essencial: sem conector (o assistente do app continua como era).

-- >>> plan_features: GERADO por `npm run gen:plans` a partir de supabase/functions/_shared/plans.ts. Não edite à mão.
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'start' THEN '{"active_client_days":60,"ai_connector":false,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":true,"email_branding":false,"email_custom":false,"extra_teachers_allowed":false,"google_calendar":false,"included_teachers":1,"max_active_clients":25,"max_students":null,"max_teachers":1,"nome":"Cronys Start","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro_solo' THEN '{"active_client_days":60,"ai_connector":false,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":3,"assistant_included":true,"assistant_messages":100,"assistant_needs_payment":true,"auto_messages_quota":null,"email_billing":true,"email_branding":true,"email_custom":false,"extra_teachers_allowed":true,"google_calendar":true,"included_teachers":1,"max_active_clients":null,"max_students":null,"max_teachers":3,"nome":"Cronys Pro","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro' THEN '{"active_client_days":60,"ai_connector":true,"any_teacher":true,"arrival_location":true,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":5,"assistant_included":true,"assistant_messages":200,"assistant_needs_payment":true,"auto_messages_quota":null,"email_billing":true,"email_branding":true,"email_custom":true,"extra_teachers_allowed":true,"google_calendar":true,"included_teachers":5,"max_active_clients":null,"max_students":null,"max_teachers":null,"nome":"Cronys Max IA","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":true,"vocabulary":true,"whatsapp_auto":true,"whatsapp_link":true}'::jsonb
    ELSE '{"active_client_days":60,"ai_connector":false,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":false,"email_branding":false,"email_custom":false,"extra_teachers_allowed":false,"google_calendar":false,"included_teachers":1,"max_active_clients":10,"max_students":null,"max_teachers":1,"nome":"Cronys Essencial","packages":false,"recurring_blocks":false,"services_multi":false,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":false}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public.plan_trial_days()
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT 14 $$;
-- <<< plan_features

-- Pode usar o conector? Diz também por quê, e até quando no teste.
CREATE OR REPLACE FUNCTION public.ai_connector_access(_account uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN coalesce((public.plan_features(a.plan) ->> 'ai_connector')::boolean, false)
      THEN jsonb_build_object('allowed', true, 'reason', 'plan')
    WHEN a.plan = 'pro_solo' AND a.trial_ends_at IS NOT NULL
         AND coalesce(a.billing_status, 'none') NOT IN ('active', 'past_due')
         AND now() < a.trial_ends_at - make_interval(days => public.plan_trial_days() - 3)
      THEN jsonb_build_object('allowed', true, 'reason', 'trial',
                              'until', a.trial_ends_at - make_interval(days => public.plan_trial_days() - 3))
    ELSE jsonb_build_object('allowed', false, 'reason', 'plan')
  END
  FROM public.accounts a
  WHERE a.id = _account
$$;
REVOKE ALL ON FUNCTION public.ai_connector_access(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_connector_access(uuid) TO service_role;

-- A tela de Conectar IA pergunta pela empresa de quem está logado.
CREATE OR REPLACE FUNCTION public.ai_connector_my_access()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(public.ai_connector_access(public.ai_connector_admin_account()),
                  jsonb_build_object('allowed', false, 'reason', 'not_admin'))
$$;
REVOKE ALL ON FUNCTION public.ai_connector_my_access() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_connector_my_access() TO authenticated;

-- Criar: só quem pode usar (o gestor cria a dele sempre).
CREATE OR REPLACE FUNCTION public.ai_connector_create(_label text DEFAULT NULL, _read_only boolean DEFAULT false, _platform boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _acct uuid;
  _tok text;
  _id uuid;
  _n int;
  _name text := left(coalesce(nullif(btrim(_label), ''), 'Claude'), 60);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _platform THEN
    IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not allowed'; END IF;
  ELSE
    _acct := public.ai_connector_admin_account();
    IF _acct IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
    IF NOT coalesce((public.ai_connector_access(_acct) ->> 'allowed')::boolean, false) THEN
      RAISE EXCEPTION 'Conectar IA é do plano Max IA.';
    END IF;
  END IF;

  SELECT count(*) INTO _n FROM public.ai_connectors c
   WHERE c.revoked_at IS NULL
     AND (CASE WHEN _platform THEN c.scope = 'platform' ELSE c.account_id = _acct END);
  IF _n >= 10 THEN
    RAISE EXCEPTION 'Limite de 10 conexões ativas. Desligue uma antes de criar outra.';
  END IF;

  _tok := 'crn_' || encode(gen_random_bytes(20), 'hex');
  INSERT INTO public.ai_connectors (scope, account_id, created_by, label, read_only, token_hash, token_hint)
  VALUES (CASE WHEN _platform THEN 'platform' ELSE 'account' END, _acct, auth.uid(), _name,
          coalesce(_read_only, false) OR _platform, encode(digest(_tok, 'sha256'), 'hex'), right(_tok, 4))
  RETURNING id INTO _id;
  RETURN jsonb_build_object('id', _id, 'token', _tok);
END $$;

-- Usar: a chave da empresa sem o plano volta marcada (blocked = 'plan'), para
-- a função mcp responder "é do Max IA" em vez de "chave inválida".
CREATE OR REPLACE FUNCTION public.ai_connector_resolve(_token text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE _c public.ai_connectors;
BEGIN
  IF _token IS NULL OR _token !~ '^crn_[0-9a-f]{40}$' THEN RETURN NULL; END IF;
  SELECT * INTO _c FROM public.ai_connectors
   WHERE token_hash = encode(digest(_token, 'sha256'), 'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF _c.scope = 'platform' THEN
    IF NOT EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id = _c.created_by) THEN RETURN NULL; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.user_roles r
                    WHERE r.user_id = _c.created_by AND r.role = 'admin' AND r.account_id = _c.account_id) THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = _c.account_id AND a.active) THEN RETURN NULL; END IF;
    IF NOT coalesce((public.ai_connector_access(_c.account_id) ->> 'allowed')::boolean, false) THEN
      RETURN jsonb_build_object('id', _c.id, 'scope', _c.scope, 'blocked', 'plan');
    END IF;
  END IF;

  IF _c.last_used_at IS NULL OR _c.last_used_at < now() - interval '1 minute' THEN
    UPDATE public.ai_connectors SET last_used_at = now() WHERE id = _c.id;
  END IF;
  RETURN jsonb_build_object('id', _c.id, 'scope', _c.scope, 'account_id', _c.account_id,
                            'read_only', _c.read_only, 'user_id', _c.created_by);
END $$;

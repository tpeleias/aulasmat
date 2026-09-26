-- Planos novos (26/09): Essencial, Start, Pro e Max, com preço e limite
-- definidos num lugar só (supabase/functions/_shared/plans.ts).
--
-- O que muda aqui:
--   1. Plano novo 'start'.
--   2. plan_features() gerada do arquivo de planos (bloco marcado abaixo).
--   3. O limite de clientes passa a ser de clientes ATIVOS: quem tem
--      atendimento nos últimos active_client_days (60) ou algum marcado para
--      frente. Cadastrar é livre; o que se recusa é marcar o atendimento que
--      tornaria ativo um cliente além do limite. Nada que já existe é travado.
--   4. Rebaixar não trava mais cliente nenhum (as travas de cliente que
--      existiam são soltas). Profissional continua como antes: acima do
--      limite, todos ficam pausados e o admin escolhe quem volta.
--   5. IA: amostra de 20 mensagens no Pro (vale também no teste), somada às
--      100 do adicional quando contratado; o adicional existe no Start e no Pro.

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_plan_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_plan_check
  CHECK (plan = ANY (ARRAY['essencial'::text, 'start'::text, 'pro_solo'::text, 'pro'::text]));

-- >>> plan_features: GERADO por `npm run gen:plans` a partir de supabase/functions/_shared/plans.ts. Não edite à mão.
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'start' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"extra_teachers_allowed":false,"included_teachers":1,"max_active_clients":25,"max_students":null,"max_teachers":1,"nome":"Cronys Start","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro_solo' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0.6,"assistant_included":true,"assistant_messages":20,"assistant_needs_payment":false,"auto_messages_quota":null,"extra_teachers_allowed":true,"included_teachers":1,"max_active_clients":null,"max_students":null,"max_teachers":3,"nome":"Cronys Pro","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro' THEN '{"active_client_days":60,"any_teacher":true,"arrival_location":true,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":5,"assistant_included":true,"assistant_messages":200,"assistant_needs_payment":true,"auto_messages_quota":null,"extra_teachers_allowed":true,"included_teachers":5,"max_active_clients":null,"max_students":null,"max_teachers":null,"nome":"Cronys Max","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":true,"vocabulary":true,"whatsapp_auto":true,"whatsapp_link":true}'::jsonb
    ELSE '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"extra_teachers_allowed":false,"included_teachers":1,"max_active_clients":10,"max_students":null,"max_teachers":1,"nome":"Cronys Essencial","packages":false,"recurring_blocks":false,"services_multi":false,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":false}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public.plan_trial_days()
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT 14 $$;
-- <<< plan_features

-- ---------------------------------------------------------------------------
-- Assistente: quem tem, e quantas mensagens por mês
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.account_can(_capability text, _account uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _capability = 'assistant' THEN coalesce(
      (SELECT coalesce(a.assistant_override, false)
              OR ((public.plan_features(a.plan) ->> 'assistant_messages')::int > 0
                  AND (NOT (public.plan_features(a.plan) ->> 'assistant_needs_payment')::boolean
                       OR a.billing_status IN ('active', 'past_due')))
         FROM public.accounts a
        WHERE a.id = coalesce(_account, public.current_account_id())),
      false)
    ELSE coalesce((public.plan_features(public.account_plan(_account)) ->> _capability)::boolean, false)
  END
$$;

-- As do plano + as do adicional (quando comprado). Quem só tem a liberação
-- manual do gestor (sem plano que traga IA) fica com a franquia do adicional.
CREATE OR REPLACE FUNCTION public.assistant_limits(_account uuid)
RETURNS TABLE(messages integer, cost_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    coalesce(a.assistant_monthly_messages,
      nullif((f ->> 'assistant_messages')::int
             + CASE WHEN a.assistant_billed AND (f ->> 'assistant_addon')::boolean
                    THEN (f ->> 'assistant_addon_messages')::int ELSE 0 END, 0),
      (f ->> 'assistant_addon_messages')::int),
    coalesce(a.assistant_monthly_cost_usd,
      nullif((f ->> 'assistant_cost_usd')::numeric
             + CASE WHEN a.assistant_billed AND (f ->> 'assistant_addon')::boolean
                    THEN (f ->> 'assistant_addon_cost_usd')::numeric ELSE 0 END, 0),
      (f ->> 'assistant_addon_cost_usd')::numeric)
  FROM public.accounts a
  CROSS JOIN LATERAL (SELECT public.plan_features(a.plan) AS f) x
  WHERE a.id = _account
$$;

-- ---------------------------------------------------------------------------
-- Cliente ativo
-- ---------------------------------------------------------------------------

-- O mesmo cliente é o mesmo nome + responsável, como no resto do app.
CREATE OR REPLACE FUNCTION public.client_key(_student text, _guardian text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT lower(btrim(coalesce(_student, ''))) || '|' || lower(btrim(coalesce(_guardian, ''))) $$;

-- Atendimento que conta: marcado, pedido ou feito, a partir de N dias atrás
-- (o que está no futuro entra junto).
CREATE OR REPLACE FUNCTION public.active_client_count_for(_account uuid, _exclude_lesson uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(DISTINCT public.client_key(l.student_name, l.guardian_name))::int
    FROM public.lessons l
   WHERE l.account_id = _account
     AND l.id IS DISTINCT FROM _exclude_lesson
     AND l.status IN ('agendada', 'solicitada', 'realizada')
     AND l.start_at >= now() - make_interval(days =>
           (public.plan_features(public.account_plan(_account)) ->> 'active_client_days')::int)
$$;
REVOKE ALL ON FUNCTION public.active_client_count_for(uuid, uuid) FROM public, anon, authenticated;

-- O número que a tela mostra ("X de 25 clientes ativos"), só da própria empresa.
CREATE OR REPLACE FUNCTION public.active_client_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT public.active_client_count_for(public.current_account_id()) $$;
REVOKE ALL ON FUNCTION public.active_client_count() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.active_client_count() TO authenticated;

-- A trava dos atendimentos: profissional pausado (como antes) e, agora, o
-- limite de clientes ativos. Cliente que já está ativo nunca é barrado.
CREATE OR REPLACE FUNCTION public.enforce_lesson_plan_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _f jsonb;
  _limit int;
  _days int;
  _desde timestamptz;
  _key text;
BEGIN
  IF coalesce(current_setting('cronys.renomeando_professor', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('agendada', 'solicitada', 'realizada') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.student_name IS NOT DISTINCT FROM NEW.student_name
     AND OLD.guardian_name IS NOT DISTINCT FROM NEW.guardian_name
     AND OLD.teacher IS NOT DISTINCT FROM NEW.teacher THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('agendada', 'solicitada') AND EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.account_id = NEW.account_id
       AND t.plan_locked
       AND regexp_replace(
             translate(lower(btrim(t.name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
             '\s+', '-', 'g')
         = lower(btrim(NEW.teacher))
  ) THEN
    RAISE EXCEPTION 'Não é possível agendar com este profissional agora: o cadastro está pausado.'
      USING ERRCODE = 'check_violation', HINT = 'profissional_pausado';
  END IF;

  _f := public.plan_features(public.account_plan(NEW.account_id));
  _limit := (_f ->> 'max_active_clients')::int;
  IF _limit IS NULL THEN
    RETURN NEW;
  END IF;
  _days := (_f ->> 'active_client_days')::int;
  _desde := now() - make_interval(days => _days);
  IF NEW.start_at < _desde THEN
    RETURN NEW;  -- atendimento antigo não torna ninguém ativo
  END IF;
  _key := public.client_key(NEW.student_name, NEW.guardian_name);

  -- A própria linha já contava (marcado -> feito, ou o nome do cliente ou
  -- do responsável corrigido em todos os atendimentos dele): não é cliente novo.
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('agendada', 'solicitada', 'realizada')
     AND OLD.start_at >= _desde THEN
    RETURN NEW;
  END IF;

  -- Já é ativo por outro atendimento.
  IF EXISTS (
    SELECT 1 FROM public.lessons l
     WHERE l.account_id = NEW.account_id
       AND l.id <> NEW.id
       AND l.status IN ('agendada', 'solicitada', 'realizada')
       AND l.start_at >= _desde
       AND public.client_key(l.student_name, l.guardian_name) = _key
  ) THEN
    RETURN NEW;
  END IF;

  IF public.active_client_count_for(NEW.account_id, NEW.id) >= _limit THEN
    -- A família também pode cair aqui (pedido pelo portal): a mensagem não
    -- fala de plano; a tela do admin troca pelo convite de upgrade (hint).
    RAISE EXCEPTION 'A agenda não está aceitando clientes novos agora.'
      USING ERRCODE = 'check_violation', HINT = 'limite_clientes_ativos:' || _limit;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Rebaixar não trava cliente: solta as travas de cliente que existiam
-- ---------------------------------------------------------------------------

UPDATE public.students SET plan_locked = false WHERE plan_locked;

-- A mensagem do limite de profissionais não cita mais um plano específico.
CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _limit int;
  _atual int;
BEGIN
  _limit := public.account_limit(TG_ARGV[0], NEW.account_id);
  IF _limit IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_ARGV[0] = 'teachers' THEN
    IF NEW.active IS NOT TRUE THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO _atual FROM public.teachers
     WHERE account_id = NEW.account_id AND active;
    IF _atual >= _limit THEN
      RAISE EXCEPTION 'O seu plano permite % profissional(is) ativo(s).', _limit
        USING ERRCODE = 'check_violation', HINT = 'limite_profissionais_cadastrar:' || _limit;
    END IF;
  ELSE
    IF NEW.plan_locked THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO _atual FROM public.students
     WHERE account_id = NEW.account_id AND NOT plan_locked;
    IF _atual >= _limit THEN
      RAISE EXCEPTION 'O seu plano permite % clientes.', _limit
        USING ERRCODE = 'check_violation', HINT = 'limite_clientes_cadastrar:' || _limit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 'start' aceito pela cobrança e pelo gestor; o plano diz os ativos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.billing_apply_subscription(_account uuid, _customer text, _subscription text, _status text, _plan text, _interval text, _period_end timestamp with time zone, _assistant boolean DEFAULT NULL::boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.accounts;
  _novo text;
BEGIN
  IF _plan IS NOT NULL AND _plan NOT IN ('start', 'pro_solo', 'pro') THEN
    RAISE EXCEPTION 'plano inválido: %', _plan;
  END IF;

  SELECT * INTO _row FROM public.accounts WHERE id = _account FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  _novo := CASE
    WHEN _status IN ('active', 'trialing') THEN 'active'
    WHEN _status IN ('past_due', 'unpaid', 'incomplete') THEN 'past_due'
    ELSE 'canceled'
  END;

  UPDATE public.accounts SET
    stripe_customer_id = coalesce(_customer, stripe_customer_id),
    stripe_subscription_id = CASE WHEN _novo = 'canceled' THEN NULL ELSE coalesce(_subscription, stripe_subscription_id) END,
    billing_status = _novo,
    billing_interval = coalesce(_interval, billing_interval),
    paid_until = CASE WHEN _novo = 'active' THEN _period_end ELSE paid_until END,
    past_due_since = CASE
      WHEN _novo = 'past_due' THEN coalesce(past_due_since, now())
      ELSE NULL END,
    plan = CASE
      WHEN _novo = 'active' AND _plan IS NOT NULL THEN _plan
      WHEN _novo = 'canceled' THEN 'essencial'
      ELSE plan END,
    trial_ends_at = CASE WHEN _novo = 'active' THEN NULL ELSE trial_ends_at END,
    assistant_override = CASE
      WHEN _novo = 'active' AND _assistant IS TRUE THEN true
      WHEN assistant_billed AND (_novo = 'canceled' OR _assistant IS FALSE) THEN false
      ELSE assistant_override END,
    assistant_billed = CASE
      WHEN _novo = 'active' AND _assistant IS TRUE THEN true
      WHEN _novo = 'canceled' OR _assistant IS FALSE THEN false
      ELSE assistant_billed END
  WHERE id = _account
  RETURNING * INTO _row;

  RETURN jsonb_build_object('plan', _row.plan, 'billing_status', _row.billing_status,
                            'assistant', _row.assistant_override)
         || public.apply_plan_locks(_account);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_set_account_plan(_account uuid, _plan text DEFAULT NULL::text, _assistant_override boolean DEFAULT NULL::boolean, _clear_override boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.accounts;
  _travas jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _plan IS NOT NULL AND _plan NOT IN ('essencial', 'start', 'pro_solo', 'pro') THEN
    RAISE EXCEPTION 'plano inválido: %', _plan;
  END IF;

  UPDATE public.accounts
     SET plan = coalesce(_plan, plan),
         trial_ends_at = CASE WHEN _plan IS NOT NULL THEN NULL ELSE trial_ends_at END,
         assistant_override = CASE
           WHEN _clear_override THEN coalesce(_plan, plan) <> 'essencial'
           ELSE coalesce(_assistant_override, assistant_override) END
   WHERE id = _account
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  IF _plan IS NOT NULL THEN
    _travas := public.apply_plan_locks(_row.id);
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'plan', _row.plan,
                            'assistant_override', _row.assistant_override,
                            'assistant', public.account_can('assistant', _row.id))
         || _travas;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.plan_features(a.plan)
      || jsonb_build_object(
           'plano', CASE WHEN a.plan = 'essencial' THEN 'essencial' ELSE 'pro' END,
           'tier', a.plan,
           'assistant', public.account_can('assistant'),
           'assistant_override', coalesce(a.assistant_override, false),
           'assistant_billed', a.assistant_billed,
           'assistant_on_sale', public.assistant_on_sale(),
           'trial_ends_at', a.trial_ends_at,
           'tester_until', a.tester_until,
           'school_code', a.slug,
           'billing_status', a.billing_status,
           'billing_interval', a.billing_interval,
           'paid_until', a.paid_until,
           'grace_until', CASE WHEN a.past_due_since IS NOT NULL
                               THEN a.past_due_since + make_interval(days => public.billing_grace_days()) END,
           'extra_teachers', public.account_extra_teachers(a.id),
           'active_clients', public.active_client_count_for(a.id),
           'assistant_usage', public.assistant_usage_status(a.id))
    FROM public.accounts a
   WHERE a.id = public.current_account_id()
  UNION ALL
  SELECT public.plan_features('essencial') || jsonb_build_object('plano', 'essencial', 'tier', 'essencial', 'assistant', false, 'assistant_override', false, 'assistant_on_sale', public.assistant_on_sale())
   WHERE public.current_account_id() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = public.current_account_id())
  LIMIT 1
$$;

-- Planos novos, assinatura pelo Stripe e limite de uso do assistente.
--
-- 1. PLANOS. O cardápio passa a ter duas faixas pagas:
--      pro_solo   - Cronys Pro Solo   (R$ 49): 1 profissional, clientes sem limite
--      pro        - Cronys Pro Equipe (R$ 99): 5 profissionais incluídos, e cada
--                   extra é COBRADO (R$ 19), não bloqueado
--    O valor 'pro' continua existindo e passa a querer dizer Equipe. Por quê:
--    toda conta Pro de hoje vira Equipe sem migrar dado nenhum (decisão: ninguém
--    perde nada; quem quiser pagar menos passa para o Solo), o teste de 14 dias
--    continua sendo do Pro completo, e os apps já instalados - que comparam
--    plano === 'pro' - seguem funcionando. my_plan() devolve `plano` = 'pro'
--    nas duas faixas e a faixa exata em `tier`.
--
-- 2. ASSINATURA. O Stripe manda o que aconteceu (webhook, edge function
--    stripe-webhook) e o banco decide o plano (billing_apply_subscription).
--    Atrasou: a conta segue no plano por billing_grace_days() dias e depois
--    cai para o Essencial com a trava de rebaixamento que já existe - nada é
--    apagado. Empresa sem assinatura no Stripe (as de hoje, ligadas à mão pelo
--    gestor) nunca é rebaixada por esta rotina.
--
-- 3. ASSISTENTE. Cada resposta grava os tokens que a API devolveu; a função
--    confere o limite do mês ANTES de chamar a API. Dois limites por empresa:
--    mensagens (o que o cliente vê) e custo em dólar (a trava de verdade, que
--    ele não vê). O gestor muda os dois no painel.

-- ---------------------------------------------------------------------------
-- 1. Planos
-- ---------------------------------------------------------------------------

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_plan_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_plan_check CHECK (plan IN ('essencial', 'pro_solo', 'pro'));

CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'pro' THEN jsonb_build_object(
      'nome',              'Cronys Pro Equipe',
      -- Sem teto: acima dos incluídos, cada profissional ativo é cobrado.
      'max_teachers',      null,
      'included_teachers', 5,
      'max_students',      null,
      'assistant',         false,
      'packages',          true,
      'recurring_blocks',  true,
      'vocabulary',        true
    )
    WHEN 'pro_solo' THEN jsonb_build_object(
      'nome',              'Cronys Pro Solo',
      'max_teachers',      1,
      'included_teachers', 1,
      'max_students',      null,
      'assistant',         false,
      'packages',          true,
      'recurring_blocks',  true,
      'vocabulary',        true
    )
    ELSE jsonb_build_object(
      'nome',              'Cronys Essencial',
      'max_teachers',      1,
      'included_teachers', 1,
      'max_students',      5,
      'assistant',         false,
      'packages',          false,
      'recurring_blocks',  false,
      'vocabulary',        false
    )
  END
$$;

-- As travas depois de uma troca de plano, para qualquer par de planos. Antes
-- era "virou Pro: libera tudo; senão: trava", o que com o Solo no meio estaria
-- errado nos dois sentidos (Equipe -> Solo precisa travar profissionais e
-- liberar clientes).
CREATE OR REPLACE FUNCTION public.apply_plan_locks(_account uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _max_s int := public.account_limit('students', _account);
  _max_t int := public.account_limit('teachers', _account);
  _r jsonb := '{}'::jsonb;
  _n int;
BEGIN
  IF _max_s IS NULL THEN
    UPDATE public.students SET plan_locked = false WHERE account_id = _account AND plan_locked;
    GET DIAGNOSTICS _n = ROW_COUNT;
    _r := _r || jsonb_build_object('alunos_liberados', _n);
  END IF;
  IF _max_t IS NULL THEN
    UPDATE public.teachers SET active = true WHERE account_id = _account AND plan_locked;
    GET DIAGNOSTICS _n = ROW_COUNT;
    _r := _r || jsonb_build_object('professores_liberados', _n);
  END IF;
  -- lock_over_plan_limits só mexe no que passa do limite atual.
  RETURN _r || public.lock_over_plan_limits(_account);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plan_locks(uuid) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Assinatura
-- ---------------------------------------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  -- none | active | past_due | canceled
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS billing_interval text,
  ADD COLUMN IF NOT EXISTS paid_until timestamptz,
  ADD COLUMN IF NOT EXISTS past_due_since timestamptz,
  ADD COLUMN IF NOT EXISTS billed_extra_teachers int NOT NULL DEFAULT 0;

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_billing_status_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_billing_status_check CHECK (billing_status IN ('none', 'active', 'past_due', 'canceled'));

CREATE UNIQUE INDEX IF NOT EXISTS accounts_stripe_customer_key
  ON public.accounts (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Quantos dias uma assinatura atrasada segue valendo. Um número só, aqui:
-- mudar é trocar esta linha (decisão provisória de 25/09: 7 dias).
CREATE OR REPLACE FUNCTION public.billing_grace_days()
RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 7 $$;

-- Profissionais ativos que passam dos incluídos: é o que vira cobrança extra.
CREATE OR REPLACE FUNCTION public.account_extra_teachers(_account uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT greatest(0,
    (SELECT count(*)::int FROM public.teachers t WHERE t.account_id = _account AND t.active)
    - coalesce((public.plan_features(public.account_plan(_account)) ->> 'included_teachers')::int, 1))
$$;

REVOKE ALL ON FUNCTION public.account_extra_teachers(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.account_extra_teachers(uuid) TO authenticated, service_role;

-- O que o webhook do Stripe manda aplicar. Só a chave mestra chama (a edge
-- function, depois de conferir a assinatura do Stripe).
--   _status: o status da assinatura no Stripe (active, trialing, past_due,
--            unpaid, incomplete, canceled, incomplete_expired, paused)
--   _plan:   'pro_solo' | 'pro', do metadata do produto
CREATE OR REPLACE FUNCTION public.billing_apply_subscription(
  _account uuid,
  _customer text,
  _subscription text,
  _status text,
  _plan text,
  _interval text,
  _period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _row public.accounts;
  _novo text;
BEGIN
  IF _plan IS NOT NULL AND _plan NOT IN ('pro_solo', 'pro') THEN
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
    -- Pagou: vale o plano que comprou, e o teste grátis acabou.
    plan = CASE
      WHEN _novo = 'active' AND _plan IS NOT NULL THEN _plan
      WHEN _novo = 'canceled' THEN 'essencial'
      ELSE plan END,
    trial_ends_at = CASE WHEN _novo = 'active' THEN NULL ELSE trial_ends_at END
  WHERE id = _account
  RETURNING * INTO _row;

  RETURN jsonb_build_object('plan', _row.plan, 'billing_status', _row.billing_status)
         || public.apply_plan_locks(_account);
END;
$$;

REVOKE ALL ON FUNCTION public.billing_apply_subscription(uuid, text, text, text, text, text, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription(uuid, text, text, text, text, text, timestamptz) TO service_role;

-- Roda todo dia: quem está em atraso há mais que a tolerância cai para o
-- Essencial. A assinatura no Stripe continua lá; se a pessoa pagar depois, o
-- webhook devolve o plano.
CREATE OR REPLACE FUNCTION public.expire_unpaid_subscriptions()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _n int := 0;
BEGIN
  FOR _id IN
    SELECT id FROM public.accounts
     WHERE billing_status = 'past_due'
       AND plan <> 'essencial'
       AND past_due_since <= now() - make_interval(days => public.billing_grace_days())
  LOOP
    UPDATE public.accounts SET plan = 'essencial' WHERE id = _id;
    PERFORM public.apply_plan_locks(_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unpaid_subscriptions() FROM public, anon, authenticated;

SELECT cron.schedule('expire-unpaid-subscriptions', '30 3 * * *', 'SELECT public.expire_unpaid_subscriptions()');

-- ---------------------------------------------------------------------------
-- 3. Uso do assistente
-- ---------------------------------------------------------------------------

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS assistant_monthly_messages int NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS assistant_monthly_cost_usd numeric(8,2) NOT NULL DEFAULT 5.00;

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_assistant_limits_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_assistant_limits_check
  CHECK (assistant_monthly_messages >= 0 AND assistant_monthly_cost_usd >= 0);

CREATE TABLE IF NOT EXISTS public.assistant_usage (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  month date NOT NULL,
  messages int NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, month)
);

ALTER TABLE public.assistant_usage ENABLE ROW LEVEL SECURITY;

-- Escreve só a edge function (chave mestra). O admin lê o da própria empresa.
DROP POLICY IF EXISTS "admins read own assistant usage" ON public.assistant_usage;
CREATE POLICY "admins read own assistant usage" ON public.assistant_usage
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id());

REVOKE ALL ON public.assistant_usage FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.assistant_usage FROM authenticated;

-- O mês é o de Brasília: a virada do mês para o cliente é à meia-noite dele.
CREATE OR REPLACE FUNCTION public.assistant_month()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date
$$;

-- A conta ANTES de chamar a API: pode mandar mais uma mensagem?
CREATE OR REPLACE FUNCTION public.assistant_usage_status(_account uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH a AS (
    SELECT id, assistant_monthly_messages AS lim, assistant_monthly_cost_usd AS cap
      FROM public.accounts WHERE id = coalesce(_account, public.current_account_id())
  ), u AS (
    SELECT coalesce(sum(messages), 0) AS msgs, coalesce(sum(cost_usd), 0) AS cost
      FROM public.assistant_usage WHERE account_id = (SELECT id FROM a) AND month = public.assistant_month()
  )
  SELECT jsonb_build_object(
    'used', u.msgs,
    'limit', a.lim,
    -- Custo só para quem cuida da plataforma; o cliente vê mensagens.
    'allowed', u.msgs < a.lim AND u.cost < a.cap,
    'month', public.assistant_month())
  FROM a, u
$$;

REVOKE ALL ON FUNCTION public.assistant_usage_status(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assistant_usage_status(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assistant_usage_add(
  _account uuid, _input bigint, _output bigint, _cache_read bigint, _cache_write bigint, _cost numeric
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  INSERT INTO public.assistant_usage AS u
    (account_id, month, messages, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
  VALUES (_account, public.assistant_month(), 1, _input, _output, _cache_read, _cache_write, _cost)
  ON CONFLICT (account_id, month) DO UPDATE SET
    messages = u.messages + 1,
    input_tokens = u.input_tokens + EXCLUDED.input_tokens,
    output_tokens = u.output_tokens + EXCLUDED.output_tokens,
    cache_read_tokens = u.cache_read_tokens + EXCLUDED.cache_read_tokens,
    cache_write_tokens = u.cache_write_tokens + EXCLUDED.cache_write_tokens,
    cost_usd = u.cost_usd + EXCLUDED.cost_usd
$$;

REVOKE ALL ON FUNCTION public.assistant_usage_add(uuid, bigint, bigint, bigint, bigint, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_usage_add(uuid, bigint, bigint, bigint, bigint, numeric) TO service_role;

-- O gestor muda os limites de uma empresa.
CREATE OR REPLACE FUNCTION public.platform_set_assistant_limits(_account uuid, _messages int, _cost_usd numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.accounts;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  UPDATE public.accounts SET
    assistant_monthly_messages = coalesce(_messages, assistant_monthly_messages),
    assistant_monthly_cost_usd = coalesce(_cost_usd, assistant_monthly_cost_usd)
  WHERE id = _account RETURNING * INTO _row;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'empresa não encontrada'; END IF;
  RETURN jsonb_build_object('messages', _row.assistant_monthly_messages, 'cost_usd', _row.assistant_monthly_cost_usd);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_set_assistant_limits(uuid, int, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_assistant_limits(uuid, int, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. O que a tela lê
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.plan_features(a.plan)
      || jsonb_build_object(
           -- 'pro' nas duas faixas: é o que o app antigo entende por "pago".
           'plano', CASE WHEN a.plan = 'essencial' THEN 'essencial' ELSE 'pro' END,
           'tier', a.plan,
           'assistant', public.account_can('assistant'),
           'assistant_override', coalesce(a.assistant_override, false),
           'trial_ends_at', a.trial_ends_at,
           'school_code', a.slug,
           'billing_status', a.billing_status,
           'billing_interval', a.billing_interval,
           'paid_until', a.paid_until,
           'grace_until', CASE WHEN a.past_due_since IS NOT NULL
                               THEN a.past_due_since + make_interval(days => public.billing_grace_days()) END,
           'extra_teachers', public.account_extra_teachers(a.id),
           'assistant_usage', public.assistant_usage_status(a.id))
    FROM public.accounts a
   WHERE a.id = public.current_account_id()
  UNION ALL
  -- Sem empresa: o mesmo de antes (Essencial), para a tela não quebrar.
  SELECT public.plan_features('essencial') || jsonb_build_object('plano', 'essencial', 'tier', 'essencial', 'assistant', false, 'assistant_override', false)
   WHERE public.current_account_id() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = public.current_account_id())
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.platform_set_account_plan(_account uuid, _plan text DEFAULT NULL::text, _assistant_override boolean DEFAULT NULL::boolean, _clear_override boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _row public.accounts;
  _travas jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _plan IS NOT NULL AND _plan NOT IN ('essencial', 'pro_solo', 'pro') THEN
    RAISE EXCEPTION 'plano inválido: %', _plan;
  END IF;

  UPDATE public.accounts
     SET plan = coalesce(_plan, plan),
         trial_ends_at = CASE WHEN _plan IS NOT NULL THEN NULL ELSE trial_ends_at END,
         assistant_override = CASE
           -- Painel antigo (até o app 1.10.1): "limpar" num Pro queria dizer ligar.
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

-- O painel do gestor ganha ramo, assinatura e uso do assistente. A assinatura
-- de retorno muda, então a função é recriada.
DROP FUNCTION IF EXISTS public.platform_accounts_overview();
CREATE FUNCTION public.platform_accounts_overview()
RETURNS TABLE(id uuid, name text, slug text, active boolean, is_public_default boolean, created_at timestamptz,
              plan text, assistant boolean, assistant_override boolean, responsaveis bigint, alunos bigint,
              professores bigint, aulas bigint, logins bigint, ultima_aula timestamptz, alunos_travados bigint,
              professores_travados bigint, trial_ends_at timestamptz,
              business_model text, billing_status text, paid_until timestamptz, past_due_since timestamptz,
              assistant_messages int, assistant_cost_usd numeric, assistant_monthly_messages int, assistant_monthly_cost_usd numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT a.id, a.name, a.slug, a.active, a.is_public_default, a.created_at,
         a.plan,
         public.account_can('assistant', a.id),
         a.assistant_override,
         (SELECT count(DISTINCT lower(btrim(s.guardian_name))) FROM public.students s
           WHERE s.account_id = a.id AND nullif(btrim(coalesce(s.guardian_name, '')), '') IS NOT NULL),
         (SELECT count(*) FROM public.students s WHERE s.account_id = a.id),
         (SELECT count(*) FROM public.teachers t WHERE t.account_id = a.id AND t.active),
         (SELECT count(*) FROM public.lessons l WHERE l.account_id = a.id),
         (SELECT count(*) FROM public.user_roles r WHERE r.account_id = a.id),
         (SELECT max(l.start_at) FROM public.lessons l WHERE l.account_id = a.id),
         (SELECT count(*) FROM public.students s WHERE s.account_id = a.id AND s.plan_locked),
         (SELECT count(*) FROM public.teachers t WHERE t.account_id = a.id AND t.plan_locked),
         a.trial_ends_at,
         a.business_model,
         a.billing_status,
         a.paid_until,
         a.past_due_since,
         coalesce((SELECT u.messages FROM public.assistant_usage u WHERE u.account_id = a.id AND u.month = public.assistant_month()), 0),
         coalesce((SELECT u.cost_usd FROM public.assistant_usage u WHERE u.account_id = a.id AND u.month = public.assistant_month()), 0),
         a.assistant_monthly_messages,
         a.assistant_monthly_cost_usd
    FROM public.accounts a
   ORDER BY a.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_accounts_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_accounts_overview() TO authenticated;

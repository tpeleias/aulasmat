-- Tolerância de atraso de 2 dias, e o assistente pronto para ser vendido -
-- mas fora de venda e desligado em todas as empresas.
--
-- Decisão do Thiago (24/09): por enquanto ninguém usa o assistente, para não
-- gerar gasto na API. Quando a cobrança começar, ele vira um ADICIONAL da
-- assinatura (produto "Cronys Assistente" no Stripe, lookup_key
-- cronys_assistente_mensal / _anual). Tudo abaixo já funciona; o que o mantém
-- fora de venda é assistant_on_sale() = false. Para vender: trocar essa linha.

-- ---------------------------------------------------------------------------
-- 1. Tolerância: 2 dias (era 7)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.billing_grace_days()
RETURNS int LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT 2 $$;

-- ---------------------------------------------------------------------------
-- 2. O interruptor da venda do assistente
-- ---------------------------------------------------------------------------

-- false = a tela não oferece e o checkout não aceita o adicional. Não mexe em
-- quem o gestor liberar à mão (assistant_override).
CREATE OR REPLACE FUNCTION public.assistant_on_sale()
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT false $$;

GRANT EXECUTE ON FUNCTION public.assistant_on_sale() TO authenticated, service_role;

-- Separa "comprou o adicional" de "o gestor liberou de cortesia": tirar o
-- adicional da assinatura desliga só o que foi comprado.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS assistant_billed boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 3. O webhook passa a dizer se a assinatura tem o adicional
-- ---------------------------------------------------------------------------
-- _assistant: true = tem o item do assistente; false = não tem; nulo = não
-- sabe (não mexe). A versão de 7 argumentos sai; a edge function antiga, que
-- não manda _assistant, continua casando com esta pelo valor padrão.

DROP FUNCTION IF EXISTS public.billing_apply_subscription(uuid, text, text, text, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.billing_apply_subscription(
  _account uuid,
  _customer text,
  _subscription text,
  _status text,
  _plan text,
  _interval text,
  _period_end timestamptz,
  _assistant boolean DEFAULT NULL
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
    plan = CASE
      WHEN _novo = 'active' AND _plan IS NOT NULL THEN _plan
      WHEN _novo = 'canceled' THEN 'essencial'
      ELSE plan END,
    trial_ends_at = CASE WHEN _novo = 'active' THEN NULL ELSE trial_ends_at END,
    -- O adicional: ligado enquanto a assinatura paga o tiver. Cortesia do
    -- gestor (assistant_billed falso) não é desligada por aqui.
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

REVOKE ALL ON FUNCTION public.billing_apply_subscription(uuid, text, text, text, text, text, timestamptz, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_subscription(uuid, text, text, text, text, text, timestamptz, boolean) TO service_role;

-- Rebaixado por atraso também perde o adicional comprado: sem pagamento, sem
-- gasto de API.
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
    UPDATE public.accounts SET plan = 'essencial',
           assistant_override = CASE WHEN assistant_billed THEN false ELSE assistant_override END
     WHERE id = _id;
    PERFORM public.apply_plan_locks(_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unpaid_subscriptions() FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A tela sabe se o adicional está à venda e se foi comprado
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
  SELECT public.plan_features('essencial') || jsonb_build_object('plano', 'essencial', 'tier', 'essencial', 'assistant', false, 'assistant_override', false, 'assistant_on_sale', public.assistant_on_sale())
   WHERE public.current_account_id() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = public.current_account_id())
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 5. Por enquanto, ninguém usa (decisão de 24/09)
-- ---------------------------------------------------------------------------
-- Na aplicação, só o Portal de Aulas estava ligado. O gestor religa no painel
-- quando quiser (o switch "Assistente"), sem migration.
UPDATE public.accounts SET assistant_override = false WHERE assistant_override IS TRUE;

-- Pedidos do Thiago (25/09, noite):
--   1. Limite do assistente por plano, para o cliente saber o que tem:
--      Pro (adicional): 100 mensagens/mês, teto de US$ 3.
--      Max (incluso):   200 mensagens/mês, teto de US$ 5.
--      Quem usa é só o dono (admin); professor não tem o assistente.
--      accounts.assistant_monthly_* passam a ser AJUSTE À MÃO do gestor:
--      nulo = vale o do plano.
--   2. Um admin por empresa. Admin não cria outro admin (hoje nenhuma tela
--      nem função cria; a trava no banco garante daqui para frente). Exceção:
--      accounts.multi_admin, ligada só no Portal de Aulas.

-- ---------------------------------------------------------------------------
-- 1. Limites do assistente por plano
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'pro' THEN jsonb_build_object(
      'nome',               'Cronys Max',
      -- Sem teto: acima dos incluídos, cada profissional ativo é cobrado.
      'max_teachers',       null,
      'included_teachers',  5,
      'max_students',       null,
      -- O assistente em si é decidido por account_can (só com assinatura paga).
      'assistant',          false,
      'assistant_included', true,
      'assistant_messages', 200,
      'assistant_cost_usd', 5.00,
      'packages',           true,
      'recurring_blocks',   true,
      'vocabulary',         true,
      'whatsapp_link',      true,
      'whatsapp_auto',      true,
      'arrival_location',   true
    )
    WHEN 'pro_solo' THEN jsonb_build_object(
      'nome',               'Cronys Pro',
      'max_teachers',       1,
      'included_teachers',  1,
      'max_students',       null,
      'assistant',          false,
      'assistant_included', false,
      'assistant_messages', 100,
      'assistant_cost_usd', 3.00,
      'packages',           true,
      'recurring_blocks',   true,
      'vocabulary',         true,
      'whatsapp_link',      true,
      'whatsapp_auto',      false,
      'arrival_location',   false
    )
    ELSE jsonb_build_object(
      'nome',               'Cronys Essencial',
      'max_teachers',       1,
      'included_teachers',  1,
      'max_students',       5,
      'assistant',          false,
      'assistant_included', false,
      'assistant_messages', 100,
      'assistant_cost_usd', 3.00,
      'packages',           false,
      'recurring_blocks',   false,
      'vocabulary',         false,
      'whatsapp_link',      false,
      'whatsapp_auto',      false,
      'arrival_location',   false
    )
  END
$$;

ALTER TABLE public.accounts
  ALTER COLUMN assistant_monthly_messages DROP NOT NULL,
  ALTER COLUMN assistant_monthly_messages DROP DEFAULT,
  ALTER COLUMN assistant_monthly_cost_usd DROP NOT NULL,
  ALTER COLUMN assistant_monthly_cost_usd DROP DEFAULT;

COMMENT ON COLUMN public.accounts.assistant_monthly_messages IS
  'Ajuste à mão do gestor; nulo = o do plano (plan_features.assistant_messages).';
COMMENT ON COLUMN public.accounts.assistant_monthly_cost_usd IS
  'Ajuste à mão do gestor; nulo = o do plano (plan_features.assistant_cost_usd).';

-- Quem estava no padrão antigo (150 / US$ 5) passa a seguir o plano.
UPDATE public.accounts SET assistant_monthly_messages = NULL WHERE assistant_monthly_messages = 150;
UPDATE public.accounts SET assistant_monthly_cost_usd = NULL WHERE assistant_monthly_cost_usd = 5.00;

CREATE OR REPLACE FUNCTION public.assistant_limits(_account uuid)
RETURNS TABLE (messages int, cost_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(a.assistant_monthly_messages, (public.plan_features(a.plan) ->> 'assistant_messages')::int, 100),
         coalesce(a.assistant_monthly_cost_usd, (public.plan_features(a.plan) ->> 'assistant_cost_usd')::numeric, 3)
    FROM public.accounts a WHERE a.id = _account
$$;

REVOKE ALL ON FUNCTION public.assistant_limits(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assistant_usage_status(_account uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH a AS (
    SELECT l.messages AS lim, l.cost_usd AS cap, coalesce(_account, public.current_account_id()) AS id
      FROM public.assistant_limits(coalesce(_account, public.current_account_id())) l
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

REVOKE ALL ON FUNCTION public.assistant_usage_status(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_usage_status(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_accounts_overview()
RETURNS TABLE(id uuid, name text, slug text, active boolean, is_public_default boolean, created_at timestamp with time zone, plan text, assistant boolean, assistant_override boolean, responsaveis bigint, alunos bigint, professores bigint, aulas bigint, logins bigint, ultima_aula timestamp with time zone, alunos_travados bigint, professores_travados bigint, trial_ends_at timestamp with time zone, business_model text, billing_status text, paid_until timestamp with time zone, past_due_since timestamp with time zone, assistant_messages integer, assistant_cost_usd numeric, assistant_monthly_messages integer, assistant_monthly_cost_usd numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
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
         lim.messages,
         lim.cost_usd
    FROM public.accounts a
    CROSS JOIN LATERAL public.assistant_limits(a.id) lim
   ORDER BY a.created_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Um admin por empresa
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS multi_admin boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.accounts.multi_admin IS
  'Pode ter mais de um admin. Só a Cronys liga, à mão (hoje: Portal de Aulas).';
UPDATE public.accounts SET multi_admin = true WHERE slug = 'portaldeaulas';

CREATE OR REPLACE FUNCTION public.enforce_single_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role = 'admin'::app_role AND NEW.account_id IS NOT NULL
     AND NOT coalesce((SELECT multi_admin FROM public.accounts WHERE id = NEW.account_id), false)
     AND EXISTS (SELECT 1 FROM public.user_roles r
                  WHERE r.account_id = NEW.account_id AND r.role = 'admin'::app_role
                    AND r.user_id <> NEW.user_id)
  THEN
    RAISE EXCEPTION 'Esta empresa já tem um administrador. Os demais entram como profissionais.'
      USING ERRCODE = 'check_violation', HINT = 'um_admin';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_single_admin() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_single_admin ON public.user_roles;
CREATE TRIGGER user_roles_single_admin
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_admin();

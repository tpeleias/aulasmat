-- Pedidos do Thiago (25/09, depois da revisão geral):
--   6. Testador: o gestor dá o Max de cortesia a uma empresa por um período,
--      com ou sem assistente. No fim, volta sozinha ao Essencial (a menos que
--      tenha assinado).
--   7. Professor escreve o resumo da aula dele (e, se ela já começou, a marca
--      como realizada). Continua sem mexer em horário, aluno ou valor.
--   8. Intervalo entre atendimentos (Configurações; padrão 0).
--  10. Pacote de um serviço específico.

-- ---------------------------------------------------------------------------
-- 6. Testador
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS tester_until timestamptz,
  ADD COLUMN IF NOT EXISTS tester_assistant boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.tester_until IS
  'Max de cortesia (testador) até esta data; expire_testers() devolve ao Essencial.';
COMMENT ON COLUMN public.accounts.tester_assistant IS
  'A cortesia inclui o assistente (ligado pelo gestor junto com o testador).';

-- _days > 0 liga (ou renova) por tantos dias; _days <= 0 tira agora.
CREATE OR REPLACE FUNCTION public.platform_set_tester(_account uuid, _days integer, _assistant boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _row public.accounts;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT * INTO _row FROM public.accounts WHERE id = _account;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  IF coalesce(_days, 0) > 0 THEN
    UPDATE public.accounts
       SET plan = 'pro',
           trial_ends_at = NULL,
           tester_until = now() + make_interval(days => least(_days, 730)),
           tester_assistant = coalesce(_assistant, false),
           assistant_override = CASE WHEN coalesce(_assistant, false) THEN true
                                     WHEN tester_assistant THEN NULL
                                     ELSE assistant_override END
     WHERE id = _account
    RETURNING * INTO _row;
  ELSE
    PERFORM public.end_tester(_account);
    SELECT * INTO _row FROM public.accounts WHERE id = _account;
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'plan', _row.plan, 'tester_until', _row.tester_until,
                            'assistant', public.account_can('assistant', _row.id))
         || public.apply_plan_locks(_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_set_tester(uuid, integer, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_tester(uuid, integer, boolean) TO authenticated;

-- Fim da cortesia: quem assinou fica com o plano da assinatura; quem não
-- assinou volta ao Essencial. O assistente de cortesia sai junto.
CREATE OR REPLACE FUNCTION public.end_tester(_account uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.accounts
     SET plan = CASE WHEN billing_status IN ('active', 'past_due') THEN plan ELSE 'essencial' END,
         assistant_override = CASE WHEN tester_assistant THEN NULL ELSE assistant_override END,
         tester_until = NULL,
         tester_assistant = false
   WHERE id = _account AND (tester_until IS NOT NULL OR tester_assistant);
END;
$$;

REVOKE ALL ON FUNCTION public.end_tester(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_testers()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _n int := 0;
BEGIN
  FOR _id IN SELECT id FROM public.accounts WHERE tester_until IS NOT NULL AND tester_until <= now() LOOP
    PERFORM public.end_tester(_id);
    PERFORM public.apply_plan_locks(_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_testers() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_testers() TO service_role;

SELECT cron.schedule('expire-testers', '20 3 * * *', $$SELECT public.expire_testers();$$);

-- O painel do gestor mostra até quando vai a cortesia.
DROP FUNCTION IF EXISTS public.platform_accounts_overview();
CREATE FUNCTION public.platform_accounts_overview()
RETURNS TABLE(id uuid, name text, slug text, active boolean, is_public_default boolean, created_at timestamp with time zone, plan text, assistant boolean, assistant_override boolean, responsaveis bigint, alunos bigint, professores bigint, aulas bigint, logins bigint, ultima_aula timestamp with time zone, alunos_travados bigint, professores_travados bigint, trial_ends_at timestamp with time zone, business_model text, billing_status text, paid_until timestamp with time zone, past_due_since timestamp with time zone, assistant_messages integer, assistant_cost_usd numeric, assistant_monthly_messages integer, assistant_monthly_cost_usd numeric, tester_until timestamp with time zone, tester_assistant boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
         lim.cost_usd,
         a.tester_until,
         a.tester_assistant
    FROM public.accounts a
    CROSS JOIN LATERAL public.assistant_limits(a.id) lim
   ORDER BY a.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_accounts_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_accounts_overview() TO authenticated;

-- A empresa vê até quando vai a cortesia.
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
           'assistant_usage', public.assistant_usage_status(a.id))
    FROM public.accounts a
   WHERE a.id = public.current_account_id()
  UNION ALL
  SELECT public.plan_features('essencial') || jsonb_build_object('plano', 'essencial', 'tier', 'essencial', 'assistant', false, 'assistant_override', false, 'assistant_on_sale', public.assistant_on_sale())
   WHERE public.current_account_id() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = public.current_account_id())
  LIMIT 1
$function$;

-- ---------------------------------------------------------------------------
-- 7. Resumo da aula pelo professor
-- ---------------------------------------------------------------------------
-- Uma porta só, em vez de devolver ao professor o UPDATE da tabela: ele muda
-- o resumo e, se a aula já começou, o status para realizada. Nada mais.
CREATE OR REPLACE FUNCTION public.teacher_save_lesson_summary(_lesson uuid, _summary text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _row public.lessons;
BEGIN
  IF NOT public.has_role(auth.uid(), 'teacher'::app_role) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE public.lessons l
     SET class_summary = nullif(btrim(coalesce(_summary, '')), ''),
         status = CASE WHEN l.status = 'agendada' AND l.start_at <= now() THEN 'realizada' ELSE l.status END
   WHERE l.id = _lesson
     AND l.account_id = public.current_account_id()
     AND public.teacher_slug(l.teacher) = public.current_teacher_slug()
     AND (l.status = 'realizada' OR (l.status = 'agendada' AND l.start_at <= now()))
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Só dá para escrever o resumo de uma aula sua que já começou.'
      USING ERRCODE = 'check_violation', HINT = 'resumo_aula';
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'status', _row.status, 'class_summary', _row.class_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_save_lesson_summary(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.teacher_save_lesson_summary(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Intervalo entre atendimentos
-- ---------------------------------------------------------------------------
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS buffer_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_buffer_range;
ALTER TABLE public.settings ADD CONSTRAINT settings_buffer_range CHECK (buffer_minutes BETWEEN 0 AND 240);

COMMENT ON COLUMN public.settings.buffer_minutes IS
  'Minutos livres antes e depois de cada atendimento nos horários oferecidos à família (0 = colado).';

-- A página pública (sem login) também respeita o intervalo.
GRANT SELECT (buffer_minutes) ON public.settings TO anon;

-- ---------------------------------------------------------------------------
-- 10. Pacote de um serviço
-- ---------------------------------------------------------------------------
ALTER TABLE public.lesson_packages
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.services(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.lesson_packages.service_id IS
  'Pacote de um serviço específico (o voucher usa o preço dele); nulo = pacote geral.';

CREATE OR REPLACE FUNCTION public.enforce_package_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.active AND NOT public.account_can('packages', NEW.account_id) THEN
    RAISE EXCEPTION 'Pacotes são do Cronys Pro.'
      USING ERRCODE = 'check_violation', HINT = 'pacote_pro';
  END IF;
  IF NEW.service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = NEW.service_id AND s.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'check_violation', HINT = 'servico_invalido';
  END IF;
  RETURN NEW;
END;
$$;

-- Tarefas por ramo (Thiago, 03/10): "Tarefa" é coisa de aula; nos outros
-- ramos a mesma função vira outra coisa (orientação para casa, atividade entre
-- sessões, treino para casa) ou nem aparece.
--
-- 1. settings.tasks_enabled: nulo = o padrão do ramo (tasks_default); a
--    empresa liga ou desliga em Configurações. Desligada, some das telas e
--    dos e-mails, e nada se apaga.
-- 2. my_vocabulary devolve 'tasks' (quem está logado, inclusive a família e o
--    filho, sabe se mostra o menu) e aceita a palavra 'task' editada.
-- 3. Entregar marca a tarefa como entregue (antes a família mandava o arquivo
--    e o status não mudava: ela não pode dar UPDATE em homework) e
--    mark_homework_done marca sem arquivo ("Marcar como feita").

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS tasks_enabled boolean;
COMMENT ON COLUMN public.settings.tasks_enabled IS
  'Tarefas ligadas nesta empresa. Nulo = o padrão do ramo (public.tasks_default).';

CREATE OR REPLACE FUNCTION public.tasks_default(_model text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(_model, 'aulas') IN ('aulas', 'psicologia', 'saude', 'esportes')
$$;

CREATE OR REPLACE FUNCTION public.account_tasks_on(_account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT s.tasks_enabled FROM public.settings s WHERE s.account_id = _account),
    public.tasks_default((SELECT a.business_model FROM public.accounts a WHERE a.id = _account)))
$$;
REVOKE ALL ON FUNCTION public.account_tasks_on(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_tasks_on(uuid) TO authenticated, service_role;

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
           'member', public.current_account_id() IS NOT NULL,
           'tasks', public.account_tasks_on(a.id))
    FROM public.accounts a
   WHERE a.id = public.effective_account_id()
$function$;

CREATE OR REPLACE FUNCTION public.set_custom_vocabulary(_vocab jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _key text;
  _term jsonb;
  _s text;
  _p text;
  _g text;
  _clean jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') OR _acct IS NULL THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _vocab IS NULL OR _vocab = 'null'::jsonb THEN
    UPDATE public.accounts SET vocabulary = NULL WHERE id = _acct;
    RETURN public.my_vocabulary();
  END IF;

  IF NOT public.account_can('vocabulary', _acct) THEN
    RAISE EXCEPTION 'Os nomes do seu tipo de negócio são do Cronys Pro.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(_vocab) <> 'object' THEN
    RAISE EXCEPTION 'Vocabulário inválido.' USING ERRCODE = 'check_violation';
  END IF;

  FOR _key, _term IN SELECT * FROM jsonb_each(_vocab) LOOP
    IF _key NOT IN ('business', 'staff', 'appointment', 'client', 'guardian', 'topic', 'task') THEN
      RAISE EXCEPTION 'Termo desconhecido: %', _key USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(_term) <> 'object' THEN
      RAISE EXCEPTION 'Termo inválido: %', _key USING ERRCODE = 'check_violation';
    END IF;
    _s := btrim(coalesce(_term ->> 's', ''));
    _p := btrim(coalesce(_term ->> 'p', ''));
    _g := coalesce(_term ->> 'g', '');
    IF _s = '' OR _p = '' OR length(_s) > 40 OR length(_p) > 40 THEN
      RAISE EXCEPTION 'Cada nome precisa de singular e plural, com até 40 letras.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF _g NOT IN ('m', 'f') THEN
      RAISE EXCEPTION 'Gênero inválido: %', _key USING ERRCODE = 'check_violation';
    END IF;
    _clean := _clean || jsonb_build_object(_key, jsonb_build_object('s', _s, 'p', _p, 'g', _g));
  END LOOP;

  UPDATE public.accounts SET vocabulary = nullif(_clean, '{}'::jsonb) WHERE id = _acct;
  RETURN public.my_vocabulary();
END;
$$;
REVOKE ALL ON FUNCTION public.set_custom_vocabulary(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_custom_vocabulary(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Entregue: pelo arquivo ou pelo "Marcar como feita"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_submission_done()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.homework SET status = 'entregue', updated_at = now()
   WHERE id = NEW.homework_id AND status <> 'entregue';
  RETURN NULL;
END $$;
CREATE TRIGGER homework_submission_done AFTER INSERT ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.homework_submission_done();

-- A família (login do responsável ou do aluno) e o filho marcam ou desmarcam
-- a própria tarefa; nada além do status.
CREATE OR REPLACE FUNCTION public.mark_homework_done(_homework uuid, _done boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _status text;
BEGIN
  UPDATE public.homework h
     SET status = CASE WHEN _done THEN 'entregue' ELSE 'pendente' END, updated_at = now()
   WHERE h.id = _homework
     AND h.account_id = public.current_account_id()
     AND EXISTS (SELECT 1 FROM public.students s
                  WHERE s.id = h.student_id AND (s.user_id = auth.uid() OR s.child_user_id = auth.uid()))
  RETURNING h.status INTO _status;
  IF _status IS NULL THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN _status;
END $$;
REVOKE ALL ON FUNCTION public.mark_homework_done(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_homework_done(uuid, boolean) TO authenticated;

-- A tarefa que já tinha arquivo e ficou "pendente" pelo bug de antes.
UPDATE public.homework h SET status = 'entregue'
 WHERE h.status <> 'entregue'
   AND EXISTS (SELECT 1 FROM public.homework_submissions s WHERE s.homework_id = h.id);

-- ---------------------------------------------------------------------------
-- E-mail de tarefa nova só com as tarefas ligadas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acct uuid; _prefs jsonb;
BEGIN
  BEGIN
    SELECT s.account_id INTO _acct FROM public.students s WHERE s.id = NEW.student_id;
    IF _acct IS NULL OR NOT public.account_tasks_on(_acct) THEN RETURN NULL; END IF;
    SELECT st.email_notifications INTO _prefs FROM public.settings st WHERE st.account_id = _acct;
    IF NOT public.email_pref(_prefs, 'homework_new') THEN RETURN NULL; END IF;
    INSERT INTO public.email_event_outbox (account_id, kind, ref_id, process_after)
    VALUES (_acct, 'homework', NEW.id, now() + interval '2 minutes')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_event_outbox homework: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

-- Link de reunião (Thiago, 05/10): cada profissional escolhe como as aulas
-- on-line dele ganham link, e o link vai junto em tudo (aula, agenda, portal,
-- e-mails, WhatsApp, Google Agenda).
--
--   none         nada automático (dá para colar um link na própria aula)
--   fixed        a sala fixa dele (Zoom, Meet, Teams...), a mesma em toda aula
--   jitsi        uma sala nova do Jitsi Meet por aula (grátis, sem conta)
--   google_meet  um Meet por aula, criado no evento da agenda "Cronys" do
--                Google (Pro e Max, Google conectado com a exportação ligada);
--                sem isso, cai no Jitsi
--
-- lessons.meeting_source diz de onde veio o link: manual (colado na aula),
-- fixed, jitsi ou google. O automático é refeito quando a aula troca de
-- profissional ou quando o profissional muda a escolha; o colado à mão fica.
--
-- A escolha mora fora de teachers porque teachers é lida pela página pública
-- de horários: a sala fixa não pode ficar à vista de quem não é da empresa.

CREATE TABLE IF NOT EXISTS public.teacher_meeting (
  teacher_id uuid PRIMARY KEY REFERENCES public.teachers(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'none' CHECK (mode IN ('none', 'fixed', 'jitsi', 'google_meet')),
  fixed_url text CHECK (fixed_url IS NULL OR (fixed_url ~* '^https://[^\s]+$' AND length(fixed_url) <= 500)),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.teacher_meeting ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teacher_meeting FROM anon, authenticated;

ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS meeting_url text;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS meeting_source text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_meeting_source_check') THEN
    ALTER TABLE public.lessons ADD CONSTRAINT lessons_meeting_source_check
      CHECK (meeting_source IS NULL OR meeting_source IN ('manual', 'fixed', 'jitsi', 'google'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lessons_meeting_url_check') THEN
    ALTER TABLE public.lessons ADD CONSTRAINT lessons_meeting_url_check
      CHECK (meeting_url IS NULL OR (meeting_url ~* '^https?://[^\s]+$' AND length(meeting_url) <= 500));
  END IF;
END $$;
COMMENT ON COLUMN public.lessons.meeting_url IS 'Link da reunião da aula on-line (migration 20261005010000).';
COMMENT ON COLUMN public.lessons.meeting_source IS 'De onde veio o link: manual, fixed, jitsi ou google (pendente enquanto meeting_url é nulo).';

-- O Google cria o Meet: conectado, exportando e no plano certo.
CREATE OR REPLACE FUNCTION public.meeting_google_ready(_teacher uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.google_calendar_connections c
     WHERE c.teacher_id = _teacher AND c.export_enabled AND coalesce(c.status, '') <> 'revoked'
       AND public.account_can('google_calendar', c.account_id))
$$;
REVOKE ALL ON FUNCTION public.meeting_google_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meeting_google_ready(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.jitsi_room()
RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'https://meet.jit.si/Cronys-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)
$$;

-- ---------------------------------------------------------------------------
-- O link de cada aula
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lesson_meeting_fill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _m public.teacher_meeting;
BEGIN
  IF NOT coalesce(NEW.is_online, false) THEN
    NEW.meeting_url := NULL; NEW.meeting_source := NULL;
    RETURN NEW;
  END IF;
  NEW.meeting_url := nullif(btrim(coalesce(NEW.meeting_url, '')), '');

  IF TG_OP = 'INSERT' THEN
    IF NEW.meeting_url IS NOT NULL THEN NEW.meeting_source := coalesce(NEW.meeting_source, 'manual'); END IF;
  ELSE
    -- Quem mexeu no link foi a pessoa (a origem não mudou junto): é dela.
    -- A volta do Google (pendente -> link) continua sendo do Google.
    IF NEW.meeting_url IS DISTINCT FROM OLD.meeting_url
       AND NEW.meeting_source IS NOT DISTINCT FROM OLD.meeting_source
       AND NOT (OLD.meeting_source = 'google' AND OLD.meeting_url IS NULL) THEN
      NEW.meeting_source := CASE WHEN NEW.meeting_url IS NULL THEN NULL ELSE 'manual' END;
    END IF;
    -- Outro profissional: o link automático é o dele.
    IF NEW.teacher IS DISTINCT FROM OLD.teacher AND coalesce(NEW.meeting_source, '') <> 'manual' THEN
      NEW.meeting_url := NULL; NEW.meeting_source := NULL;
    END IF;
  END IF;

  IF NEW.meeting_url IS NOT NULL OR NEW.meeting_source = 'google' THEN RETURN NEW; END IF;
  NEW.meeting_source := NULL;

  SELECT m.* INTO _m
    FROM public.teachers t JOIN public.teacher_meeting m ON m.teacher_id = t.id
   WHERE t.account_id = NEW.account_id AND public.teacher_slug(t.name) = lower(NEW.teacher)
   LIMIT 1;
  IF NOT FOUND OR _m.mode = 'none' THEN RETURN NEW; END IF;

  IF _m.mode = 'fixed' THEN
    IF _m.fixed_url IS NOT NULL THEN NEW.meeting_url := _m.fixed_url; NEW.meeting_source := 'fixed'; END IF;
  ELSIF _m.mode = 'google_meet' AND public.meeting_google_ready(_m.teacher_id) THEN
    NEW.meeting_source := 'google';
  ELSE
    NEW.meeting_url := public.jitsi_room(); NEW.meeting_source := 'jitsi';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER lessons_meeting_fill BEFORE INSERT OR UPDATE OF is_online, teacher, meeting_url, meeting_source ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lesson_meeting_fill();

-- ---------------------------------------------------------------------------
-- A escolha de cada profissional: o admin vê e muda todos; o profissional com
-- login, só a dele.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meeting_can_manage(_teacher uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.id = _teacher AND t.account_id = public.current_account_id()
       AND (public.has_role(auth.uid(), 'admin'::app_role)
            OR (t.user_id = auth.uid() AND public.has_role(auth.uid(), 'teacher'::app_role))))
$$;
REVOKE ALL ON FUNCTION public.meeting_can_manage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meeting_can_manage(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.meeting_settings()
RETURNS TABLE(teacher_id uuid, teacher_name text, mode text, fixed_url text, google_ready boolean, is_self boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT t.id, t.name, coalesce(m.mode, 'none'), m.fixed_url,
         public.meeting_google_ready(t.id),
         t.user_id = auth.uid() OR t.admin_user_id = auth.uid()
    FROM public.teachers t
    LEFT JOIN public.teacher_meeting m ON m.teacher_id = t.id
   WHERE t.active AND public.meeting_can_manage(t.id)
   ORDER BY t.sort_order, t.name
$$;
REVOKE ALL ON FUNCTION public.meeting_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meeting_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_meeting_settings(_teacher uuid, _mode text, _fixed_url text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acct uuid; _url text := nullif(btrim(coalesce(_fixed_url, '')), ''); _old public.teacher_meeting; _slug text;
BEGIN
  IF NOT public.meeting_can_manage(_teacher) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _mode NOT IN ('none', 'fixed', 'jitsi', 'google_meet') THEN
    RAISE EXCEPTION 'Escolha inválida.' USING ERRCODE = 'check_violation';
  END IF;
  IF _url IS NOT NULL AND _url !~* '^https?://' THEN _url := 'https://' || _url; END IF;
  IF _url IS NOT NULL AND (_url !~* '^https://[^\s]+$' OR length(_url) > 500) THEN
    RAISE EXCEPTION 'O link precisa começar com https:// e não ter espaços.' USING ERRCODE = 'check_violation';
  END IF;
  IF _mode = 'fixed' AND _url IS NULL THEN
    RAISE EXCEPTION 'Cole o link da sua sala.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT t.account_id, public.teacher_slug(t.name) INTO _acct, _slug FROM public.teachers t WHERE t.id = _teacher;
  SELECT * INTO _old FROM public.teacher_meeting WHERE teacher_id = _teacher;
  INSERT INTO public.teacher_meeting (teacher_id, account_id, mode, fixed_url, updated_at)
  VALUES (_teacher, _acct, _mode, _url, now())
  ON CONFLICT (teacher_id) DO UPDATE SET mode = EXCLUDED.mode, fixed_url = EXCLUDED.fixed_url, updated_at = now();

  -- Mudou a escolha: as próximas aulas on-line com link automático passam a
  -- usar a nova (o colado à mão fica). Mesma escolha, mesmos links.
  IF coalesce(_old.mode, 'none') IS DISTINCT FROM _mode OR (_mode = 'fixed' AND _old.fixed_url IS DISTINCT FROM _url) THEN
    UPDATE public.lessons l SET meeting_url = NULL, meeting_source = NULL
     WHERE l.account_id = _acct AND lower(l.teacher) = _slug AND l.is_online
       AND l.start_at > now() - interval '1 hour'
       AND l.status IN ('agendada', 'solicitada')
       AND coalesce(l.meeting_source, '') <> 'manual';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_meeting_settings(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_meeting_settings(uuid, text, text) TO authenticated;

-- "Gerar outro link" na aula: o admin pede um novo automático.
CREATE OR REPLACE FUNCTION public.regenerate_lesson_meeting(_lesson uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _url text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not allowed'; END IF;
  UPDATE public.lessons SET meeting_url = NULL, meeting_source = NULL
   WHERE id = _lesson AND account_id = public.current_account_id() AND is_online
  RETURNING meeting_url INTO _url;
  RETURN _url;
END $$;
REVOKE ALL ON FUNCTION public.regenerate_lesson_meeting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_lesson_meeting(uuid) TO authenticated;

-- O login do filho (get_child_lessons não tem o link e mudar o retorno dela
-- pediria recriá-la): os links das próximas aulas on-line dele.
CREATE OR REPLACE FUNCTION public.get_child_meetings()
RETURNS TABLE(id uuid, meeting_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT l.id, l.meeting_url
    FROM public.lessons l
    JOIN public.students s
      ON s.account_id = l.account_id
     AND lower(btrim(s.student_name)) = lower(btrim(l.student_name))
     AND coalesce(nullif(btrim(s.guardian_name), ''), '') = coalesce(nullif(btrim(l.guardian_name), ''), '')
   WHERE s.child_user_id = auth.uid()
     AND s.account_id = public.current_account_id()
     AND l.is_online AND l.meeting_url IS NOT NULL
     AND l.start_at > now() - interval '3 hours'
$$;
REVOKE ALL ON FUNCTION public.get_child_meetings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_child_meetings() TO authenticated;

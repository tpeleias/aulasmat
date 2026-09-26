-- Google Agenda do CLIENTE (Thiago, 26/09). Pro e Max, só exportar.
--
-- A empresa liga um switch (settings.client_google_calendar) e cada cliente
-- com acesso ao portal pode conectar o próprio Google: os horários dele vão
-- para uma agenda "Cronys" na conta Google dele, como "Aula com Thiago ·
-- Matemática" (a palavra "Aula" é a do ramo da empresa), com endereço ou
-- "Online", sem valores. O sentido contrário não existe: nada do Google do
-- cliente é lido.
--
-- Mesmo desenho do Google do profissional (20260926140000): o banco guarda a
-- conexão (refresh token fechado), enfileira quem teve aula mexida e o pg_cron
-- cutuca a função google-calendar.

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS client_google_calendar boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.client_calendar_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  google_email text,
  refresh_token text NOT NULL,
  access_token text,
  access_expires_at timestamptz,
  export_calendar_id text,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'revoked')),
  last_error text,
  last_export_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_calendar_connections_account_idx ON public.client_calendar_connections (account_id);
ALTER TABLE public.client_calendar_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_calendar_connections FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.client_calendar_queue (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_calendar_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_calendar_queue FROM anon, authenticated;

-- A empresa deixa os clientes conectarem? (switch ligado e plano com Google Agenda)
CREATE OR REPLACE FUNCTION public.client_calendar_enabled(_account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT s.client_google_calendar FROM public.settings s WHERE s.account_id = _account LIMIT 1), false)
     AND public.account_can('google_calendar', _account)
$$;

-- A palavra do atendimento no ramo da empresa ("Aula", "Consulta", "Sessão"...),
-- a mesma de src/lib/vocabulary.ts, com a editada pela empresa por cima.
CREATE OR REPLACE FUNCTION public.account_appointment_word(_account uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    CASE WHEN public.account_can('vocabulary', a.id) THEN nullif(btrim(a.vocabulary -> 'appointment' ->> 's'), '') END,
    CASE WHEN a.locale = 'en' THEN
      CASE a.business_model WHEN 'aulas' THEN 'Lesson' WHEN 'psicologia' THEN 'Session' WHEN 'esportes' THEN 'Session'
                            WHEN 'oficina' THEN 'Service visit' ELSE 'Appointment' END
    ELSE
      CASE a.business_model WHEN 'aulas' THEN 'Aula' WHEN 'saude' THEN 'Consulta' WHEN 'psicologia' THEN 'Sessão'
                            WHEN 'pet' THEN 'Consulta Pet' WHEN 'esportes' THEN 'Treino' WHEN 'oficina' THEN 'Revisão'
                            ELSE 'Atendimento' END
    END)
    FROM public.accounts a WHERE a.id = _account
$$;

-- As aulas que o cliente vê no portal (mesma regra de student_account_matches:
-- o responsável e o acesso próprio do filho), numa janela. Só a função chama.
CREATE OR REPLACE FUNCTION public.client_calendar_lessons(_user uuid, _from timestamptz, _to timestamptz)
RETURNS TABLE(id uuid, start_at timestamptz, duration_minutes integer, teacher_name text,
              what text, address text, is_online boolean, word text, locale text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT l.id, l.start_at, l.duration_minutes,
         initcap(coalesce(t.name, l.teacher)),
         coalesce(nullif(btrim(sv.name), ''), nullif(btrim(l.subject), '')),
         l.address, coalesce(l.is_online, false),
         public.account_appointment_word(l.account_id), a.locale
    FROM public.students s
    JOIN public.lessons l
      ON l.account_id = s.account_id
     AND lower(btrim(l.student_name)) = lower(btrim(s.student_name))
     AND coalesce(nullif(btrim(l.guardian_name), ''), '') = coalesce(nullif(btrim(s.guardian_name), ''), '')
    JOIN public.accounts a ON a.id = l.account_id
    LEFT JOIN public.teachers t ON t.account_id = l.account_id AND public.teacher_slug(t.name) = lower(l.teacher)
    LEFT JOIN public.services sv ON sv.id = l.service_id
   WHERE (s.user_id = _user OR s.child_user_id = _user)
     AND l.status NOT IN ('solicitada', 'cancelada', 'recusada')
     AND l.start_at >= _from AND l.start_at <= _to
$$;

-- O portal: a empresa deixa? já está conectado?
CREATE OR REPLACE FUNCTION public.client_calendar_status()
RETURNS TABLE(enabled boolean, connected boolean, google_email text, status text, last_error text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.client_calendar_enabled(public.current_account_id())
         AND (public.has_role(auth.uid(), 'student'::app_role) OR public.has_role(auth.uid(), 'child'::app_role)),
         c.user_id IS NOT NULL, c.google_email, c.status, c.last_error
    FROM (SELECT 1) x
    LEFT JOIN public.client_calendar_connections c ON c.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.client_calendar_forget(_user uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM public.client_calendar_queue WHERE user_id = _user;
  DELETE FROM public.client_calendar_connections WHERE user_id = _user;
$$;

REVOKE ALL ON FUNCTION public.client_calendar_enabled(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_appointment_word(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_calendar_lessons(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_calendar_forget(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_calendar_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_calendar_enabled(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_appointment_word(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_calendar_lessons(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_calendar_forget(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_calendar_status() TO authenticated;

-- Aula mexida -> fila dos clientes conectados que a veem. Nunca derruba o
-- salvamento da aula (a passada de 10 em 10 minutos corrige).
CREATE OR REPLACE FUNCTION public.lessons_client_calendar_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    INSERT INTO public.client_calendar_queue (user_id)
    SELECT DISTINCT c.user_id
      FROM public.client_calendar_connections c
      JOIN public.students s ON (s.user_id = c.user_id OR s.child_user_id = c.user_id) AND s.account_id = c.account_id
     WHERE (TG_OP <> 'DELETE'
            AND s.account_id = NEW.account_id
            AND lower(btrim(s.student_name)) = lower(btrim(NEW.student_name))
            AND coalesce(nullif(btrim(s.guardian_name), ''), '') = coalesce(nullif(btrim(NEW.guardian_name), ''), ''))
        OR (TG_OP <> 'INSERT'
            AND s.account_id = OLD.account_id
            AND lower(btrim(s.student_name)) = lower(btrim(OLD.student_name))
            AND coalesce(nullif(btrim(s.guardian_name), ''), '') = coalesce(nullif(btrim(OLD.guardian_name), ''), ''))
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'client_calendar_queue: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS lessons_client_calendar_sync ON public.lessons;
CREATE TRIGGER lessons_client_calendar_sync AFTER INSERT OR UPDATE OR DELETE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_client_calendar_enqueue();

-- O cron passa a olhar também a fila e as conexões dos clientes.
SELECT cron.schedule('google-calendar-push', '* * * * *',
  $$SELECT public.google_calendar_kick('push') WHERE EXISTS (SELECT 1 FROM public.google_sync_queue) OR EXISTS (SELECT 1 FROM public.client_calendar_queue)$$);
SELECT cron.schedule('google-calendar-pull', '*/10 * * * *',
  $$SELECT public.google_calendar_kick('pull') WHERE EXISTS (SELECT 1 FROM public.google_calendar_connections WHERE status <> 'revoked') OR EXISTS (SELECT 1 FROM public.client_calendar_connections WHERE status <> 'revoked')$$);

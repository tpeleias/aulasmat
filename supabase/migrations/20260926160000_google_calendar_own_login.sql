-- Google Agenda: quem tem login próprio conecta o próprio Google (Thiago, 26/09).
--
-- Antes o admin podia conectar/desligar o Google de qualquer profissional. Mas
-- a conexão dá acesso à agenda PESSOAL de alguém: o funcionário com login é o
-- único que deve ligar, mexer nos switches ou desconectar a dele. O admin só vê
-- se está sincronizado. Profissional sem login (o próprio dono que atende, ou
-- alguém sem acesso ao app) continua com o admin.

CREATE OR REPLACE FUNCTION public.google_calendar_can_manage(_teacher uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.id = _teacher
       AND t.account_id = public.current_account_id()
       AND ((t.user_id = auth.uid() AND public.has_role(auth.uid(), 'teacher'::app_role))
            OR (t.user_id IS NULL AND public.has_role(auth.uid(), 'admin'::app_role))))
$$;

-- A tela: o admin vê todos (e só mexe em quem não tem login); o profissional, a si.
DROP FUNCTION IF EXISTS public.google_calendar_status();
CREATE FUNCTION public.google_calendar_status()
RETURNS TABLE(teacher_id uuid, teacher_name text, connected boolean, google_email text,
              import_enabled boolean, export_enabled boolean, status text, last_error text,
              last_import_at timestamptz, last_export_at timestamptz,
              can_manage boolean, has_login boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT t.id, t.name, c.teacher_id IS NOT NULL, c.google_email,
         coalesce(c.import_enabled, false), coalesce(c.export_enabled, false),
         c.status, c.last_error, c.last_import_at, c.last_export_at,
         public.google_calendar_can_manage(t.id), t.user_id IS NOT NULL
    FROM public.teachers t
    LEFT JOIN public.google_calendar_connections c ON c.teacher_id = t.id
   WHERE t.active
     AND t.account_id = public.current_account_id()
     AND (public.has_role(auth.uid(), 'admin'::app_role)
          OR (t.user_id = auth.uid() AND public.has_role(auth.uid(), 'teacher'::app_role)))
   ORDER BY t.sort_order, t.name
$$;
REVOKE ALL ON FUNCTION public.google_calendar_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_calendar_status() TO authenticated;

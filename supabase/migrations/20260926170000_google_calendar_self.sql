-- Google Agenda: cada um conecta SÓ o próprio Google (Thiago, 26/09).
--
-- O admin não entra no Google de outra pessoa, então o botão "Conectar" na
-- linha de outro profissional não servia para nada. Agora:
--   - profissional com login (papel teacher) conecta o próprio;
--   - admin conecta só o cadastro de profissional que é ELE MESMO, marcado
--     uma vez em teachers.admin_user_id ("sou eu");
--   - os demais só aparecem com a situação (sincronizado / não conectado).
-- Empresa com mais de um admin (multi_admin): cada admin marca o seu.

ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teachers_admin_user_id_key ON public.teachers (admin_user_id) WHERE admin_user_id IS NOT NULL;
COMMENT ON COLUMN public.teachers.admin_user_id IS
  'O admin que É este profissional (o dono que também atende). Só ele conecta o Google deste cadastro.';

-- Quem já conectou o próprio Google fica marcado como "sou eu" daquele cadastro.
UPDATE public.teachers t
   SET admin_user_id = c.connected_by
  FROM public.google_calendar_connections c
 WHERE c.teacher_id = t.id
   AND t.user_id IS NULL
   AND t.admin_user_id IS NULL
   AND c.connected_by IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.user_roles r
                WHERE r.user_id = c.connected_by AND r.role = 'admin'::app_role AND r.account_id = t.account_id)
   AND NOT EXISTS (SELECT 1 FROM public.teachers o WHERE o.admin_user_id = c.connected_by);

-- Empresa de um admin só e um profissional só sem login: é ele.
UPDATE public.teachers t
   SET admin_user_id = (SELECT r.user_id FROM public.user_roles r
                         WHERE r.account_id = t.account_id AND r.role = 'admin'::app_role LIMIT 1)
 WHERE t.user_id IS NULL AND t.admin_user_id IS NULL AND t.active
   AND (SELECT count(*) FROM public.user_roles r WHERE r.account_id = t.account_id AND r.role = 'admin'::app_role) = 1
   AND (SELECT count(*) FROM public.teachers o WHERE o.account_id = t.account_id AND o.active AND o.user_id IS NULL) = 1
   AND NOT EXISTS (SELECT 1 FROM public.teachers o
                    WHERE o.admin_user_id = (SELECT r.user_id FROM public.user_roles r
                                              WHERE r.account_id = t.account_id AND r.role = 'admin'::app_role LIMIT 1));

CREATE OR REPLACE FUNCTION public.google_calendar_can_manage(_teacher uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.id = _teacher
       AND t.account_id = public.current_account_id()
       AND ((t.user_id = auth.uid() AND public.has_role(auth.uid(), 'teacher'::app_role))
            OR (t.admin_user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'::app_role))))
$$;

-- O admin diz qual cadastro é ele (ou nenhum, com NULL). Só cadastro sem login
-- e ainda não marcado por outro admin.
CREATE OR REPLACE FUNCTION public.google_calendar_claim_self(_teacher uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acct uuid := public.current_account_id();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) OR _acct IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _teacher IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.teachers t
        WHERE t.id = _teacher AND t.account_id = _acct AND t.user_id IS NULL
          AND (t.admin_user_id IS NULL OR t.admin_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Esse cadastro não pode ser marcado como seu.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Trocar de cadastro com o Google ligado deixaria a agenda "Cronys" órfã lá:
  -- primeiro desconecta (pela tela, que apaga a agenda e revoga o acesso).
  IF EXISTS (SELECT 1 FROM public.teachers t
               JOIN public.google_calendar_connections c ON c.teacher_id = t.id
              WHERE t.admin_user_id = auth.uid() AND t.id IS DISTINCT FROM _teacher) THEN
    RAISE EXCEPTION 'Desconecte o Google do seu cadastro atual antes de trocar.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.teachers SET admin_user_id = NULL
   WHERE admin_user_id = auth.uid() AND id IS DISTINCT FROM _teacher;
  IF _teacher IS NOT NULL THEN
    UPDATE public.teachers SET admin_user_id = auth.uid() WHERE id = _teacher;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.google_calendar_claim_self(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_calendar_claim_self(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.google_calendar_status();
CREATE FUNCTION public.google_calendar_status()
RETURNS TABLE(teacher_id uuid, teacher_name text, connected boolean, google_email text,
              import_enabled boolean, export_enabled boolean, status text, last_error text,
              last_import_at timestamptz, last_export_at timestamptz,
              can_manage boolean, has_login boolean, is_self boolean, claimable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT t.id, t.name, c.teacher_id IS NOT NULL, c.google_email,
         coalesce(c.import_enabled, false), coalesce(c.export_enabled, false),
         c.status, c.last_error, c.last_import_at, c.last_export_at,
         public.google_calendar_can_manage(t.id), t.user_id IS NOT NULL,
         t.admin_user_id = auth.uid() OR t.user_id = auth.uid(),
         public.has_role(auth.uid(), 'admin'::app_role) AND t.user_id IS NULL AND t.admin_user_id IS NULL
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

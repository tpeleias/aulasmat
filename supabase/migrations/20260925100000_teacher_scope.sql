-- Professor é funcionário (Thiago, 25/09): o login dele é informativo.
--   - Aulas: só VÊ as próprias. Não marca, não edita, não desmarca (quem mexe
--     na agenda é o admin).
--   - Alunos: só os que têm (ou tiveram) aula com ele. Não cadastra aluno.
--   - Bloqueios: continua livre na própria agenda.
--   - Material e tarefa: pode pôr para aluno com quem JÁ deu aula (aula
--     realizada), e só apaga o que ele mesmo pôs.
-- De quebra: os arquivos de material/tarefa ficavam liberados para o admin de
-- QUALQUER empresa (a regra olhava só o papel). Agora olham a empresa também.

-- ---------------------------------------------------------------------------
-- Quem é "aluno do professor"
-- ---------------------------------------------------------------------------
-- A aula guarda o nome do aluno (e do responsável), não o id. Casa pelo nome;
-- havendo responsável na aula, ele também tem que bater (homônimos).
CREATE OR REPLACE FUNCTION public.teacher_has_student(_student uuid, _only_done boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'teacher'::app_role) AND EXISTS (
    SELECT 1
      FROM public.students s
      JOIN public.lessons l
        ON l.account_id = s.account_id
       AND lower(btrim(l.student_name)) = lower(btrim(s.student_name))
       AND (nullif(btrim(coalesce(l.guardian_name, '')), '') IS NULL
            OR lower(btrim(l.guardian_name)) = lower(btrim(coalesce(s.guardian_name, ''))))
     WHERE s.id = _student
       AND s.account_id = public.current_account_id()
       AND public.teacher_slug(l.teacher) = public.current_teacher_slug()
       AND CASE WHEN _only_done THEN l.status = 'realizada'
                ELSE l.status NOT IN ('cancelada', 'recusada') END
  )
$$;

REVOKE ALL ON FUNCTION public.teacher_has_student(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.teacher_has_student(uuid, boolean) TO authenticated;

-- O mesmo, a partir da pasta do arquivo no storage (pasta = id do aluno). Pasta
-- que não é id vira "não", em vez de erro.
CREATE OR REPLACE FUNCTION public.teacher_has_student_folder(_folder text, _only_done boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN _folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN public.teacher_has_student(_folder::uuid, _only_done) ELSE false END
$$;

REVOKE ALL ON FUNCTION public.teacher_has_student_folder(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.teacher_has_student_folder(text, boolean) TO authenticated;

-- Pasta do arquivo no storage = id do aluno. Serve às regras dos arquivos.
CREATE OR REPLACE FUNCTION public.storage_student_in_my_account(_folder text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.students s
                  WHERE s.id::text = _folder AND s.account_id = public.current_account_id())
$$;

REVOKE ALL ON FUNCTION public.storage_student_in_my_account(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.storage_student_in_my_account(text) TO authenticated;

-- Quem pôs o material / a tarefa: preenchido pelo banco, para o professor só
-- apagar o que é dele.
ALTER TABLE public.homework ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.student_materials ALTER COLUMN uploaded_by SET DEFAULT auth.uid();

-- ---------------------------------------------------------------------------
-- Aulas: só leitura
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "teachers insert own lessons" ON public.lessons;
DROP POLICY IF EXISTS "teachers update own lessons" ON public.lessons;

-- ---------------------------------------------------------------------------
-- Alunos: só os dele, sem cadastrar
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "teachers insert students" ON public.students;
DROP POLICY IF EXISTS "teachers read students" ON public.students;
CREATE POLICY "teachers read own students" ON public.students
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND public.teacher_has_student(id));

-- ---------------------------------------------------------------------------
-- Tarefas
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "teachers read homework" ON public.homework;
CREATE POLICY "teachers read homework of own students" ON public.homework
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND public.teacher_has_student(student_id));
CREATE POLICY "teachers add homework for taught students" ON public.homework
  FOR INSERT TO authenticated
  WITH CHECK (account_id = public.current_account_id() AND created_by = auth.uid() AND public.teacher_has_student(student_id, true));
CREATE POLICY "teachers edit own homework" ON public.homework
  FOR UPDATE TO authenticated
  USING (account_id = public.current_account_id() AND created_by = auth.uid() AND public.teacher_has_student(student_id, true))
  WITH CHECK (account_id = public.current_account_id() AND created_by = auth.uid() AND public.teacher_has_student(student_id, true));
CREATE POLICY "teachers delete own homework" ON public.homework
  FOR DELETE TO authenticated
  USING (account_id = public.current_account_id() AND created_by = auth.uid() AND public.teacher_has_student(student_id, true));

DROP POLICY IF EXISTS "teachers read homework_submissions" ON public.homework_submissions;
CREATE POLICY "teachers read submissions of own students" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.homework h WHERE h.id = homework_id AND public.teacher_has_student(h.student_id)));
-- Comentário do professor na entrega (teacher_feedback).
CREATE POLICY "teachers comment submissions of taught students" ON public.homework_submissions
  FOR UPDATE TO authenticated
  USING (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.homework h WHERE h.id = homework_id AND public.teacher_has_student(h.student_id, true)))
  WITH CHECK (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.homework h WHERE h.id = homework_id AND public.teacher_has_student(h.student_id, true)));

-- ---------------------------------------------------------------------------
-- Materiais
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "teachers read student_materials" ON public.student_materials;
CREATE POLICY "teachers read materials of own students" ON public.student_materials
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND public.teacher_has_student(student_id));
CREATE POLICY "teachers add materials for taught students" ON public.student_materials
  FOR INSERT TO authenticated
  WITH CHECK (account_id = public.current_account_id() AND uploaded_by = auth.uid() AND public.teacher_has_student(student_id, true));
CREATE POLICY "teachers delete own materials" ON public.student_materials
  FOR DELETE TO authenticated
  USING (account_id = public.current_account_id() AND uploaded_by = auth.uid() AND public.teacher_has_student(student_id, true));

-- ---------------------------------------------------------------------------
-- Arquivos (storage): admin só da própria empresa; professor só dos seus
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "admins all student-materials" ON storage.objects;
DROP POLICY IF EXISTS "admins manage materials files" ON storage.objects;
DROP POLICY IF EXISTS "admins all homework-submissions" ON storage.objects;
DROP POLICY IF EXISTS "admins manage homework files" ON storage.objects;

CREATE POLICY "admins manage own account student-materials" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'student-materials' AND public.has_role(auth.uid(), 'admin'::app_role)
         AND public.storage_student_in_my_account((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'student-materials' AND public.has_role(auth.uid(), 'admin'::app_role)
              AND public.storage_student_in_my_account((storage.foldername(name))[1]));

CREATE POLICY "admins manage own account homework-submissions" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'homework-submissions' AND public.has_role(auth.uid(), 'admin'::app_role)
         AND public.storage_student_in_my_account((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'homework-submissions' AND public.has_role(auth.uid(), 'admin'::app_role)
              AND public.storage_student_in_my_account((storage.foldername(name))[1]));

CREATE POLICY "teachers read own students materials files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('student-materials', 'homework-submissions')
         AND public.teacher_has_student_folder((storage.foldername(name))[1]));
CREATE POLICY "teachers upload materials for taught students" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'student-materials'
              AND public.teacher_has_student_folder((storage.foldername(name))[1], true));
CREATE POLICY "teachers delete own materials files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'student-materials' AND owner = auth.uid()
         AND public.teacher_has_student_folder((storage.foldername(name))[1], true));

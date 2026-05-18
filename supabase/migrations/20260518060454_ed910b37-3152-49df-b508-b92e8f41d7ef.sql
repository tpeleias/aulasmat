-- 1. Add 'child' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'child';

-- 2. Add columns to students table
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS child_user_id uuid,
  ADD COLUMN IF NOT EXISTS child_username text,
  ADD COLUMN IF NOT EXISTS child_must_change_password boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS students_child_username_uniq
  ON public.students (lower(child_username))
  WHERE child_username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS students_child_user_id_uniq
  ON public.students (child_user_id)
  WHERE child_user_id IS NOT NULL;

-- 3. RLS policies for the child role

-- students: child reads own record
CREATE POLICY "child reads own student"
ON public.students FOR SELECT TO authenticated
USING (child_user_id = auth.uid());

-- lessons: child reads own lessons (matched via student_name on their student record)
CREATE POLICY "child reads own lessons"
ON public.lessons FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.students s
  WHERE s.child_user_id = auth.uid() AND s.student_name = lessons.student_name
));

-- student_materials: child reads own materials
CREATE POLICY "child reads own materials"
ON public.student_materials FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.students s
  WHERE s.id = student_materials.student_id AND s.child_user_id = auth.uid()
));

-- homework: child reads own homework
CREATE POLICY "child reads own homework"
ON public.homework FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.students s
  WHERE s.id = homework.student_id AND s.child_user_id = auth.uid()
));

-- homework_submissions: child reads + inserts own submissions
CREATE POLICY "child reads own submissions"
ON public.homework_submissions FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.homework h
  JOIN public.students s ON s.id = h.student_id
  WHERE h.id = homework_submissions.homework_id AND s.child_user_id = auth.uid()
));

CREATE POLICY "child inserts own submissions"
ON public.homework_submissions FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.homework h
  JOIN public.students s ON s.id = h.student_id
  WHERE h.id = homework_submissions.homework_id AND s.child_user_id = auth.uid()
));
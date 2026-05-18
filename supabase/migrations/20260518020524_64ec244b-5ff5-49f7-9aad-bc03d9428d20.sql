
-- 1. Add 'student' role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'student';

-- 2. Link students to auth users
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE;

-- 3. Lesson status + class summary
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'agendada',
  ADD COLUMN IF NOT EXISTS class_summary text;

-- 4. Settings additions
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS payment_link text,
  ADD COLUMN IF NOT EXISTS show_payment_info_to_students boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_thiago text,
  ADD COLUMN IF NOT EXISTS whatsapp_mayara text;

-- 5. Student materials table
CREATE TABLE IF NOT EXISTS public.student_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  title text NOT NULL,
  file_path text NOT NULL,
  file_type text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.student_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage student_materials"
  ON public.student_materials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "students read own materials"
  ON public.student_materials FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_materials.student_id AND s.user_id = auth.uid()));

-- 6. Homework + submissions
CREATE TABLE IF NOT EXISTS public.homework (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.homework ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage homework"
  ON public.homework FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "students read own homework"
  ON public.homework FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = homework.student_id AND s.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.homework_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_id uuid NOT NULL REFERENCES public.homework(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_type text,
  student_note text,
  teacher_feedback text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.homework_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage submissions"
  ON public.homework_submissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "students read own submissions"
  ON public.homework_submissions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.homework h JOIN public.students s ON s.id = h.student_id
    WHERE h.id = homework_submissions.homework_id AND s.user_id = auth.uid()
  ));

CREATE POLICY "students insert own submissions"
  ON public.homework_submissions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.homework h JOIN public.students s ON s.id = h.student_id
    WHERE h.id = homework_submissions.homework_id AND s.user_id = auth.uid()
  ));

-- 7. Storage buckets (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('student-materials', 'student-materials', false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('homework-submissions', 'homework-submissions', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: paths are {student_id}/...
CREATE POLICY "admins all student-materials"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'student-materials' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'student-materials' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "students read own student-materials"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'student-materials'
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = auth.uid() AND s.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "admins all homework-submissions"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'homework-submissions' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'homework-submissions' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "students manage own homework-submissions"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'homework-submissions'
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = auth.uid() AND s.id::text = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'homework-submissions'
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = auth.uid() AND s.id::text = (storage.foldername(name))[1]
    )
  );

-- 8. Helper function: get student record for current user
CREATE OR REPLACE FUNCTION public.current_student()
RETURNS public.students
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.students WHERE user_id = auth.uid() LIMIT 1
$$;

-- 9. Allow students to see lessons that belong to them (by student_name match through linked profile)
CREATE POLICY "students read own lessons"
  ON public.lessons FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.user_id = auth.uid() AND s.student_name = lessons.student_name
  ));

-- 10. Allow students to read their own wallet transactions
CREATE POLICY "students read own wallet"
  ON public.wallet_transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.user_id = auth.uid() AND s.student_name = wallet_transactions.student_name
  ));

-- 11. Allow students to read their own student record + settings already public
CREATE POLICY "students read own student"
  ON public.students FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 12. Modify handle_new_user: don't auto-make admin if any admin exists; new signups become 'student' (unlinked)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    CASE WHEN (SELECT count(*) FROM public.user_roles WHERE role='admin') = 0
      THEN 'admin'::app_role
      ELSE 'student'::app_role
    END
  );
  RETURN NEW;
END;
$$;

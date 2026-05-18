
-- 1. Teachers table
CREATE TABLE public.teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage teachers" ON public.teachers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "anyone reads teachers" ON public.teachers FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.teachers (name) VALUES ('Thiago'),('Mayara');

-- 2. Settings: allow student booking
ALTER TABLE public.settings ADD COLUMN allow_student_booking boolean NOT NULL DEFAULT true;

-- 3. Students: must_change_password
ALTER TABLE public.students ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- 4. Update lesson wallet trigger: only create/keep tx when status='realizada'
CREATE OR REPLACE FUNCTION public.sync_lesson_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'realizada' THEN
      INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description)
      VALUES (NULLIF(trim(NEW.guardian_name),''), NEW.student_name, -NEW.price, 'lesson', NEW.id,
              'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'realizada' AND OLD.status IS DISTINCT FROM 'realizada' THEN
      -- Became realizada: create tx
      INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description)
      VALUES (NULLIF(trim(NEW.guardian_name),''), NEW.student_name, -NEW.price, 'lesson', NEW.id,
              'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'));
    ELSIF NEW.status <> 'realizada' AND OLD.status = 'realizada' THEN
      -- No longer realizada: remove tx
      DELETE FROM public.wallet_transactions WHERE lesson_id = NEW.id AND kind = 'lesson';
    ELSIF NEW.status = 'realizada' THEN
      -- Update existing tx
      UPDATE public.wallet_transactions
      SET amount = -NEW.price,
          guardian_name = NULLIF(trim(NEW.guardian_name),''),
          student_name = NEW.student_name,
          description = 'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI')
      WHERE lesson_id = NEW.id AND kind = 'lesson';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

-- Cleanup: remove wallet transactions for lessons NOT yet realizadas
DELETE FROM public.wallet_transactions
 WHERE kind = 'lesson'
   AND lesson_id IN (SELECT id FROM public.lessons WHERE status <> 'realizada');

-- 5. RLS: allow students to insert own lessons when settings.allow_student_booking is true
CREATE POLICY "students insert own lessons" ON public.lessons FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = auth.uid() AND s.student_name = lessons.student_name)
  AND EXISTS (SELECT 1 FROM public.settings WHERE id = 1 AND allow_student_booking = true)
);

-- 6. Storage policies for homework-submissions and student-materials
-- Students can read their own files (folder = student_id)
CREATE POLICY "students read own homework files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'homework-submissions'
  AND EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = auth.uid() AND s.id::text = (storage.foldername(name))[1])
);
CREATE POLICY "students upload own homework files" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'homework-submissions'
  AND EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = auth.uid() AND s.id::text = (storage.foldername(name))[1])
);
CREATE POLICY "admins manage homework files" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'homework-submissions' AND has_role(auth.uid(),'admin'))
WITH CHECK (bucket_id = 'homework-submissions' AND has_role(auth.uid(),'admin'));

CREATE POLICY "students read own materials files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'student-materials'
  AND EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = auth.uid() AND s.id::text = (storage.foldername(name))[1])
);
CREATE POLICY "admins manage materials files" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'student-materials' AND has_role(auth.uid(),'admin'))
WITH CHECK (bucket_id = 'student-materials' AND has_role(auth.uid(),'admin'));

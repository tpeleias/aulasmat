-- Students/children were matched to their lessons and wallet by student_name alone,
-- so two students sharing a first name could read each other's schedule and finances.
-- Match on the full account identity (student name + guardian) instead.

CREATE OR REPLACE FUNCTION public.student_account_matches(
  _student_name text, _guardian_name text, _child boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE (CASE WHEN _child THEN s.child_user_id ELSE s.user_id END) = auth.uid()
      AND lower(btrim(s.student_name)) = lower(btrim(_student_name))
      AND coalesce(nullif(btrim(s.guardian_name), ''), '')
          = coalesce(nullif(btrim(_guardian_name), ''), '')
  )
$$;

DROP POLICY IF EXISTS "students read own lessons" ON public.lessons;
CREATE POLICY "students read own lessons" ON public.lessons
  FOR SELECT TO authenticated
  USING (public.student_account_matches(student_name, guardian_name));

DROP POLICY IF EXISTS "students insert own lessons" ON public.lessons;
CREATE POLICY "students insert own lessons" ON public.lessons
  FOR INSERT TO authenticated
  WITH CHECK (
    public.student_account_matches(student_name, guardian_name)
    AND EXISTS (SELECT 1 FROM public.settings WHERE id = 1 AND allow_student_booking = true)
  );

DROP POLICY IF EXISTS "students read own wallet" ON public.wallet_transactions;
CREATE POLICY "students read own wallet" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (public.student_account_matches(student_name, guardian_name));

CREATE OR REPLACE FUNCTION public.get_child_lessons()
RETURNS TABLE(id uuid, start_at timestamp with time zone, subject text, duration_minutes integer, teacher text, status text, class_summary text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.id, l.start_at, l.subject, l.duration_minutes, l.teacher, l.status, l.class_summary
  FROM public.lessons l
  JOIN public.students s
    ON lower(btrim(s.student_name)) = lower(btrim(l.student_name))
   AND coalesce(nullif(btrim(s.guardian_name), ''), '')
       = coalesce(nullif(btrim(l.guardian_name), ''), '')
  WHERE s.child_user_id = auth.uid()
  ORDER BY l.start_at DESC;
$$;

-- Stray whitespace in a name orphaned the row from its cadastro.
UPDATE public.lessons SET student_name = btrim(student_name), guardian_name = nullif(btrim(guardian_name), '')
 WHERE student_name <> btrim(student_name) OR guardian_name <> btrim(guardian_name) OR guardian_name = '';
UPDATE public.wallet_transactions SET student_name = btrim(student_name), guardian_name = nullif(btrim(guardian_name), '')
 WHERE student_name <> btrim(student_name) OR guardian_name <> btrim(guardian_name) OR guardian_name = '';
UPDATE public.students SET student_name = btrim(student_name), guardian_name = nullif(btrim(guardian_name), '')
 WHERE student_name <> btrim(student_name) OR guardian_name <> btrim(guardian_name) OR guardian_name = '';

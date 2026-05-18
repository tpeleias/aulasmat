DROP POLICY IF EXISTS "child reads own lessons" ON public.lessons;

CREATE OR REPLACE FUNCTION public.get_child_lessons()
RETURNS TABLE (
  id uuid,
  start_at timestamptz,
  subject text,
  duration_minutes integer,
  teacher text,
  status text,
  class_summary text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.start_at,
    l.subject,
    l.duration_minutes,
    l.teacher,
    l.status,
    l.class_summary
  FROM public.lessons l
  JOIN public.students s ON s.student_name = l.student_name
  WHERE s.child_user_id = auth.uid()
  ORDER BY l.start_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_child_lessons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_child_lessons() TO authenticated;
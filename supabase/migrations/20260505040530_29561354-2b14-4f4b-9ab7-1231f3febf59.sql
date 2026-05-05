ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_busy_ranges_by_teacher(_from timestamptz, _to timestamptz, _teacher text)
RETURNS TABLE(start_at timestamptz, end_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.start_at, l.start_at + (l.duration_minutes || ' minutes')::interval
  FROM public.lessons l
  WHERE l.teacher = _teacher
    AND l.start_at < _to
    AND l.start_at + (l.duration_minutes || ' minutes')::interval > _from
  UNION ALL
  SELECT b.start_at, b.end_at FROM public.blocks b
  WHERE b.block_type = 'one_off' AND b.start_at < _to AND b.end_at > _from
$$;
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS teacher text NOT NULL DEFAULT 'both';

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
  WHERE b.block_type = 'one_off'
    AND (b.teacher = _teacher OR b.teacher = 'both')
    AND b.start_at < _to AND b.end_at > _from
$$;

CREATE OR REPLACE FUNCTION public.get_recurring_blocks_by_teacher(_teacher text)
RETURNS TABLE(id uuid, weekday integer, start_time time, end_time time, exceptions date[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.weekday, b.start_time, b.end_time,
    COALESCE(ARRAY(SELECT exception_date FROM public.block_exceptions WHERE block_id = b.id), ARRAY[]::date[])
  FROM public.blocks b
  WHERE b.block_type = 'recurring' AND (b.teacher = _teacher OR b.teacher = 'both')
$$;
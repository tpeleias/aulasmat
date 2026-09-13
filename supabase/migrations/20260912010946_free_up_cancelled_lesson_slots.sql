-- A cancelled lesson still counted as a busy range, so its slot never reopened:
-- it stayed hidden on the availability page and the booking dialog refused to reuse it.
CREATE OR REPLACE FUNCTION public.get_busy_ranges(_from timestamp with time zone, _to timestamp with time zone)
RETURNS TABLE(start_at timestamp with time zone, end_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.start_at, l.start_at + (l.duration_minutes || ' minutes')::interval
  FROM public.lessons l
  WHERE l.status <> 'cancelada'
    AND l.start_at < _to
    AND l.start_at + (l.duration_minutes || ' minutes')::interval > _from
  UNION ALL
  SELECT b.start_at, b.end_at FROM public.blocks b
  WHERE b.block_type = 'one_off' AND b.start_at < _to AND b.end_at > _from
$$;

CREATE OR REPLACE FUNCTION public.get_busy_ranges_by_teacher(_from timestamp with time zone, _to timestamp with time zone, _teacher text)
RETURNS TABLE(start_at timestamp with time zone, end_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.start_at, l.start_at + (l.duration_minutes || ' minutes')::interval
  FROM public.lessons l
  WHERE l.teacher = _teacher
    AND l.status <> 'cancelada'
    AND l.start_at < _to
    AND l.start_at + (l.duration_minutes || ' minutes')::interval > _from
  UNION ALL
  SELECT b.start_at, b.end_at FROM public.blocks b
  WHERE b.block_type = 'one_off'
    AND (b.teacher = _teacher OR b.teacher = 'both')
    AND b.start_at < _to AND b.end_at > _from
$$;

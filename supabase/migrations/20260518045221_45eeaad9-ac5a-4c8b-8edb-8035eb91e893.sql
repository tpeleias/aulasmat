
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.mark_past_lessons_realizada()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  WITH updated AS (
    UPDATE public.lessons
    SET status = 'realizada'
    WHERE status = 'agendada'
      AND (start_at + (duration_minutes || ' minutes')::interval) <= now()
    RETURNING id
  )
  SELECT count(*) INTO _count FROM updated;
  RETURN _count;
END;
$$;

-- Run it now to backfill anything currently in the past
SELECT public.mark_past_lessons_realizada();

-- Schedule it to run every 5 minutes
DO $$
BEGIN
  PERFORM cron.unschedule('mark-past-lessons-realizada');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'mark-past-lessons-realizada',
  '*/5 * * * *',
  $$SELECT public.mark_past_lessons_realizada();$$
);

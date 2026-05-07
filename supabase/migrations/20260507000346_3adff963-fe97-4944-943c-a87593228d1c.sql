-- Audit log for lesson scheduling/cancellations
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL, -- 'created' | 'updated' | 'cancelled'
  lesson_id uuid,
  teacher text,
  student_name text,
  guardian_name text,
  start_at timestamptz,
  duration_minutes integer,
  actor_id uuid
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage audit_log"
ON public.audit_log
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_audit_log_created_at ON public.audit_log (created_at DESC);

CREATE OR REPLACE FUNCTION public.log_lesson_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor uuid;
BEGIN
  BEGIN
    _actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    _actor := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(action, lesson_id, teacher, student_name, guardian_name, start_at, duration_minutes, actor_id)
    VALUES ('created', NEW.id, NEW.teacher, NEW.student_name, NEW.guardian_name, NEW.start_at, NEW.duration_minutes, _actor);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.start_at IS DISTINCT FROM OLD.start_at
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
       OR NEW.teacher IS DISTINCT FROM OLD.teacher
       OR NEW.student_name IS DISTINCT FROM OLD.student_name THEN
      INSERT INTO public.audit_log(action, lesson_id, teacher, student_name, guardian_name, start_at, duration_minutes, actor_id)
      VALUES ('updated', NEW.id, NEW.teacher, NEW.student_name, NEW.guardian_name, NEW.start_at, NEW.duration_minutes, _actor);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(action, lesson_id, teacher, student_name, guardian_name, start_at, duration_minutes, actor_id)
    VALUES ('cancelled', OLD.id, OLD.teacher, OLD.student_name, OLD.guardian_name, OLD.start_at, OLD.duration_minutes, _actor);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_lesson_audit
AFTER INSERT OR UPDATE OR DELETE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.log_lesson_audit();
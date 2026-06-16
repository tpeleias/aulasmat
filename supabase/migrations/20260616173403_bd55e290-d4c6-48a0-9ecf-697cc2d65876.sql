CREATE OR REPLACE FUNCTION public.sync_lesson_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _amount numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'realizada' THEN
      _amount := -ROUND((NEW.price * NEW.duration_minutes / 60.0)::numeric, 2);
      INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description)
      VALUES (NULLIF(trim(NEW.guardian_name),''), NEW.student_name, _amount, 'lesson', NEW.id,
              'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') || ' (' || NEW.duration_minutes || ' min)');
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'realizada' AND OLD.status IS DISTINCT FROM 'realizada' THEN
      _amount := -ROUND((NEW.price * NEW.duration_minutes / 60.0)::numeric, 2);
      INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description)
      VALUES (NULLIF(trim(NEW.guardian_name),''), NEW.student_name, _amount, 'lesson', NEW.id,
              'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') || ' (' || NEW.duration_minutes || ' min)');
    ELSIF NEW.status <> 'realizada' AND OLD.status = 'realizada' THEN
      DELETE FROM public.wallet_transactions WHERE lesson_id = NEW.id AND kind = 'lesson';
    ELSIF NEW.status = 'realizada' THEN
      _amount := -ROUND((NEW.price * NEW.duration_minutes / 60.0)::numeric, 2);
      UPDATE public.wallet_transactions
      SET amount = _amount,
          guardian_name = NULLIF(trim(NEW.guardian_name),''),
          student_name = NEW.student_name,
          description = 'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') || ' (' || NEW.duration_minutes || ' min)'
      WHERE lesson_id = NEW.id AND kind = 'lesson';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;
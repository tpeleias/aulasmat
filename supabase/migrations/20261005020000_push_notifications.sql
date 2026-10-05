-- Notificações no celular (Thiago, 05/10). Só no app Android, pelo Firebase
-- Cloud Messaging; quem manda é a função "push" (supabase/functions/push).
--
-- Para quem atende (profissional e admin):
--   staff_soon      "começa em 30 min" (a pessoa escolhe 10, 15, 30 ou 60)
--   staff_request   pedido novo de horário pelo portal ou pelo link
--   staff_cancel    o cliente cancelou
--   staff_day       de manhã (7h): quantos atendimentos hoje e o primeiro
-- Para o cliente (login da família e do filho):
--   client_eve      véspera, 18h
--   client_hour     1h antes
--   client_booked / client_approved / client_declined / client_cancelled / client_changed
--   client_homework tarefa nova (só com as tarefas ligadas)
-- Cobrança não vai por notificação: fica no e-mail (combinado em 05/10).
--
-- Cada pessoa liga e desliga cada tipo (push_prefs). Entre 21h e 8h só saem os
-- lembretes de atendimento; o resto espera as 8h (a função cuida disso).

-- ---------------------------------------------------------------------------
-- Aparelhos e preferências
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_devices (
  token text PRIMARY KEY CHECK (length(token) BETWEEN 20 AND 4096),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_devices_user ON public.push_devices (user_id);
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.push_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_prefs FROM anon, authenticated;

-- O mesmo celular com outro login passa a ser do login novo.
CREATE OR REPLACE FUNCTION public.register_push_device(_token text, _platform text DEFAULT 'android')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
  INSERT INTO public.push_devices (token, user_id, platform, last_seen_at)
  VALUES (_token, auth.uid(), coalesce(_platform, 'android'), now())
  ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now();
END $$;
REVOKE ALL ON FUNCTION public.register_push_device(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text) TO authenticated;

-- Sair da conta: o aparelho para de receber os avisos dela.
CREATE OR REPLACE FUNCTION public.unregister_push_device(_token text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM public.push_devices WHERE token = _token AND user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.unregister_push_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_push_prefs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT prefs FROM public.push_prefs WHERE user_id = auth.uid()), '{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.my_push_prefs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_push_prefs() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_push_prefs(_prefs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _k text; _v jsonb; _clean jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _prefs IS NULL OR jsonb_typeof(_prefs) <> 'object' THEN
    RAISE EXCEPTION 'Preferências inválidas.' USING ERRCODE = 'check_violation';
  END IF;
  FOR _k, _v IN SELECT * FROM jsonb_each(_prefs) LOOP
    IF _k IN ('soon', 'requests', 'day', 'eve', 'hour', 'changes', 'homework') AND jsonb_typeof(_v) = 'boolean' THEN
      _clean := _clean || jsonb_build_object(_k, _v);
    ELSIF _k = 'soon_minutes' AND _v::text IN ('10', '15', '30', '60') THEN
      _clean := _clean || jsonb_build_object(_k, _v);
    ELSE
      RAISE EXCEPTION 'Preferência desconhecida: %', _k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  INSERT INTO public.push_prefs (user_id, prefs, updated_at) VALUES (auth.uid(), _clean, now())
  ON CONFLICT (user_id) DO UPDATE SET prefs = public.push_prefs.prefs || EXCLUDED.prefs, updated_at = now();
  RETURN public.my_push_prefs();
END $$;
REVOKE ALL ON FUNCTION public.set_push_prefs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_push_prefs(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Quem recebe
-- ---------------------------------------------------------------------------
-- O cliente de um atendimento: o login da família (user_id) e o do filho.
CREATE OR REPLACE FUNCTION public.push_client_users(_account uuid, _student text, _guardian text)
RETURNS TABLE(user_id uuid, child boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT x.u, x.c
    FROM public.students s
    CROSS JOIN LATERAL (VALUES (s.user_id, false), (s.child_user_id, true)) AS x(u, c)
   WHERE s.account_id = _account
     AND lower(btrim(s.student_name)) = lower(btrim(_student))
     AND lower(coalesce(nullif(btrim(s.guardian_name), ''), '')) = lower(coalesce(nullif(btrim(_guardian), ''), ''))
     AND x.u IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.push_client_users(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_client_users(uuid, text, text) TO service_role;

-- Quem atende: o login do profissional (ou o admin que disse "sou eu"); com
-- _admins, os admins da empresa também. Sem ninguém ligado ao profissional,
-- vão os admins (a empresa de uma pessoa só costuma ser assim).
CREATE OR REPLACE FUNCTION public.push_staff_users(_account uuid, _teacher text, _admins boolean)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH t AS (
    SELECT u FROM public.teachers t
    CROSS JOIN LATERAL (VALUES (t.user_id), (t.admin_user_id)) AS x(u)
     WHERE t.account_id = _account AND public.teacher_slug(t.name) = lower(_teacher) AND x.u IS NOT NULL
  ), a AS (
    SELECT r.user_id AS u FROM public.user_roles r WHERE r.account_id = _account AND r.role = 'admin'::app_role
  )
  SELECT u FROM t
  UNION
  SELECT u FROM a WHERE _admins OR NOT EXISTS (SELECT 1 FROM t)
$$;
REVOKE ALL ON FUNCTION public.push_staff_users(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_staff_users(uuid, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- A fila
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  -- lessons.id | homework.id | nulo (resumo do dia)
  ref_id uuid,
  data jsonb,
  -- Lembretes: um por atendimento, pessoa e horário.
  dedupe text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  process_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS push_outbox_pending ON public.push_outbox (process_after) WHERE sent_at IS NULL;
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_outbox FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.lessons_push_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _actor uuid; _by_client boolean; _kind text; _staff boolean := false;
BEGIN
  BEGIN
    -- Ninguém com o app ainda: nada a fazer (o caso de quase todo gatilho hoje).
    IF NOT EXISTS (SELECT 1 FROM public.push_devices) THEN RETURN NULL; END IF;
    BEGIN _actor := auth.uid(); EXCEPTION WHEN OTHERS THEN _actor := NULL; END;
    _by_client := _actor IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.push_client_users(NEW.account_id, NEW.student_name, NEW.guardian_name) c WHERE c.user_id = _actor);

    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'solicitada' THEN _kind := 'staff_request'; _staff := true;
      ELSIF NEW.status = 'agendada' AND NOT _by_client AND NEW.start_at > now() THEN _kind := 'client_booked';
      END IF;
    ELSIF OLD.status = 'solicitada' AND NEW.status = 'agendada' THEN _kind := 'client_approved';
    ELSIF OLD.status = 'solicitada' AND NEW.status = 'recusada' THEN _kind := 'client_declined';
    ELSIF NEW.status = 'cancelada' AND OLD.status IS DISTINCT FROM 'cancelada' AND NEW.start_at > now() - interval '1 hour' THEN
      IF _by_client THEN _kind := 'staff_cancel'; _staff := true; ELSE _kind := 'client_cancelled'; END IF;
    ELSIF NEW.status = 'agendada' AND OLD.status = 'agendada' AND NEW.start_at IS DISTINCT FROM OLD.start_at
          AND NOT _by_client AND NEW.start_at > now() THEN
      _kind := 'client_changed';
    END IF;
    IF _kind IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.push_outbox (account_id, user_id, kind, ref_id, process_after)
    SELECT NEW.account_id, x.u, _kind, NEW.id, now() + interval '1 minute'
      FROM (SELECT s AS u FROM public.push_staff_users(NEW.account_id, NEW.teacher, true) s WHERE _staff
            UNION
            SELECT c.user_id FROM public.push_client_users(NEW.account_id, NEW.student_name, NEW.guardian_name) c
             WHERE NOT _staff AND NOT c.child) x
     WHERE x.u IS DISTINCT FROM _actor
       AND EXISTS (SELECT 1 FROM public.push_devices d WHERE d.user_id = x.u);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_outbox lesson: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER lessons_push AFTER INSERT OR UPDATE OF status, start_at ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_push_enqueue();

CREATE OR REPLACE FUNCTION public.homework_push_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s public.students;
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.push_devices) THEN RETURN NULL; END IF;
    SELECT * INTO _s FROM public.students WHERE id = NEW.student_id;
    IF _s.id IS NULL OR NOT public.account_tasks_on(_s.account_id) THEN RETURN NULL; END IF;
    INSERT INTO public.push_outbox (account_id, user_id, kind, ref_id, process_after)
    SELECT _s.account_id, c.user_id, 'client_homework', NEW.id, now() + interval '2 minutes'
      FROM public.push_client_users(_s.account_id, _s.student_name, _s.guardian_name) c
     WHERE EXISTS (SELECT 1 FROM public.push_devices d WHERE d.user_id = c.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_outbox homework: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER homework_push AFTER INSERT ON public.homework
  FOR EACH ROW EXECUTE FUNCTION public.homework_push_enqueue();

-- ---------------------------------------------------------------------------
-- O cron chama a função: de minuto em minuto se há fila, de 5 em 5 para os
-- lembretes por horário.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_secret(_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s text;
BEGIN
  IF _name NOT IN ('push_cron_secret', 'fcm_service_account') THEN RETURN NULL; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1$q$ INTO _s USING _name;
  RETURN _s;
END $$;
REVOKE ALL ON FUNCTION public.push_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.push_kick(_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _secret text := public.push_secret('push_cron_secret');
BEGIN
  IF _secret IS NULL OR to_regnamespace('net') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 60000)'
    USING 'https://dqfzuviwejlobrwebyum.supabase.co/functions/v1/push/cron',
          jsonb_build_object('mode', _mode),
          jsonb_build_object('content-type', 'application/json', 'x-cron-secret', _secret);
END $$;
REVOKE ALL ON FUNCTION public.push_kick(text) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('push-outbox', '* * * * *',
  $$SELECT public.push_kick('outbox') WHERE EXISTS (SELECT 1 FROM public.push_outbox WHERE sent_at IS NULL AND attempts < 5 AND process_after <= now())$$);
SELECT cron.schedule('push-reminders', '*/5 * * * *',
  $$SELECT public.push_kick('reminders') WHERE EXISTS (SELECT 1 FROM public.push_devices)$$);

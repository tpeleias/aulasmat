-- E-mails automáticos, primeira etapa (Thiago, 03/10).
--
-- Quem recebe: o cliente e o responsável (e-mail no cadastro, ou o do login de
-- verdade), o profissional (teacher_emails, ou o do login) e os admins.
-- O quê, cada empresa escolhe em settings.email_notifications:
--
--   enabled           liga tudo (nasce desligado: ninguém recebe sem a empresa querer)
--   client_booked     atendimento marcado
--   client_changed    horário alterado (inclui a troca aprovada)
--   client_cancelled  atendimento cancelado
--   client_requests   pedido recebido, aprovado ou recusado
--   reminder_eve      lembrete na véspera (18h)
--   reminder_day      lembrete no dia (7h)
--   teacher_changes   o profissional fica sabendo do que mudou na agenda dele
--   admin_requests    os admins recebem cada pedido novo do portal
--
-- Chave ausente = ligada, menos reminder_day (desligada). Assim a empresa liga
-- "enabled" e já recebe o pacote que faz sentido.
--
-- Como sai: o gatilho em lessons põe o fato em email_outbox; o pg_cron, a cada
-- minuto, chama a função "emails" (pg_net) quando há o que mandar. Os
-- lembretes, de hora em hora. Os e-mails saem pelo Resend, de
-- lembretes@cronys.com.br, com o nome da empresa e o "Responder" indo para o
-- contato dela. A chave do Resend fica no cofre (resend_api_key).

-- ---------------------------------------------------------------------------
-- Onde está o e-mail de cada um
-- ---------------------------------------------------------------------------
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_email text;

CREATE OR REPLACE FUNCTION public.email_valid(_e text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _e IS NULL OR _e ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
$$;

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_email_valid;
ALTER TABLE public.students ADD CONSTRAINT students_email_valid CHECK (public.email_valid(email) AND public.email_valid(guardian_email));
-- O do profissional fica numa tabela à parte: a linha de teachers é lida por
-- todo mundo da empresa (clientes inclusive) e, na empresa do endereço
-- público, até sem login. O e-mail só o admin vê.
CREATE TABLE IF NOT EXISTS public.teacher_emails (
  teacher_id uuid PRIMARY KEY REFERENCES public.teachers(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (public.email_valid(email)),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.teacher_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teacher_emails FROM anon;
DROP POLICY IF EXISTS "admins manage teacher emails" ON public.teacher_emails;
CREATE POLICY "admins manage teacher emails" ON public.teacher_emails FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id()
              AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_id AND t.account_id = public.current_account_id()));

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS email_notifications jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Ligado? (chave ausente = padrão)
CREATE OR REPLACE FUNCTION public.email_pref(_prefs jsonb, _key text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _prefs IS NULL OR NOT coalesce((_prefs ->> 'enabled')::boolean, false) THEN false
    WHEN _key = 'enabled' THEN true
    WHEN _prefs ? _key THEN coalesce((_prefs ->> _key)::boolean, false)
    ELSE _key <> 'reminder_day'
  END
$$;

-- ---------------------------------------------------------------------------
-- Fila, lembretes já enviados, quem saiu, pedidos de senha
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- booked | changed | cancelled | requested | approved | declined
  kind text NOT NULL,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  old_start timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Meio minuto de espera: a troca aprovada cancela a antiga logo depois, e o
  -- envio junta as duas num "horário alterado" só.
  process_after timestamptz NOT NULL DEFAULT now() + interval '30 seconds',
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS email_outbox_pending ON public.email_outbox (process_after) WHERE sent_at IS NULL;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.email_reminders_sent (
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  kind text NOT NULL,           -- eve | day
  start_at timestamptz NOT NULL, -- remarcou: o lembrete vale de novo
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, kind, start_at)
);
ALTER TABLE public.email_reminders_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_reminders_sent FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.email_optouts (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, email)
);
ALTER TABLE public.email_optouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_optouts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  email text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_requests_recent ON public.password_reset_requests (email, requested_at);
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_requests FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atendimento mexido -> fila
-- ---------------------------------------------------------------------------
-- Nunca derruba o salvamento: qualquer erro aqui só deixa de enfileirar.
CREATE OR REPLACE FUNCTION public.lessons_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _prefs jsonb;
  _kind text;
  _old timestamptz;
BEGIN
  BEGIN
    SELECT s.email_notifications INTO _prefs FROM public.settings s WHERE s.account_id = NEW.account_id;
    IF NOT public.email_pref(_prefs, 'enabled') THEN RETURN NULL; END IF;

    IF TG_OP = 'INSERT' THEN
      _kind := CASE NEW.status WHEN 'solicitada' THEN 'requested' WHEN 'agendada' THEN 'booked' END;
    ELSIF OLD.status = 'solicitada' AND NEW.status = 'agendada' THEN
      _kind := 'approved';
    ELSIF OLD.status = 'solicitada' AND NEW.status = 'recusada' THEN
      _kind := 'declined';
    ELSIF NEW.status = 'cancelada' AND OLD.status IS DISTINCT FROM 'cancelada' THEN
      _kind := 'cancelled';
    ELSIF NEW.status = 'agendada' AND OLD.status = 'agendada' AND NEW.start_at IS DISTINCT FROM OLD.start_at THEN
      _kind := 'changed'; _old := OLD.start_at;
    END IF;

    IF _kind IS NOT NULL THEN
      INSERT INTO public.email_outbox (account_id, kind, lesson_id, old_start)
      VALUES (NEW.account_id, _kind, NEW.id, _old);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_outbox: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS lessons_email ON public.lessons;
CREATE TRIGGER lessons_email AFTER INSERT OR UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_email_enqueue();

-- ---------------------------------------------------------------------------
-- Segredos (cofre) e o cutucão do pg_cron
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_secret(_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s text;
BEGIN
  IF _name NOT IN ('emails_cron_secret', 'resend_api_key', 'email_unsubscribe_secret') THEN RETURN NULL; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1$q$ INTO _s USING _name;
  RETURN _s;
END $$;
REVOKE ALL ON FUNCTION public.email_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.emails_kick(_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _secret text := public.email_secret('emails_cron_secret');
BEGIN
  IF _secret IS NULL OR to_regnamespace('net') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 60000)'
    USING 'https://dqfzuviwejlobrwebyum.supabase.co/functions/v1/emails/cron',
          jsonb_build_object('mode', _mode),
          jsonb_build_object('content-type', 'application/json', 'x-cron-secret', _secret);
END $$;
REVOKE ALL ON FUNCTION public.emails_kick(text) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'emails_cron_secret') THEN
      PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'emails_cron_secret');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'email_unsubscribe_secret') THEN
      PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'email_unsubscribe_secret');
    END IF;
  END IF;
END $$;

SELECT cron.schedule('emails-outbox', '* * * * *',
  $$SELECT public.emails_kick('outbox') WHERE EXISTS (SELECT 1 FROM public.email_outbox WHERE sent_at IS NULL AND attempts < 5 AND process_after <= now())$$);
SELECT cron.schedule('emails-reminders', '3 * * * *',
  $$SELECT public.emails_kick('reminders')$$);

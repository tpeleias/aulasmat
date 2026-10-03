-- E-mails, etapa 2 (03/10): tarefa nova, tarefas pendentes na véspera, resumo
-- do atendimento para a família, pacote acabando e a agenda de amanhã para a
-- equipe. Quem manda é a função "emails" (events.ts).
--
-- Chaves novas em settings.email_notifications (todas ligadas por padrão,
-- como os avisos da agenda; cada uma desliga em Configurações):
--   homework_new     tarefa nova
--   homework_due     tarefas pendentes, junto do lembrete da véspera (18h)
--   class_summary    o resumo que o profissional escreveu
--   package_low      o crédito do pacote acabando ou acabado (Start, Pro e Max)
--   agenda_tomorrow  a agenda de amanhã para cada profissional e os admins (18h)

-- ---------------------------------------------------------------------------
-- Fila dos avisos que nascem de uma mudança no banco
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('homework', 'summary', 'package')),
  -- homework.id | lessons.id | wallet_transactions.id
  ref_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  process_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
-- Um aviso por tarefa, por resumo e por débito: editar o resumo depois não
-- manda de novo.
CREATE UNIQUE INDEX IF NOT EXISTS email_event_outbox_once ON public.email_event_outbox (kind, ref_id);
CREATE INDEX IF NOT EXISTS email_event_outbox_pending ON public.email_event_outbox (process_after) WHERE sent_at IS NULL;
ALTER TABLE public.email_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_event_outbox FROM anon, authenticated;

-- O que o cron de hora em hora já mandou (agenda de amanhã, tarefas da
-- véspera, pacote): uma chave por envio.
CREATE TABLE IF NOT EXISTS public.email_event_sent (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
ALTER TABLE public.email_event_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_event_sent FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tarefa nova
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.homework_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acct uuid; _prefs jsonb;
BEGIN
  BEGIN
    SELECT s.account_id INTO _acct FROM public.students s WHERE s.id = NEW.student_id;
    IF _acct IS NULL THEN RETURN NULL; END IF;
    SELECT st.email_notifications INTO _prefs FROM public.settings st WHERE st.account_id = _acct;
    IF NOT public.email_pref(_prefs, 'homework_new') THEN RETURN NULL; END IF;
    -- Dois minutos para corrigir um erro de digitação (ou apagar) antes de sair.
    INSERT INTO public.email_event_outbox (account_id, kind, ref_id, process_after)
    VALUES (_acct, 'homework', NEW.id, now() + interval '2 minutes')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_event_outbox homework: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER homework_email AFTER INSERT ON public.homework
  FOR EACH ROW EXECUTE FUNCTION public.homework_email_enqueue();

-- ---------------------------------------------------------------------------
-- Resumo do atendimento
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.summary_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _prefs jsonb;
BEGIN
  BEGIN
    IF nullif(btrim(coalesce(NEW.class_summary, '')), '') IS NULL OR NEW.account_id IS NULL THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND nullif(btrim(coalesce(OLD.class_summary, '')), '') IS NOT NULL THEN RETURN NULL; END IF;
    SELECT st.email_notifications INTO _prefs FROM public.settings st WHERE st.account_id = NEW.account_id;
    IF NOT public.email_pref(_prefs, 'class_summary') THEN RETURN NULL; END IF;
    -- Dez minutos: quem escreve costuma voltar e completar. Sai o texto do
    -- momento do envio.
    INSERT INTO public.email_event_outbox (account_id, kind, ref_id, process_after)
    VALUES (NEW.account_id, 'summary', NEW.id, now() + interval '10 minutes')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_event_outbox summary: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER lesson_summary_email AFTER INSERT OR UPDATE OF class_summary ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.summary_email_enqueue();

-- ---------------------------------------------------------------------------
-- Pacote acabando: cada débito de atendimento de quem já comprou pacote entra
-- na fila; a função olha o saldo (com o desconto da própria aula, que entra
-- logo depois) e decide se avisa.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.package_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _prefs jsonb;
BEGIN
  BEGIN
    IF NEW.amount >= 0 OR NEW.kind <> 'lesson' OR NEW.account_id IS NULL THEN RETURN NULL; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.wallet_transactions w
       WHERE w.account_id = NEW.account_id AND w.kind = 'package'
         AND public.account_key(w.student_name, w.guardian_name) = public.account_key(NEW.student_name, NEW.guardian_name)
    ) THEN RETURN NULL; END IF;
    SELECT st.email_notifications INTO _prefs FROM public.settings st WHERE st.account_id = NEW.account_id;
    IF NOT public.email_pref(_prefs, 'package_low') OR NOT public.account_can('email_billing', NEW.account_id) THEN RETURN NULL; END IF;
    INSERT INTO public.email_event_outbox (account_id, kind, ref_id, process_after)
    VALUES (NEW.account_id, 'package', NEW.id, now() + interval '1 minute')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_event_outbox package: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER wallet_package_email AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.package_email_enqueue();

-- ---------------------------------------------------------------------------
-- O cron de minuto em minuto também olha esta fila
-- ---------------------------------------------------------------------------
SELECT cron.schedule('emails-outbox', '* * * * *',
  $$SELECT public.emails_kick('outbox') WHERE EXISTS (SELECT 1 FROM public.email_outbox WHERE sent_at IS NULL AND attempts < 5 AND process_after <= now())
       OR EXISTS (SELECT 1 FROM public.email_payment_outbox WHERE sent_at IS NULL AND attempts < 5 AND process_after <= now())
       OR EXISTS (SELECT 1 FROM public.email_event_outbox WHERE sent_at IS NULL AND attempts < 5 AND process_after <= now())$$);

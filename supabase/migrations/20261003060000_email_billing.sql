-- E-mails, segunda rodada (Thiago, 03/10): cobrança, recibo, histórico,
-- e-mail que voltou e descadastro por tipo.
--
--   * Planos: email_billing (Start, Pro, Max), email_branding (Pro, Max) e
--     email_custom (Max) em plan_features().
--   * Cobrança automática: cada empresa escolhe uma ou mais - no fim do dia em
--     que houve atendimento (19h), toda segunda (9h) e/ou todo mês num dia
--     (9h). Nascem desligadas. Só vai para quem tem saldo em aberto.
--   * "Pagamento recebido", com recibo em PDF: o gatilho em
--     wallet_transactions põe na fila email_payment_outbox.
--   * email_log: o que saiu, para quem, e o que o Resend disse depois
--     (entregue, voltou, marcado como spam). O admin lê o da empresa.
--   * email_bounces: endereço que voltou (o Resend avisa pelo webhook).
--   * email_optout_categories: a pessoa para de receber só um tipo
--     (agenda, lembretes, financeiro...); email_optouts continua sendo "tudo".

-- >>> plan_features: GERADO por `npm run gen:plans` a partir de supabase/functions/_shared/plans.ts. Não edite à mão.
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'start' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":true,"email_branding":false,"email_custom":false,"extra_teachers_allowed":false,"google_calendar":false,"included_teachers":1,"max_active_clients":25,"max_students":null,"max_teachers":1,"nome":"Cronys Start","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro_solo' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0.6,"assistant_included":true,"assistant_messages":20,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":true,"email_branding":true,"email_custom":false,"extra_teachers_allowed":true,"google_calendar":true,"included_teachers":1,"max_active_clients":null,"max_students":null,"max_teachers":3,"nome":"Cronys Pro","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro' THEN '{"active_client_days":60,"any_teacher":true,"arrival_location":true,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":5,"assistant_included":true,"assistant_messages":200,"assistant_needs_payment":true,"auto_messages_quota":null,"email_billing":true,"email_branding":true,"email_custom":true,"extra_teachers_allowed":true,"google_calendar":true,"included_teachers":5,"max_active_clients":null,"max_students":null,"max_teachers":null,"nome":"Cronys Max","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":true,"vocabulary":true,"whatsapp_auto":true,"whatsapp_link":true}'::jsonb
    ELSE '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"email_billing":false,"email_branding":false,"email_custom":false,"extra_teachers_allowed":false,"google_calendar":false,"included_teachers":1,"max_active_clients":10,"max_students":null,"max_teachers":1,"nome":"Cronys Essencial","packages":false,"recurring_blocks":false,"services_multi":false,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":false}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public.plan_trial_days()
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT 14 $$;
-- <<< plan_features

-- ---------------------------------------------------------------------------
-- O que nasce desligado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_pref(_prefs jsonb, _key text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _prefs IS NULL OR NOT coalesce((_prefs ->> 'enabled')::boolean, false) THEN false
    WHEN _key = 'enabled' THEN true
    WHEN _prefs ? _key THEN coalesce((_prefs ->> _key)::boolean, false)
    ELSE _key NOT IN ('reminder_day', 'billing_daily', 'billing_weekly', 'billing_monthly')
  END
$$;

-- ---------------------------------------------------------------------------
-- Histórico
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  -- booked, changed, cancelled, requested, approved, declined, eve, day,
  -- charge, statement, payment, lesson_reminder, test...
  kind text NOT NULL,
  subject text NOT NULL,
  student_name text,
  guardian_name text,
  -- quem mandou na mão (nulo = automático)
  sent_by uuid,
  resend_id text,
  -- sent | delivered | bounced | complained | failed
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_account ON public.email_log (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_resend ON public.email_log (resend_id) WHERE resend_id IS NOT NULL;
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.email_log FROM authenticated;
CREATE POLICY "admins read email log" ON public.email_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id());

-- ---------------------------------------------------------------------------
-- E-mail que voltou
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_bounces (
  email text PRIMARY KEY,
  reason text,
  kind text NOT NULL DEFAULT 'bounced', -- bounced | complained
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_bounces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_bounces FROM anon, authenticated;

-- Para o admin: dos e-mails da própria empresa, quais voltaram.
CREATE OR REPLACE FUNCTION public.account_email_issues()
RETURNS TABLE (email text, kind text, reason text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT b.email, b.kind, b.reason, b.created_at
    FROM public.email_bounces b
   WHERE public.has_role(auth.uid(), 'admin'::app_role)
     AND b.email IN (
       SELECT lower(s.email) FROM public.students s WHERE s.account_id = public.current_account_id() AND s.email IS NOT NULL
       UNION SELECT lower(s.guardian_email) FROM public.students s WHERE s.account_id = public.current_account_id() AND s.guardian_email IS NOT NULL
       UNION SELECT lower(te.email) FROM public.teacher_emails te WHERE te.account_id = public.current_account_id())
$$;
REVOKE ALL ON FUNCTION public.account_email_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_email_issues() TO authenticated;

-- ---------------------------------------------------------------------------
-- Descadastro por tipo: agenda | lembretes | financeiro | tarefas | resumo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_optout_categories (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, email, category)
);
ALTER TABLE public.email_optout_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_optout_categories FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cobrança automática já enviada (uma por conta e período)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_charge_sent (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  account_key text NOT NULL,   -- g:<responsável> | s:<cliente>, como no Financeiro
  period_key text NOT NULL,    -- d:2026-10-03 | w:2026-10-05 | m:2026-10
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, account_key, period_key)
);
ALTER TABLE public.email_charge_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_charge_sent FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pagamento recebido -> fila
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_payment_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  tx_id uuid NOT NULL REFERENCES public.wallet_transactions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Um minuto: o "pagamento + voucher" do mesmo registro entra junto, e um
  -- lançamento feito por engano e apagado logo em seguida não manda nada.
  process_after timestamptz NOT NULL DEFAULT now() + interval '1 minute',
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS email_payment_outbox_pending ON public.email_payment_outbox (process_after) WHERE sent_at IS NULL;
ALTER TABLE public.email_payment_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_payment_outbox FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.wallet_email_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _prefs jsonb;
BEGIN
  BEGIN
    IF NEW.amount <= 0 OR NEW.kind NOT IN ('adjustment', 'package') OR NEW.account_id IS NULL THEN RETURN NULL; END IF;
    SELECT s.email_notifications INTO _prefs FROM public.settings s WHERE s.account_id = NEW.account_id;
    IF NOT public.email_pref(_prefs, 'payment_received') OR NOT public.account_can('email_billing', NEW.account_id) THEN RETURN NULL; END IF;
    INSERT INTO public.email_payment_outbox (account_id, tx_id) VALUES (NEW.account_id, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_payment_outbox: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER wallet_email AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.wallet_email_enqueue();

-- ---------------------------------------------------------------------------
-- Segredo do webhook do Resend; o cutucão olha as duas filas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_secret(_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s text;
BEGIN
  IF _name NOT IN ('emails_cron_secret', 'resend_api_key', 'email_unsubscribe_secret', 'resend_webhook_secret') THEN RETURN NULL; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1$q$ INTO _s USING _name;
  RETURN _s;
END $$;
REVOKE ALL ON FUNCTION public.email_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_secret(text) TO service_role;

SELECT cron.schedule('emails-outbox', '* * * * *',
  $$SELECT public.emails_kick('outbox') WHERE EXISTS (SELECT 1 FROM public.email_outbox WHERE sent_at IS NULL AND attempts < 5 AND process_after <= now())
       OR EXISTS (SELECT 1 FROM public.email_payment_outbox WHERE sent_at IS NULL AND attempts < 5 AND process_after <= now())$$);

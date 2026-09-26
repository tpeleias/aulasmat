-- Google Agenda por profissional (Thiago, 26/09). Pro e Max.
--
-- Dois sentidos, cada um com o próprio switch:
--   importar - o ocupado da agenda principal do Google vira bloqueio aqui
--              (blocks com source = 'google', título "Ocupado (Google)"). Só
--              o intervalo: nem título, nem convidados. Como é bloqueio comum,
--              a agenda, a vitrine pública e o portal do cliente já respeitam.
--   exportar - os agendamentos do profissional vão para uma agenda separada
--              chamada "Cronys" dentro do Google dele. Separada de propósito:
--              ela fica fora da importação (senão a aula exportada voltaria
--              como "ocupado" e bloquearia a si mesma), e desconectar apaga
--              tudo de uma vez.
--
-- Quem conecta: o admin, para qualquer profissional da empresa (é o caso de
-- quem atende sozinho), ou o próprio profissional com login, para si.
--
-- Quem conversa com o Google é a função google-calendar. O banco só guarda a
-- conexão (com o refresh token, que ninguém de fora lê), enfileira quem teve
-- aula mexida e cutuca a função pelo pg_net:
--   - a cada minuto, se a fila não estiver vazia (exportar "na hora");
--   - a cada 10 minutos, para puxar o ocupado de todo mundo.

-- >>> plan_features: GERADO por `npm run gen:plans` a partir de supabase/functions/_shared/plans.ts. Não edite à mão.
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'start' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"extra_teachers_allowed":false,"google_calendar":false,"included_teachers":1,"max_active_clients":25,"max_students":null,"max_teachers":1,"nome":"Cronys Start","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro_solo' THEN '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":true,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0.6,"assistant_included":true,"assistant_messages":20,"assistant_needs_payment":false,"auto_messages_quota":null,"extra_teachers_allowed":true,"google_calendar":true,"included_teachers":1,"max_active_clients":null,"max_students":null,"max_teachers":3,"nome":"Cronys Pro","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":true}'::jsonb
    WHEN 'pro' THEN '{"active_client_days":60,"any_teacher":true,"arrival_location":true,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":5,"assistant_included":true,"assistant_messages":200,"assistant_needs_payment":true,"auto_messages_quota":null,"extra_teachers_allowed":true,"google_calendar":true,"included_teachers":5,"max_active_clients":null,"max_students":null,"max_teachers":null,"nome":"Cronys Max","packages":true,"recurring_blocks":true,"services_multi":true,"teacher_services":true,"vocabulary":true,"whatsapp_auto":true,"whatsapp_link":true}'::jsonb
    ELSE '{"active_client_days":60,"any_teacher":false,"arrival_location":false,"assistant":false,"assistant_addon":false,"assistant_addon_cost_usd":3,"assistant_addon_messages":100,"assistant_cost_usd":0,"assistant_included":false,"assistant_messages":0,"assistant_needs_payment":false,"auto_messages_quota":null,"extra_teachers_allowed":false,"google_calendar":false,"included_teachers":1,"max_active_clients":10,"max_students":null,"max_teachers":1,"nome":"Cronys Essencial","packages":false,"recurring_blocks":false,"services_multi":false,"teacher_services":false,"vocabulary":true,"whatsapp_auto":false,"whatsapp_link":false}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public.plan_trial_days()
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT 14 $$;
-- <<< plan_features

-- ---------------------------------------------------------------------------
-- Bloqueio que veio do Google
-- ---------------------------------------------------------------------------
ALTER TABLE public.blocks ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_source_valid;
ALTER TABLE public.blocks ADD CONSTRAINT blocks_source_valid CHECK (source IN ('manual', 'google'));
CREATE INDEX IF NOT EXISTS blocks_google_idx ON public.blocks (account_id, teacher) WHERE source = 'google';

-- Quem mexe em bloqueio pela tela não cria nem edita o do Google: ele é
-- espelho, a próxima sincronização o refaz. Apagar pode (volta sozinho).
-- Exceção: renomear o profissional (rename_teacher) leva junto o dele.
CREATE OR REPLACE FUNCTION public.blocks_google_is_mirror()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND coalesce(current_setting('cronys.renomeando_professor', true), 'off') <> 'on'
     AND (NEW.source = 'google' OR (TG_OP = 'UPDATE' AND OLD.source = 'google')) THEN
    RAISE EXCEPTION 'Este bloqueio vem do Google Agenda e é atualizado sozinho.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS blocks_google_mirror ON public.blocks;
CREATE TRIGGER blocks_google_mirror BEFORE INSERT OR UPDATE ON public.blocks
  FOR EACH ROW EXECUTE FUNCTION public.blocks_google_is_mirror();

-- ---------------------------------------------------------------------------
-- Conexão por profissional
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  teacher_id uuid PRIMARY KEY REFERENCES public.teachers(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  google_email text,
  refresh_token text NOT NULL,
  access_token text,
  access_expires_at timestamptz,
  -- A agenda "Cronys" criada no Google dele (para onde vão os agendamentos).
  export_calendar_id text,
  import_enabled boolean NOT NULL DEFAULT true,
  export_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'revoked')),
  last_error text,
  last_import_at timestamptz,
  last_export_at timestamptz,
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS google_calendar_connections_account_idx ON public.google_calendar_connections (account_id);
-- O refresh token dá acesso à agenda da pessoa: ninguém de fora lê a tabela.
-- A tela usa google_calendar_status(); a função, a chave de serviço.
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_calendar_connections FROM anon, authenticated;

-- Profissionais com aula mexida, esperando a exportação.
CREATE TABLE IF NOT EXISTS public.google_sync_queue (
  teacher_id uuid PRIMARY KEY REFERENCES public.teachers(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_sync_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_sync_queue FROM anon, authenticated;

-- Pode conectar/desligar o Google deste profissional? O admin da empresa, para
-- qualquer um; o profissional com login, para si. E só com o plano que traz.
CREATE OR REPLACE FUNCTION public.google_calendar_can_manage(_teacher uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.id = _teacher
       AND t.account_id = public.current_account_id()
       AND (public.has_role(auth.uid(), 'admin'::app_role)
            OR (t.user_id = auth.uid() AND public.has_role(auth.uid(), 'teacher'::app_role))))
$$;

-- A tela: um profissional por linha (o admin vê todos; o profissional, a si).
CREATE OR REPLACE FUNCTION public.google_calendar_status()
RETURNS TABLE(teacher_id uuid, teacher_name text, connected boolean, google_email text,
              import_enabled boolean, export_enabled boolean, status text, last_error text,
              last_import_at timestamptz, last_export_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT t.id, t.name, c.teacher_id IS NOT NULL, c.google_email,
         coalesce(c.import_enabled, false), coalesce(c.export_enabled, false),
         c.status, c.last_error, c.last_import_at, c.last_export_at
    FROM public.teachers t
    LEFT JOIN public.google_calendar_connections c ON c.teacher_id = t.id
   WHERE t.active
     AND public.google_calendar_can_manage(t.id)
   ORDER BY t.sort_order, t.name
$$;

-- Os dois switches. Desligar a importação apaga na hora o ocupado importado;
-- desligar a exportação esvazia a agenda "Cronys" na próxima passada.
CREATE OR REPLACE FUNCTION public.google_calendar_set(_teacher uuid, _import boolean, _export boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _c public.google_calendar_connections;
BEGIN
  IF NOT public.google_calendar_can_manage(_teacher) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (_import OR _export) AND NOT public.account_can('google_calendar') THEN
    RAISE EXCEPTION 'O Google Agenda faz parte do Pro e do Max.' USING ERRCODE = 'check_violation', HINT = 'plano:google_calendar';
  END IF;
  UPDATE public.google_calendar_connections
     SET import_enabled = _import, export_enabled = _export, updated_at = now()
   WHERE teacher_id = _teacher
  RETURNING * INTO _c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conecte o Google Agenda primeiro.'; END IF;
  IF NOT _import THEN
    DELETE FROM public.blocks b USING public.teachers t
     WHERE t.id = _teacher AND b.account_id = t.account_id AND b.source = 'google'
       AND b.teacher = public.teacher_slug(t.name);
  END IF;
  INSERT INTO public.google_sync_queue (teacher_id) VALUES (_teacher) ON CONFLICT DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.google_calendar_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.google_calendar_set(uuid, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.google_calendar_can_manage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_calendar_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_set(uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_can_manage(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Do lado da função (chave de serviço)
-- ---------------------------------------------------------------------------

-- Troca o ocupado importado de um profissional numa janela, de uma vez só: nunca
-- fica um instante sem bloqueio no meio da troca.
CREATE OR REPLACE FUNCTION public.google_calendar_replace_busy(_teacher uuid, _from timestamptz, _to timestamptz, _ranges jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _t public.teachers; _n integer;
BEGIN
  SELECT * INTO _t FROM public.teachers WHERE id = _teacher;
  IF NOT FOUND THEN RETURN 0; END IF;
  DELETE FROM public.blocks
   WHERE account_id = _t.account_id AND source = 'google'
     AND teacher = public.teacher_slug(_t.name)
     AND start_at < _to AND end_at > _from;
  INSERT INTO public.blocks (account_id, teacher, title, block_type, start_at, end_at, source)
  SELECT _t.account_id, public.teacher_slug(_t.name), 'Ocupado (Google)', 'one_off',
         greatest((r->>'start')::timestamptz, _from), least((r->>'end')::timestamptz, _to), 'google'
    FROM jsonb_array_elements(coalesce(_ranges, '[]'::jsonb)) r
   WHERE (r->>'end')::timestamptz > (r->>'start')::timestamptz;
  GET DIAGNOSTICS _n = ROW_COUNT;
  -- O que já passou não precisa ficar guardado.
  DELETE FROM public.blocks
   WHERE account_id = _t.account_id AND source = 'google'
     AND teacher = public.teacher_slug(_t.name) AND end_at < now() - interval '2 days';
  RETURN _n;
END $$;

-- Ao desconectar: some o ocupado importado.
CREATE OR REPLACE FUNCTION public.google_calendar_forget(_teacher uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM public.blocks b USING public.teachers t
   WHERE t.id = _teacher AND b.account_id = t.account_id AND b.source = 'google'
     AND b.teacher = public.teacher_slug(t.name);
  DELETE FROM public.google_sync_queue WHERE teacher_id = _teacher;
  DELETE FROM public.google_calendar_connections WHERE teacher_id = _teacher;
$$;

-- O segredo com que o pg_net se apresenta à função (gerado aqui, no cofre; não
-- está em arquivo nenhum).
CREATE OR REPLACE FUNCTION public.google_calendar_cron_secret()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'google_calendar_cron_secret' LIMIT 1$q$ INTO _s;
  RETURN _s;
END $$;

REVOKE ALL ON FUNCTION public.google_calendar_replace_busy(uuid, timestamptz, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_calendar_forget(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_calendar_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_replace_busy(uuid, timestamptz, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_forget(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_calendar_cron_secret() TO service_role;

-- ---------------------------------------------------------------------------
-- Aula mexida -> fila de exportação
-- ---------------------------------------------------------------------------
-- Nunca derruba o salvamento da aula: qualquer erro aqui só deixa de enfileirar
-- (a passada de 10 em 10 minutos corrige).
CREATE OR REPLACE FUNCTION public.lessons_google_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    INSERT INTO public.google_sync_queue (teacher_id)
    SELECT c.teacher_id
      FROM public.google_calendar_connections c
      JOIN public.teachers t ON t.id = c.teacher_id
     WHERE c.export_enabled
       AND ((TG_OP <> 'DELETE' AND t.account_id = NEW.account_id AND public.teacher_slug(t.name) = lower(NEW.teacher))
         OR (TG_OP <> 'INSERT' AND t.account_id = OLD.account_id AND public.teacher_slug(t.name) = lower(OLD.teacher)))
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'google_sync_queue: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS lessons_google_sync ON public.lessons;
CREATE TRIGGER lessons_google_sync AFTER INSERT OR UPDATE OR DELETE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_google_enqueue();

-- ---------------------------------------------------------------------------
-- Cutucar a função (pg_net) - só existe no Supabase
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.google_calendar_kick(_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _secret text := public.google_calendar_cron_secret(); _url text;
BEGIN
  IF _secret IS NULL OR to_regnamespace('net') IS NULL THEN RETURN; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'google_calendar_function_url' LIMIT 1$q$ INTO _url;
  IF _url IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 60000)'
    USING _url || '/cron',
          jsonb_build_object('mode', _mode),
          jsonb_build_object('content-type', 'application/json', 'x-cron-secret', _secret);
END $$;
REVOKE ALL ON FUNCTION public.google_calendar_kick(text) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_net indisponível (espelho local?): %', SQLERRM;
  END;
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'google_calendar_cron_secret') THEN
      PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'google_calendar_cron_secret');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'google_calendar_function_url') THEN
      PERFORM vault.create_secret('https://dqfzuviwejlobrwebyum.supabase.co/functions/v1/google-calendar', 'google_calendar_function_url');
    END IF;
  END IF;
END $$;

SELECT cron.schedule('google-calendar-push', '* * * * *',
  $$SELECT public.google_calendar_kick('push') WHERE EXISTS (SELECT 1 FROM public.google_sync_queue)$$);
SELECT cron.schedule('google-calendar-pull', '*/10 * * * *',
  $$SELECT public.google_calendar_kick('pull') WHERE EXISTS (SELECT 1 FROM public.google_calendar_connections WHERE status <> 'revoked')$$);

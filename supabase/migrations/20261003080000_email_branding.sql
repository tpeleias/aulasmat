-- E-mails, etapa 3 (03/10): a cara da empresa nos e-mails.
--
-- Fica tudo em settings.email_notifications, junto das outras escolhas (a
-- função "emails" só usa o que o plano permite, pela account_can):
--   Pro e Max (email_branding): brand_logo (endereço público do logo, neste
--     bucket), brand_color (#rrggbb), brand_signature (até 300 letras)
--   Max (email_custom): templates {tipo: {subject, message}} com campos entre
--     chaves ({nome}, {data}...), reminder_eve_hour (12 a 22) e
--     reminder_day_hour (5 a 11)
--
-- O logo vai num bucket público (o e-mail precisa abrir a imagem sem login),
-- numa pasta com o id da empresa; só o admin dela grava ali.

INSERT INTO storage.buckets (id, name, public) VALUES ('email-logos', 'email-logos', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit') THEN
    UPDATE storage.buckets SET file_size_limit = 524288, allowed_mime_types = ARRAY['image/png', 'image/jpeg'] WHERE id = 'email-logos';
  END IF;
END $$;

CREATE POLICY "admins upload own email logo" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'email-logos' AND public.has_role(auth.uid(), 'admin'::app_role)
    AND (storage.foldername(name))[1] = public.current_account_id()::text);
CREATE POLICY "admins update own email logo" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'email-logos' AND public.has_role(auth.uid(), 'admin'::app_role)
    AND (storage.foldername(name))[1] = public.current_account_id()::text);
CREATE POLICY "admins remove own email logo" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'email-logos' AND public.has_role(auth.uid(), 'admin'::app_role)
    AND (storage.foldername(name))[1] = public.current_account_id()::text);

-- ---------------------------------------------------------------------------
-- Etapa 4: os e-mails de login saem pela função "emails" (/auth-hook), pelo
-- Send Email Hook do Supabase Auth. O segredo do hook fica no cofre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_secret(_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s text;
BEGIN
  IF _name NOT IN ('emails_cron_secret', 'resend_api_key', 'email_unsubscribe_secret', 'resend_webhook_secret', 'auth_hook_secret') THEN RETURN NULL; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1$q$ INTO _s USING _name;
  RETURN _s;
END $$;
REVOKE ALL ON FUNCTION public.email_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_secret(text) TO service_role;

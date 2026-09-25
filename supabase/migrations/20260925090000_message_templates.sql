-- Mensagens prontas de cada empresa (Thiago, 25/09): lembrete, confirmação ao
-- marcar, "estou a caminho" e cobrança. Chave = tipo, valor = texto com campos
-- entre chaves ({nome}, {dia}...). Ausente ou vazio = o texto padrão do app.
-- Escreve só o admin (política "admins manage settings"); professor lê, porque
-- também manda lembrete e "estou a caminho".
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS message_templates jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_message_templates_shape;
ALTER TABLE public.settings
  ADD CONSTRAINT settings_message_templates_shape
  CHECK (jsonb_typeof(message_templates) = 'object' AND length(message_templates::text) <= 20000);

COMMENT ON COLUMN public.settings.message_templates IS
  'Modelos de mensagem da empresa: {lembrete, confirmacao, a_caminho, cobranca}. Vazio = padrão do app.';

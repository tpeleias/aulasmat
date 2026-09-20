-- Duas coisas que andam juntas porque mexem na mesma tabela e no mesmo grant.
--
-- 1) O e-mail de contato da política de privacidade sai do código e vira campo
--    por empresa. Estava cravado em PrivacyPolicy.tsx, então toda empresa
--    cliente publicava, na política de privacidade dela, o e-mail do dono do
--    primeiro negócio.
--
-- 2) A leitura sem login de `settings` deixa de ser "a tabela inteira" e passa
--    a ser uma lista explícita de colunas. Hoje `pix_key` e `payment_link` são
--    legíveis por qualquer visitante: a política por empresa diz *quais linhas*
--    o anônimo alcança, e nunca disse *quais colunas*.

-- ---------------------------------------------------------------------------
-- 1. E-mail de contato por empresa
-- ---------------------------------------------------------------------------

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS contact_email text;

COMMENT ON COLUMN public.settings.contact_email IS
  'E-mail que a política de privacidade mostra como contato desta empresa. Nulo esconde o parágrafo em vez de mostrar o e-mail de outra.';

-- Preenche só a empresa dona do endereço público, que é a que hoje responde em
-- /privacidade. As outras ficam nulas de propósito: mostrar o e-mail errado é
-- pior que não mostrar nenhum, porque convida a família a escrever para um
-- estranho sobre os dados do filho.
UPDATE public.settings s
   SET contact_email = 'thiagopeleias@gmail.com'
 WHERE s.contact_email IS NULL
   AND EXISTS (
     SELECT 1 FROM public.accounts a
      WHERE a.id = s.account_id AND a.is_public_default
   );

-- ---------------------------------------------------------------------------
-- 2. O visitante sem login passa a ler uma lista fechada de colunas
-- ---------------------------------------------------------------------------
-- É um ALLOWLIST, não um denylist, e isso é a parte que importa: revogar só as
-- duas colunas sensíveis de hoje deixaria a PRÓXIMA coluna sensível exposta em
-- silêncio, porque ninguém lembra de voltar aqui ao adicionar uma. Assim,
-- coluna nova em `settings` nasce invisível para o visitante, e quem precisar
-- dela na página pública tem que dizer isso aqui, de propósito.
--
-- Cuidado ao mexer: quem lê como `anon` precisa pedir colunas nomeadas.
-- `select("*")` passa a falhar. Conferido no front-end antes de aplicar - as
-- consultas anônimas (PublicHome, PublicAvailability, AvailabilityBoard) já
-- nomeiam colunas; os dois `select("*")` que existem (useAppSettings e
-- SettingsPage) rodam autenticados, que não é tocado aqui.

REVOKE SELECT ON public.settings FROM anon;
GRANT SELECT (
  id,
  account_id,
  work_start,
  work_end,
  slot_minutes,
  scarcity,
  contact_email
) ON public.settings TO anon;

-- O visitante nunca escreveu em `settings`: estes grants existem só porque são
-- o padrão do Supabase para o schema public. As políticas RLS já barravam o
-- INSERT/UPDATE/DELETE, mas **TRUNCATE não passa por RLS** - é um comando de
-- tabela, não de linha. Não é alcançável pelo PostgREST, então nunca foi um
-- buraco de verdade; é um grant que ninguém usa, e fechar não custa nada.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.settings FROM anon;

-- CPF/CNPJ de quem recebe, pra aparecer no recibo (docs/proximos-passos.md,
-- pedido do Thiago em 23/09). Um recibo sem documento de quem emite não serve
-- de comprovante pra ninguém.
--
-- Nenhum grant novo: não entra na lista de colunas que o anon lê (migration
-- 20260920120000) de propósito - é allowlist, então uma coluna nova já nasce
-- invisível pra quem não está logado, e esta em especial não tem por que ser
-- pública. "admins manage settings" (FOR ALL) já cobre a escrita, por ser
-- política de linha e não de coluna.
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS issuer_document text;

COMMENT ON COLUMN public.settings.issuer_document IS
  'CPF ou CNPJ de quem recebe, impresso no recibo. Nulo deixa a linha em branco pra preencher à mão.';

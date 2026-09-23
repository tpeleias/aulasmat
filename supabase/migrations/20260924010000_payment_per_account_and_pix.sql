-- Meio de pagamento por empresa, e Pix "copia e cola" com valor (24/09).
--
-- Até aqui o texto "InfinitePay ... parcelamos em até 12x" estava cravado no
-- código: toda empresa cliente mandava, na mensagem de cobrança, a maquininha
-- e as condições do Thiago. Agora cada empresa diz o nome do link de
-- pagamento dela e o texto que acompanha.
--
-- O Pix "copia e cola" com o valor já preenchido (BR Code) exige, além da
-- chave, o nome de quem recebe e a cidade - é o padrão do Banco Central, e
-- sem eles o banco da família recusa o código.
--
-- Nenhum grant novo para `anon`: a lista de colunas que o visitante lê é
-- allowlist (migration 20260920120000), então as colunas novas já nascem
-- invisíveis para ele. A família logada lê settings pela política existente,
-- que é por linha - é assim que o portal dela mostra o Pix.

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS payment_link_label text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS payment_link_note text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pix_receiver_name text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pix_city text;

COMMENT ON COLUMN public.settings.payment_link_label IS 'Nome do link de pagamento na mensagem de cobrança e no portal (ex.: InfinitePay, Mercado Pago). Nulo mostra "Link de pagamento".';
COMMENT ON COLUMN public.settings.payment_link_note IS 'Texto que acompanha o link (formas aceitas, parcelamento). Nulo não mostra nada.';
COMMENT ON COLUMN public.settings.pix_receiver_name IS 'Nome de quem recebe o Pix, como está no banco. Necessário para o Pix copia e cola.';
COMMENT ON COLUMN public.settings.pix_city IS 'Cidade de quem recebe o Pix. Necessária para o Pix copia e cola.';

-- A empresa do endereço público (a do Thiago) continua mandando exatamente o
-- que mandava: o texto que estava no código passa a morar na linha dela.
UPDATE public.settings s
   SET payment_link_label = coalesce(s.payment_link_label, 'InfinitePay'),
       payment_link_note = coalesce(s.payment_link_note,
         'Google Pay, cartão de crédito ou Pix — no cartão, parcelamos em até 12x.')
 WHERE s.payment_link IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = s.account_id AND a.is_public_default);

-- `lessons.teacher` tinha DEFAULT 'thiago': uma aula criada sem professor, em
-- qualquer empresa, nascia do Thiago. Todas as inserções do app, do portal e
-- do assistente já informam o professor; sem default, uma que esqueça passa a
-- falhar na hora em vez de gravar o professor errado em silêncio.
ALTER TABLE public.lessons ALTER COLUMN teacher DROP DEFAULT;

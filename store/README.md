# Imagens da ficha da Google Play

- `pt-BR/phoneScreenshots/` - capturas 1080x1920, na ordem do nome.
- `pt-BR/featureGraphic.png` - imagem de destaque 1024x500.

São telas reais do app rodando com uma empresa-modelo inventada (nenhum dado
de cliente). Para refazer: `tools/` (mock.mjs = os dados de exemplo,
capture.mjs = abre o app e fotografa, compose.mjs = moldura e frase).
Textos da ficha: `listing/` (título, descrição curta e completa).
Para publicar: Actions → Update Google Play listing → apply = true.
A ficha está em pt-BR (padrão) e pt-PT, com o mesmo conteúdo, e em en-US com
textos e imagens próprios: `listing/en-US/` e `en-US/`. As fotos em inglês saem
de `TZ=America/New_York STORE_LANG=en node tools/capture.mjs` e
`STORE_LANG=en node tools/compose.mjs` (dados de exemplo em inglês, em dólar).

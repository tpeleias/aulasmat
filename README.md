# Cronys

Agenda, alunos e cobrança para quem dá aula particular.

O professor vê a agenda, quem deve, quem está em aberto e os pedidos de aula
que as famílias mandaram. A família entra no portal, vê as próprias aulas e o
que deve, e **solicita** horário — quem aprova é o professor, e só depois a
aula existe.

O app atende várias empresas no mesmo banco (cada professor/escola é uma
`account`), com as regras de acesso no Postgres e não na tela.

## Como rodar

```bash
npm install
npm run dev        # http://localhost:8080
npm run build      # gera dist/
npx tsc --noEmit   # checagem de tipos
npm test           # testes
```

As chaves do Supabase ficam no `.env`, que é versionado de propósito: são as
chaves públicas (`anon`), o Android embute o `dist/` no `.aab`, e sem elas o
build da esteira sairia sem back-end. O que protege os dados são as políticas
de RLS, não o segredo da chave.

## Onde as coisas ficam

| O quê | Onde |
| --- | --- |
| Telas do professor | `src/pages/admin/` |
| Portal da família | `src/pages/student/` |
| Páginas públicas (sem login) | `src/pages/Public*.tsx` |
| Banco: tudo que já foi aplicado | `supabase/migrations/` |
| Funções de borda | `supabase/functions/` |
| App Android (Capacitor) | `android/` |
| Marca: paleta e tipografia | `src/index.css`, `src/components/brand.tsx` |
| Marca: ícones, splash, og-image | `scripts/gerar-identidade.py` |
| Notas de trabalho entre conversas | `docs/proximos-passos.md` |
| Publicar na Play Store | `docs/publicar-na-play.md` |

## A marca

Navy e dourado, com Fraunces no nome. Uma regra vale para o dourado inteiro:
**ele mora sobre o navy escuro e nunca vira texto sobre fundo claro** —
`#C9A227` sobre branco dá contraste 2,3:1, abaixo do mínimo legível.

Os ícones não se editam à mão. O desenho existe uma vez, em
`scripts/gerar-identidade.py`, e de lá saem os 28 arquivos (favicon, PWA,
apple-touch, mipmaps Android nas 5 densidades, os 11 splash e o og-image):

```bash
pip install pillow cairosvg
python3 scripts/gerar-identidade.py
```

## Publicado em dois lugares

`main` vai para o **Netlify sozinho**; o **Lovable não publica sozinho** e
precisa de um deploy explícito. Detalhe em `docs/proximos-passos.md`.

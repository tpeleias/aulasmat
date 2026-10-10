# OpenSquad com o Cronys, passo a passo

O que você vai ter no fim: uma pasta no seu computador com 4 "squads" (times de
agentes) que leem os números reais do Cronys e trabalham em sequência:
**Marketing**, **Financeiro**, **Prospecção** e **Jurídico**. Você pede, eles
fazem, e param para você aprovar nos pontos importantes.

Tempo: uns 40 minutos na primeira vez. Depois, é só abrir e pedir.

> Precisa de um computador (Windows ou Mac) e de uma assinatura paga do Claude
> (Pro ou Max), que é o que o Claude Code usa. Cada execução de squad gasta
> desse uso; comece com um squad por vez.

---

## Parte 1: instalar (uma vez só)

### 1. Node.js
1. Entre em [nodejs.org](https://nodejs.org) e baixe a versão **LTS** (o botão
   verde da esquerda).
2. Instale clicando em "Avançar" até o fim (pode deixar tudo como vem).

### 2. Claude Code
- **Jeito mais fácil:** baixe o app do Claude para computador
  ([claude.ai/download](https://claude.ai/download)), entre com a sua conta e
  abra a aba **Code**.
- **Ou pelo terminal:** siga [code.claude.com](https://code.claude.com).

### 3. A pasta dos squads
1. Crie uma pasta vazia chamada `cronys-squads` (por exemplo, em Documentos).
2. Abra essa pasta no Claude Code (no app: aba Code → escolher pasta).
3. No terminal dessa pasta (no app, o Claude Code roda comandos por você:
   peça *"rode `npx opensquad init` nesta pasta"*), rode:

   ```
   npx opensquad init
   ```

   Ele pergunta a língua e o programa: escolha **Português** e **Claude Code**.

---

## Parte 2: ligar o Cronys e criar os squads (uma vez só)

1. No Cronys, pegue o link do conector do gestor: **painel do gestor → aba
   Assistente e IA → Conectar IA ao painel do gestor → Criar link → Copiar**.
   (Pode criar um link novo só para o OpenSquad, com o nome "OpenSquad".)
2. No Claude Code, dentro da pasta `cronys-squads`, cole o texto abaixo,
   trocando `COLE_O_LINK_AQUI` pelo link:

```
Vou usar o OpenSquad nesta pasta para gerir o Cronys, a minha empresa. Faça, em ordem:

1. Ligue o conector do Cronys (só números da plataforma, nenhum dado de cliente) neste projeto:
   claude mcp add --transport http --scope project cronys-gestor "COLE_O_LINK_AQUI"
   Depois confira que as ferramentas platform_overview e platform_companies respondem.

2. Preencha _opensquad/_memory/company.md com:
   - Nome: Cronys
   - Site: cronys.com.br (app Android na Google Play)
   - Setor: SaaS de agenda, clientes e financeiro para quem vive de atendimento marcado
   - Descrição: app brasileiro para professores particulares, escolas de reforço, psicólogos, fisioterapeutas, nutricionistas, personal trainers, clínicas pequenas e pet shops. Agenda, portal da família, cobrança por Pix e cartão, pacotes por número de aulas, "Como foi?" de cada atendimento, materiais e tarefas, assistente de IA e o Conectar IA (Claude/ChatGPT dentro do Cronys).
   - Público: profissional autônomo ou pequena equipe, pouco tempo, que hoje usa caderno, planilha e WhatsApp
   - Tom de voz: próximo, prático, de quem também atende cliente; nada de jargão de marketing
   - Produtos: Essencial (grátis), Start R$ 29,90, Pro R$ 49,90, Max IA R$ 129,90 por mês; anual = 10 mensalidades; teste grátis de 14 dias do Pro (o Conectar IA vale nos 3 primeiros dias); cupom LANCAMENTO
   - Dono: Thiago, professor de matemática, que faz tudo sozinho
   E em _opensquad/_memory/preferences.md: nome Thiago, saída em Português (Brasil), IDE claude-code, data DD/MM/AAAA.

3. Crie, um de cada vez, com o Arquiteto do OpenSquad (/opensquad crie um squad ...), estes 4 squads. Todos devem começar lendo os números do conector cronys-gestor, nunca inventar número, dizer o que é estimativa e pausar para eu aprovar antes de entregar:
   a) "marketing-cronys": pesquisa o que está acontecendo no Cronys (empresas novas, ramos que mais crescem, testes), escolhe temas da semana para UM ramo por peça, escreve 3 posts (Instagram/LinkedIn) e 1 roteiro de Reels prontos para publicar, com chamada para o teste grátis, e revisa se nada promete o que o app não faz.
   b) "financeiro-cronys": analisa receita estimada, pagantes por plano, testes que viram assinatura, gasto com IA perto do teto, e entrega os 3 números da semana, o que mudou e até 3 ações com impacto e esforço, em português simples.
   c) "prospeccao-cronys": olha testes acabando nos próximos 7 dias e empresas que pararam de usar, classifica em quente/morno/frio e escreve a mensagem pronta de cada uma (eu envio, ele não envia nada); sugere um canal novo para achar clientes, sem inventar contatos e respeitando a LGPD.
   d) "juridico-cronys": revisa termos de uso, privacidade (LGPD, dados de crianças e de saúde em alguns ramos), cancelamento e arrependimento de 7 dias, regras da Google Play, Stripe e Asaas; entrega resposta curta, passos e o que levar a um advogado, marcando [VERIFICAR] no que depender de dado que não tem. Deixe claro que não substitui advogado.

4. No fim, me mostre a lista dos squads e como rodar cada um.
```

3. Responda as perguntas do Arquiteto quando ele parar. Em geral é só
   confirmar.

---

## Parte 3: usar (toda semana)

Abra a pasta `cronys-squads` no Claude Code e peça, por exemplo:

| Para | Digite |
|---|---|
| Posts da semana | `/opensquad rode o squad marketing-cronys` |
| Números e recomendações | `/opensquad rode o squad financeiro-cronys` |
| Quem contatar e o que dizer | `/opensquad rode o squad prospeccao-cronys` |
| Revisar um assunto jurídico | `/opensquad rode o squad juridico-cronys sobre <o assunto>` |

Os resultados ficam na pasta `squads/<nome>/output/`, um arquivo por
execução.

Para ver os agentes trabalhando num "escritório virtual":
`/opensquad dashboard` e depois, no terminal, `npx serve squads/<nome>/dashboard`
(abre em `http://localhost:3000`).

---

## Dúvidas comuns

- **Deu erro de conector?** Veja se o link do gestor ainda está ligado no
  Cronys (painel do gestor → Assistente e IA). Se desligou, crie outro e rode
  de novo o comando `claude mcp add` da Parte 2 com o link novo.
- **O link é secreto?** Sim. O comando guarda o link no arquivo `.mcp.json`
  desta pasta: não mande essa pasta para ninguém.
- **E os projetos do Claude que já montei?** Continuam valendo para
  conversar no dia a dia, até pelo celular. O OpenSquad é para quando você quer
  que vários agentes trabalhem em sequência, sozinhos.

Fontes: [README do OpenSquad](https://cdn.jsdelivr.net/npm/opensquad@0.1.15/src/readme/README.md)
(versão 0.1.15, instalação por `npx opensquad init`, Node.js 20+).

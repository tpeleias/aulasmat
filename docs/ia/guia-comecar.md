# IA no Cronys: guia do zero

Este guia é para quem nunca configurou nada disso. São três etapas. Faça uma por
vez e só passe para a próxima quando a anterior estiver funcionando.

| Etapa | O que você ganha | Tempo | Precisa instalar? |
|---|---|---|---|
| 1. Conectar o Claude ao Cronys | Pedir coisas ao Cronys conversando ("Como foi?", quem deve, agenda) | 10 min | Não |
| 2. Montar seus agentes de gestão | Um "time" de marketing, financeiro, prospecção e jurídico com os números reais do Cronys | 20 min | Não |
| 3. OpenSquad (opcional, depois) | Agentes trabalhando em sequência, sozinhos, com pausas para você aprovar | 1 h | Sim (Node.js) |

---

## Etapa 1: conectar o Claude ao Cronys

**O que é:** o Claude passa a "enxergar" o Cronys por um link secreto. Ele lê a
agenda e o financeiro e, quando for gravar algo, pede sua confirmação.

1. Crie uma conta em [claude.ai](https://claude.ai) (se ainda não tiver). Use no
   computador, que é mais fácil para configurar.
2. No Cronys, entre como administrador e vá em **Configurações → Integrações →
   Conectar IA**.
3. Dê um nome (ex.: "Claude do Thiago") e clique em **Criar link**. Clique em
   **Copiar**. O link aparece uma vez só.
4. No Claude: **Configurações → Conectores → Adicionar conector personalizado**.
   Nome: `Cronys`. URL: cole o link. Autenticação: **Sem login**. Clique em
   **Adicionar**.
   - Mais discreto (opcional): em URL, cole só o começo do link, até `/mcp`.
     Em **Adicionar cabeçalho**, nome `Authorization` e valor `Bearer crn_...`
     (a palavra Bearer, um espaço e o final do link). A chave fica escondida no
     Claude, fora de prints e dos registros do servidor.
5. Abra uma conversa nova, clique no botão de ferramentas (**+** ou o ícone de
   controles) e veja se o **Cronys** está ligado.
6. Teste: *"Me dá um resumo do meu Cronys."*

Pronto. Exemplos para o dia a dia:

- *"Coloca estas anotações no Como foi? da aula de hoje com o Miguel: [cole aqui]"*
- *"Quem está devendo? Monta uma mensagem gentil de WhatsApp para cada responsável."*
- *"Quais aulas da semana passada estão sem Como foi?"*
- *"Marca o Pedro quinta às 15h."* (o Claude confirma antes de gravar)

**Para os "Como foi?" a partir dos seus projetos do Claude:** dentro de qualquer
projeto seu (ex.: "Aulas de Matemática"), com o Cronys ligado na conversa, peça:
*"Usa as notas da aula de hoje deste projeto e escreve o Como foi? da aula do
Miguel no Cronys."* O Claude mostra o texto, você aprova e ele grava.

**Segurança, em uma frase:** quem tiver o link mexe no seu Cronys. Não mande o
link para ninguém. Se vazar, vá em Conectar IA, clique em **Desligar** e crie
outro.

**Quer um conector só para olhar?** Ao criar, ligue **Só leitura**: a IA
consulta, mas não grava nada.

---

## Etapa 2: seus agentes de gestão

**O que é um "agente" aqui:** um projeto do Claude com instruções fixas de um
papel (ex.: "você é o diretor financeiro do Cronys"). Toda conversa dentro do
projeto já começa com esse papel.

### 2.1. Ligue o conector do gestor

1. No Cronys, entre no **painel do gestor** → aba **Assistente e IA** →
   **Conectar IA ao painel do gestor** → **Criar link** → **Copiar**.
2. No Claude: **Configurações → Conectores → Adicionar conector personalizado**.
   Nome: `Cronys gestor`. URL: cole o link.

Esse conector só traz números da plataforma (empresas, planos, testes, receita
estimada, gasto com IA). Nenhum dado dos clientes das empresas.

### 2.2. Crie um projeto para cada agente

Para cada arquivo da pasta [`agentes/`](agentes/):

1. No Claude, clique em **Projetos → Criar projeto**. Nome: o do agente (ex.:
   "Cronys - Financeiro").
2. Em **Instruções do projeto**, cole o texto inteiro do arquivo.
3. Em **Conhecimento do projeto**, se quiser, envie o arquivo
   [`sobre-o-cronys.md`](agentes/sobre-o-cronys.md), que descreve o produto.
4. Abra uma conversa no projeto, ligue o conector **Cronys gestor** e peça:
   *"Faça a análise da semana."*

Os agentes prontos:

| Agente | Para que serve | Comece pedindo |
|---|---|---|
| [Financeiro](agentes/financeiro.md) | Receita, custo da IA, preço, fluxo de caixa | "Como está a receita e o que falta para pagar as contas?" |
| [Marketing](agentes/marketing.md) | Posts, campanhas, e-mails, calendário de conteúdo | "Monte o calendário de posts das próximas 2 semanas." |
| [Prospecção](agentes/prospeccao.md) | Achar e abordar novos assinantes, converter testes | "Quais testes acabam esta semana? Escreva a abordagem de cada um." |
| [Jurídico](agentes/juridico.md) | Termos, privacidade (LGPD), contratos, riscos | "Revise os pontos de LGPD que o Cronys precisa cuidar." |

**Dica:** o jeito mais fácil de usar é uma vez por semana, no mesmo dia, abrir
cada projeto e pedir a análise da semana. Depois você vai ajustando as
instruções com o que funcionou.

---

## Etapa 3 (opcional): OpenSquad

**O que é:** o [OpenSquad](https://github.com/renatoasse/opensquad) é um projeto
gratuito e aberto que monta "squads": vários agentes que trabalham em sequência
(ex.: pesquisador → estrategista → redator → revisor), pausando para você
aprovar. Ele roda dentro de um programa de programação com IA (Claude Code,
Cursor e outros), não no site do Claude, e ainda está no começo (versão 0.1).

Só vale a pena depois que as etapas 1 e 2 estiverem no seu dia a dia.

1. Instale o **Node.js 20 ou mais novo** ([nodejs.org](https://nodejs.org),
   botão "LTS").
2. Instale o **Claude Code** (o app de computador do Claude tem a aba "Code", ou
   siga [code.claude.com](https://code.claude.com)).
3. Crie uma pasta vazia, por exemplo `cronys-squads`, e abra o terminal nela.
4. Rode `npx opensquad init`.
5. Ligue o conector do gestor no Claude Code (troque pelo seu link):
   `claude mcp add --transport http cronys-gestor "COLE_O_LINK_AQUI"`
6. Abra o Claude Code nessa pasta e digite: `/opensquad crie um squad de
   marketing para o Cronys que usa os números do conector cronys-gestor e
   produz os posts da semana`.
7. O "Arquiteto" do OpenSquad faz perguntas e monta o squad. Depois, para rodar:
   `/opensquad rode o squad <nome>`.

**Custo:** o OpenSquad é grátis, mas cada execução gasta o uso do seu plano do
Claude (ou da IA que você usar). Comece com squads pequenos.

Fontes: [README do OpenSquad](https://cdn.jsdelivr.net/npm/opensquad@0.1.15/src/readme/README.md),
[resumo do projeto](https://www.sourcepulse.org/projects/26214255),
[comparação de ferramentas de squads](https://crevio.co/pt/blog/squad-so-alternatives).

---

## E para as empresas que assinam o Cronys?

Elas já podem usar a Etapa 1 hoje: cada empresa cria o próprio link em
**Configurações → Integrações → Conectar IA** e liga no Claude, no ChatGPT ou em
qualquer IA que aceite conector MCP. A IA é delas, então o Cronys não paga nada
por isso. O assistente dentro do app continua sendo a opção para quem não quer
configurar nada.

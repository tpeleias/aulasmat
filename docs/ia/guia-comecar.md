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
- *"Faz uma lista de 10 exercícios de frações para o Miguel e manda para ele."*
  O Claude escreve a lista (com as fórmulas certinhas), mostra para você e,
  quando você aprova, ela aparece em **Materiais** no portal do aluno, que lê
  e salva em PDF.
- *"Passa como tarefa para o Miguel fazer a lista até sexta."* Vira tarefa
  com prazo, e o aluno recebe o aviso.
- *"Manda para a Ana este vídeo: https://youtu.be/..."* Vira um link nos
  materiais dela.

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

O [OpenSquad](https://github.com/renatoasse/opensquad) monta "squads": vários
agentes que trabalham em sequência (pesquisador → estrategista → redator →
revisor), pausando para você aprovar. Roda no computador, dentro do Claude
Code. O passo a passo completo, com um texto pronto para colar que configura
o Cronys e cria os 4 squads, está em [`opensquad.md`](opensquad.md).

---

## E para as empresas que assinam o Cronys?

No plano **Max IA** (e nos 3 primeiros dias do teste grátis do Pro), elas
usam a Etapa 1: cada empresa cria o próprio link em
**Configurações → Integrações → Conectar IA** e liga no Claude, no ChatGPT ou em
qualquer IA que aceite conector MCP. A IA é delas, então o Cronys não paga nada
por isso. O assistente dentro do app continua sendo a opção para quem não quer
configurar nada.

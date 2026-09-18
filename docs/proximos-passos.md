# Próximos passos

Notas de planejamento entre Thiago e o Claude. Não é documentação do produto —
é um bloco de notas para retomar trabalho entre conversas sem precisar reler
um chat inteiro. Atualize/apague itens conforme forem resolvidos.

## Fila de itens pequenos (prontos para implementar)

Os 3 itens abaixo foram implementados (typecheck, lint no nível já existente
no projeto, testes e build de produção passando):

1. ~~Ícone "A" ao salvar o site na tela de início do iPhone/iPad~~ — feito.
   Gerado `public/apple-touch-icon.png` (180×180, arte do `ic_launcher.png`
   composta sobre o fundo `#20232B`) e adicionada a tag
   `<link rel="apple-touch-icon">` em `index.html`.

2. ~~Editar aula recorrente: perguntar "só esta" ou "esta e as futuras"~~ — feito.
   Implementada a via de **inferência** em `LessonDialog.tsx`: ao salvar a
   edição de uma aula existente, busca outras aulas do mesmo aluno/professor,
   ainda `agendada`, no mesmo dia da semana e horário, com data futura. Se
   achar alguma, pergunta (via `confirm()`) se aplica a alteração só a esta
   ou a esta e às futuras; ao aplicar a todas, reaplica o novo horário
   (hora:minuto) mantendo a data de cada ocorrência, e não toca em
   `status`/`class_summary`/`payment_status` de cada uma.

3. ~~Aula cancelada aparece em vermelho na agenda~~ — feito.
   `CalendarPage.tsx`: `status === "cancelada"` agora prioriza
   `bg-destructive/15` / `border-l-destructive`, com nome tachado
   (`line-through`).

Pendente (deixado para depois, a pedido do Thiago): um 4º item ainda não
escrito neste arquivo — perguntar a ele qual é antes de seguir.

## Linha de fundo: abrir para outras empresas (SaaS)

Contexto: não é "adicionar professores" à escola do Thiago — são **empresas
clientes independentes**, cada uma com o próprio negócio, próprios alunos e
próprios dados. Thiago não deve (nem quer) ver os dados delas.

**Decisão tomada:** não fazer a cirurgia multi-tenant (schema compartilhado
com `account_id` em tudo) agora. Risco alto — dados de crianças, várias
regras de acesso para acertar, e a edge function do assistente roda com
`service_role`, que ignora RLS. Um erro ali vaza dados entre empresas
clientes de verdade, não só entre você e sua esposa.

**Caminho escolhido: uma instância isolada por empresa.**
- Banco Supabase próprio por empresa (confirmado: R$ 0/mês por projeto
  extra na organização atual)
- Site próprio no Netlify, mesmo repositório, apontando pro banco dela
- Isolamento é estrutural (bancos fisicamente separados), não depende de
  nenhuma regra de acesso estar certa

**Para não parecer "provisório" com várias empresas:**
- Domínio próprio (~R$ 40/ano) com subdomínio por empresa:
  `empresax.portaldeaulas.com.br` em vez de link do Netlify
- Script de provisionamento: automatizar criar banco + aplicar migrações +
  criar site + configurar variáveis + criar admin, tudo num comando, em vez
  de montar cada instância na mão

**Limite do modelo:** cada melhoria de banco precisa ser aplicada em cada
instância separadamente (o código do site atualiza sozinho via Git, o banco
não). Tranquilo até uns 6-8 clientes; a partir daí a repetição começa a
doer, e é o gatilho real para considerar a cirurgia multi-tenant — não o
número de empresas testando.

**Ativar/desativar por pagamento (perguntado, ainda não implementado):**
- Rastrear quem pagou = uma lista simples (planilha), não precisa de nada
  no app agora
- Cortar acesso = pausar o projeto Supabase da empresa (ação manual, já
  existe pronta no Supabase, reversível)
- Automatizar isso (cobrança recorrente + corte automático) só quando o
  número de clientes tornar o processo manual inviável — não construir
  infra de cobrança antes de validar se alguém paga

**Não fazer ainda:** painel único mostrando todas as empresas juntas (só
existe naturalmente com schema compartilhado — é exatamente o que estamos
evitando por enquanto).

## Como retomar

Numa conversa nova: aponte para este arquivo (`docs/proximos-passos.md`) em
vez de continuar uma conversa antiga e longa — custa bem menos crédito, porque
não precisa reprocessar o histórico inteiro a cada mensagem.

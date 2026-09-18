# Próximos passos

Notas de planejamento entre Thiago e o Claude. Não é documentação do produto —
é um bloco de notas para retomar trabalho entre conversas sem precisar reler
um chat inteiro. Atualize/apague itens conforme forem resolvidos.

## Fila de itens pequenos (prontos para implementar)

1. **Ícone "A" ao salvar o site na tela de início do iPhone/iPad**
   Causa confirmada: `index.html` só declara `favicon.ico`. O Safari usa a
   primeira letra do título quando não há `apple-touch-icon`. Falta gerar um
   PNG 180×180 (mesma arte do ícone da Play Store) e adicionar a tag
   `<link rel="apple-touch-icon" href="...">`.

2. **Editar aula recorrente: perguntar "só esta" ou "esta e as futuras"**
   Hoje não existe conceito de série no banco — cada linha de `lessons` é
   solta, sem link para as demais do mesmo aluno/horário. Duas opções:
   - **Inferir** (mais simples): ao editar, buscar outras aulas do mesmo
     aluno/professor/dia da semana/horário nas próximas semanas e oferecer o
     "aplicar a todas" com base nisso.
   - **Explícito** (mais robusto, mais trabalho): dar às aulas um vínculo de
     série no momento da criação, do jeito que `blocks` já faz para
     bloqueios recorrentes (`block_type = 'recurring'`, `weekday`).
   Recomendação: começar pela inferência, é o suficiente para o caso de uso.

3. **Aula cancelada aparece em vermelho na agenda**
   Confirmado: `CalendarPage.tsx` (~linha 274) não tem nenhum tratamento para
   `status === "cancelada"` — ela renderiza igual a uma aula normal (mesma
   cor azul/rosa por professor). Ajustar a expressão de classe para priorizar
   `status === "cancelada"` → `bg-destructive/…`, com tachado no nome.
   Mudança pontual, só CSS/JSX, sem tocar banco.

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

Esta é uma evolução grande — vou descrever tudo que será implementado para você aprovar antes de eu começar a codar. O escopo é amplo, então prefiro alinhar primeiro para não retrabalhar.

## 1. Login como tela inicial + redirecionamento por perfil

- `/` passa a ser a tela de login/cadastro (atualmente `/auth`).
- Hoje só existe a role `admin`. Vou adicionar a role `student` no enum `app_role`.
- No login:
  - Se o usuário tem role `admin` → vai para `/admin` (calendário etc., como hoje).
  - Se tem role `student` → vai para `/aluno` (novo dashboard).
  - Sem role → tela "aguardando vinculação" pedindo para o professor liberar.
- Vínculo aluno ⇄ conta:
  - Adicionar coluna `user_id uuid` (nullable) na tabela `students`.
  - Quando um responsável se cadastra, ele informa o e-mail. No painel admin, na lista de alunos, você poderá clicar em "Vincular conta" e escolher o e-mail/usuário; isso preenche `students.user_id` e cria a linha em `user_roles` com role `student`.
  - Alternativa: você gera o acesso pelo admin (cria usuário via edge function `admin-create-user` já existente, vincula, e o aluno recebe a senha).

## 2. Dashboard do aluno (`/aluno`)

Layout limpo com 4 seções:

- **Aulas**: lista filtrada por `students.user_id` (via `student_name` vinculado), separada em abas: Futuras / Realizadas / Pendentes de pagamento.
- **Financeiro**: saldo atual + extrato (lê `wallet_transactions` filtrando pelo aluno/responsável vinculado). Mostra pacotes adquiridos, aulas debitadas e pendentes.
- **Materiais**: documentos enviados pelo professor para esse aluno (download).
- **Tarefas**: lista de homework com contador de prazo e botão de envio.

Também terá botão "Falar no WhatsApp" com link dinâmico para o professor daquela aula (número configurado em settings do professor).

## 3. Diário de classe (resumo da aula)

- Adicionar campos `status` (`agendada` / `realizada` / `cancelada`) e `class_summary text` em `lessons`.
- No `LessonDialog`, quando admin marca como "realizada", o campo de sumário fica visível.
- O aluno enxerga o sumário na timeline das aulas realizadas dele.

## 4. Materiais (upload de arquivos)

- Criar bucket privado `student-materials` no Cloud Storage.
- Nova tabela `student_materials` (student_id, title, file_path, uploaded_by, created_at).
- RLS: admin pode tudo; aluno só vê materiais onde `student_id` corresponde ao seu `students.user_id`.
- Política do storage: admin pode upload/delete; aluno só pode ler arquivos do seu próprio caminho (`{student_id}/...`).
- Tela no admin (dentro do CRM do aluno) para anexar PDFs/imagens.

## 5. Tarefas (Homework Tracker)

- Tabela `homework` (student_id, title, description, deadline, status, created_by).
- Tabela `homework_submissions` (homework_id, file_path, submitted_at, feedback).
- Bucket `homework-submissions` (privado).
- Admin: cria/edita tarefas por aluno.
- Aluno: vê contador de prazo (`Faltam X dias` / `Entrega hoje` / `Atrasado`), faz upload da resolução.
- Admin: corrige (campo de feedback opcional).

## 6. Configurações de pagamento

- Adicionar em `settings`: `pix_key text`, `payment_link text`, `show_payment_info_to_students bool`.
- Tela de Configurações do admin ganha esses campos + toggle.
- Se toggle ligado, a seção financeira do aluno mostra a chave PIX (com botão "copiar") e o link de pagamento (botão "Pagar agora").

## 7. Comunicação (WhatsApp)

- Adicionar `whatsapp text` por professor — solução simples: duas chaves em `settings` (`whatsapp_thiago`, `whatsapp_mayara`).
- Botão no dashboard do aluno e em cada card de aula: abre `https://wa.me/<numero>?text=...` com contexto pré-preenchido.

## Mudanças técnicas resumidas

- **Migrations**: novo enum value `student`, colunas em `students` e `lessons`, novas tabelas `student_materials`, `homework`, `homework_submissions`, novas colunas em `settings`, dois buckets de storage + policies.
- **Edge function**: reuso da `admin-create-user` para criar contas de alunos pelo admin.
- **Frontend**:
  - Novo layout `StudentLayout` + páginas `/aluno`, `/aluno/aulas`, `/aluno/financeiro`, `/aluno/materiais`, `/aluno/tarefas`.
  - Atualização do `App.tsx` (rota raiz vira login; redirecionamento por role).
  - Atualização do `useAuth` para expor a role do usuário (admin/student/none).
  - Atualizações no CRM de alunos (vincular conta, anexar materiais, criar tarefas).
  - Atualização do `LessonDialog` com status e sumário da aula.
  - Atualização do `SettingsPage` com PIX/link/toggle.

## Sugestão de execução em fases

Como é bastante coisa, sugiro fatiar em entregas (cada fase já fica usável):

1. **Fase 1 — Fundação**: roles `student`, vínculo de conta no CRM, login redirecionando por role, `StudentLayout` com Dashboard de aulas + financeiro (read-only).
2. **Fase 2 — Diário de classe + WhatsApp**: status/sumário na aula, botão WhatsApp, leitura no portal do aluno.
3. **Fase 3 — Materiais**: bucket, tabela, upload no admin, download no aluno.
4. **Fase 4 — Homework Tracker**: tarefas, prazos, entregas, feedback.
5. **Fase 5 — Configurações de pagamento**: PIX, link, toggle, exibição no aluno.

## Perguntas rápidas antes de começar

1. Confirma fatiar em 5 fases (entrego e você valida cada uma) ou prefere que eu mande tudo de uma vez?
2. Para o cadastro do aluno: prefere **só você criar as contas** pelo admin, ou **deixar cadastro público** + você aprovar/vincular depois?
3. Os números de WhatsApp do Thiago e da Mayara — quer que eu deixe campos vazios em Configurações para você preencher, ou já tem os números para eu colocar como default?

Me responda esses pontos (ou apenas "pode começar pela Fase 1" / "manda tudo") que eu já parto para a implementação.
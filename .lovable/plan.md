## Plano de implementação

Vou implementar 6 grandes mudanças. Como o escopo é grande, agrupo em fases claras.

### 1. Multi-professor (cadastro + escala)

**Banco:**
- Nova tabela `teachers` (id, name, active, created_at). RLS: admins gerenciam, todos autenticados podem ler. Seed inicial com "Thiago" e "Mayara".
- Coluna `teacher` em `lessons` e `blocks` continua sendo `text` (nome/slug). Migração: nada a remover, só nova tabela.

**Frontend:**
- Nova página `/admin/teachers` (CRUD simples: nome + ativo).
- `LessonDialog`: carregar lista de `teachers` ativos no select.
- `CalendarPage`: filtro vira dropdown dinâmico com opção "Todos" (mostra todos + cor por professor). Bloqueios já são por `teacher`, manter.
- `BlocksPage`: select de professor puxa da nova tabela.
- Item de menu "Professores" em `AdminLayout`.

### 2. Agendamento por alunos (configurável)

**Banco:** nova coluna `settings.allow_student_booking boolean default true`.

**Frontend:**
- `SettingsPage`: toggle "Permitir que alunos agendem aulas diretamente".
- Nova página `/aluno/agendar` que reusa lógica de disponibilidade (similar a `PublicAvailability`). Cria `lesson` com `student_name` do aluno logado e `payment_status='pendente'`, `status='agendada'`.
- Adicionar policy RLS: `students insert own lessons` quando setting permitir. Como RLS não lê settings facilmente, fazer policy: `EXISTS (select 1 from students s where s.user_id = auth.uid() and s.student_name = lessons.student_name) AND (select allow_student_booking from settings where id=1)`.
- Esconder botão/menu no portal do aluno quando setting desligada.

### 3. Lógica financeira

**Banco:**
- Alterar trigger `sync_lesson_wallet`:
  - INSERT: só cria transação `kind='lesson'` (negativa) se `status='realizada'`.
  - UPDATE: se mudou para `realizada` → criar/atualizar transação; se saiu de `realizada` → remover.
  - Manter atualização de valor/descrição quando já existe.

**Frontend (busca por "Crédito"):**
- Substituir rótulos "Crédito"/"Adicionar crédito" → "Pagamento"/"Adicionar pagamento" em BillingPage, StudentBilling, etc.
- Saldo: helper `formatBalance(value)` → `{ label: value >= 0 ? "Crédito Disponível" : "A pagar", amount: Math.abs(value) }`. Aplicar em BillingPage, StudentBilling, StudentDashboard, StudentsPage cards.

### 4. Contas de alunos: senha

**Banco:** coluna `students.must_change_password boolean default false`.

**Edge function `link-student-account`:** quando cria usuário novo ou faz reset, marcar `must_change_password=true` no student.

**Nova edge function `admin-reset-student-password`** (admin-only): recebe `student_id` + `new_password`, usa service role para `auth.admin.updateUserById`, marca `must_change_password=true`. Retorna senha gerada se não passada.

**Frontend:**
- `StudentManageDialog`: novo botão "Resetar senha" → mostra senha gerada copiável.
- Aviso: por segurança não é possível "visualizar a senha atual" (senhas são hash). Em vez disso, oferecer reset rápido com senha gerada exibida ao admin.
- `useAuth`: ao logar, se `students.must_change_password === true`, redirecionar para `/aluno/trocar-senha`.
- Nova página `/aluno/trocar-senha`: form nova senha → `supabase.auth.updateUser({password})` + update `must_change_password=false`. Bloqueia outras rotas até concluir.

### 5. Bug upload de tarefas

Investigar `StudentHomework.tsx` — provável causa: caminho do arquivo não começa com `student_id/...` que as RLS do bucket esperam, ou `contentType` ausente para PDFs. Conferir policies do bucket `homework-submissions` na migração existente; ajustar storage policies para aceitar path `{student_id}/{homework_id}/file` e incluir `contentType` no upload.

### 6. Status no painel do aluno

`StudentLessons` / `StudentDashboard`: remover seção "Pendentes". Manter só "Próximas" (start_at > now()) e "Realizadas" (status='realizada' ou start_at < now()).

### Estrutura técnica

**Migrações (uma só):**
```sql
create table teachers (id uuid pk, name text unique, active bool default true, ...);
alter table settings add column allow_student_booking boolean not null default true;
alter table students add column must_change_password boolean not null default false;
-- replace sync_lesson_wallet trigger function
-- new RLS: students insert own lessons (with settings check via security definer fn)
-- adjust storage policies for homework-submissions / student-materials if needed
insert into teachers (name) values ('Thiago'),('Mayara');
```

**Arquivos novos:**
- `src/pages/admin/TeachersPage.tsx`
- `src/pages/student/StudentBooking.tsx`
- `src/pages/student/ChangePassword.tsx`
- `src/hooks/useTeachers.ts`
- `supabase/functions/admin-reset-student-password/index.ts`

**Arquivos editados:**
- `App.tsx`, `AdminLayout.tsx`, `StudentLayout.tsx`
- `LessonDialog.tsx`, `CalendarPage.tsx`, `BlocksPage.tsx`
- `BillingPage.tsx`, `StudentBilling.tsx`, `StudentDashboard.tsx`, `StudentLessons.tsx`, `StudentsPage.tsx`
- `SettingsPage.tsx`, `StudentManageDialog.tsx`
- `useAuth.tsx` (redirect troca de senha)
- `useStudent.ts` (expor must_change_password)

### Observação sobre "Visualizar senha atual"

Senhas no Supabase são armazenadas com hash irreversível — não é tecnicamente possível mostrar a senha atual. Vou implementar **reset com senha gerada visível** (admin escolhe ou clica "Gerar") + cópia em um clique + obriga troca no próximo login. Isso atende a intenção sem comprometer segurança.

Posso prosseguir?

# Plano: Perfil do Aluno (filho), login por username e geradores de acesso

## Contexto

Hoje o sistema tem 2 papéis: `admin` (professor) e `student` (que na prática é o **responsável**, com acesso completo incluindo financeiro). Vamos adicionar um terceiro papel para o **aluno em si** (a criança/adolescente), com visão pedagógica restrita.

Para não quebrar a base existente, vou **renomear conceitualmente** mantendo o enum como está:
- `admin` → professor (sem mudança)
- `student` → continua sendo o **responsável** (sem mudança no código existente)
- novo papel `child` → o aluno em si (acesso restrito)

> Não vou reusar a palavra "aluno" no enum para evitar conflito com o role `student` já existente. Na UI tudo aparecerá como "Aluno" e "Responsável" em português.

---

## 1. Banco de dados (migração)

- Adicionar valor `child` ao enum `app_role`.
- Adicionar coluna `students.child_user_id uuid` (nullable) — vincula o aluno-criança à sua conta auth.
- Adicionar coluna `students.child_username text` (nullable, único quando preenchido) — só para exibir/lembrar o username escolhido.
- Adicionar coluna `students.child_must_change_password boolean default false`.
- RLS: criar policies para o role `child` em:
  - `lessons` (SELECT onde `student_name` corresponde ao seu registro via `child_user_id`)
  - `student_materials` (SELECT próprio)
  - `homework` (SELECT próprio)
  - `homework_submissions` (SELECT e INSERT próprios)
  - `students` (SELECT do próprio registro via `child_user_id`)
  - **NÃO** dar acesso a `wallet_transactions` nem `settings.payment_*`.

---

## 2. Autenticação por username

Como o Supabase Auth exige email, vou usar sufixo invisível:

```
USERNAME_DOMAIN = "aluno.sistema.local"
emailFromUsername("miguel.silva") → "miguel.silva@aluno.sistema.local"
```

- Util novo: `src/lib/username.ts` com `toEmail(username)` e validador (regex `^[a-z0-9._-]{3,30}$`).
- Tela de login (`/`): adicionar tab "Aluno" ao lado de "Entrar/Criar conta" que aceita username + senha e por baixo dos panos chama `signInWithPassword` com o email derivado.
- Auto-confirmar email para essas contas (criadas via edge function com `email_confirm: true`, igual ao fluxo atual de `link-student-account`).

---

## 3. Roteamento e layout

- Novo `src/components/ChildLayout.tsx` — sidebar enxuta com: Início, Aulas, Materiais, Tarefas.
- Novas rotas em `App.tsx` sob `/meu-painel`:
  - `index` → `ChildDashboard` (resumo: próximas aulas)
  - `aulas` → reusa `StudentLessons` mas filtrando pelos dados do aluno-criança
  - `materiais` → reusa `StudentMaterials`
  - `tarefas` → reusa `StudentHomework`
- Atualizar `useAuth` para reconhecer role `child` e o `Auth.tsx` para redirecionar `child` para `/meu-painel`.
- Atualizar `StudentLayout` (responsável) — sem mudanças de menu; continua com financeiro.
- Adaptar `useStudent` para buscar `students` por `user_id` OU `child_user_id`, retornando uma flag `isChild` para os componentes esconderem qualquer link financeiro caso reaproveitemos hooks.

---

## 4. Edge function `create-child-account`

Nova função (`supabase/functions/create-child-account/index.ts`) que:
- Aceita `{ student_id, username, password }`.
- Autorização: admin (via `has_role`) **ou** responsável dono daquele `students.user_id`.
- Converte username → email (`<username>@aluno.sistema.local`).
- Cria usuário no Auth (`email_confirm: true`) ou retorna erro se já existir.
- Faz upsert em `user_roles` com role `child`.
- Atualiza `students` com `child_user_id`, `child_username`, `child_must_change_password = true`.
- Retorna `{ ok, username }`.

Configurar em `supabase/config.toml`:
```
[functions.create-child-account]
verify_jwt = true
```

---

## 5. UI dos geradores de acesso

### a) Painel do responsável
Em `StudentDashboard.tsx`, adicionar card **"Acesso do Aluno"**:
- Se `student.child_user_id` não existir → form com inputs username + senha + botão "Gerar acesso".
- Se já existir → mostrar o username e botão "Redefinir senha" (chama edge function existente adaptada, ou nova `reset-child-password`).

### b) Painel admin
Em `StudentManageDialog.tsx`, abaixo da seção atual de conta do responsável, adicionar bloco **"Acesso do aluno (filho)"** com os mesmos inputs e botão. Reusa a mesma edge function.

---

## 6. Troca de senha obrigatória

- Reusar `ChangePassword.tsx`: quando role for `child` e `students.child_must_change_password = true`, redirecionar para `/trocar-senha` antes de liberar `/meu-painel`. Após troca, chamar edge function existente `clear-must-change-password` adaptada para também limpar `child_must_change_password` quando o caller for o aluno-criança.

---

## Arquivos afetados (estimativa)

**Novos**
- `supabase/migrations/<timestamp>_child_role.sql`
- `supabase/functions/create-child-account/index.ts`
- `src/lib/username.ts`
- `src/components/ChildLayout.tsx`
- `src/pages/child/ChildDashboard.tsx`

**Editados**
- `src/App.tsx` (rotas)
- `src/pages/Auth.tsx` (tab aluno)
- `src/hooks/useAuth.tsx` (role child)
- `src/hooks/useStudent.ts` (lookup por child_user_id)
- `src/pages/student/StudentDashboard.tsx` (card acesso do aluno)
- `src/components/StudentManageDialog.tsx` (bloco acesso do aluno)
- `src/pages/student/ChangePassword.tsx` (suporte child)
- `supabase/functions/clear-must-change-password/index.ts` (suporte child)
- `supabase/config.toml` (config nova function)

---

## Pontos a confirmar

1. **Nome do papel no enum**: ok usar `child`? (UI sempre mostra "Aluno"). Se preferir, posso usar `kid` ou `alumni`.
2. **Domínio sufixo**: `aluno.sistema.local` serve, ou prefere `@aulasmat.local`?
3. **Reset de senha do aluno**: posso reusar o mesmo padrão (admin define nova senha + força troca no próximo login)?

Se confirmar, implemento tudo em sequência.
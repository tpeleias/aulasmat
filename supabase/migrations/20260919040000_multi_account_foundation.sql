-- Multi-empresa, parte 1 de 4: a fundação.
--
-- Hoje o banco atende um negócio só. Toda política de acesso diz, na prática,
-- "se é admin, pode ver a tabela inteira" - o que basta com uma empresa e vira
-- vazamento com duas. Aqui cada linha passa a carregar a empresa dona, e
-- "admin" passa a significar "admin desta empresa".
--
-- Nada muda para quem já usa: todas as linhas existentes vão para a conta do
-- negócio atual e o app continua consultando exatamente como antes, porque o
-- filtro acontece dentro do banco.
--
-- O que esta parte NÃO faz (fica para as partes 2 e 3, e por isso nenhuma
-- empresa nova deve ser criada antes delas):
--   - as 17 funções SECURITY DEFINER ainda não filtram por empresa
--   - as 6 edge functions usam service_role e ignoram RLS
--   - as páginas públicas (sem login) ainda não sabem de qual empresa são

-- ---------------------------------------------------------------------------
-- 1. A empresa
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Vira o subdomínio na parte 2: <slug>.dominio.com.br
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

INSERT INTO public.accounts (name, slug)
SELECT 'Portal de Aulas', 'portaldeaulas'
WHERE NOT EXISTS (SELECT 1 FROM public.accounts);

-- ---------------------------------------------------------------------------
-- 2. Quem pertence a qual empresa
-- ---------------------------------------------------------------------------

-- Fica nulo de propósito quando o usuário não tem empresa: sem empresa, as
-- políticas abaixo não deixam ver nada (falha fechando, não abrindo).
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);

UPDATE public.user_roles
   SET account_id = (SELECT id FROM public.accounts ORDER BY created_at LIMIT 1)
 WHERE account_id IS NULL;

CREATE INDEX IF NOT EXISTS user_roles_account_id_idx ON public.user_roles(account_id);

CREATE OR REPLACE FUNCTION public.current_account_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT account_id FROM public.user_roles
   WHERE user_id = auth.uid() AND account_id IS NOT NULL
   LIMIT 1
$$;

-- Usada pelas páginas públicas, que não têm login para dizer quem são.
-- Enquanto existe uma empresa só, devolve ela. Com duas ou mais devolve nulo
-- de propósito: é melhor a página pública parar de funcionar e cobrar a parte
-- 2 (endereço por empresa) do que servir os dados da empresa errada.
CREATE OR REPLACE FUNCTION public.public_account_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT a.id FROM public.accounts a
   WHERE a.active
     AND (SELECT count(*) FROM public.accounts WHERE active) = 1
$$;

REVOKE ALL ON FUNCTION public.current_account_id() FROM public;
REVOKE ALL ON FUNCTION public.public_account_id() FROM public;
GRANT EXECUTE ON FUNCTION public.current_account_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_account_id() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Marcar cada tabela com a empresa dona
-- ---------------------------------------------------------------------------

-- O DEFAULT é o que mantém as 97 chamadas do app funcionando sem alteração:
-- ao criar uma aula, o banco carimba a empresa de quem está logado sozinho.
DO $$
DECLARE
  t text;
  first_account uuid := (SELECT id FROM public.accounts ORDER BY created_at LIMIT 1);
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lessons', 'students', 'teachers', 'blocks', 'block_exceptions',
    'wallet_transactions', 'settings', 'homework', 'homework_submissions',
    'student_materials', 'audit_log'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id)', t);
    EXECUTE format(
      'UPDATE public.%I SET account_id = %L WHERE account_id IS NULL', t, first_account);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN account_id SET NOT NULL', t);
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN account_id SET DEFAULT public.current_account_id()', t);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(account_id)', t || '_account_id_idx', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Tirar as travas de "um negócio só"
-- ---------------------------------------------------------------------------

-- settings era literalmente uma linha só (check id = 1). Vira uma por empresa.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.settings'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.settings DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

CREATE SEQUENCE IF NOT EXISTS public.settings_id_seq OWNED BY public.settings.id;
SELECT setval('public.settings_id_seq', GREATEST(coalesce((SELECT max(id) FROM public.settings), 1), 1));
ALTER TABLE public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq');

CREATE UNIQUE INDEX IF NOT EXISTS settings_account_id_key ON public.settings(account_id);

-- Duas empresas podem ter um professor com o mesmo nome.
ALTER TABLE public.teachers DROP CONSTRAINT IF EXISTS teachers_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS teachers_account_name_key ON public.teachers(account_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- 5. Cadastro novo entra na empresa certa
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _account uuid;
BEGIN
  -- Com uma empresa só, todo cadastro é dela. Com duas ou mais fica nulo:
  -- quem cria usuário passa a ser obrigado a dizer a empresa (parte 3), e
  -- até lá o usuário sem empresa simplesmente não enxerga nada.
  SELECT a.id INTO _account FROM public.accounts a
   WHERE a.active
     AND (SELECT count(*) FROM public.accounts WHERE active) = 1;

  INSERT INTO public.user_roles (user_id, role, account_id)
  VALUES (
    NEW.id,
    CASE WHEN (SELECT count(*) FROM public.user_roles
                WHERE role = 'admin' AND account_id IS NOT DISTINCT FROM _account) = 0
      THEN 'admin'::app_role
      ELSE 'student'::app_role
    END,
    _account
  );
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Gatilhos que escrevem de uma tabela para outra
-- ---------------------------------------------------------------------------

-- Estes dois gravam no histórico e na carteira a partir da aula. Sem passar a
-- empresa explicitamente, cairiam no DEFAULT (a empresa de quem está logado),
-- que é nulo quando quem escreve não é uma pessoa logada - o caso do assistente
-- de IA, que usa chave mestra. O resultado seria toda criação de aula falhando.
-- O certo é o registro herdar a empresa da própria aula.

CREATE OR REPLACE FUNCTION public.log_lesson_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _actor uuid;
BEGIN
  BEGIN
    _actor := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    _actor := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(action, lesson_id, teacher, student_name, guardian_name, start_at, duration_minutes, actor_id, account_id)
    VALUES ('created', NEW.id, NEW.teacher, NEW.student_name, NEW.guardian_name, NEW.start_at, NEW.duration_minutes, _actor, NEW.account_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.start_at IS DISTINCT FROM OLD.start_at
       OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
       OR NEW.teacher IS DISTINCT FROM OLD.teacher
       OR NEW.student_name IS DISTINCT FROM OLD.student_name THEN
      INSERT INTO public.audit_log(action, lesson_id, teacher, student_name, guardian_name, start_at, duration_minutes, actor_id, account_id)
      VALUES ('updated', NEW.id, NEW.teacher, NEW.student_name, NEW.guardian_name, NEW.start_at, NEW.duration_minutes, _actor, NEW.account_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(action, lesson_id, teacher, student_name, guardian_name, start_at, duration_minutes, actor_id, account_id)
    VALUES ('cancelled', OLD.id, OLD.teacher, OLD.student_name, OLD.guardian_name, OLD.start_at, OLD.duration_minutes, _actor, OLD.account_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_lesson_wallet()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _amount numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'realizada' THEN
      _amount := -ROUND((NEW.price * NEW.duration_minutes / 60.0)::numeric, 2);
      INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description, account_id)
      VALUES (NULLIF(trim(NEW.guardian_name),''), NEW.student_name, _amount, 'lesson', NEW.id,
              'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') || ' (' || NEW.duration_minutes || ' min)',
              NEW.account_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'realizada' AND OLD.status IS DISTINCT FROM 'realizada' THEN
      _amount := -ROUND((NEW.price * NEW.duration_minutes / 60.0)::numeric, 2);
      INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description, account_id)
      VALUES (NULLIF(trim(NEW.guardian_name),''), NEW.student_name, _amount, 'lesson', NEW.id,
              'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') || ' (' || NEW.duration_minutes || ' min)',
              NEW.account_id);
    ELSIF NEW.status <> 'realizada' AND OLD.status = 'realizada' THEN
      DELETE FROM public.wallet_transactions WHERE lesson_id = NEW.id AND kind = 'lesson';
    ELSIF NEW.status = 'realizada' THEN
      _amount := -ROUND((NEW.price * NEW.duration_minutes / 60.0)::numeric, 2);
      UPDATE public.wallet_transactions
      SET amount = _amount,
          guardian_name = NULLIF(trim(NEW.guardian_name),''),
          student_name = NEW.student_name,
          description = 'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI') || ' (' || NEW.duration_minutes || ' min)'
      WHERE lesson_id = NEW.id AND kind = 'lesson';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. As fechaduras
-- ---------------------------------------------------------------------------

-- Cada usuário enxerga a própria empresa.
DROP POLICY IF EXISTS "users read own account" ON public.accounts;
CREATE POLICY "users read own account" ON public.accounts
  FOR SELECT TO authenticated
  USING (id = public.current_account_id());

-- Admin: tudo, mas só dentro da própria empresa. Este é o conserto central.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lessons', 'students', 'teachers', 'blocks', 'block_exceptions',
    'wallet_transactions', 'settings', 'homework', 'homework_submissions',
    'student_materials', 'audit_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admins manage ' || t, t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated
        USING (has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id())
        WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id())
    $f$, 'admins manage ' || t, t);
  END LOOP;
END $$;

-- As políticas antigas tinham nomes fora do padrão em duas tabelas.
DROP POLICY IF EXISTS "admins manage submissions" ON public.homework_submissions;

-- Aluno e responsável: o vínculo continua sendo nome+responsável, agora
-- obrigatoriamente dentro da mesma empresa. Sem isso, a "Maria Silva" de uma
-- empresa passaria a enxergar a agenda e o financeiro da "Maria Silva" de
-- outra - o mesmo bug que a migration de setembro consertou entre alunos.
DROP POLICY IF EXISTS "students read own lessons" ON public.lessons;
CREATE POLICY "students read own lessons" ON public.lessons
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id()
         AND public.student_account_matches(student_name, guardian_name));

DROP POLICY IF EXISTS "students insert own lessons" ON public.lessons;
CREATE POLICY "students insert own lessons" ON public.lessons
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = public.current_account_id()
    AND public.student_account_matches(student_name, guardian_name)
    AND EXISTS (SELECT 1 FROM public.settings s
                 WHERE s.account_id = public.current_account_id()
                   AND s.allow_student_booking = true)
  );

DROP POLICY IF EXISTS "students read own wallet" ON public.wallet_transactions;
CREATE POLICY "students read own wallet" ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id()
         AND public.student_account_matches(student_name, guardian_name));

DROP POLICY IF EXISTS "students read own student" ON public.students;
CREATE POLICY "students read own student" ON public.students
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "child reads own student" ON public.students;
CREATE POLICY "child reads own student" ON public.students
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND child_user_id = auth.uid());

DROP POLICY IF EXISTS "students read own homework" ON public.homework;
CREATE POLICY "students read own homework" ON public.homework
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = homework.student_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "child reads own homework" ON public.homework;
CREATE POLICY "child reads own homework" ON public.homework
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = homework.student_id AND s.child_user_id = auth.uid()));

DROP POLICY IF EXISTS "students read own materials" ON public.student_materials;
CREATE POLICY "students read own materials" ON public.student_materials
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = student_materials.student_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "child reads own materials" ON public.student_materials;
CREATE POLICY "child reads own materials" ON public.student_materials
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = student_materials.student_id AND s.child_user_id = auth.uid()));

DROP POLICY IF EXISTS "students read own submissions" ON public.homework_submissions;
CREATE POLICY "students read own submissions" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.homework h JOIN public.students s ON s.id = h.student_id
     WHERE h.id = homework_submissions.homework_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "child reads own submissions" ON public.homework_submissions;
CREATE POLICY "child reads own submissions" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.homework h JOIN public.students s ON s.id = h.student_id
     WHERE h.id = homework_submissions.homework_id AND s.child_user_id = auth.uid()));

DROP POLICY IF EXISTS "students insert own submissions" ON public.homework_submissions;
CREATE POLICY "students insert own submissions" ON public.homework_submissions
  FOR INSERT TO authenticated
  WITH CHECK (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.homework h JOIN public.students s ON s.id = h.student_id
     WHERE h.id = homework_submissions.homework_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "child inserts own submissions" ON public.homework_submissions;
CREATE POLICY "child inserts own submissions" ON public.homework_submissions
  FOR INSERT TO authenticated
  WITH CHECK (account_id = public.current_account_id() AND EXISTS (
    SELECT 1 FROM public.homework h JOIN public.students s ON s.id = h.student_id
     WHERE h.id = homework_submissions.homework_id AND s.child_user_id = auth.uid()));

-- Leitura sem login: continua funcionando igual enquanto existe uma empresa,
-- e fecha sozinha quando aparecer a segunda (ver public_account_id acima).
DROP POLICY IF EXISTS "authenticated non-child reads settings" ON public.settings;
CREATE POLICY "authenticated non-child reads settings" ON public.settings
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id()
         AND NOT has_role(auth.uid(), 'child'::app_role));

DROP POLICY IF EXISTS "anon reads settings" ON public.settings;
CREATE POLICY "anon reads settings" ON public.settings
  FOR SELECT TO anon
  USING (account_id = public.public_account_id());

DROP POLICY IF EXISTS "anyone reads teachers" ON public.teachers;
CREATE POLICY "anon reads teachers" ON public.teachers
  FOR SELECT TO anon
  USING (account_id = public.public_account_id());
CREATE POLICY "authenticated reads teachers" ON public.teachers
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id());

DROP POLICY IF EXISTS "users see own roles" ON public.user_roles;
CREATE POLICY "users see own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

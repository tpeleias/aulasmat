-- Papel "professor", separado de "admin" (24/09).
--
-- Até aqui todo login da equipe era admin: via o financeiro de todas as
-- famílias, as configurações e os outros professores. Escola com mais de um
-- professor não compra isso. O papel 'teacher' é um login ligado a UM
-- professor (teachers.user_id) e enxerga:
--
--   - as PRÓPRIAS aulas (marcar, editar, dar como realizada, aprovar pedido);
--   - os alunos da escola (para marcar aula) e poder cadastrar um novo;
--   - os bloqueios da escola (para ver a agenda certa) e mexer nos próprios;
--   - lições, entregas e materiais (leitura, para a evolução do aluno).
--
-- E NÃO enxerga: carteira/pagamentos, descontos, histórico (audit_log),
-- aulas de outros professores, nem administração (logins, professores,
-- configurações - settings ele só lê, pela política que já existia).
--
-- Tudo aditivo: as políticas de admin não mudam. Cada política nova exige
-- has_role(... 'teacher') E a empresa dele - a mesma forma de todas as outras.

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.teachers.user_id IS 'Login do próprio professor (papel teacher). Nulo = professor sem acesso próprio.';

-- O apelido do professor como o front-end grava em lessons.teacher
-- (teacherSlug: sem acento, minúsculo, espaço vira hífen). Mesma conta usada
-- pela trava de plano.
CREATE OR REPLACE FUNCTION public.teacher_slug(_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT regexp_replace(
           translate(lower(btrim(coalesce(_name, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
           '\s+', '-', 'g')
$$;

-- O apelido do professor logado - nulo para quem não é professor. É o que
-- as políticas abaixo comparam com lessons.teacher / blocks.teacher.
CREATE OR REPLACE FUNCTION public.current_teacher_slug()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.teacher_slug(t.name)
    FROM public.teachers t
   WHERE t.user_id = auth.uid()
     AND t.account_id = public.current_account_id()
     AND public.has_role(auth.uid(), 'teacher'::app_role)
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_teacher_slug() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_teacher_slug() TO authenticated;

-- ---------------------------------------------------------------------------
-- Aulas: só as próprias
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "teachers read own lessons" ON public.lessons;
CREATE POLICY "teachers read own lessons" ON public.lessons
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'teacher'::app_role)
         AND account_id = public.current_account_id()
         AND public.teacher_slug(teacher) = public.current_teacher_slug());

DROP POLICY IF EXISTS "teachers insert own lessons" ON public.lessons;
CREATE POLICY "teachers insert own lessons" ON public.lessons
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'teacher'::app_role)
              AND account_id = public.current_account_id()
              AND public.teacher_slug(teacher) = public.current_teacher_slug());

-- USING e WITH CHECK iguais: não dá para pegar uma aula própria e passá-la
-- para outro professor, nem editar a de outro.
DROP POLICY IF EXISTS "teachers update own lessons" ON public.lessons;
CREATE POLICY "teachers update own lessons" ON public.lessons
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'teacher'::app_role)
         AND account_id = public.current_account_id()
         AND public.teacher_slug(teacher) = public.current_teacher_slug())
  WITH CHECK (has_role(auth.uid(), 'teacher'::app_role)
              AND account_id = public.current_account_id()
              AND public.teacher_slug(teacher) = public.current_teacher_slug());

-- Sem DELETE: o professor desmarca (cancelada), não apaga histórico.

-- O preço da aula é dinheiro da escola: a cobrança da família sai dele
-- (sync_lesson_wallet). O professor não o escolhe - na aula nova vale o da
-- escola, e na edição fica o que estava. payment_status NÃO é travado aqui:
-- quem o atualiza é recompute_payment_status, que roda com o auth.uid() de
-- quem disparou a cobrança - inclusive o professor que marcou "realizada".
CREATE OR REPLACE FUNCTION public.enforce_teacher_lesson_price()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'teacher'::app_role)
     OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.price := public.account_lesson_price(NEW.account_id);
  ELSE
    NEW.price := OLD.price;
  END IF;
  RETURN NEW;
END;
$$;

-- "zz" no nome: gatilhos BEFORE rodam em ordem alfabética, e este precisa vir
-- depois de lessons_fill_price.
DROP TRIGGER IF EXISTS lessons_zz_teacher_price ON public.lessons;
CREATE TRIGGER lessons_zz_teacher_price
  BEFORE INSERT OR UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.enforce_teacher_lesson_price();

-- ---------------------------------------------------------------------------
-- Alunos: ler todos da escola e cadastrar novo (a aula precisa de aluno)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "teachers read students" ON public.students;
CREATE POLICY "teachers read students" ON public.students
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'teacher'::app_role) AND account_id = public.current_account_id());

DROP POLICY IF EXISTS "teachers insert students" ON public.students;
CREATE POLICY "teachers insert students" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'teacher'::app_role) AND account_id = public.current_account_id());

-- ---------------------------------------------------------------------------
-- Bloqueios: ver todos (a agenda precisa), mexer só nos próprios
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "teachers read blocks" ON public.blocks;
CREATE POLICY "teachers read blocks" ON public.blocks
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'teacher'::app_role) AND account_id = public.current_account_id());

DROP POLICY IF EXISTS "teachers manage own blocks" ON public.blocks;
CREATE POLICY "teachers manage own blocks" ON public.blocks
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'teacher'::app_role)
         AND account_id = public.current_account_id()
         AND public.teacher_slug(teacher) = public.current_teacher_slug())
  WITH CHECK (has_role(auth.uid(), 'teacher'::app_role)
              AND account_id = public.current_account_id()
              AND public.teacher_slug(teacher) = public.current_teacher_slug());

DROP POLICY IF EXISTS "teachers read block exceptions" ON public.block_exceptions;
CREATE POLICY "teachers read block exceptions" ON public.block_exceptions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'teacher'::app_role) AND account_id = public.current_account_id());

-- Liberar um dia de um bloqueio recorrente PRÓPRIO.
DROP POLICY IF EXISTS "teachers manage own block exceptions" ON public.block_exceptions;
CREATE POLICY "teachers manage own block exceptions" ON public.block_exceptions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'teacher'::app_role)
         AND account_id = public.current_account_id()
         AND EXISTS (SELECT 1 FROM public.blocks b
                      WHERE b.id = block_id AND b.account_id = public.current_account_id()
                        AND public.teacher_slug(b.teacher) = public.current_teacher_slug()))
  WITH CHECK (has_role(auth.uid(), 'teacher'::app_role)
              AND account_id = public.current_account_id()
              AND EXISTS (SELECT 1 FROM public.blocks b
                           WHERE b.id = block_id AND b.account_id = public.current_account_id()
                             AND public.teacher_slug(b.teacher) = public.current_teacher_slug()));

-- ---------------------------------------------------------------------------
-- Lições, entregas e materiais: leitura (evolução do aluno)
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['homework', 'homework_submissions', 'student_materials'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'teachers read ' || t, t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (has_role(auth.uid(), 'teacher'::app_role) AND account_id = public.current_account_id())
    $f$, 'teachers read ' || t, t);
  END LOOP;
END $$;

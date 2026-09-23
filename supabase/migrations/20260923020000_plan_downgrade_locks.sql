-- Rebaixar de verdade: trava tudo o que passa do limite e o professor escolhe
-- o que liberar (decisão do Thiago em 23/09, docs/proximos-passos.md).
--
-- Até aqui o rebaixamento só travava o PRÓXIMO cadastro (migration
-- 20260921160000): quem tinha 15 alunos seguia com os 15 funcionando.
--
-- Agora, ao cair para o Essencial:
--   - se os alunos passam do limite, TODOS ficam travados, e o professor
--     libera até o limite, um a um. Não existe escolha automática de quem
--     fica (nem "os mais antigos") - essa é a decisão.
--   - o mesmo com professores ativos.
--   - abaixo do limite, nada trava: travar para o professor destravar em
--     seguida seria só atrito.
--
-- "Travado" NÃO apaga nem esconde nada: aulas, histórico, carteira e aulas já
-- marcadas continuam. O que trava é marcar aula NOVA (inclusive o pedido da
-- família no portal e a aprovação de um pedido antigo). E isso é regra do
-- banco, pelo mesmo motivo de sempre: a tela não é a trava.
--
-- Voltar para o Pro destrava tudo sozinho.
--
-- Bloqueio recorrente e desconto fixo que já existiam NÃO são pausados aqui,
-- de propósito - ver docs/proximos-passos.md: pausar o bloqueio faz a vitrine
-- oferecer horário que o professor não tem, e pausar o desconto aumenta a
-- conta da família sem ninguém avisar. Fica para o Thiago decidir.

-- ---------------------------------------------------------------------------
-- 1. A marca
-- ---------------------------------------------------------------------------

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS plan_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS plan_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.students.plan_locked IS
  'Travado pelo rebaixamento de plano. Não conta no limite e não recebe aula nova; nada dele é apagado.';
COMMENT ON COLUMN public.teachers.plan_locked IS
  'Desativado pelo rebaixamento de plano (e não pelo professor). Voltar ao Pro reativa só estes.';

-- ---------------------------------------------------------------------------
-- 2. Os limites passam a contar só quem não está travado
-- ---------------------------------------------------------------------------

-- Igual à versão de 20260921160000, salvo o ramo de alunos: aluno travado não
-- ocupa vaga (professor travado já não ocupava, porque fica inativo).
CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _limit int;
  _atual int;
BEGIN
  _limit := public.account_limit(TG_ARGV[0], NEW.account_id);
  IF _limit IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_ARGV[0] = 'teachers' THEN
    IF NEW.active IS NOT TRUE THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO _atual FROM public.teachers
     WHERE account_id = NEW.account_id AND active;
    IF _atual >= _limit THEN
      RAISE EXCEPTION 'O plano Cronys Essencial permite % professor(es) ativo(s). Para ter mais, mude para o Cronys Pro.', _limit
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.plan_locked THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO _atual FROM public.students
     WHERE account_id = NEW.account_id AND NOT plan_locked;
    IF _atual >= _limit THEN
      RAISE EXCEPTION 'O plano Cronys Essencial permite % alunos liberados. Para cadastrar mais, mude para o Cronys Pro.', _limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Liberar um aluno travado é o mesmo que cadastrar um, para efeito de limite.
-- É este gatilho que faz o "Liberar" da tela ser seguro: o admin tem UPDATE em
-- students pela própria política, então sem ele bastaria um UPDATE direto na
-- API para liberar os 15.
CREATE OR REPLACE FUNCTION public.enforce_student_unlock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _limit int := public.account_limit('students', NEW.account_id);
  _atual int;
BEGIN
  IF _limit IS NULL OR NEW.plan_locked OR NOT OLD.plan_locked THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _atual FROM public.students
   WHERE account_id = NEW.account_id AND NOT plan_locked AND id <> NEW.id;
  IF _atual >= _limit THEN
    RAISE EXCEPTION 'O plano Cronys Essencial permite % alunos liberados. Trave outro antes, ou mude para o Cronys Pro.', _limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_plan_unlock ON public.students;
CREATE TRIGGER students_plan_unlock
  BEFORE UPDATE OF plan_locked ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_unlock();

-- Professor: o "liberar" é o próprio interruptor de ativo, que já passava pelo
-- limite. A única novidade é limpar a marca ao reativar, para que um próximo
-- "voltar ao Pro" não reative um professor que o dono desligou por conta
-- própria depois.
CREATE OR REPLACE FUNCTION public.enforce_teacher_reactivation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _limit int := public.account_limit('teachers', NEW.account_id);
  _atual int;
BEGIN
  IF NEW.active IS NOT TRUE OR OLD.active IS TRUE THEN
    RETURN NEW;
  END IF;
  IF _limit IS NOT NULL THEN
    SELECT count(*) INTO _atual FROM public.teachers
     WHERE account_id = NEW.account_id AND active AND id <> NEW.id;
    IF _atual >= _limit THEN
      RAISE EXCEPTION 'O plano Cronys Essencial permite % professor(es) ativo(s). Desative outro antes, ou mude para o Cronys Pro.', _limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.plan_locked := false;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Travar ao rebaixar, destravar ao voltar
-- ---------------------------------------------------------------------------

-- Só a plataforma chama (via platform_set_account_plan). NÃO pode ficar
-- executável por `authenticated`: é SECURITY DEFINER e recebe a empresa por
-- parâmetro, então um admin qualquer travaria os alunos de outra empresa.
CREATE OR REPLACE FUNCTION public.lock_over_plan_limits(_account uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _max_s int := public.account_limit('students', _account);
  _max_t int := public.account_limit('teachers', _account);
  _alunos int := 0;
  _profs int := 0;
BEGIN
  IF _max_s IS NOT NULL
     AND (SELECT count(*) FROM public.students WHERE account_id = _account AND NOT plan_locked) > _max_s THEN
    UPDATE public.students SET plan_locked = true
     WHERE account_id = _account AND NOT plan_locked;
    GET DIAGNOSTICS _alunos = ROW_COUNT;
  END IF;

  IF _max_t IS NOT NULL
     AND (SELECT count(*) FROM public.teachers WHERE account_id = _account AND active) > _max_t THEN
    UPDATE public.teachers SET plan_locked = true, active = false
     WHERE account_id = _account AND active;
    GET DIAGNOSTICS _profs = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('alunos_travados', _alunos, 'professores_travados', _profs);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_plan_locks(_account uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _alunos int;
  _profs int;
BEGIN
  UPDATE public.students SET plan_locked = false
   WHERE account_id = _account AND plan_locked;
  GET DIAGNOSTICS _alunos = ROW_COUNT;
  -- O gatilho de reativação confere o limite do plano ATUAL; como isto só
  -- roda depois de a empresa ter virado Pro, o limite é nulo e passa.
  UPDATE public.teachers SET active = true
   WHERE account_id = _account AND plan_locked;
  GET DIAGNOSTICS _profs = ROW_COUNT;
  RETURN jsonb_build_object('alunos_liberados', _alunos, 'professores_liberados', _profs);
END;
$$;

REVOKE ALL ON FUNCTION public.lock_over_plan_limits(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_plan_locks(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_over_plan_limits(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_plan_locks(uuid) TO service_role;

-- Igual à versão de 20260921160000, mais o travar/destravar quando o PLANO é
-- informado. Mexer só na exceção do assistente não toca em aluno nenhum.
-- Informar 'essencial' de novo reaplica a trava: é o jeito de o gestor
-- enquadrar uma empresa que já estava acima do limite antes desta migration.
CREATE OR REPLACE FUNCTION public.platform_set_account_plan(
  _account uuid,
  _plan text DEFAULT NULL,
  _assistant_override boolean DEFAULT NULL,
  _clear_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _row public.accounts;
  _travas jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _plan IS NOT NULL AND _plan NOT IN ('essencial', 'pro') THEN
    RAISE EXCEPTION 'plano inválido: %', _plan;
  END IF;

  UPDATE public.accounts
     SET plan = coalesce(_plan, plan),
         assistant_override = CASE WHEN _clear_override THEN NULL
                                   ELSE coalesce(_assistant_override, assistant_override) END
   WHERE id = _account
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  IF _plan IS NOT NULL THEN
    _travas := CASE WHEN _row.plan = 'pro'
                    THEN public.release_plan_locks(_row.id)
                    ELSE public.lock_over_plan_limits(_row.id) END;
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'plan', _row.plan,
                            'assistant_override', _row.assistant_override,
                            'assistant', public.account_can('assistant', _row.id))
         || _travas;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_set_account_plan(uuid, text, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_account_plan(uuid, text, boolean, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Aluno ou professor travado não recebe aula nova
-- ---------------------------------------------------------------------------

-- Vale para INSERT (admin, portal da família, assistente) e para o UPDATE que
-- faz uma aula passar a existir para alguém: aprovar pedido, ou trocar o aluno
-- ou o professor de uma aula marcada. Cancelar, marcar realizada, mudar o
-- horário: nada disso é barrado - não dá para uma trava de plano impedir o
-- professor de desmarcar uma aula.
--
-- A aula liga ao aluno por nome + responsável e ao professor pelo apelido
-- (teacherSlug no front-end: sem acento, minúsculo, espaço vira hífen). É o
-- mesmo casamento por texto que o resto do banco já usa.
CREATE OR REPLACE FUNCTION public.enforce_lesson_plan_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status NOT IN ('agendada', 'solicitada') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.student_name IS NOT DISTINCT FROM NEW.student_name
     AND OLD.guardian_name IS NOT DISTINCT FROM NEW.guardian_name
     AND OLD.teacher IS NOT DISTINCT FROM NEW.teacher THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students s
     WHERE s.account_id = NEW.account_id
       AND s.plan_locked
       AND lower(btrim(s.student_name)) = lower(btrim(NEW.student_name))
       AND lower(btrim(coalesce(s.guardian_name, ''))) = lower(btrim(coalesce(NEW.guardian_name, '')))
  ) THEN
    -- A família também pode cair aqui (pedido pelo portal), então a mensagem
    -- não fala de plano: isso é assunto entre o professor e a Cronys.
    RAISE EXCEPTION 'Não é possível marcar aula para este aluno agora: o cadastro está pausado. Fale com o professor.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.account_id = NEW.account_id
       AND t.plan_locked
       AND regexp_replace(
             translate(lower(btrim(t.name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
             '\s+', '-', 'g')
         = lower(btrim(NEW.teacher))
  ) THEN
    RAISE EXCEPTION 'Não é possível marcar aula com este professor agora: o cadastro está pausado.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lessons_plan_lock ON public.lessons;
CREATE TRIGGER lessons_plan_lock
  BEFORE INSERT OR UPDATE OF status, student_name, guardian_name, teacher ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.enforce_lesson_plan_lock();

-- O painel do gestor passa a mostrar quantos estão travados.
DROP FUNCTION IF EXISTS public.platform_accounts_overview();
CREATE OR REPLACE FUNCTION public.platform_accounts_overview()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  active boolean,
  is_public_default boolean,
  created_at timestamptz,
  plan text,
  assistant boolean,
  assistant_override boolean,
  responsaveis bigint,
  alunos bigint,
  professores bigint,
  aulas bigint,
  logins bigint,
  ultima_aula timestamptz,
  alunos_travados bigint,
  professores_travados bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT a.id, a.name, a.slug, a.active, a.is_public_default, a.created_at,
         a.plan,
         public.account_can('assistant', a.id),
         a.assistant_override,
         (SELECT count(DISTINCT lower(btrim(s.guardian_name))) FROM public.students s
           WHERE s.account_id = a.id AND nullif(btrim(coalesce(s.guardian_name, '')), '') IS NOT NULL),
         (SELECT count(*) FROM public.students s WHERE s.account_id = a.id),
         (SELECT count(*) FROM public.teachers t WHERE t.account_id = a.id AND t.active),
         (SELECT count(*) FROM public.lessons l WHERE l.account_id = a.id),
         (SELECT count(*) FROM public.user_roles r WHERE r.account_id = a.id),
         (SELECT max(l.start_at) FROM public.lessons l WHERE l.account_id = a.id),
         (SELECT count(*) FROM public.students s WHERE s.account_id = a.id AND s.plan_locked),
         (SELECT count(*) FROM public.teachers t WHERE t.account_id = a.id AND t.plan_locked)
    FROM public.accounts a
   ORDER BY a.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_accounts_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_accounts_overview() TO authenticated, service_role;

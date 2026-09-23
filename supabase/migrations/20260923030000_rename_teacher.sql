-- Renomear professor (pedido do Thiago, 23/09).
--
-- O nome não é só rótulo: aulas e bloqueios guardam o professor pelo APELIDO
-- do nome (teacherSlug no front-end: sem acento, minúsculo, espaço vira
-- hífen - "Ana Júlia" vira "ana-julia"). Trocar só teachers.name deixaria
-- todas as aulas dele apontando para um professor que não existe mais: elas
-- sumiriam do filtro da agenda, da vitrine e da cor dele.
--
-- Por isso é uma função, e tudo muda junto ou nada muda.
--
-- Os dois apelidos vêm do front-end, e não são recalculados aqui, de
-- propósito: foi o front-end que gravou lessons.teacher com teacherSlug, e o
-- Postgres não tem unaccent instalado para reproduzir o NFD dele com
-- garantia. Mandar o apelido pronto não abre nada: a função é SECURITY
-- INVOKER, então só alcança o que a RLS já deixa o admin mexer - as linhas da
-- própria empresa, que ele já podia alterar uma a uma pela API.
--
-- audit_log NÃO é reescrito: é histórico, e histórico diz o nome da época.

CREATE OR REPLACE FUNCTION public.rename_teacher(
  _teacher uuid,
  _new_name text,
  _old_slug text,
  _new_slug text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _name text := btrim(coalesce(_new_name, ''));
  _old text := lower(btrim(coalesce(_old_slug, '')));
  _new text := lower(btrim(coalesce(_new_slug, '')));
  _aulas int := 0;
  _bloqueios int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') OR _acct IS NULL THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _name = '' OR _new = '' THEN
    RAISE EXCEPTION 'O nome do professor não pode ficar vazio.' USING ERRCODE = 'check_violation';
  END IF;
  -- 'both' é o valor de bloqueio que vale para todos os professores.
  IF _new = 'both' THEN
    RAISE EXCEPTION 'Esse nome é reservado. Escolha outro.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.teachers SET name = _name
   WHERE id = _teacher AND account_id = _acct;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'professor não encontrado';
  END IF;

  IF _old <> '' AND _old <> _new THEN
    -- Renomear não cria aula para ninguém, então a trava de plano
    -- (enforce_lesson_plan_lock) não tem o que barrar aqui - e barraria:
    -- para ela, "o professor da aula mudou". O aviso vale só até o fim desta
    -- transação (is_local) e é desligado logo abaixo; set_config não é
    -- alcançável pela API.
    PERFORM set_config('cronys.renomeando_professor', 'on', true);
    UPDATE public.lessons SET teacher = _new
     WHERE account_id = _acct AND lower(teacher) = _old;
    GET DIAGNOSTICS _aulas = ROW_COUNT;
    UPDATE public.blocks SET teacher = _new
     WHERE account_id = _acct AND lower(teacher) = _old;
    GET DIAGNOSTICS _bloqueios = ROW_COUNT;
    PERFORM set_config('cronys.renomeando_professor', 'off', true);
  END IF;

  RETURN jsonb_build_object('aulas', _aulas, 'bloqueios', _bloqueios);
END;
$$;

REVOKE ALL ON FUNCTION public.rename_teacher(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rename_teacher(uuid, text, text, text) TO authenticated;

-- A trava de plano ganha a exceção acima. Fora a primeira checagem, igual à
-- versão de 20260923020000.
CREATE OR REPLACE FUNCTION public.enforce_lesson_plan_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('cronys.renomeando_professor', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
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

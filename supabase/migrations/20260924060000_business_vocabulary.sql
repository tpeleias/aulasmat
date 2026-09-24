-- Tipo de negócio e vocabulário por empresa (24/09).
--
-- O app nasceu para aula particular, mas o que ele faz - agenda, cadastro de
-- quem é atendido, cobrança, portal - serve para clínica, salão, oficina.
-- O que muda de um ramo para outro são as PALAVRAS: professor/médico,
-- aula/consulta, aluno/paciente. Então a empresa diz o ramo, e a tela troca as
-- palavras.
--
-- As tabelas continuam com os nomes de sempre (lessons, teachers, students):
-- o nome interno não aparece para ninguém, e renomear mexeria em 20 funções,
-- nas políticas e em todas as consultas do app sem mudar nada que se veja.
--
-- O que fica aqui:
--   accounts.business_model  o ramo. Nulo = a empresa ainda não escolheu, e o
--                            dono vê a tela de boas-vindas no primeiro acesso.
--   accounts.vocabulary      palavras editadas à mão pelo dono. Nulo = usa as
--                            do ramo, que moram no front-end
--                            (src/lib/vocabulary.ts) - o banco não precisa
--                            delas para decidir nada.
--
-- Plano (decisão do Thiago, 24/09): as palavras do ramo, e editá-las, são do
-- Pro. No Essencial o app fala genérico (Profissional, Atendimento, Cliente),
-- mesmo que a empresa tenha escolhido um ramo. A escolha fica guardada: a
-- empresa nova nasce no teste do Pro e já vê as palavras dela; se o teste
-- acaba sem contratar, a tela volta ao genérico, e voltando ao Pro volta
-- tudo. Nada é apagado - o mesmo espírito da trava de rebaixamento.

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS business_model text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS vocabulary jsonb;

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_business_model_check;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_business_model_check
  CHECK (business_model IS NULL OR business_model IN
    ('aulas', 'saude', 'psicologia', 'beleza', 'pet', 'esportes', 'oficina', 'outro'));

COMMENT ON COLUMN public.accounts.business_model IS
  'Ramo da empresa; define as palavras da tela. Nulo = ainda não escolheu (tela de boas-vindas).';
COMMENT ON COLUMN public.accounts.vocabulary IS
  'Palavras editadas pelo dono (Pro), por cima das do ramo. Nulo = as do ramo.';

-- Quem já existe era escola de aula particular: nada muda para essas contas.
-- Só as criadas daqui para frente passam pela escolha.
UPDATE public.accounts SET business_model = 'aulas' WHERE business_model IS NULL;

-- ---------------------------------------------------------------------------
-- Plano: as palavras do ramo são do Pro
-- ---------------------------------------------------------------------------

-- Igual à versão de 20260921160000, com vocabulary.
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _plan
    WHEN 'pro' THEN jsonb_build_object(
      'nome',              'Cronys Pro',
      'max_teachers',      null,
      'max_students',      null,
      'assistant',         true,
      'packages',          true,
      'recurring_blocks',  true,
      'vocabulary',        true
    )
    ELSE jsonb_build_object(
      'nome',              'Cronys Essencial',
      'max_teachers',      1,
      'max_students',      5,
      'assistant',         false,
      'packages',          false,
      -- Bloqueio pontual continua valendo no Essencial: dizer "dia 14 não dou
      -- aula" é função básica de agenda, e sem ela a vitrine pública ofereceria
      -- horário que o professor não tem. O que se paga é não repetir o
      -- trabalho toda semana.
      'recurring_blocks',  false,
      -- Palavras do ramo e as editadas: no Essencial, tudo genérico.
      'vocabulary',        false
    )
  END
$$;
REVOKE ALL ON FUNCTION public.plan_features(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.plan_features(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ler
-- ---------------------------------------------------------------------------

-- Serve ao dono, ao professor, à família e à página pública (sem login):
-- effective_account_id() é a empresa de quem está logado, ou a dona do
-- endereço. Palavras não são segredo - são o que a própria tela mostra.
--   business_model  o ramo escolhido (nulo = tela de boas-vindas)
--   active          se o plano deixa usar as palavras do ramo; falso = genérico
--   custom          as palavras editadas que valem agora
CREATE OR REPLACE FUNCTION public.my_vocabulary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
           'business_model', a.business_model,
           'active', public.account_can('vocabulary', a.id),
           'custom', CASE WHEN public.account_can('vocabulary', a.id)
                          THEN a.vocabulary END,
           'custom_saved', a.vocabulary IS NOT NULL)
    FROM public.accounts a
   WHERE a.id = public.effective_account_id()
$$;
REVOKE ALL ON FUNCTION public.my_vocabulary() FROM public;
GRANT EXECUTE ON FUNCTION public.my_vocabulary() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Escrever (só o admin da própria empresa)
-- ---------------------------------------------------------------------------

-- Trocar de ramo começa do zero: as palavras editadas eram do ramo anterior.
-- Vale em qualquer plano: é a tela de boas-vindas, e no Essencial a escolha
-- fica guardada para quando a empresa for Pro.
CREATE OR REPLACE FUNCTION public.set_business_model(_model text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') OR _acct IS NULL THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _model IS NULL OR _model NOT IN
     ('aulas', 'saude', 'psicologia', 'beleza', 'pet', 'esportes', 'oficina', 'outro') THEN
    RAISE EXCEPTION 'Tipo de negócio inválido.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.accounts SET business_model = _model, vocabulary = NULL
   WHERE id = _acct;
  RETURN public.my_vocabulary();
END;
$$;
REVOKE ALL ON FUNCTION public.set_business_model(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_business_model(text) TO authenticated;

-- _vocab nulo volta às palavras do ramo (livre em qualquer plano: quem saiu
-- do Pro precisa conseguir limpar). Senão, um objeto só com as chaves
-- conhecidas, cada uma {s, p, g}: singular, plural e gênero ('m' ou 'f', que
-- decide "Novo atendimento" x "Nova aula").
CREATE OR REPLACE FUNCTION public.set_custom_vocabulary(_vocab jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _key text;
  _term jsonb;
  _s text;
  _p text;
  _g text;
  _clean jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') OR _acct IS NULL THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF _vocab IS NULL OR _vocab = 'null'::jsonb THEN
    UPDATE public.accounts SET vocabulary = NULL WHERE id = _acct;
    RETURN public.my_vocabulary();
  END IF;

  IF NOT public.account_can('vocabulary', _acct) THEN
    RAISE EXCEPTION 'Os nomes do seu tipo de negócio são do Cronys Pro.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(_vocab) <> 'object' THEN
    RAISE EXCEPTION 'Vocabulário inválido.' USING ERRCODE = 'check_violation';
  END IF;

  FOR _key, _term IN SELECT * FROM jsonb_each(_vocab) LOOP
    IF _key NOT IN ('business', 'staff', 'appointment', 'client', 'guardian', 'topic') THEN
      RAISE EXCEPTION 'Termo desconhecido: %', _key USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(_term) <> 'object' THEN
      RAISE EXCEPTION 'Termo inválido: %', _key USING ERRCODE = 'check_violation';
    END IF;
    _s := btrim(coalesce(_term ->> 's', ''));
    _p := btrim(coalesce(_term ->> 'p', ''));
    _g := coalesce(_term ->> 'g', '');
    IF _s = '' OR _p = '' OR length(_s) > 40 OR length(_p) > 40 THEN
      RAISE EXCEPTION 'Cada nome precisa de singular e plural, com até 40 letras.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF _g NOT IN ('m', 'f') THEN
      RAISE EXCEPTION 'Gênero inválido: %', _key USING ERRCODE = 'check_violation';
    END IF;
    _clean := _clean || jsonb_build_object(_key, jsonb_build_object('s', _s, 'p', _p, 'g', _g));
  END LOOP;

  UPDATE public.accounts SET vocabulary = nullif(_clean, '{}'::jsonb) WHERE id = _acct;
  RETURN public.my_vocabulary();
END;
$$;
REVOKE ALL ON FUNCTION public.set_custom_vocabulary(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_custom_vocabulary(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Mensagens de erro sem "aula/professor/aluno"
-- ---------------------------------------------------------------------------
--
-- O banco não sabe as palavras de cada ramo (elas moram no front-end), então
-- as mensagens ficam neutras e levam uma chave em HINT. A tela troca a chave
-- pela frase com as palavras da empresa (src/lib/dbErrors.ts); quem não
-- conhece a chave (o assistente, um app antigo) mostra a mensagem neutra.
-- Fora as mensagens, cada função é igual à última versão dela.

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
    RAISE EXCEPTION 'O plano Cronys Essencial permite % clientes liberados. Trave outro antes, ou mude para o Cronys Pro.', _limit
      USING ERRCODE = 'check_violation', HINT = 'limite_clientes_liberar:' || _limit;
  END IF;
  RETURN NEW;
END;
$$;

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
      RAISE EXCEPTION 'O plano Cronys Essencial permite % profissional(is) ativo(s). Para ter mais, mude para o Cronys Pro.', _limit
        USING ERRCODE = 'check_violation', HINT = 'limite_profissionais_cadastrar:' || _limit;
    END IF;
  ELSE
    IF NEW.plan_locked THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO _atual FROM public.students
     WHERE account_id = NEW.account_id AND NOT plan_locked;
    IF _atual >= _limit THEN
      RAISE EXCEPTION 'O plano Cronys Essencial permite % clientes liberados. Para cadastrar mais, mude para o Cronys Pro.', _limit
        USING ERRCODE = 'check_violation', HINT = 'limite_clientes_cadastrar:' || _limit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

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
      RAISE EXCEPTION 'O plano Cronys Essencial permite % profissional(is) ativo(s). Desative outro antes, ou mude para o Cronys Pro.', _limit
        USING ERRCODE = 'check_violation', HINT = 'limite_profissionais_reativar:' || _limit;
    END IF;
  END IF;
  NEW.plan_locked := false;
  RETURN NEW;
END;
$$;

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
    RAISE EXCEPTION 'Não é possível agendar para este cadastro agora: ele está pausado.'
      USING ERRCODE = 'check_violation', HINT = 'cliente_pausado';
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
    RAISE EXCEPTION 'Não é possível agendar com este profissional agora: o cadastro está pausado.'
      USING ERRCODE = 'check_violation', HINT = 'profissional_pausado';
  END IF;

  RETURN NEW;
END;
$$;

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
    RAISE EXCEPTION 'O nome não pode ficar vazio.' USING ERRCODE = 'check_violation';
  END IF;
  -- 'both' é o valor de bloqueio que vale para todos os professores.
  IF _new = 'both' THEN
    RAISE EXCEPTION 'Esse nome é reservado. Escolha outro.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.teachers SET name = _name
   WHERE id = _teacher AND account_id = _acct;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cadastro não encontrado';
  END IF;

  IF _old <> '' AND _old <> _new THEN
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

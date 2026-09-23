-- Escola se cadastrando sozinha, com teste grátis do Pro (24/09).
--
-- Até aqui toda empresa nascia pela mão do gestor, no painel. Quem baixava o
-- app na loja e não era família não tinha o que fazer - e, pior, todo
-- cadastro novo caía dentro da empresa do endereço público (a de produção,
-- do Thiago) como "aluno sem vínculo". Não via nada, mas a empresa real ia
-- acumulando estranhos.
--
-- Agora o cadastro diz o que é, pelos metadados do signUp:
--   signup_kind = 'school'  → cria a escola, as configurações, o professor e
--                             o login como admin, com 14 dias de Pro;
--   school_code = '<slug>'  → família de uma escola específica (o código é o
--                             apelido da escola, que o professor repassa);
--   nada                    → o comportamento de antes, para a vitrine web
--                             da empresa do endereço público.
--
-- Metadados vêm do cliente, então nada aqui confia neles além do que eles
-- podem conceder: 'school' só cria uma escola NOVA e vazia, onde a pessoa é
-- admin - não dá acesso a nenhuma existente. O código de escola só dá o papel
-- de família (student), que não enxerga nada até o professor vincular o
-- cadastro - e nunca admin, nem numa escola que ainda não tenha nenhum.

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
COMMENT ON COLUMN public.accounts.trial_ends_at IS
  'Fim do teste grátis do Pro. Nulo = não está em teste (plano contratado ou definido pelo gestor).';

-- Apelido único a partir do nome. Vira o "código da escola" e, no futuro, o
-- subdomínio - por isso só letras, números e hífen.
CREATE OR REPLACE FUNCTION public.unique_account_slug(_name text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _base text;
  _cand text;
  _i int := 0;
BEGIN
  _base := btrim(regexp_replace(
             translate(lower(btrim(coalesce(_name, ''))), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
             '[^a-z0-9]+', '-', 'g'), '-');
  _base := left(coalesce(nullif(_base, ''), 'escola'), 30);
  _cand := _base;
  WHILE EXISTS (SELECT 1 FROM public.accounts WHERE slug = _cand) LOOP
    _i := _i + 1;
    _cand := left(_base, 25) || '-' || _i;
  END LOOP;
  RETURN _cand;
END;
$$;

REVOKE ALL ON FUNCTION public.unique_account_slug(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _meta jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  _code text := lower(btrim(coalesce(_meta ->> 'school_code', '')));
  _account uuid;
  _school text;
  _teacher text;
BEGIN
  IF _meta ->> 'signup_kind' = 'school' THEN
    _school := left(nullif(btrim(coalesce(_meta ->> 'school_name', '')), ''), 120);
    _teacher := lower(left(nullif(btrim(coalesce(_meta ->> 'teacher_name', '')), ''), 60));
    IF _school IS NULL OR _teacher IS NULL THEN
      RAISE EXCEPTION 'Informe o nome da escola e o seu nome.';
    END IF;

    INSERT INTO public.accounts (name, slug, plan, trial_ends_at)
    VALUES (_school, public.unique_account_slug(_school), 'pro', now() + interval '14 days')
    RETURNING id INTO _account;
    -- Sem a linha de settings a primeira tela do dono parece quebrada (mesmo
    -- motivo de platform_create_account).
    INSERT INTO public.settings (account_id, contact_email) VALUES (_account, NEW.email);
    INSERT INTO public.teachers (account_id, name, active) VALUES (_account, _teacher, true);
    INSERT INTO public.user_roles (user_id, role, account_id) VALUES (NEW.id, 'admin', _account);
    RETURN NEW;
  END IF;

  IF _code <> '' THEN
    -- Código errado deixa a empresa nula: o cadastro existe, mas não enxerga
    -- nada, e o professor resolve vinculando. Melhor que cair na empresa
    -- errada.
    SELECT a.id INTO _account FROM public.accounts a WHERE a.slug = _code AND a.active;
    INSERT INTO public.user_roles (user_id, role, account_id) VALUES (NEW.id, 'student', _account);
    RETURN NEW;
  END IF;

  -- Sem metadados: igual à versão de 20260919070000 (vitrine web da empresa
  -- do endereço público, e logins criados pelas edge functions, que em
  -- seguida realocam o papel).
  _account := public.public_account_id();
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
-- Fim do teste: vira Essencial de verdade (com a trava de rebaixamento)
-- ---------------------------------------------------------------------------

-- Roda todo dia pelo pg_cron. Passar para o Essencial aplica a mesma trava
-- de quando o gestor rebaixa: acima do limite, tudo daquele tipo fica pausado
-- e a escola escolhe o que liberar. Nada é apagado.
CREATE OR REPLACE FUNCTION public.expire_trials()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _n int := 0;
BEGIN
  FOR _id IN
    SELECT id FROM public.accounts
     WHERE plan = 'pro' AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
  LOOP
    UPDATE public.accounts SET plan = 'essencial', trial_ends_at = NULL WHERE id = _id;
    PERFORM public.lock_over_plan_limits(_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trials() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_trials() TO service_role;

SELECT cron.unschedule('expire-trials') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-trials');
SELECT cron.schedule('expire-trials', '15 3 * * *', $$SELECT public.expire_trials();$$);

-- O gestor definir o plano encerra o teste: a partir dali o plano é o que
-- ele escolheu. Fora isso, igual à versão de 20260923020000.
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
         trial_ends_at = CASE WHEN _plan IS NOT NULL THEN NULL ELSE trial_ends_at END,
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

-- O app mostra "teste grátis até dd/mm". Fora trial_ends_at e slug (o código
-- da escola, que ela repassa às famílias), igual à versão de 20260922020000.
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.plan_features(public.account_plan(NULL))
      || jsonb_build_object(
           'plano', public.account_plan(NULL),
           'assistant', public.account_can('assistant'),
           'assistant_override',
             (SELECT a.assistant_override FROM public.accounts a
               WHERE a.id = public.current_account_id()),
           'trial_ends_at',
             (SELECT a.trial_ends_at FROM public.accounts a
               WHERE a.id = public.current_account_id()),
           'school_code',
             (SELECT a.slug FROM public.accounts a
               WHERE a.id = public.current_account_id()))
$$;
REVOKE ALL ON FUNCTION public.my_plan() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated, service_role;

-- O painel do gestor passa a mostrar quem está em teste.
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
  professores_travados bigint,
  trial_ends_at timestamptz
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
         (SELECT count(*) FROM public.teachers t WHERE t.account_id = a.id AND t.plan_locked),
         a.trial_ends_at
    FROM public.accounts a
   ORDER BY a.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_accounts_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_accounts_overview() TO authenticated, service_role;

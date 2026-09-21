-- O gestor da plataforma: quem enxerga as empresas de fora.
--
-- Até aqui não existia ninguém acima das empresas. Criar uma empresa era
-- escrever SQL na mão no painel do Supabase, com os dois cuidados que a nota
-- de docs/proximos-passos.md registra terem sido aprendidos errando (realocar
-- o user_roles na mesma transação; as colunas de texto de auth.users que
-- precisam ser '' e não NULL). Isso não escala e é fácil de errar.
--
-- A decisão de desenho que manda em tudo aqui: o operador da plataforma é uma
-- conta SEM EMPRESA. Não é o Thiago com um poder a mais - é outro login, que
-- não pertence a empresa nenhuma. Consequência direta: current_account_id()
-- dele é nulo, então as políticas de acesso não deixam ele ler NENHUMA linha
-- de NENHUMA empresa. Ele não vê aula, aluno, responsável nem financeiro de
-- ninguém. O que ele vê são CONTAGENS, e só através das funções deste arquivo.
--
-- É o próprio pedido do Thiago virado regra do banco: "Thiago não deve (nem
-- quer) ver os dados delas".

-- ---------------------------------------------------------------------------
-- 1. Quem é operador da plataforma
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS ligada e NENHUMA política: a tabela fica inalcançável pelo app, em
-- qualquer papel. Quem precisa da resposta usa is_platform_admin() abaixo, e
-- entrar nesta lista é ato deliberado feito no painel do Supabase. Sem isso,
-- a lista de quem manda seria legível - ou pior, gravável - de dentro do app.
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. A tabela do painel: contagens, nunca conteúdo
-- ---------------------------------------------------------------------------

-- Cada número aqui é um count(). Nenhum nome de aluno, de responsável ou de
-- professor sai desta função - é o que separa "administrar a plataforma" de
-- "ler os dados dos clientes".
CREATE OR REPLACE FUNCTION public.platform_accounts_overview()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  active boolean,
  is_public_default boolean,
  created_at timestamptz,
  responsaveis bigint,
  alunos bigint,
  professores bigint,
  aulas bigint,
  logins bigint,
  ultima_aula timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT a.id, a.name, a.slug, a.active, a.is_public_default, a.created_at,
         (SELECT count(DISTINCT lower(btrim(s.guardian_name))) FROM public.students s
           WHERE s.account_id = a.id AND nullif(btrim(coalesce(s.guardian_name, '')), '') IS NOT NULL),
         (SELECT count(*) FROM public.students s WHERE s.account_id = a.id),
         (SELECT count(*) FROM public.teachers t WHERE t.account_id = a.id AND t.active),
         (SELECT count(*) FROM public.lessons l WHERE l.account_id = a.id),
         (SELECT count(*) FROM public.user_roles r WHERE r.account_id = a.id),
         (SELECT max(l.start_at) FROM public.lessons l WHERE l.account_id = a.id)
    FROM public.accounts a
   ORDER BY a.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_accounts_overview() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_accounts_overview() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Ligar e desligar uma empresa
-- ---------------------------------------------------------------------------

-- Desligar é a ação do dia a dia: a empresa some do ar e os logins dela param
-- de enxergar qualquer coisa, mas nada é perdido e dá para religar.
CREATE OR REPLACE FUNCTION public.platform_set_account_active(_account uuid, _active boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.accounts;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT * INTO _row FROM public.accounts WHERE id = _account;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  -- Desligar a empresa dona do endereço público tiraria do ar a página de
  -- horários que as famílias usam, sem nenhum aviso de que foi isso.
  IF _row.is_public_default AND _active IS NOT TRUE THEN
    RAISE EXCEPTION 'esta é a empresa do endereço público; troque o endereço padrão antes de desativá-la';
  END IF;

  UPDATE public.accounts SET active = _active WHERE id = _account;
  RETURN jsonb_build_object('id', _account, 'active', _active);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_set_account_active(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_account_active(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Excluir, sem que "excluir" queira dizer "perder"
-- ---------------------------------------------------------------------------

-- Tudo o que foi apagado fica aqui, linha por linha, em JSON. RLS ligada e
-- nenhuma política, como platform_admins: nem o operador alcança esta tabela
-- pelo app. Ela existe para o caso de alguém apagar a empresa errada - a
-- recuperação é feita por fora, no painel do Supabase, olhando o payload.
CREATE TABLE IF NOT EXISTS public.deleted_account_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid,
  payload jsonb NOT NULL
);

ALTER TABLE public.deleted_account_archives ENABLE ROW LEVEL SECURITY;

-- Quatro travas, e todas precisam ceder ao mesmo tempo:
--
--   1. só operador da plataforma;
--   2. a empresa precisa estar DESATIVADA - não dá para apagar uma empresa em
--      funcionamento sem antes desligá-la e ver o que quebra;
--   3. não dá para apagar a empresa do endereço público;
--   4. o nome digitado precisa bater exatamente com o nome da empresa.
--
-- E, antes de apagar qualquer coisa, tudo é copiado para o arquivo acima. É
-- isso que permite chamar essa exclusão de segura: ela é reversível.
--
-- Os logins não são apagados aqui: auth.users é do serviço de autenticação, e
-- mexer nele por SQL é a receita da nota "as colunas de texto que precisam ser
-- '' e não NULL". A função devolve os user_ids e quem apaga é a edge function
-- platform-console, pela API oficial.
CREATE OR REPLACE FUNCTION public.platform_delete_account(_account uuid, _confirm_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _row public.accounts;
  _archive_id uuid;
  _users uuid[];
  _payload jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT * INTO _row FROM public.accounts WHERE id = _account;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;
  IF _row.active THEN
    RAISE EXCEPTION 'desative a empresa antes de excluí-la';
  END IF;
  IF _row.is_public_default THEN
    RAISE EXCEPTION 'esta é a empresa do endereço público e não pode ser excluída';
  END IF;
  IF btrim(coalesce(_confirm_name, '')) <> _row.name THEN
    RAISE EXCEPTION 'o nome digitado não confere com o nome da empresa';
  END IF;

  SELECT coalesce(array_agg(user_id), '{}') INTO _users
    FROM public.user_roles WHERE account_id = _account;

  SELECT jsonb_build_object(
    'account',              to_jsonb(_row),
    'user_roles',           (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.user_roles t WHERE t.account_id = _account),
    'settings',             (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.settings t WHERE t.account_id = _account),
    'teachers',             (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.teachers t WHERE t.account_id = _account),
    'students',             (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.students t WHERE t.account_id = _account),
    'lessons',              (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.lessons t WHERE t.account_id = _account),
    'wallet_transactions',  (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.wallet_transactions t WHERE t.account_id = _account),
    'account_discounts',    (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.account_discounts t WHERE t.account_id = _account),
    'blocks',               (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.blocks t WHERE t.account_id = _account),
    'block_exceptions',     (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.block_exceptions t WHERE t.account_id = _account),
    'homework',             (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.homework t WHERE t.account_id = _account),
    'homework_submissions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.homework_submissions t WHERE t.account_id = _account),
    'student_materials',    (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.student_materials t WHERE t.account_id = _account),
    'audit_log',            (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.audit_log t WHERE t.account_id = _account)
  ) INTO _payload;

  INSERT INTO public.deleted_account_archives (account_id, name, slug, deleted_by, payload)
  VALUES (_account, _row.name, _row.slug, auth.uid(), _payload)
  RETURNING id INTO _archive_id;

  -- Filhos antes dos pais. Vários desses já cairiam em cascata, mas a ordem
  -- explícita é o que faz a função continuar correta se alguma cascata for
  -- removida um dia.
  DELETE FROM public.homework_submissions WHERE account_id = _account;
  DELETE FROM public.homework            WHERE account_id = _account;
  DELETE FROM public.student_materials   WHERE account_id = _account;
  DELETE FROM public.wallet_transactions WHERE account_id = _account;
  DELETE FROM public.lessons             WHERE account_id = _account;
  -- Depois das aulas, e não antes: log_lesson_audit dispara no DELETE de cada
  -- aula e grava uma linha nova de histórico. Apagar o histórico primeiro
  -- deixava a tabela se repovoando sozinha, e o DELETE da empresa batia na
  -- chave estrangeira no fim de tudo.
  DELETE FROM public.audit_log           WHERE account_id = _account;
  DELETE FROM public.block_exceptions    WHERE account_id = _account;
  DELETE FROM public.blocks              WHERE account_id = _account;
  DELETE FROM public.students            WHERE account_id = _account;
  DELETE FROM public.teachers            WHERE account_id = _account;
  DELETE FROM public.account_discounts   WHERE account_id = _account;
  DELETE FROM public.settings            WHERE account_id = _account;
  DELETE FROM public.user_roles          WHERE account_id = _account;
  DELETE FROM public.accounts            WHERE id = _account;

  RETURN jsonb_build_object(
    'archive_id', _archive_id,
    'name', _row.name,
    'user_ids', to_jsonb(_users),
    'counts', (SELECT jsonb_object_agg(k, jsonb_array_length(v))
                 FROM jsonb_each(_payload - 'account') AS e(k, v))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.platform_delete_account(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_delete_account(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Criar empresa
-- ---------------------------------------------------------------------------

-- Só a parte do banco. O login do primeiro admin é criado pela edge function
-- platform-console, pela API oficial de autenticação, e só depois amarrado
-- aqui - de novo para não repetir o erro de criar usuário por SQL.
CREATE OR REPLACE FUNCTION public.platform_create_account(_name text, _slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _n text := btrim(coalesce(_name, ''));
  _s text := lower(btrim(coalesce(_slug, '')));
  _id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _n = '' THEN
    RAISE EXCEPTION 'o nome da empresa é obrigatório';
  END IF;
  -- O apelido vira subdomínio quando o endereço próprio por empresa existir,
  -- então já nasce com as regras de um: minúsculas, números e hífen.
  IF _s !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' THEN
    RAISE EXCEPTION 'o apelido deve ter de 3 a 32 caracteres, só letras minúsculas, números e hífen';
  END IF;
  IF EXISTS (SELECT 1 FROM public.accounts WHERE slug = _s) THEN
    RAISE EXCEPTION 'já existe uma empresa com o apelido "%"', _s;
  END IF;

  INSERT INTO public.accounts (name, slug) VALUES (_n, _s) RETURNING id INTO _id;

  -- Sem linha em settings a empresa nasce sem janela de trabalho e sem valor
  -- de aula, e a primeira tela que o admin dela abre parece quebrada.
  INSERT INTO public.settings (account_id) VALUES (_id);

  RETURN jsonb_build_object('id', _id, 'name', _n, 'slug', _s);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_create_account(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_create_account(text, text) TO authenticated, service_role;

-- Amarra um login recém-criado como admin da empresa. Chamada pela edge
-- function logo depois de criar o usuário.
--
-- O DELETE antes do INSERT é o cuidado que a nota de docs/proximos-passos.md
-- registra: handle_new_user joga todo usuário novo na empresa pública, que é a
-- de produção. Sem tirar de lá, o login nasce dentro da empresa errada.
CREATE OR REPLACE FUNCTION public.platform_attach_admin(_account uuid, _user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = _account) THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user;
  INSERT INTO public.user_roles (user_id, role, account_id)
  VALUES (_user, 'admin', _account);

  RETURN jsonb_build_object('account_id', _account, 'user_id', _user);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_attach_admin(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_attach_admin(uuid, uuid) TO authenticated, service_role;

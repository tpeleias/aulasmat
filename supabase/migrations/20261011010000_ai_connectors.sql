-- Conector de IA do Cronys (11/10, Thiago).
--
-- A empresa liga o Claude (ou outra IA que aceite conector MCP) ao Cronys e
-- pede, conversando, coisas como "coloca estas notas no Como foi? da aula de
-- hoje do Miguel" ou "quem está devendo?". Quem faz o trabalho é a função
-- "mcp"; aqui ficam as chaves de acesso.
--
-- Cada chave é um link secreto. Ela pertence a uma empresa (escopo
-- 'account') ou ao gestor da plataforma (escopo 'platform', só números,
-- nunca nome de cliente - como o painel do gestor). O banco guarda só o hash:
-- a chave aparece uma vez, na hora de criar. Quem criou precisa continuar
-- administrador para a chave valer; tirou o acesso, a chave morre junto.

CREATE TABLE IF NOT EXISTS public.ai_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('account', 'platform')),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  read_only boolean NOT NULL DEFAULT false,
  token_hash text NOT NULL UNIQUE,
  token_hint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT ai_connectors_scope_account CHECK ((scope = 'account') = (account_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ai_connectors_account_idx ON public.ai_connectors (account_id) WHERE revoked_at IS NULL;

-- Sem política nenhuma: ninguém lê a tabela direto, só pelas funções abaixo.
ALTER TABLE public.ai_connectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_connectors FROM anon, authenticated;

-- A empresa de quem está logado, se for administrador dela.
CREATE OR REPLACE FUNCTION public.ai_connector_admin_account()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT account_id FROM public.user_roles
   WHERE user_id = auth.uid() AND role = 'admin' AND account_id IS NOT NULL
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.ai_connector_admin_account() FROM public, anon, authenticated;

-- Cria a chave e devolve ela uma única vez. pgcrypto fica em "extensions" no
-- Supabase (e em public no espelho), por isso o search_path inclui os dois.
CREATE OR REPLACE FUNCTION public.ai_connector_create(_label text DEFAULT NULL, _read_only boolean DEFAULT false, _platform boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _acct uuid;
  _tok text;
  _id uuid;
  _n int;
  _name text := left(coalesce(nullif(btrim(_label), ''), 'Claude'), 60);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _platform THEN
    IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not allowed'; END IF;
  ELSE
    _acct := public.ai_connector_admin_account();
    IF _acct IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
  END IF;

  SELECT count(*) INTO _n FROM public.ai_connectors c
   WHERE c.revoked_at IS NULL
     AND (CASE WHEN _platform THEN c.scope = 'platform' ELSE c.account_id = _acct END);
  IF _n >= 10 THEN
    RAISE EXCEPTION 'Limite de 10 conexões ativas. Desligue uma antes de criar outra.';
  END IF;

  _tok := 'crn_' || encode(gen_random_bytes(20), 'hex');
  INSERT INTO public.ai_connectors (scope, account_id, created_by, label, read_only, token_hash, token_hint)
  VALUES (CASE WHEN _platform THEN 'platform' ELSE 'account' END, _acct, auth.uid(), _name,
          coalesce(_read_only, false) OR _platform, encode(digest(_tok, 'sha256'), 'hex'), right(_tok, 4))
  RETURNING id INTO _id;
  RETURN jsonb_build_object('id', _id, 'token', _tok);
END $$;
REVOKE ALL ON FUNCTION public.ai_connector_create(text, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_connector_create(text, boolean, boolean) TO authenticated;

-- As conexões ativas (sem a chave, que o banco nem tem).
CREATE OR REPLACE FUNCTION public.ai_connectors_list(_platform boolean DEFAULT false)
RETURNS TABLE (id uuid, label text, read_only boolean, token_hint text, created_at timestamptz, last_used_at timestamptz, mine boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _acct uuid;
BEGIN
  IF _platform THEN
    IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not allowed'; END IF;
  ELSE
    _acct := public.ai_connector_admin_account();
    IF _acct IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
  END IF;
  RETURN QUERY
  SELECT c.id, c.label, c.read_only, c.token_hint, c.created_at, c.last_used_at, c.created_by = auth.uid()
    FROM public.ai_connectors c
   WHERE c.revoked_at IS NULL
     AND (CASE WHEN _platform THEN c.scope = 'platform' ELSE c.account_id = _acct END)
   ORDER BY c.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.ai_connectors_list(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_connectors_list(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_connector_revoke(_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _c public.ai_connectors;
BEGIN
  SELECT * INTO _c FROM public.ai_connectors WHERE id = _id AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _c.scope = 'platform' THEN
    IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not allowed'; END IF;
  ELSIF _c.account_id IS DISTINCT FROM public.ai_connector_admin_account() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  UPDATE public.ai_connectors SET revoked_at = now() WHERE id = _id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ai_connector_revoke(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_connector_revoke(uuid) TO authenticated;

-- Só a função "mcp" (chave de serviço) chama: diz de quem é a chave, se ainda
-- vale. A empresa desativada pelo gestor e o administrador que perdeu o
-- acesso derrubam a chave na hora.
CREATE OR REPLACE FUNCTION public.ai_connector_resolve(_token text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE _c public.ai_connectors;
BEGIN
  IF _token IS NULL OR _token !~ '^crn_[0-9a-f]{40}$' THEN RETURN NULL; END IF;
  SELECT * INTO _c FROM public.ai_connectors
   WHERE token_hash = encode(digest(_token, 'sha256'), 'hex') AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF _c.scope = 'platform' THEN
    IF NOT EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id = _c.created_by) THEN RETURN NULL; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.user_roles r
                    WHERE r.user_id = _c.created_by AND r.role = 'admin' AND r.account_id = _c.account_id) THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = _c.account_id AND a.active) THEN RETURN NULL; END IF;
  END IF;

  IF _c.last_used_at IS NULL OR _c.last_used_at < now() - interval '1 minute' THEN
    UPDATE public.ai_connectors SET last_used_at = now() WHERE id = _c.id;
  END IF;
  RETURN jsonb_build_object('id', _c.id, 'scope', _c.scope, 'account_id', _c.account_id,
                            'read_only', _c.read_only, 'user_id', _c.created_by);
END $$;
REVOKE ALL ON FUNCTION public.ai_connector_resolve(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_connector_resolve(text) TO service_role;

-- Quem está devendo: o saldo de cada conta (família ou cliente sozinho),
-- do mesmo jeito que o financeiro soma. Só para a função "mcp".
CREATE OR REPLACE FUNCTION public.ai_open_balances(_account uuid)
RETURNS TABLE (conta text, clientes text, saldo numeric, ultimo_lancamento timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(min(nullif(btrim(w.guardian_name), '')), min(w.student_name)),
         string_agg(DISTINCT w.student_name, ', '),
         round(sum(w.amount), 2),
         max(w.created_at)
    FROM public.wallet_transactions w
   WHERE w.account_id = _account
   GROUP BY public.account_key(w.student_name, w.guardian_name)
  HAVING sum(w.amount) < -0.005
   ORDER BY sum(w.amount)
$$;
REVOKE ALL ON FUNCTION public.ai_open_balances(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_open_balances(uuid) TO service_role;

-- O painel do gestor para a IA: os mesmos números do painel (contagens,
-- nunca conteúdo), lidos como o gestor que criou a chave.
CREATE OR REPLACE FUNCTION public.ai_platform_overview(_admin uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _admin) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', _admin::text, true);
  RETURN QUERY SELECT to_jsonb(o) FROM public.platform_accounts_overview() o;
END $$;
REVOKE ALL ON FUNCTION public.ai_platform_overview(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_platform_overview(uuid) TO service_role;

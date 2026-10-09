-- 09/10, pedidos do Thiago:
--
-- 1. "Mostrar o financeiro aos clientes" (todas as empresas; uma empresa
--    interessada pediu): desligado, o portal do cliente mostra só agenda,
--    materiais e tarefas. O banco também para de entregar a carteira e os
--    pacotes ao login do cliente, para não depender só da tela.
--
-- 2. Link de pagamento curto: cronys.com.br/pagar/<código>, no lugar do
--    endereço comprido da função. Um código fixo por conta (responsável ou
--    cliente), que sempre cobra o valor em aberto de agora.
--
-- 3. Asaas além do Stripe (só quem tem accounts.online_payments, por ora o
--    Portal de Aulas), e a escolha de qual usar: accounts.online_provider
--    nulo = o padrão da empresa (Pix e link de pagamento das Configurações);
--    'stripe' ou 'asaas' = o botão "Pagar com cartão ou Pix" vai para ele.

-- ---------------------------------------------------------------------------
-- 1. Financeiro no portal do cliente
-- ---------------------------------------------------------------------------
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS show_finance_to_clients boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.client_finance_visible()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT s.show_finance_to_clients FROM public.settings s
                   WHERE s.account_id = public.current_account_id() LIMIT 1), true)
$$;
REVOKE ALL ON FUNCTION public.client_finance_visible() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_finance_visible() TO authenticated, service_role;

ALTER POLICY "students read own wallet" ON public.wallet_transactions
  USING (account_id = public.current_account_id()
         AND public.student_account_matches(student_name, guardian_name)
         AND public.client_finance_visible());

ALTER POLICY "students read own purchases" ON public.package_purchases
  USING (account_id = public.current_account_id()
         AND public.student_account_matches(student_name, guardian_name)
         AND public.client_finance_visible());

-- ---------------------------------------------------------------------------
-- 2. Link curto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pay_links (
  code text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  account_key text NOT NULL,
  student_name text NOT NULL,
  guardian_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, account_key)
);
ALTER TABLE public.pay_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pay_links FROM anon, authenticated;

-- O código da conta (cria na primeira vez). Só as funções (chave de serviço).
CREATE OR REPLACE FUNCTION public.pay_link_code(_account uuid, _student text, _guardian text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _g text := btrim(coalesce(_guardian, ''));
  _key text := CASE WHEN _g <> '' THEN 'g:' || lower(_g) ELSE 's:' || lower(btrim(coalesce(_student, ''))) END;
  _alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  _code text;
  _bytes bytea;
BEGIN
  IF _account IS NULL OR btrim(coalesce(_student, '')) = '' THEN RAISE EXCEPTION 'conta inválida'; END IF;
  SELECT code INTO _code FROM public.pay_links WHERE account_id = _account AND account_key = _key;
  IF _code IS NOT NULL THEN RETURN _code; END IF;
  FOR _try IN 1..10 LOOP
    _bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    _code := '';
    -- Os bytes 6 e 8 do uuid levam a versão e a variante (não são sorteados).
    FOR i IN 1..8 LOOP
      _code := _code || substr(_alpha, (get_byte(_bytes, (ARRAY[0, 1, 2, 3, 4, 5, 10, 11])[i]) % length(_alpha)) + 1, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.pay_links (code, account_id, account_key, student_name, guardian_name)
      VALUES (_code, _account, _key, btrim(_student), nullif(_g, ''))
      ON CONFLICT (account_id, account_key) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN
      CONTINUE; -- o código sorteado já existe: sorteia outro
    END;
    SELECT code INTO _code FROM public.pay_links WHERE account_id = _account AND account_key = _key;
    RETURN _code;
  END LOOP;
  RAISE EXCEPTION 'não deu para gerar o código';
END $$;
REVOKE ALL ON FUNCTION public.pay_link_code(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_link_code(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Stripe ou Asaas
-- ---------------------------------------------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS online_provider text CHECK (online_provider IN ('stripe', 'asaas'));

-- Quem já conectou o Stripe segue usando o Stripe (nada muda até trocar).
DO $$
BEGIN
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE $q$UPDATE public.accounts a SET online_provider = 'stripe'
      WHERE a.online_payments AND a.online_provider IS NULL
        AND EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = 'stripe_key:' || a.id::text)$q$;
  END IF;
END $$;

ALTER TABLE public.online_payments DROP CONSTRAINT IF EXISTS online_payments_provider_check;
ALTER TABLE public.online_payments ADD CONSTRAINT online_payments_provider_check CHECK (provider IN ('stripe', 'asaas'));

CREATE OR REPLACE FUNCTION public.pay_secret(_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s text;
BEGIN
  IF _name <> 'pay_link_secret' AND _name !~ '^(stripe|asaas)_(key|whsec):[0-9a-f-]{36}$' THEN RETURN NULL; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 ORDER BY created_at DESC LIMIT 1$q$ INTO _s USING _name;
  RETURN _s;
END $$;
REVOKE ALL ON FUNCTION public.pay_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.pay_store_secret(_name text, _value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid;
BEGIN
  IF _name !~ '^(stripe|asaas)_(key|whsec):[0-9a-f-]{36}$' AND _name <> 'pay_link_secret' THEN RAISE EXCEPTION 'invalid secret name'; END IF;
  IF coalesce(_value, '') = '' THEN RAISE EXCEPTION 'empty secret'; END IF;
  IF to_regclass('vault.secrets') IS NULL THEN RAISE EXCEPTION 'vault unavailable'; END IF;
  EXECUTE $q$SELECT id FROM vault.secrets WHERE name = $1 LIMIT 1$q$ INTO _id USING _name;
  IF _id IS NULL THEN
    EXECUTE $q$SELECT vault.create_secret($1, $2)$q$ USING _value, _name;
  ELSE
    EXECUTE $q$SELECT vault.update_secret($1, $2)$q$ USING _id, _value;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.pay_store_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_store_secret(text, text) TO service_role;

-- Para a tela: liberada? Qual está em uso? Quais estão conectados?
-- (Nenhuma chave volta, só sim ou não.) `connected` = o escolhido está conectado.
CREATE OR REPLACE FUNCTION public.online_payments_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _allowed boolean; _provider text;
  _stripe boolean := false; _asaas boolean := false;
BEGIN
  IF _acct IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'connected', false, 'provider', null, 'stripe', false, 'asaas', false);
  END IF;
  SELECT online_payments, online_provider INTO _allowed, _provider FROM public.accounts WHERE id = _acct;
  _allowed := coalesce(_allowed, false);
  IF _allowed AND to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)$q$ INTO _stripe USING 'stripe_key:' || _acct::text;
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)$q$ INTO _asaas USING 'asaas_key:' || _acct::text;
  END IF;
  IF NOT _allowed THEN _provider := NULL; END IF;
  RETURN jsonb_build_object(
    'allowed', _allowed,
    'provider', _provider,
    'stripe', _stripe,
    'asaas', _asaas,
    'connected', CASE _provider WHEN 'stripe' THEN _stripe WHEN 'asaas' THEN _asaas ELSE false END);
END $$;
REVOKE ALL ON FUNCTION public.online_payments_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.online_payments_status() TO authenticated;

-- O admin escolhe: nulo (o padrão), 'stripe' ou 'asaas' (precisa estar conectado).
CREATE OR REPLACE FUNCTION public.set_online_provider(_provider text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acct uuid := public.current_account_id(); _ok boolean := false;
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF NOT coalesce((SELECT online_payments FROM public.accounts WHERE id = _acct), false) THEN RAISE EXCEPTION 'not enabled'; END IF;
  IF _provider IS NOT NULL THEN
    IF _provider NOT IN ('stripe', 'asaas') THEN RAISE EXCEPTION 'invalid provider'; END IF;
    IF to_regclass('vault.secrets') IS NOT NULL THEN
      EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)$q$ INTO _ok USING _provider || '_key:' || _acct::text;
    END IF;
    IF NOT _ok THEN RAISE EXCEPTION 'not connected'; END IF;
  END IF;
  UPDATE public.accounts SET online_provider = _provider WHERE id = _acct;
END $$;
REVOKE ALL ON FUNCTION public.set_online_provider(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_online_provider(text) TO authenticated;

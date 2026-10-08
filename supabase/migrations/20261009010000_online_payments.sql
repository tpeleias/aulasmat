-- Pagamento on-line pelo Stripe da PRÓPRIA empresa (09/10, pedido do Thiago).
--
-- Cada empresa que tiver a função liberada (accounts.online_payments) conecta
-- a conta Stripe dela em Configurações → Integrações: a chave secreta e o
-- segredo do webhook ficam no cofre (vault), com o id da empresa no nome, e
-- nunca voltam para a tela. A família recebe um link "Pagar com cartão ou
-- Pix" com o valor em aberto; quando o Stripe confirma, a função "pay" lança
-- o pagamento na carteira (register_payment) e a conta se acerta sozinha.
--
-- Por ora só o Portal de Aulas (a empresa do Thiago) tem a função liberada.
-- Para liberar outra: UPDATE accounts SET online_payments = true WHERE ...

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS online_payments boolean NOT NULL DEFAULT false;

UPDATE public.accounts SET online_payments = true WHERE slug = 'portaldeaulas';

-- Cada link de pagamento aberto no Stripe (uma Checkout Session).
CREATE TABLE IF NOT EXISTS public.online_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  session_id text NOT NULL UNIQUE,
  student_name text NOT NULL,
  guardian_name text,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired')),
  method text,
  wallet_tx_id uuid REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS online_payments_account_idx ON public.online_payments (account_id, created_at DESC);

ALTER TABLE public.online_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read own online payments" ON public.online_payments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id());
REVOKE ALL ON public.online_payments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.online_payments FROM authenticated;

-- ---------------------------------------------------------------------------
-- Cofre: só a função "pay" (chave de serviço) lê e grava
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_secret(_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s text;
BEGIN
  IF _name <> 'pay_link_secret' AND _name !~ '^stripe_(key|whsec):[0-9a-f-]{36}$' THEN RETURN NULL; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 ORDER BY created_at DESC LIMIT 1$q$ INTO _s USING _name;
  RETURN _s;
END $$;
REVOKE ALL ON FUNCTION public.pay_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_secret(text) TO service_role;

-- Grava (ou troca) a chave e o segredo do webhook de uma empresa.
CREATE OR REPLACE FUNCTION public.pay_store_secret(_name text, _value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid;
BEGIN
  IF _name !~ '^stripe_(key|whsec):[0-9a-f-]{36}$' AND _name <> 'pay_link_secret' THEN RAISE EXCEPTION 'invalid secret name'; END IF;
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

-- Para a tela: a empresa tem a função liberada? E já conectou o Stripe?
-- (Não devolve chave nenhuma, só sim ou não.)
CREATE OR REPLACE FUNCTION public.online_payments_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acct uuid := public.current_account_id(); _allowed boolean; _connected boolean := false;
BEGIN
  IF _acct IS NULL THEN RETURN jsonb_build_object('allowed', false, 'connected', false); END IF;
  SELECT online_payments INTO _allowed FROM public.accounts WHERE id = _acct;
  IF coalesce(_allowed, false) AND to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)$q$ INTO _connected USING 'stripe_key:' || _acct::text;
  END IF;
  RETURN jsonb_build_object('allowed', coalesce(_allowed, false), 'connected', coalesce(_allowed, false) AND _connected);
END $$;
REVOKE ALL ON FUNCTION public.online_payments_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.online_payments_status() TO authenticated;

-- O segredo que assina os links de pagamento dos e-mails (criado uma vez).
DO $$
BEGIN
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'pay_link_secret') THEN
      PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'pay_link_secret');
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pay_link_secret: %', SQLERRM;
END $$;

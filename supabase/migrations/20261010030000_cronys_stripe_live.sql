-- Stripe real das assinaturas do Cronys (10/10). O gestor cola a chave real no
-- painel da plataforma ("Ligar o modo real") e ela fica no cofre, junto com o
-- segredo do webhook: cronys_stripe_key e cronys_stripe_whsec. Só as funções
-- (service_role) leem ou gravam; nenhuma tela recebe a chave de volta.
-- Igual às versões de 20261009020000, com os dois nomes a mais.

CREATE OR REPLACE FUNCTION public.pay_secret(_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s text;
BEGIN
  IF _name NOT IN ('pay_link_secret', 'cronys_stripe_key', 'cronys_stripe_whsec')
     AND _name !~ '^(stripe|asaas)_(key|whsec):[0-9a-f-]{36}$' THEN RETURN NULL; END IF;
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
  IF _name NOT IN ('pay_link_secret', 'cronys_stripe_key', 'cronys_stripe_whsec')
     AND _name !~ '^(stripe|asaas)_(key|whsec):[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'invalid secret name'; END IF;
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

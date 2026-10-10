-- Plano vitalício (10/10, pedido do Thiago para o Portal de Aulas): Max com
-- assistente para sempre, sem depender do "testador" (o botão do presente,
-- que continua servindo para cortesias com prazo).
--
-- Uma marca na empresa (accounts.lifetime). Enquanto ligada, um gatilho
-- segura o Max e o assistente em qualquer UPDATE: fim de teste, fim de
-- cortesia, assinatura cancelada ou mudança de plano no painel não rebaixam.
-- Para mudar o plano de uma vitalícia, o gestor tira a marca antes.

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS lifetime boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.accounts_lifetime_hold()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.lifetime THEN
    NEW.plan := 'pro';
    NEW.assistant_override := true;
    NEW.trial_ends_at := NULL;
    NEW.tester_until := NULL;
    NEW.tester_assistant := false;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER accounts_aa_lifetime_hold
  BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.accounts_lifetime_hold();

-- Só o gestor muda a marca (accounts não tem UPDATE para o app).
CREATE OR REPLACE FUNCTION public.platform_set_lifetime(_account uuid, _on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _row public.accounts;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not allowed'; END IF;
  UPDATE public.accounts SET lifetime = coalesce(_on, false) WHERE id = _account RETURNING * INTO _row;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'empresa não encontrada'; END IF;
  RETURN jsonb_build_object('id', _row.id, 'lifetime', _row.lifetime, 'plan', _row.plan)
         || public.apply_plan_locks(_row.id);
END $$;
REVOKE ALL ON FUNCTION public.platform_set_lifetime(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_lifetime(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_lifetime_accounts()
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not allowed'; END IF;
  RETURN QUERY SELECT id FROM public.accounts WHERE lifetime;
END $$;
REVOKE ALL ON FUNCTION public.platform_lifetime_accounts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_lifetime_accounts() TO authenticated;

UPDATE public.accounts SET lifetime = true WHERE slug = 'portaldeaulas';

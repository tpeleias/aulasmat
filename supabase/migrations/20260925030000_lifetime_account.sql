-- Empresa com tudo liberado para sempre (decisão do Thiago, 24/09): o Portal
-- de Aulas, a empresa dele.
--
-- accounts.lifetime = true quer dizer: Pro Equipe e assistente ligados, e
-- nada rebaixa - nem o fim de teste, nem atraso ou cancelamento no Stripe,
-- nem o painel do gestor. Para tirar, só desligando a marca à mão no banco.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS lifetime boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.lifetime IS
  'Tudo liberado para sempre: plano Pro Equipe e assistente fixos; nenhuma rotina, webhook ou painel rebaixa.';

-- A trava mora num gatilho, e não em cada função que muda plano: assim vale
-- para as que existem hoje (expire_trials, expire_unpaid_subscriptions,
-- billing_apply_subscription, platform_set_account_plan) e para as que vierem.
CREATE OR REPLACE FUNCTION public.keep_lifetime_account()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lifetime THEN
    NEW.plan := 'pro';
    NEW.assistant_override := true;
    NEW.trial_ends_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_keep_lifetime ON public.accounts;
CREATE TRIGGER accounts_keep_lifetime
  BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.keep_lifetime_account();

-- O Portal de Aulas. Se estiver com algo pausado, libera (Pro Equipe não tem
-- limite de clientes nem de profissionais).
UPDATE public.accounts SET lifetime = true WHERE slug = 'portaldeaulas';
SELECT public.apply_plan_locks(id) FROM public.accounts WHERE slug = 'portaldeaulas';

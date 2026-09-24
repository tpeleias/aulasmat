-- A Demonstração fica para sempre no Pro, mas SEM o assistente (Thiago,
-- 25/09): é a conta do revisor da Google Play, e o robô da Play sai clicando
-- em tudo - cada mensagem ao assistente custa dinheiro de API.
--
-- Até aqui a marca "para sempre" (accounts.lifetime) prendia plano e
-- assistente juntos. Agora são duas marcas:
--   lifetime            - plano Pro Equipe fixo, sem teste, nada rebaixa
--   lifetime_assistant  - assistente fixo ligado
-- O Portal de Aulas tem as duas; a Demonstração, só a primeira.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS lifetime_assistant boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.lifetime_assistant IS
  'Assistente ligado para sempre (independe de lifetime).';

CREATE OR REPLACE FUNCTION public.keep_lifetime_account()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lifetime THEN
    NEW.plan := 'pro';
    NEW.trial_ends_at := NULL;
  END IF;
  IF NEW.lifetime_assistant THEN
    NEW.assistant_override := true;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.accounts SET lifetime_assistant = true WHERE slug = 'portaldeaulas';
UPDATE public.accounts SET assistant_override = false WHERE slug = 'demo';

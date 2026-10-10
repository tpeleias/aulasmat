-- Vitalício sem prender o assistente (10/10, Thiago): a marca segura só o
-- plano Max (e limpa teste e cortesia); o assistente volta a ser do gestor,
-- que liga, desliga e limita como em qualquer empresa. Igual à versão de
-- 20261010050000, sem a linha do assistente.
CREATE OR REPLACE FUNCTION public.accounts_lifetime_hold()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.lifetime THEN
    NEW.plan := 'pro';
    NEW.trial_ends_at := NULL;
    NEW.tester_until := NULL;
    NEW.tester_assistant := false;
  END IF;
  RETURN NEW;
END $$;

-- O que prendia o assistente de fato era a marca antiga lifetime_assistant
-- (20260925050000), ligada no Portal de Aulas: o gatilho keep_lifetime_account
-- religava o assistente a cada mudança. Sai a marca; o assistente fica como
-- está agora (ligado) e passa a obedecer o switch do painel.
UPDATE public.accounts SET lifetime_assistant = false WHERE lifetime_assistant;

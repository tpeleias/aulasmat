-- Switch geral do assistente, no painel do gestor (26/09).
--
-- Enquanto o Thiago testa, o assistente não pode ligar sozinho por plano
-- (amostra do Pro, IA do Max, adicional): cada conversa custa API. Com o
-- switch desligado (o padrão), só funciona para a empresa que o gestor
-- liberou uma a uma (assistant_override = true) - na prática, o Portal de
-- Aulas. Ligado, volta a valer o que cada plano traz.
--
-- O mesmo switch põe o adicional de IA à venda (assistant_on_sale), que antes
-- era um "false" cravado no código.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  assistant_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Só as funções abaixo leem e gravam; ninguém acessa a tabela direto.
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_settings FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assistant_enabled_for_plans()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce((SELECT assistant_enabled FROM public.platform_settings WHERE id), false)
$$;
GRANT EXECUTE ON FUNCTION public.assistant_enabled_for_plans() TO authenticated, service_role;

-- Adicional à venda = switch ligado.
CREATE OR REPLACE FUNCTION public.assistant_on_sale()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT public.assistant_enabled_for_plans() $$;
GRANT EXECUTE ON FUNCTION public.assistant_on_sale() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_set_assistant_enabled(_on boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Só o gestor da plataforma pode mudar isso.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.platform_settings SET assistant_enabled = coalesce(_on, false), updated_at = now() WHERE id;
  RETURN coalesce(_on, false);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_assistant_enabled(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_assistant_enabled(boolean) TO authenticated;

-- A liberação manual do gestor vale sempre; o que vem do plano, só com o
-- switch ligado.
CREATE OR REPLACE FUNCTION public.account_can(_capability text, _account uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _capability = 'assistant' THEN coalesce(
      (SELECT coalesce(a.assistant_override, false)
              OR (public.assistant_enabled_for_plans()
                  AND (((public.plan_features(a.plan) ->> 'assistant_messages')::int > 0
                        AND (NOT (public.plan_features(a.plan) ->> 'assistant_needs_payment')::boolean
                             OR a.billing_status IN ('active', 'past_due')))
                       -- O adicional comprado (o Start não tem amostra).
                       OR (a.assistant_billed AND (public.plan_features(a.plan) ->> 'assistant_addon')::boolean)))
         FROM public.accounts a
        WHERE a.id = coalesce(_account, public.current_account_id())),
      false)
    ELSE coalesce((public.plan_features(public.account_plan(_account)) ->> _capability)::boolean, false)
  END
$$;

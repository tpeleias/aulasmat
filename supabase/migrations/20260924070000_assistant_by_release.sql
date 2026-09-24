-- Assistente só com liberação do gestor (pedido do Thiago, 24/09).
--
-- Até aqui o Pro trazia o assistente, e o gestor podia abrir exceções
-- (accounts.assistant_override). Cada conversa custa dinheiro de verdade, então
-- a regra vira: o assistente fica BLOQUEADO em qualquer plano - inclusive no Pro
-- e no teste de 14 dias - até o gestor liberar aquela empresa.
--
--   assistant_override = true   liberado pelo gestor
--   false ou nulo               bloqueado
--
-- A edge function assistant-chat já pergunta a account_can('assistant') antes
-- de falar com a API, então a trava vale de verdade, não só na tela. Nada disso
-- depende do app: o .aab publicado respeita a regra nova sem atualizar.

-- Quem hoje tem o assistente pelo plano continua com ele: vira liberação
-- explícita. Só as empresas criadas daqui para frente nascem bloqueadas.
UPDATE public.accounts SET assistant_override = true
 WHERE assistant_override IS NULL AND plan = 'pro';

-- Igual à versão de 20260921160000, com o assistente dependendo só da liberação.
CREATE OR REPLACE FUNCTION public.account_can(_capability text, _account uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _capability = 'assistant' THEN coalesce(
      (SELECT a.assistant_override FROM public.accounts a
        WHERE a.id = coalesce(_account, public.current_account_id())),
      false)
    ELSE coalesce((public.plan_features(public.account_plan(_account)) ->> _capability)::boolean, false)
  END
$$;

-- Igual à versão de 20260924020000. assistant_override sai como falso quando
-- nulo: é o que faz a tela - inclusive a do app já instalado - dizer "fale com
-- quem cuida da sua conta" em vez de vender o Pro, que sozinho não libera mais.
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.plan_features(public.account_plan(NULL))
      || jsonb_build_object(
           'plano', public.account_plan(NULL),
           'assistant', public.account_can('assistant'),
           'assistant_override',
             coalesce((SELECT a.assistant_override FROM public.accounts a
                        WHERE a.id = public.current_account_id()), false),
           'trial_ends_at',
             (SELECT a.trial_ends_at FROM public.accounts a
               WHERE a.id = public.current_account_id()),
           'school_code',
             (SELECT a.slug FROM public.accounts a
               WHERE a.id = public.current_account_id()))
$$;
REVOKE ALL ON FUNCTION public.my_plan() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated, service_role;

-- Igual à versão de 20260924020000, menos o "_clear_override".
--
-- O painel do gestor até a versão 1.10.1 do app não grava "ligado" ao ligar o
-- assistente de uma empresa Pro: ele manda "limpar a exceção", porque no Pro o
-- plano ligava. Com a regra nova, limpar deixaria bloqueado e o botão não
-- ligaria nunca. Então "limpar" passa a significar o que aquele painel queria:
-- no Pro, liberar; no Essencial (onde ele manda limpar ao DESLIGAR), bloquear.
-- O painel novo manda sempre ligado/desligado explícito e não passa por aqui.
CREATE OR REPLACE FUNCTION public.platform_set_account_plan(
  _account uuid,
  _plan text DEFAULT NULL,
  _assistant_override boolean DEFAULT NULL,
  _clear_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _row public.accounts;
  _travas jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _plan IS NOT NULL AND _plan NOT IN ('essencial', 'pro') THEN
    RAISE EXCEPTION 'plano inválido: %', _plan;
  END IF;

  UPDATE public.accounts
     SET plan = coalesce(_plan, plan),
         trial_ends_at = CASE WHEN _plan IS NOT NULL THEN NULL ELSE trial_ends_at END,
         assistant_override = CASE
           WHEN _clear_override THEN coalesce(_plan, plan) = 'pro'
           ELSE coalesce(_assistant_override, assistant_override) END
   WHERE id = _account
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  IF _plan IS NOT NULL THEN
    _travas := CASE WHEN _row.plan = 'pro'
                    THEN public.release_plan_locks(_row.id)
                    ELSE public.lock_over_plan_limits(_row.id) END;
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'plan', _row.plan,
                            'assistant_override', _row.assistant_override,
                            'assistant', public.account_can('assistant', _row.id))
         || _travas;
END;
$$;

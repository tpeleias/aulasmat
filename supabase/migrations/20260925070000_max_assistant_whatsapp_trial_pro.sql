-- Decisões do Thiago (25/09):
--   1. O teste grátis passa a ser do Pro (era do Max). Assim ninguém ganha o
--      assistente de graça no teste.
--   2. O Max PAGO traz o assistente incluso. O Pro compra como adicional
--      (R$ 39, preço único). As 3 contas Max de cortesia (sem assinatura)
--      continuam sem assistente, a não ser que a Cronys libere à mão.
--   3. Recursos por plano: WhatsApp de um toque (Pro e Max), WhatsApp
--      automático e "Estou a caminho" com localização (só Max).
--   4. O WhatsApp do cliente no cadastro, para os botões de WhatsApp.
--   5. O adicional do assistente (só Pro, R$ 39) entra à venda.

-- ---------------------------------------------------------------------------
-- Recursos por plano
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'pro' THEN jsonb_build_object(
      'nome',               'Cronys Max',
      -- Sem teto: acima dos incluídos, cada profissional ativo é cobrado.
      'max_teachers',       null,
      'included_teachers',  5,
      'max_students',       null,
      -- O assistente em si é decidido por account_can (só com assinatura paga).
      'assistant',          false,
      'assistant_included', true,
      'packages',           true,
      'recurring_blocks',   true,
      'vocabulary',         true,
      'whatsapp_link',      true,
      'whatsapp_auto',      true,
      'arrival_location',   true
    )
    WHEN 'pro_solo' THEN jsonb_build_object(
      'nome',               'Cronys Pro',
      'max_teachers',       1,
      'included_teachers',  1,
      'max_students',       null,
      'assistant',          false,
      'assistant_included', false,
      'packages',           true,
      'recurring_blocks',   true,
      'vocabulary',         true,
      'whatsapp_link',      true,
      'whatsapp_auto',      false,
      'arrival_location',   false
    )
    ELSE jsonb_build_object(
      'nome',               'Cronys Essencial',
      'max_teachers',       1,
      'included_teachers',  1,
      'max_students',       5,
      'assistant',          false,
      'assistant_included', false,
      'packages',           false,
      'recurring_blocks',   false,
      'vocabulary',         false,
      'whatsapp_link',      false,
      'whatsapp_auto',      false,
      'arrival_location',   false
    )
  END
$$;

-- ---------------------------------------------------------------------------
-- Assistente: liberado à mão (cortesia, adicional comprado) OU Max pago
-- ---------------------------------------------------------------------------
-- "Pago" é ter assinatura ativa ou em atraso dentro da tolerância (depois dela
-- a conta cai para o Essencial e o plano deixa de ser 'pro').
CREATE OR REPLACE FUNCTION public.account_can(_capability text, _account uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _capability = 'assistant' THEN coalesce(
      (SELECT coalesce(a.assistant_override, false)
              OR (a.plan = 'pro' AND a.billing_status IN ('active', 'past_due'))
         FROM public.accounts a
        WHERE a.id = coalesce(_account, public.current_account_id())),
      false)
    ELSE coalesce((public.plan_features(public.account_plan(_account)) ->> _capability)::boolean, false)
  END
$$;

-- ---------------------------------------------------------------------------
-- Teste grátis no Pro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _meta jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  _code text := lower(btrim(coalesce(_meta ->> 'school_code', '')));
  _account uuid;
  _school text;
  _teacher text;
BEGIN
  IF _meta ->> 'signup_kind' = 'school' THEN
    _school := left(nullif(btrim(coalesce(_meta ->> 'school_name', '')), ''), 120);
    _teacher := lower(left(nullif(btrim(coalesce(_meta ->> 'teacher_name', '')), ''), 60));
    IF _school IS NULL OR _teacher IS NULL THEN
      RAISE EXCEPTION 'Informe o nome da escola e o seu nome.';
    END IF;

    -- 14 dias do Pro (pro_solo). Até 25/09 era do Max.
    INSERT INTO public.accounts (name, slug, plan, trial_ends_at)
    VALUES (_school, public.unique_account_slug(_school), 'pro_solo', now() + interval '14 days')
    RETURNING id INTO _account;
    INSERT INTO public.settings (account_id, contact_email) VALUES (_account, NEW.email);
    INSERT INTO public.teachers (account_id, name, active) VALUES (_account, _teacher, true);
    INSERT INTO public.user_roles (user_id, role, account_id) VALUES (NEW.id, 'admin', _account);
    RETURN NEW;
  END IF;

  IF _code <> '' THEN
    SELECT a.id INTO _account FROM public.accounts a WHERE a.slug = _code AND a.active;
    INSERT INTO public.user_roles (user_id, role, account_id) VALUES (NEW.id, 'student', _account);
    RETURN NEW;
  END IF;

  _account := public.public_account_id();
  INSERT INTO public.user_roles (user_id, role, account_id)
  VALUES (
    NEW.id,
    CASE WHEN (SELECT count(*) FROM public.user_roles
                WHERE role = 'admin' AND account_id IS NOT DISTINCT FROM _account) = 0
      THEN 'admin'::app_role
      ELSE 'student'::app_role
    END,
    _account
  );
  RETURN NEW;
END;
$$;

-- Vale para os testes novos (Pro) e para os que ainda estão no Max.
CREATE OR REPLACE FUNCTION public.expire_trials()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _n int := 0;
BEGIN
  FOR _id IN
    SELECT id FROM public.accounts
     WHERE plan IN ('pro', 'pro_solo') AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
  LOOP
    UPDATE public.accounts SET plan = 'essencial', trial_ends_at = NULL WHERE id = _id;
    PERFORM public.lock_over_plan_limits(_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trials() FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- WhatsApp do cliente
-- ---------------------------------------------------------------------------
-- Opcional. Só dígitos, com ou sem o 55; a tela acrescenta o 55 quando falta.
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_whatsapp_digits;
ALTER TABLE public.students
  ADD CONSTRAINT students_whatsapp_digits CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{10,15}$');

COMMENT ON COLUMN public.students.whatsapp IS
  'WhatsApp do cliente/responsável, só dígitos. Usado nos botões de lembrete e "Estou a caminho".';

-- ---------------------------------------------------------------------------
-- Adicional do assistente à venda (só o Pro compra; o Max já tem)
-- ---------------------------------------------------------------------------
-- Para tirar de venda de novo: voltar para SELECT false. Quem já comprou
-- continua com ele.
CREATE OR REPLACE FUNCTION public.assistant_on_sale()
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT true $$;

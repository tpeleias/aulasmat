-- Entrar com o Google (Thiago, 27/09).
--
-- Quem entra pelo Google pela primeira vez chega sem nome de empresa: o
-- cadastro com e-mail manda school_name/teacher_name junto, o Google não. Sem
-- isto, handle_new_user jogava essa pessoa como cliente sem vínculo (a tela
-- "Conta aguardando liberação"). Agora ela fica sem papel nenhum, e o app
-- mostra "Bem-vindo! Qual o nome do seu negócio?", que chama
-- create_my_business abaixo.

-- A empresa nova, igual para o cadastro com e-mail e para o do Google.
CREATE OR REPLACE FUNCTION public.start_business(_user uuid, _email text, _school text, _teacher text, _locale text, _currency text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _account uuid;
  _s text := left(nullif(btrim(coalesce(_school, '')), ''), 120);
  _t text := lower(left(nullif(btrim(coalesce(_teacher, '')), ''), 60));
  _l text := CASE WHEN _locale IN ('pt-BR', 'en') THEN _locale ELSE 'pt-BR' END;
  _c text := CASE WHEN _currency IN ('BRL', 'USD', 'EUR', 'GBP') THEN _currency
                  WHEN _locale = 'en' THEN 'USD' ELSE 'BRL' END;
BEGIN
  IF _s IS NULL OR _t IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da escola e o seu nome.';
  END IF;
  INSERT INTO public.accounts (name, slug, plan, trial_ends_at, locale, currency)
  VALUES (_s, public.unique_account_slug(_s), 'pro_solo', now() + interval '14 days', _l, _c)
  RETURNING id INTO _account;
  INSERT INTO public.settings (account_id, contact_email) VALUES (_account, _email);
  INSERT INTO public.teachers (account_id, name, active, admin_user_id) VALUES (_account, _t, true, _user);
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_user, 'admin', _account);
  RETURN _account;
END;
$$;
REVOKE ALL ON FUNCTION public.start_business(uuid, text, text, text, text, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _meta jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  _code text := lower(btrim(coalesce(_meta ->> 'school_code', '')));
  _account uuid;
BEGIN
  IF _meta ->> 'signup_kind' = 'school' THEN
    PERFORM public.start_business(NEW.id, NEW.email, _meta ->> 'school_name', _meta ->> 'teacher_name',
                                  _meta ->> 'locale', _meta ->> 'currency');
    RETURN NEW;
  END IF;

  IF _code <> '' THEN
    SELECT a.id INTO _account FROM public.accounts a WHERE a.slug = _code AND a.active;
    INSERT INTO public.user_roles (user_id, role, account_id) VALUES (NEW.id, 'student', _account);
    RETURN NEW;
  END IF;

  -- Google (ou outro login de fora): sem papel. O app pergunta o nome do
  -- negócio e chama create_my_business.
  IF coalesce(NEW.raw_app_meta_data ->> 'provider', 'email') <> 'email' THEN
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
$function$;

-- Só para quem ainda não é nada: sem papel em empresa nenhuma e sem ser o
-- gestor da plataforma. Quem já tem empresa não cria outra por aqui.
CREATE OR REPLACE FUNCTION public.create_my_business(_school text, _teacher text, _locale text DEFAULT NULL, _currency text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid)
     OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _uid) THEN
    RAISE EXCEPTION 'Esta conta já tem uma empresa.' USING HINT = 'ja_tem_empresa';
  END IF;
  RETURN public.start_business(_uid, (SELECT email FROM auth.users WHERE id = _uid), _school, _teacher, _locale, _currency);
END;
$$;
REVOKE ALL ON FUNCTION public.create_my_business(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_my_business(text, text, text, text) TO authenticated;

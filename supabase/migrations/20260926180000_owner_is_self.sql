-- Google Agenda "Sou eu" automático para empresa nova (Thiago, 26/09).
--
-- Quem cria a empresa já nasce como o primeiro profissional dela; agora esse
-- cadastro nasce ligado a ele (teachers.admin_user_id, migration
-- 20260926170000), e o "Sou eu" não precisa ser marcado à mão. Só muda a linha
-- do INSERT em teachers; o resto é o handle_new_user de 20260925180000.

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
  _school text;
  _teacher text;
  _locale text := CASE WHEN _meta ->> 'locale' IN ('pt-BR', 'en') THEN _meta ->> 'locale' ELSE 'pt-BR' END;
  _currency text := CASE WHEN _meta ->> 'currency' IN ('BRL', 'USD', 'EUR', 'GBP') THEN _meta ->> 'currency'
                         WHEN _meta ->> 'locale' = 'en' THEN 'USD' ELSE 'BRL' END;
BEGIN
  IF _meta ->> 'signup_kind' = 'school' THEN
    _school := left(nullif(btrim(coalesce(_meta ->> 'school_name', '')), ''), 120);
    _teacher := lower(left(nullif(btrim(coalesce(_meta ->> 'teacher_name', '')), ''), 60));
    IF _school IS NULL OR _teacher IS NULL THEN
      RAISE EXCEPTION 'Informe o nome da escola e o seu nome.';
    END IF;

    INSERT INTO public.accounts (name, slug, plan, trial_ends_at, locale, currency)
    VALUES (_school, public.unique_account_slug(_school), 'pro_solo', now() + interval '14 days', _locale, _currency)
    RETURNING id INTO _account;
    INSERT INTO public.settings (account_id, contact_email) VALUES (_account, NEW.email);
    INSERT INTO public.teachers (account_id, name, active, admin_user_id) VALUES (_account, _teacher, true, NEW.id);
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
$function$

;

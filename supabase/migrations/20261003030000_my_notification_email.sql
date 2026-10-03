-- Cada um põe o próprio e-mail para avisos (Thiago, 03/10).
--
-- Até aqui só o admin preenchia: o do cliente e do responsável no cadastro do
-- cliente, o do profissional em Profissionais. Mas quem entra com usuário (sem
-- @) é o admin quem cria, e a pessoa não tinha onde dizer o e-mail dela.
--
-- Em "Minha conta", quem tem login ligado a um cadastro vê "E-mail para
-- avisos": o profissional grava em teacher_emails (que ele não lê pela tabela,
-- só pelo próprio cadastro, por esta função); o cliente grava em
-- students.email e, se o cadastro tem responsável, em guardian_email.
-- O admin continua podendo trocar pelo cadastro, como antes.

-- O que vale para o login atual: o cadastro de profissional primeiro (o admin
-- que também atende cai aqui), depois o de cliente. Nulo para quem não tem.
CREATE OR REPLACE FUNCTION public.my_notification_email()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _acc uuid := public.current_account_id();
  _t public.teachers%ROWTYPE;
  _s public.students%ROWTYPE;
BEGIN
  IF _uid IS NULL OR _acc IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _t FROM public.teachers WHERE user_id = _uid AND account_id = _acc LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('kind', 'teacher',
      'email', (SELECT te.email FROM public.teacher_emails te WHERE te.teacher_id = _t.id));
  END IF;

  SELECT * INTO _s FROM public.students WHERE user_id = _uid AND account_id = _acc LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('kind', 'client', 'email', _s.email,
      'guardian_name', nullif(btrim(coalesce(_s.guardian_name, '')), ''), 'guardian_email', _s.guardian_email);
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.my_notification_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_notification_email() TO authenticated;

-- Grava. Vazio apaga. O do responsável só vale se o cadastro tem responsável.
CREATE OR REPLACE FUNCTION public.set_my_notification_email(_email text, _guardian_email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _acc uuid := public.current_account_id();
  _e text := nullif(lower(btrim(coalesce(_email, ''))), '');
  _g text := nullif(lower(btrim(coalesce(_guardian_email, ''))), '');
  _tid uuid;
  _sid uuid;
BEGIN
  IF _uid IS NULL OR _acc IS NULL THEN RAISE EXCEPTION 'sem login' USING ERRCODE = '42501'; END IF;
  IF NOT public.email_valid(_e) OR NOT public.email_valid(_g) THEN
    RAISE EXCEPTION 'e-mail inválido' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO _tid FROM public.teachers WHERE user_id = _uid AND account_id = _acc LIMIT 1;
  IF _tid IS NOT NULL THEN
    IF _e IS NULL THEN
      DELETE FROM public.teacher_emails WHERE teacher_id = _tid;
    ELSE
      INSERT INTO public.teacher_emails (teacher_id, account_id, email) VALUES (_tid, _acc, _e)
      ON CONFLICT (teacher_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
    END IF;
    RETURN public.my_notification_email();
  END IF;

  SELECT id INTO _sid FROM public.students WHERE user_id = _uid AND account_id = _acc LIMIT 1;
  IF _sid IS NOT NULL THEN
    UPDATE public.students
       SET email = _e,
           guardian_email = CASE WHEN nullif(btrim(coalesce(guardian_name, '')), '') IS NULL THEN guardian_email ELSE _g END
     WHERE id = _sid;
    RETURN public.my_notification_email();
  END IF;

  RAISE EXCEPTION 'login sem cadastro' USING ERRCODE = 'P0002';
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_notification_email(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_notification_email(text, text) TO authenticated;

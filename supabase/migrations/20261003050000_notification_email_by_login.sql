-- "E-mail para avisos" conforme quem entrou (Thiago, 03/10).
--
-- O cadastro do cliente tem dois logins possíveis: o da família
-- (students.user_id, o portal /aluno) e o do aluno (students.child_user_id, o
-- /meu-painel). Antes os dois viam os mesmos campos. Agora:
--
--   família, com responsável  -> "Seu e-mail" é o do responsável
--                                (guardian_email); o do aluno (email) fica num
--                                campo recolhido, "Adicionar o e-mail de ...".
--   família, sem responsável  -> o cliente adulto: só o email.
--   aluno (meu-painel)        -> só o email dele; se o responsável já pôs, vem
--                                preenchido.
--   profissional              -> teacher_emails, como antes.
--
-- set_my_notification_email continua existindo para o app antigo; o site novo
-- usa save_my_notification_email.

CREATE OR REPLACE FUNCTION public.my_notification_email()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _acc uuid := public.current_account_id();
  _t public.teachers%ROWTYPE;
  _s public.students%ROWTYPE;
  _on boolean;
  _g text;
BEGIN
  IF _uid IS NULL OR _acc IS NULL THEN RETURN NULL; END IF;
  _on := public.email_pref((SELECT st.email_notifications FROM public.settings st WHERE st.account_id = _acc), 'enabled');

  SELECT * INTO _t FROM public.teachers WHERE user_id = _uid AND account_id = _acc LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('kind', 'teacher', 'emails_on', _on,
      'email', (SELECT te.email FROM public.teacher_emails te WHERE te.teacher_id = _t.id));
  END IF;

  SELECT * INTO _s FROM public.students WHERE child_user_id = _uid AND account_id = _acc LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('kind', 'child', 'emails_on', _on, 'email', _s.email, 'student_name', _s.student_name);
  END IF;

  SELECT * INTO _s FROM public.students WHERE user_id = _uid AND account_id = _acc LIMIT 1;
  IF FOUND THEN
    _g := nullif(btrim(coalesce(_s.guardian_name, '')), '');
    IF _g IS NOT NULL AND lower(_g) <> lower(btrim(_s.student_name)) THEN
      RETURN jsonb_build_object('kind', 'guardian', 'emails_on', _on, 'email', _s.guardian_email,
        'guardian_name', _g, 'student_name', _s.student_name, 'student_email', _s.email);
    END IF;
    RETURN jsonb_build_object('kind', 'client', 'emails_on', _on, 'email', _s.email, 'student_name', _s.student_name);
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.my_notification_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_notification_email() TO authenticated;

-- _mine: o e-mail de quem entrou. _student: só no login da família com
-- responsável, o do aluno (nulo = não mexe; vazio = apaga). Vazio apaga.
CREATE OR REPLACE FUNCTION public.save_my_notification_email(_mine text, _student text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _acc uuid := public.current_account_id();
  _m text := nullif(lower(btrim(coalesce(_mine, ''))), '');
  _st text := nullif(lower(btrim(coalesce(_student, ''))), '');
  _info jsonb;
  _tid uuid;
BEGIN
  IF _uid IS NULL OR _acc IS NULL THEN RAISE EXCEPTION 'sem login' USING ERRCODE = '42501'; END IF;
  IF NOT public.email_valid(_m) OR NOT public.email_valid(_st) THEN
    RAISE EXCEPTION 'e-mail inválido' USING ERRCODE = '22023';
  END IF;
  _info := public.my_notification_email();
  IF _info IS NULL THEN RAISE EXCEPTION 'login sem cadastro' USING ERRCODE = 'P0002'; END IF;

  CASE _info ->> 'kind'
    WHEN 'teacher' THEN
      SELECT id INTO _tid FROM public.teachers WHERE user_id = _uid AND account_id = _acc LIMIT 1;
      IF _m IS NULL THEN
        DELETE FROM public.teacher_emails WHERE teacher_id = _tid;
      ELSE
        INSERT INTO public.teacher_emails (teacher_id, account_id, email) VALUES (_tid, _acc, _m)
        ON CONFLICT (teacher_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
      END IF;
    WHEN 'child' THEN
      UPDATE public.students SET email = _m WHERE child_user_id = _uid AND account_id = _acc;
    WHEN 'guardian' THEN
      UPDATE public.students
         SET guardian_email = _m,
             email = CASE WHEN _student IS NULL THEN email ELSE _st END
       WHERE user_id = _uid AND account_id = _acc;
    ELSE
      UPDATE public.students SET email = _m WHERE user_id = _uid AND account_id = _acc;
  END CASE;
  RETURN public.my_notification_email();
END;
$$;
REVOKE ALL ON FUNCTION public.save_my_notification_email(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_notification_email(text, text) TO authenticated;

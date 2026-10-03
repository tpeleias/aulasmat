-- Aviso de primeira entrada (Thiago, 03/10): quem entra sem e-mail para
-- avisos vê, na tela inicial, "Quer receber os lembretes por e-mail?". Só faz
-- sentido se a empresa ligou os e-mails, então a função passa a dizer isso
-- (emails_on). Só acrescenta um campo na resposta.

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
BEGIN
  IF _uid IS NULL OR _acc IS NULL THEN RETURN NULL; END IF;
  _on := public.email_pref((SELECT st.email_notifications FROM public.settings st WHERE st.account_id = _acc), 'enabled');

  SELECT * INTO _t FROM public.teachers WHERE user_id = _uid AND account_id = _acc LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('kind', 'teacher', 'emails_on', _on,
      'email', (SELECT te.email FROM public.teacher_emails te WHERE te.teacher_id = _t.id));
  END IF;

  SELECT * INTO _s FROM public.students WHERE user_id = _uid AND account_id = _acc LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('kind', 'client', 'emails_on', _on, 'email', _s.email,
      'guardian_name', nullif(btrim(coalesce(_s.guardian_name, '')), ''), 'guardian_email', _s.guardian_email);
  END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.my_notification_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_notification_email() TO authenticated;

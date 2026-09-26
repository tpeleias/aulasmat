-- Google Agenda: recusas com chave (hint), para a tela traduzir (Thiago, 26/09).
--
-- As mensagens destas funções saíam só em português, também para empresa em
-- inglês. Agora cada recusa leva uma chave em HINT, como as demais do banco
-- (migration 20260924060000), e src/lib/dbErrors.ts escreve a frase na língua
-- da empresa. O texto da mensagem continua em português, para quem lê o log.

CREATE OR REPLACE FUNCTION public.google_calendar_set(_teacher uuid, _import boolean, _export boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _c public.google_calendar_connections;
BEGIN
  IF NOT public.google_calendar_can_manage(_teacher) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege', HINT = 'google_sem_permissao';
  END IF;
  IF (_import OR _export) AND NOT public.account_can('google_calendar') THEN
    RAISE EXCEPTION 'O Google Agenda faz parte do Pro e do Max.' USING ERRCODE = 'check_violation', HINT = 'plano:google_calendar';
  END IF;
  UPDATE public.google_calendar_connections
     SET import_enabled = _import, export_enabled = _export, updated_at = now()
   WHERE teacher_id = _teacher
  RETURNING * INTO _c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conecte o Google Agenda primeiro.' USING HINT = 'google_conecte_primeiro';
  END IF;
  IF NOT _import THEN
    DELETE FROM public.blocks b USING public.teachers t
     WHERE t.id = _teacher AND b.account_id = t.account_id AND b.source = 'google'
       AND b.teacher = public.teacher_slug(t.name);
  END IF;
  INSERT INTO public.google_sync_queue (teacher_id) VALUES (_teacher) ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.google_calendar_claim_self(_teacher uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _acct uuid := public.current_account_id();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) OR _acct IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege', HINT = 'google_sem_permissao';
  END IF;
  IF _teacher IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.teachers t
        WHERE t.id = _teacher AND t.account_id = _acct AND t.user_id IS NULL
          AND (t.admin_user_id IS NULL OR t.admin_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Esse cadastro não pode ser marcado como seu.'
      USING ERRCODE = 'insufficient_privilege', HINT = 'google_sou_eu_invalido';
  END IF;
  IF EXISTS (SELECT 1 FROM public.teachers t
               JOIN public.google_calendar_connections c ON c.teacher_id = t.id
              WHERE t.admin_user_id = auth.uid() AND t.id IS DISTINCT FROM _teacher) THEN
    RAISE EXCEPTION 'Desconecte o Google do seu cadastro atual antes de trocar.'
      USING ERRCODE = 'check_violation', HINT = 'google_trocar_desconecte';
  END IF;
  UPDATE public.teachers SET admin_user_id = NULL
   WHERE admin_user_id = auth.uid() AND id IS DISTINCT FROM _teacher;
  IF _teacher IS NOT NULL THEN
    UPDATE public.teachers SET admin_user_id = auth.uid() WHERE id = _teacher;
  END IF;
END $$;

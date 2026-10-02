-- Página de horários por empresa (02/10).
--
-- Até aqui a página pública (/disponibilidade) só servia a empresa marcada
-- como is_public_default: sem login, effective_account_id() cai nela. As
-- demais empresas não tinham página, mas o botão "Links de disponibilidade"
-- aparecia para elas, e o link mostrava a agenda da empresa errada.
--
-- Agora a empresa vem no endereço: cronys.com.br/horarios/<empresa>/<profissional>.
-- <empresa> é accounts.slug, o mesmo "código da empresa" que o cliente usa ao
-- criar conta (handle_new_user). Quem tem o link passa a saber o código; com
-- ele só se cria um login de cliente sem cadastro vinculado, que não enxerga
-- nada até a empresa vincular (bloco 53 do espelho confere).
--
-- Uma função só, que devolve tudo o que a página precisa, em vez de abrir as
-- tabelas ao visitante: só horários (sem nomes de cliente), serviços ativos,
-- nome e matéria de quem atende, e o expediente da empresa.

CREATE OR REPLACE FUNCTION public.public_agenda(_account text, _from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _a public.accounts%ROWTYPE;
  _show_price boolean;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from OR _to - _from > interval '15 days' THEN
    RAISE EXCEPTION 'intervalo inválido' USING ERRCODE = '22023';
  END IF;

  -- Sem empresa no endereço (/disponibilidade antigo): como sempre foi, a do
  -- login e, sem login, a do endereço público.
  IF nullif(btrim(coalesce(_account, '')), '') IS NULL THEN
    _id := public.effective_account_id();
  ELSE
    SELECT a.id INTO _id FROM public.accounts a WHERE a.slug = lower(btrim(_account)) AND a.active;
  END IF;
  IF _id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _a FROM public.accounts WHERE id = _id;
  _show_price := coalesce((SELECT st.show_payment_info_to_students FROM public.settings st WHERE st.account_id = _id), false);

  RETURN jsonb_build_object(
    'account', jsonb_build_object(
      'slug', _a.slug, 'name', _a.name, 'locale', _a.locale, 'currency', _a.currency,
      'currency_symbol', _a.currency_symbol, 'business_model', _a.business_model),
    'settings', (SELECT jsonb_build_object(
        'work_start', s.work_start, 'work_end', s.work_end, 'slot_minutes', s.slot_minutes,
        'scarcity', s.scarcity, 'buffer_minutes', s.buffer_minutes)
      FROM public.settings s WHERE s.account_id = _id),
    'services', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', sv.id, 'name', sv.name, 'duration_minutes', sv.duration_minutes,
               'price', CASE WHEN _show_price THEN sv.price END,
               'mode', sv.mode, 'color', sv.color)
             ORDER BY sv.sort_order, sv.created_at)
        FROM public.services sv WHERE sv.account_id = _id AND sv.active), '[]'::jsonb),
    'per_teacher', public.account_can('teacher_services', _id),
    'teachers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', public.teacher_slug(t.name), 'name', t.name, 'subject', t.subject,
               'scarcity', t.scarcity, 'all_services', t.all_services,
               'services', coalesce((SELECT jsonb_agg(ts.service_id) FROM public.teacher_services ts WHERE ts.teacher_id = t.id), '[]'::jsonb))
             ORDER BY t.sort_order, t.name)
        FROM public.teachers t WHERE t.account_id = _id AND t.active), '[]'::jsonb),
    -- Ocupado: atendimento que não foi cancelado nem recusado, e bloqueio pontual
    -- (o "Ocupado (Google)" entra aqui também). Só o horário e de quem é.
    'lessons', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'teacher', l.teacher, 'start_at', l.start_at,
               'end_at', l.start_at + make_interval(mins => l.duration_minutes)))
        FROM public.lessons l
       WHERE l.account_id = _id AND l.status NOT IN ('cancelada', 'recusada')
         AND l.start_at < _to AND l.start_at + make_interval(mins => l.duration_minutes) > _from), '[]'::jsonb),
    'blocks', coalesce((
      SELECT jsonb_agg(jsonb_build_object('teacher', b.teacher, 'start_at', b.start_at, 'end_at', b.end_at))
        FROM public.blocks b
       WHERE b.account_id = _id AND b.block_type = 'one_off'
         AND b.start_at < _to AND b.end_at > _from), '[]'::jsonb),
    'recurring', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'teacher', b.teacher, 'weekday', b.weekday, 'start_time', b.start_time, 'end_time', b.end_time,
               'exceptions', coalesce((SELECT jsonb_agg(e.exception_date) FROM public.block_exceptions e
                                        WHERE e.block_id = b.id AND e.account_id = b.account_id), '[]'::jsonb)))
        FROM public.blocks b WHERE b.account_id = _id AND b.block_type = 'recurring'), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_agenda(text, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.public_agenda(text, timestamptz, timestamptz) TO anon, authenticated;

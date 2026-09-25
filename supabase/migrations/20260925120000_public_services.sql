-- Serviços na página pública de horários (/disponibilidade), que abre sem
-- login. Em vez de abrir as tabelas para o anônimo, uma função devolve só o
-- necessário da empresa da página: os serviços LIGADOS (nome, duração, preço,
-- onde acontece, cor), quem faz cada um e se a empresa usa serviço por
-- profissional (Max). Com login, devolve os da própria empresa.
CREATE OR REPLACE FUNCTION public.public_services()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH acct AS (SELECT public.effective_account_id() AS id)
  SELECT jsonb_build_object(
    'services', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'duration_minutes', s.duration_minutes,
               -- Preço só se a empresa mostra valores à família.
               'price', CASE WHEN coalesce((SELECT st.show_payment_info_to_students FROM public.settings st WHERE st.account_id = acct.id), false)
                             THEN s.price END,
               'mode', s.mode, 'color', s.color)
             ORDER BY s.sort_order, s.created_at)
        FROM public.services s, acct
       WHERE s.account_id = acct.id AND s.active), '[]'::jsonb),
    'per_teacher', public.account_can('teacher_services', (SELECT id FROM acct)),
    -- Só profissionais ativos, pelo apelido usado no endereço da página.
    'teachers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', public.teacher_slug(t.name),
               'all_services', t.all_services,
               'services', coalesce((SELECT jsonb_agg(ts.service_id) FROM public.teacher_services ts WHERE ts.teacher_id = t.id), '[]'::jsonb))
             ORDER BY t.sort_order, t.name)
        FROM public.teachers t, acct
       WHERE t.account_id = acct.id AND t.active), '[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.public_services() FROM public;
GRANT EXECUTE ON FUNCTION public.public_services() TO anon, authenticated;

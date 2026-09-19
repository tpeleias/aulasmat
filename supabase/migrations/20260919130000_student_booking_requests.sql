-- Aula marcada pelo aluno deixa de ser marcação e passa a ser SOLICITAÇÃO:
-- quem decide é o professor.
--
-- Até agora o portal do aluno inseria direto com status 'agendada' e a aula
-- nascia valendo. A regra de que o aluno só pede fica no banco e não na tela,
-- pelo mesmo motivo da trava contra sobreposição: a tela não é por onde todos
-- passam. Um segundo celular, uma chamada direta à API com o token do próprio
-- responsável ou um crawler apertando botões escapariam de uma checagem no
-- frontend - e foi exatamente um crawler que marcou 55 aulas sozinho em 19/09.
--
-- Dois status novos, ao lado de agendada/realizada/cancelada:
--
--   solicitada - o aluno pediu e o professor ainda não respondeu
--   recusada   - o professor disse não
--
-- 'solicitada' OCUPA o horário; 'recusada' não. Ocupar é o que evita duas
-- famílias pedindo o mesmo horário e o professor tendo que recusar uma por
-- conflito. Liberar ao recusar é o mesmo cuidado que a migration
-- 20260912010946 teve com as canceladas: sem isso o horário recusado ficaria
-- queimado para sempre, invisível na vitrine e irrecuperável pela tela.

-- ---------------------------------------------------------------------------
-- 1. A trava contra sobreposição passa a ignorar as recusadas
-- ---------------------------------------------------------------------------
-- Recriada inteira (DROP + ADD) porque EXCLUDE não tem ALTER e ADD CONSTRAINT
-- não tem IF NOT EXISTS - assim a migration continua podendo rodar de novo
-- depois de uma interrupção.

ALTER TABLE public.lessons
  DROP CONSTRAINT IF EXISTS lessons_sem_sobreposicao;

ALTER TABLE public.lessons
  ADD CONSTRAINT lessons_sem_sobreposicao
  EXCLUDE USING gist (
    account_id WITH =,
    teacher WITH =,
    public.lesson_span(start_at, duration_minutes) WITH &&
  ) WHERE (status NOT IN ('cancelada', 'recusada'));

COMMENT ON CONSTRAINT lessons_sem_sobreposicao ON public.lessons IS
  'Impede duas aulas no mesmo horário do mesmo professor dentro da mesma empresa. Canceladas e recusadas não contam; uma solicitação pendente conta, para duas famílias não pedirem o mesmo horário.';

-- ---------------------------------------------------------------------------
-- 2. Horário recusado volta para a vitrine
-- ---------------------------------------------------------------------------
-- As duas funções abaixo alimentam a página pública, a página de
-- disponibilidade e o portal do aluno. Se a recusada continuasse contando como
-- ocupada, recusar seria o mesmo que bloquear o horário.

CREATE OR REPLACE FUNCTION public.get_busy_ranges(_from timestamp with time zone, _to timestamp with time zone)
RETURNS TABLE(start_at timestamp with time zone, end_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.start_at, l.start_at + (l.duration_minutes || ' minutes')::interval
  FROM public.lessons l
  WHERE l.account_id = public.effective_account_id()
    AND l.status NOT IN ('cancelada', 'recusada')
    AND l.start_at < _to
    AND l.start_at + (l.duration_minutes || ' minutes')::interval > _from
  UNION ALL
  SELECT b.start_at, b.end_at FROM public.blocks b
  WHERE b.account_id = public.effective_account_id()
    AND b.block_type = 'one_off' AND b.start_at < _to AND b.end_at > _from
$$;

CREATE OR REPLACE FUNCTION public.get_busy_ranges_by_teacher(_from timestamp with time zone, _to timestamp with time zone, _teacher text)
RETURNS TABLE(start_at timestamp with time zone, end_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.start_at, l.start_at + (l.duration_minutes || ' minutes')::interval
  FROM public.lessons l
  WHERE l.account_id = public.effective_account_id()
    AND l.teacher = _teacher
    AND l.status NOT IN ('cancelada', 'recusada')
    AND l.start_at < _to
    AND l.start_at + (l.duration_minutes || ' minutes')::interval > _from
  UNION ALL
  SELECT b.start_at, b.end_at FROM public.blocks b
  WHERE b.account_id = public.effective_account_id()
    AND b.block_type = 'one_off'
    AND (b.teacher = _teacher OR b.teacher = 'both')
    AND b.start_at < _to AND b.end_at > _from
$$;

-- ---------------------------------------------------------------------------
-- 3. O aluno só consegue inserir como solicitada
-- ---------------------------------------------------------------------------
-- Esta é a trava que faz a aprovação valer. Sem o `status = 'solicitada'` no
-- WITH CHECK, a exigência de aprovação existiria só no código da tela: quem
-- chamasse a API direto continuaria criando aula pronta, e a mudança toda seria
-- enfeite.

DROP POLICY IF EXISTS "students insert own lessons" ON public.lessons;
CREATE POLICY "students insert own lessons" ON public.lessons
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = public.current_account_id()
    AND public.student_account_matches(student_name, guardian_name)
    AND status = 'solicitada'
    AND EXISTS (
      SELECT 1 FROM public.settings s
       WHERE s.account_id = public.current_account_id()
         AND s.allow_student_booking = true
    )
  );

-- Nada de novo para o UPDATE: o aluno nunca teve política de UPDATE em lessons,
-- então não consegue promover o próprio pedido a 'agendada'. Conferido em
-- pg_policy: as únicas políticas da tabela são 'admins manage lessons' (ALL),
-- 'students read own lessons' (SELECT) e esta.

-- ---------------------------------------------------------------------------
-- 4. O que deliberadamente NÃO muda
-- ---------------------------------------------------------------------------
-- mark_past_lessons_realizada() fecha só o que está em 'agendada'. Isso já
-- estava certo e agora virou essencial: um pedido que o professor não respondeu
-- e cuja hora passou continua 'solicitada' em vez de virar aula realizada - e
-- aula realizada é cobrança, porque sync_lesson_wallet lança a dívida no
-- 'realizada'. Se algum dia essa função passar a varrer outros status, o pedido
-- não respondido vira dinheiro cobrado de uma aula que não houve.
--
-- sync_lesson_wallet() também só mexe na carteira quando o status é
-- 'realizada', então solicitar e aprovar não lançam nada. Aprovar é
-- solicitada -> agendada, e a cobrança continua nascendo só quando a aula
-- acontece.

-- Duas aulas não podem ocupar o mesmo horário do mesmo professor.
--
-- Até agora nada impedia isso: a tabela lessons só tinha chave primária. O robô
-- de pré-lançamento do Google marcou o mesmo horário duas vezes com 3 segundos
-- de diferença, porque no portal do aluno o botão volta a funcionar antes de a
-- lista recarregar. Só que esconder o horário na tela não é trava: quem chega
-- pela tela de admin, pelo assistente de IA ou por dois celulares ao mesmo
-- tempo passa por fora. Por isso a regra fica no banco, que é o único ponto por
-- onde todos passam.
--
-- Aula cancelada não ocupa horário, então fica de fora da regra - senão um
-- horário cancelado ficaria queimado para sempre.
--
-- Verificado na produção antes de aplicar: nenhuma aula sobreposta existia.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Por que esta função existe em vez de a expressão ir direto na constraint:
-- `timestamptz + interval` é STABLE, e índice exige IMMUTABLE. Ele é STABLE
-- porque intervalos com meses ou dias dependem do fuso da sessão (somar "1 dia"
-- numa virada de horário de verão não dá 24h). Aqui só entram MINUTOS, que são
-- deslocamento absoluto e dão o mesmo instante em qualquer fuso - conferido em
-- UTC, São Paulo, Nova York, Calcutá e Chatham, inclusive atravessando uma
-- virada de horário de verão. Por isso o IMMUTABLE é honesto.
--
-- Cuidado ao mexer: se um dia a duração passar a ser contada em dias ou meses,
-- esta função deixa de poder ser IMMUTABLE e o índice silenciosamente apodrece.
CREATE OR REPLACE FUNCTION public.lesson_span(_start timestamptz, _minutes integer)
RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT tstzrange(_start, _start + make_interval(mins => coalesce(_minutes, 60)))
$$;

ALTER TABLE public.lessons
  DROP CONSTRAINT IF EXISTS lessons_sem_sobreposicao;

ALTER TABLE public.lessons
  ADD CONSTRAINT lessons_sem_sobreposicao
  EXCLUDE USING gist (
    account_id WITH =,
    teacher WITH =,
    public.lesson_span(start_at, duration_minutes) WITH &&
  ) WHERE (status <> 'cancelada');

COMMENT ON CONSTRAINT lessons_sem_sobreposicao ON public.lessons IS
  'Impede duas aulas no mesmo horário do mesmo professor dentro da mesma empresa. Canceladas não contam.';

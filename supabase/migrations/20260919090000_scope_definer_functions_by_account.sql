-- Multi-empresa, parte 2: as rotinas que ignoram as regras de acesso.
--
-- Funções SECURITY DEFINER rodam com os poderes de quem as criou, não de quem
-- as chama - é justamente por isso que existem. O efeito colateral é que as
-- políticas de acesso por empresa não valem dentro delas: cada consulta aqui
-- precisa dizer de qual empresa é, na mão.
--
-- Das 17 funções desse tipo, uma varredura mostrou que 9 leem ou escrevem em
-- tabelas marcadas por empresa sem filtrar por ela. Três já foram corrigidas
-- antes (log_lesson_audit, sync_lesson_wallet, register_payment); estas são as
-- outras. mark_past_lessons_realizada fica de fora de propósito: ela roda por
-- agendamento e marcar como realizada as aulas passadas vale para todas as
-- empresas igualmente.

-- A empresa "em vigor" para quem está lendo: a de quem está logado, ou a dona
-- do endereço quando ninguém está logado (a página pública de horários é aberta).
CREATE OR REPLACE FUNCTION public.effective_account_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(public.current_account_id(), public.public_account_id())
$$;

REVOKE ALL ON FUNCTION public.effective_account_id() FROM public;
GRANT EXECUTE ON FUNCTION public.effective_account_id() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Identificação de aluno e responsável
-- ---------------------------------------------------------------------------

-- A mais importante do arquivo: é ela que decide se um aluno pode ver uma aula.
-- Casava só por nome+responsável, então a "Maria Silva" de uma empresa passaria
-- a enxergar a agenda e o financeiro da "Maria Silva" de outra - o mesmo bug
-- que a migration de setembro consertou entre alunos da mesma empresa.
CREATE OR REPLACE FUNCTION public.student_account_matches(
  _student_name text, _guardian_name text, _child boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE (CASE WHEN _child THEN s.child_user_id ELSE s.user_id END) = auth.uid()
      AND s.account_id = public.current_account_id()
      AND lower(btrim(s.student_name)) = lower(btrim(_student_name))
      AND coalesce(nullif(btrim(s.guardian_name), ''), '')
          = coalesce(nullif(btrim(_guardian_name), ''), '')
  )
$$;

CREATE OR REPLACE FUNCTION public.current_student()
RETURNS students
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.students
   WHERE user_id = auth.uid() AND account_id = public.current_account_id()
   LIMIT 1
$$;

-- O vínculo entre aula e aluno aqui é por nome. Sem exigir a mesma empresa nos
-- dois lados, o filho de uma empresa receberia as aulas do xará de outra.
CREATE OR REPLACE FUNCTION public.get_child_lessons()
RETURNS TABLE(id uuid, start_at timestamp with time zone, subject text, duration_minutes integer, teacher text, status text, class_summary text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.id, l.start_at, l.subject, l.duration_minutes, l.teacher, l.status, l.class_summary
  FROM public.lessons l
  JOIN public.students s
    ON s.account_id = l.account_id
   AND lower(btrim(s.student_name)) = lower(btrim(l.student_name))
   AND coalesce(nullif(btrim(s.guardian_name), ''), '')
       = coalesce(nullif(btrim(l.guardian_name), ''), '')
  WHERE s.child_user_id = auth.uid()
    AND s.account_id = public.current_account_id()
  ORDER BY l.start_at DESC;
$$;

-- ---------------------------------------------------------------------------
-- Horários ocupados e bloqueios (usados também pela página pública, sem login)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_busy_ranges(_from timestamp with time zone, _to timestamp with time zone)
RETURNS TABLE(start_at timestamp with time zone, end_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.start_at, l.start_at + (l.duration_minutes || ' minutes')::interval
  FROM public.lessons l
  WHERE l.account_id = public.effective_account_id()
    AND l.status <> 'cancelada'
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
    AND l.status <> 'cancelada'
    AND l.start_at < _to
    AND l.start_at + (l.duration_minutes || ' minutes')::interval > _from
  UNION ALL
  SELECT b.start_at, b.end_at FROM public.blocks b
  WHERE b.account_id = public.effective_account_id()
    AND b.block_type = 'one_off'
    AND (b.teacher = _teacher OR b.teacher = 'both')
    AND b.start_at < _to AND b.end_at > _from
$$;

CREATE OR REPLACE FUNCTION public.get_recurring_blocks()
RETURNS TABLE(weekday integer, start_time time without time zone, end_time time without time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT b.weekday, b.start_time, b.end_time FROM public.blocks b
  WHERE b.account_id = public.effective_account_id() AND b.block_type = 'recurring'
$$;

CREATE OR REPLACE FUNCTION public.get_recurring_blocks_by_teacher(_teacher text)
RETURNS TABLE(id uuid, weekday integer, start_time time without time zone, end_time time without time zone, exceptions date[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT b.id, b.weekday, b.start_time, b.end_time,
    COALESCE(ARRAY(
      SELECT e.exception_date FROM public.block_exceptions e
       WHERE e.block_id = b.id AND e.account_id = b.account_id
    ), ARRAY[]::date[])
  FROM public.blocks b
  WHERE b.account_id = public.effective_account_id()
    AND b.block_type = 'recurring' AND (b.teacher = _teacher OR b.teacher = 'both')
$$;

CREATE OR REPLACE FUNCTION public.get_recurring_blocks_v2()
RETURNS TABLE(id uuid, weekday integer, start_time time without time zone, end_time time without time zone, exceptions date[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT b.id, b.weekday, b.start_time, b.end_time,
    COALESCE(ARRAY(
      SELECT e.exception_date FROM public.block_exceptions e
       WHERE e.block_id = b.id AND e.account_id = b.account_id
    ), ARRAY[]::date[])
  FROM public.blocks b
  WHERE b.account_id = public.effective_account_id() AND b.block_type = 'recurring'
$$;

-- ---------------------------------------------------------------------------
-- Recálculo de quem está devendo
-- ---------------------------------------------------------------------------

-- Casa lançamentos e aulas por nome+responsável. Sem empresa, recalcularia a
-- carteira de um xará em outra empresa - mexendo em dinheiro alheio.
-- Só é chamada pelos gatilhos abaixo, que sabem a empresa da linha que mudou.
DROP FUNCTION IF EXISTS public.recompute_payment_status(text, text);

CREATE OR REPLACE FUNCTION public.recompute_payment_status(_student text, _guardian text, _account uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := lower(btrim(coalesce(_student, '')));
  _acct uuid := coalesce(_account, public.current_account_id());
  _pool numeric;
BEGIN
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'account is required';
  END IF;

  PERFORM set_config('app.recompute_payment_status', '1', true);

  SELECT coalesce(sum(w.amount), 0) INTO _pool
  FROM public.wallet_transactions w
  WHERE w.account_id = _acct
    AND w.amount > 0
    AND ((_g IS NOT NULL AND lower(btrim(coalesce(w.guardian_name, ''))) = lower(_g))
      OR (_g IS NULL AND nullif(btrim(coalesce(w.guardian_name, '')), '') IS NULL AND lower(btrim(w.student_name)) = _s));

  WITH charges AS (
    SELECT w.lesson_id,
           sum(-w.amount) OVER (ORDER BY coalesce(l.start_at, w.created_at), w.id
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado
    FROM public.wallet_transactions w
    LEFT JOIN public.lessons l ON l.id = w.lesson_id
    WHERE w.account_id = _acct
      AND w.amount < 0
      AND ((_g IS NOT NULL AND lower(btrim(coalesce(w.guardian_name, ''))) = lower(_g))
        OR (_g IS NULL AND nullif(btrim(coalesce(w.guardian_name, '')), '') IS NULL AND lower(btrim(w.student_name)) = _s))
  ),
  computed AS (
    SELECT lesson_id, CASE WHEN acumulado <= _pool + 0.005 THEN 'pago' ELSE 'pendente' END AS st
    FROM charges WHERE lesson_id IS NOT NULL
  )
  UPDATE public.lessons l SET payment_status = c.st
  FROM computed c
  WHERE l.id = c.lesson_id AND l.account_id = _acct AND l.payment_status IS DISTINCT FROM c.st;

  -- Aulas desta conta que ainda não têm cobrança (não realizadas, ou canceladas) ficam pendentes.
  UPDATE public.lessons l SET payment_status = 'pendente'
  WHERE l.account_id = _acct
    AND l.payment_status <> 'pendente'
    AND ((_g IS NOT NULL AND lower(btrim(coalesce(l.guardian_name, ''))) = lower(_g))
      OR (_g IS NULL AND nullif(btrim(coalesce(l.guardian_name, '')), '') IS NULL AND lower(btrim(l.student_name)) = _s))
    AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions w WHERE w.lesson_id = l.id AND w.amount < 0);

  PERFORM set_config('app.recompute_payment_status', '', true);
END;
$function$;

-- Estava trancada para o dono do banco (só os gatilhos a usam); segue assim.
REVOKE ALL ON FUNCTION public.recompute_payment_status(text, text, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_recompute_from_lesson()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.recompute_payment_status(NEW.student_name, NEW.guardian_name, NEW.account_id);
  IF TG_OP = 'UPDATE' AND (OLD.student_name IS DISTINCT FROM NEW.student_name
                           OR OLD.guardian_name IS DISTINCT FROM NEW.guardian_name) THEN
    PERFORM public.recompute_payment_status(OLD.student_name, OLD.guardian_name, OLD.account_id);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_recompute_from_wallet()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recompute_payment_status(NEW.student_name, NEW.guardian_name, NEW.account_id);
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM public.recompute_payment_status(OLD.student_name, OLD.guardian_name, OLD.account_id);
  END IF;
  RETURN NULL;
END;
$function$;

-- lessons.payment_status used to be a hand-set flag that could say "pago" while the wallet
-- held no money for it. It is now a cache of the ledger: money received pays the account's
-- oldest charges first, and a lesson is "pago" once its charge is fully covered.
-- (The pre-migration flags were preserved in lessons_payment_status_backup_20260912.)

CREATE OR REPLACE FUNCTION public.recompute_payment_status(_student text, _guardian text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := lower(btrim(coalesce(_student, '')));
  _pool numeric;
BEGIN
  PERFORM set_config('app.recompute_payment_status', '1', true);

  SELECT coalesce(sum(w.amount), 0) INTO _pool
  FROM public.wallet_transactions w
  WHERE w.amount > 0
    AND ((_g IS NOT NULL AND lower(btrim(coalesce(w.guardian_name, ''))) = lower(_g))
      OR (_g IS NULL AND nullif(btrim(coalesce(w.guardian_name, '')), '') IS NULL AND lower(btrim(w.student_name)) = _s));

  WITH charges AS (
    SELECT w.lesson_id,
           sum(-w.amount) OVER (ORDER BY coalesce(l.start_at, w.created_at), w.id
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado
    FROM public.wallet_transactions w
    LEFT JOIN public.lessons l ON l.id = w.lesson_id
    WHERE w.amount < 0
      AND ((_g IS NOT NULL AND lower(btrim(coalesce(w.guardian_name, ''))) = lower(_g))
        OR (_g IS NULL AND nullif(btrim(coalesce(w.guardian_name, '')), '') IS NULL AND lower(btrim(w.student_name)) = _s))
  ),
  computed AS (
    SELECT lesson_id, CASE WHEN acumulado <= _pool + 0.005 THEN 'pago' ELSE 'pendente' END AS st
    FROM charges WHERE lesson_id IS NOT NULL
  )
  UPDATE public.lessons l SET payment_status = c.st
  FROM computed c
  WHERE l.id = c.lesson_id AND l.payment_status IS DISTINCT FROM c.st;

  -- Lessons of this account that have no charge yet (not realized, or cancelled) are pending.
  UPDATE public.lessons l SET payment_status = 'pendente'
  WHERE l.payment_status <> 'pendente'
    AND ((_g IS NOT NULL AND lower(btrim(coalesce(l.guardian_name, ''))) = lower(_g))
      OR (_g IS NULL AND nullif(btrim(coalesce(l.guardian_name, '')), '') IS NULL AND lower(btrim(l.student_name)) = _s))
    AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions w WHERE w.lesson_id = l.id AND w.amount < 0);

  PERFORM set_config('app.recompute_payment_status', '', true);
END;
$$;

-- Clients can no longer set the flag by hand; only the recompute path may change it.
CREATE OR REPLACE FUNCTION public.protect_payment_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('app.recompute_payment_status', true), '') <> '1' THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.payment_status := OLD.payment_status;
    ELSE
      NEW.payment_status := 'pendente';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lessons_protect_payment_status ON public.lessons;
CREATE TRIGGER lessons_protect_payment_status
  BEFORE INSERT OR UPDATE OF payment_status ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.protect_payment_status();

CREATE OR REPLACE FUNCTION public.trg_recompute_from_wallet()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recompute_payment_status(NEW.student_name, NEW.guardian_name);
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM public.recompute_payment_status(OLD.student_name, OLD.guardian_name);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS wallet_recompute_payment_status ON public.wallet_transactions;
CREATE TRIGGER wallet_recompute_payment_status
  AFTER INSERT OR UPDATE OR DELETE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_from_wallet();

CREATE OR REPLACE FUNCTION public.trg_recompute_from_lesson()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recompute_payment_status(NEW.student_name, NEW.guardian_name);
  IF TG_OP = 'UPDATE' AND (OLD.student_name IS DISTINCT FROM NEW.student_name
                           OR OLD.guardian_name IS DISTINCT FROM NEW.guardian_name) THEN
    PERFORM public.recompute_payment_status(OLD.student_name, OLD.guardian_name);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS lessons_recompute_payment_status ON public.lessons;
CREATE TRIGGER lessons_recompute_payment_status
  AFTER INSERT OR UPDATE OF status, price, duration_minutes, start_at, student_name, guardian_name ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_from_lesson();

REVOKE EXECUTE ON FUNCTION public.recompute_payment_status(text, text) FROM anon, authenticated;

-- Backfill every account from the ledger.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT student_name, guardian_name FROM public.lessons LOOP
    PERFORM public.recompute_payment_status(r.student_name, r.guardian_name);
  END LOOP;
END $$;

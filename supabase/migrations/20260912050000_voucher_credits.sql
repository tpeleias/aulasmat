-- Package discounts as vouchers.
--
-- Every lesson is charged at the list price (R$220/h). When a family buys a package the
-- money received is registered as usual (R$2.000 for 10 lessons, R$1.050 for 5) plus a
-- voucher credit for the discount (R$200 / R$50), so 10 x R$220 = R$2.200 is matched by
-- R$2.000 + R$200 and the account closes at exactly zero. Vouchers can also be issued by
-- hand for courtesy discounts; a voucher is always a credit, never a charge.
--
-- This replaces the short-lived "account plan / repricing" approach (migration
-- 20260912040000, never released), which rewrote lessons.price instead.

DROP TRIGGER IF EXISTS lessons_default_price_from_plan ON public.lessons;
DROP FUNCTION IF EXISTS public.default_lesson_price_from_plan();
DROP FUNCTION IF EXISTS public.apply_account_plan(text, text, text, numeric);
ALTER TABLE public.lessons ALTER COLUMN price SET DEFAULT 220.00;
ALTER TABLE public.lessons ALTER COLUMN package_type SET DEFAULT 'single';
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_package_type_check;
ALTER TABLE public.students DROP COLUMN IF EXISTS package_type;
ALTER TABLE public.students DROP COLUMN IF EXISTS hourly_rate;

ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_kind_check
  CHECK (kind IN ('package', 'lesson', 'adjustment', 'voucher'));

-- A voucher only ever adds credit.
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_voucher_positive;
ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_voucher_positive
  CHECK (kind <> 'voucher' OR amount > 0);

-- Money + voucher land together or not at all, so a package can never be half-registered.
CREATE OR REPLACE FUNCTION public.register_payment(
  _student text,
  _guardian text,
  _amount numeric,
  _kind text DEFAULT 'adjustment',
  _description text DEFAULT NULL,
  _voucher numeric DEFAULT 0,
  _voucher_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := btrim(coalesce(_student, ''));
  _payment_id uuid;
  _voucher_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR current_user IN ('postgres', 'service_role', 'supabase_admin')
          OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _s = '' THEN
    RAISE EXCEPTION 'student_name is required';
  END IF;
  IF _kind NOT IN ('package', 'adjustment', 'voucher') THEN
    RAISE EXCEPTION 'invalid kind %', _kind;
  END IF;
  IF coalesce(_amount, 0) = 0 AND coalesce(_voucher, 0) = 0 THEN
    RAISE EXCEPTION 'nothing to register';
  END IF;
  IF coalesce(_voucher, 0) < 0 THEN
    RAISE EXCEPTION 'voucher must be positive';
  END IF;

  IF coalesce(_amount, 0) <> 0 THEN
    INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description)
    VALUES (_s, _g, _amount, CASE WHEN _amount < 0 THEN 'adjustment' ELSE _kind END,
            nullif(btrim(coalesce(_description, '')), ''))
    RETURNING id INTO _payment_id;
  END IF;

  IF coalesce(_voucher, 0) > 0 THEN
    INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description)
    VALUES (_s, _g, _voucher, 'voucher',
            coalesce(nullif(btrim(coalesce(_voucher_description, '')), ''), 'Voucher'))
    RETURNING id INTO _voucher_id;
  END IF;

  RETURN jsonb_build_object('payment_id', _payment_id, 'voucher_id', _voucher_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_payment(text, text, numeric, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_payment(text, text, numeric, text, text, numeric, text) TO authenticated, service_role;

-- One-time alignment of the accounts that already had a package: their scheduled lessons
-- were still priced at the old package rate (R$200 / R$210). They go back to the list price
-- and receive a voucher for exactly the difference, so nobody ends up owing more than agreed.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT guardian_name AS g, student_name AS s,
           sum(round((220 - price) * duration_minutes / 60.0, 2)) AS delta
    FROM public.lessons
    WHERE status = 'agendada' AND price <> 220
    GROUP BY 1, 2
  LOOP
    INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description)
    VALUES (r.s, nullif(btrim(coalesce(r.g, '')), ''), r.delta, 'voucher',
            'Voucher de ajuste: pacote já pago, aulas repostas a R$220/h');

    UPDATE public.lessons
    SET price = 220
    WHERE status = 'agendada' AND price <> 220
      AND student_name = r.s
      AND coalesce(guardian_name, '') = coalesce(r.g, '');
  END LOOP;
END $$;

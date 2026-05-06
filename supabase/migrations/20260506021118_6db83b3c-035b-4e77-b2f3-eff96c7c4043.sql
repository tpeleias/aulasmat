
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_name text,
  student_name text NOT NULL,
  amount numeric NOT NULL,
  kind text NOT NULL CHECK (kind IN ('package','lesson','adjustment')),
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wallet_guardian ON public.wallet_transactions (guardian_name, student_name);
CREATE INDEX idx_wallet_lesson ON public.wallet_transactions (lesson_id);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage wallet_transactions"
  ON public.wallet_transactions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger: keep a "lesson" debit transaction in sync with each lesson
CREATE OR REPLACE FUNCTION public.sync_lesson_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description)
    VALUES (NULLIF(trim(NEW.guardian_name), ''), NEW.student_name, -NEW.price, 'lesson', NEW.id,
            'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.wallet_transactions
    SET amount = -NEW.price,
        guardian_name = NULLIF(trim(NEW.guardian_name), ''),
        student_name = NEW.student_name,
        description = 'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
    WHERE lesson_id = NEW.id AND kind = 'lesson';
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER lessons_wallet_sync
AFTER INSERT OR UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.sync_lesson_wallet();

-- Backfill: create lesson debit transactions for existing lessons
INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description)
SELECT NULLIF(trim(l.guardian_name), ''), l.student_name, -l.price, 'lesson', l.id,
       'Aula em ' || to_char(l.start_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
FROM public.lessons l
WHERE NOT EXISTS (
  SELECT 1 FROM public.wallet_transactions w WHERE w.lesson_id = l.id AND w.kind = 'lesson'
);

-- Backfill: convert lessons already marked 'pago' into a positive credit so balance is 0 for those
INSERT INTO public.wallet_transactions (guardian_name, student_name, amount, kind, lesson_id, description)
SELECT NULLIF(trim(l.guardian_name), ''), l.student_name, l.price, 'adjustment', NULL,
       'Crédito retroativo (aula já paga em ' || to_char(l.start_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM') || ')'
FROM public.lessons l
WHERE l.payment_status = 'pago';

-- Três pedidos do Thiago (24/09, fim do dia):
--   1. A Demonstração (conta do revisor da Play) com tudo liberado para sempre,
--      como o Portal de Aulas.
--   2. Falta cobrada: cada empresa decide se cobra quem desmarca em cima da
--      hora (ou não aparece), com quantas horas de antecedência e quanto.
--   3. Pacotes de cada empresa: nome, quantidade e preço, criados, editados e
--      apagados por ela - no lugar dos dois botões cravados no código.

-- ---------------------------------------------------------------------------
-- 1. Demonstração para sempre
-- ---------------------------------------------------------------------------

UPDATE public.accounts SET lifetime = true WHERE slug = 'demo';
SELECT public.apply_plan_locks(id) FROM public.accounts WHERE slug = 'demo';

-- ---------------------------------------------------------------------------
-- 2. Falta cobrada
-- ---------------------------------------------------------------------------
-- Desligada por padrão: ninguém passa a ser cobrado sem a empresa escolher.
-- Cobrar uma falta é marcar a aula como 'realizada' - é assim que ela vira
-- cobrança (sync_lesson_wallet) e entra no recibo e no resumo do mês, sem
-- conta paralela - com a marca absence_charged para a tela dizer "falta", e
-- com o valor da hora reduzido à porcentagem que a empresa escolheu.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS charge_absence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS absence_notice_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS absence_charge_percent integer NOT NULL DEFAULT 100;

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_absence_ranges;
ALTER TABLE public.settings
  ADD CONSTRAINT settings_absence_ranges
  CHECK (absence_notice_hours BETWEEN 0 AND 168 AND absence_charge_percent BETWEEN 1 AND 100);

COMMENT ON COLUMN public.settings.charge_absence IS
  'A empresa cobra falta e desmarcação em cima da hora (absence_notice_hours antes), a absence_charge_percent do valor.';

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS absence_charged boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lessons.absence_charged IS
  'Falta cobrada: a aula não aconteceu, mas vale como realizada para a cobrança (charge_lesson_absence).';

-- A porta única para cobrar uma falta. Só o admin da empresa (dinheiro é da
-- escola; o login de professor não mexe em valor), só com a política ligada,
-- e só numa aula ainda marcada ou desmarcada - nunca em pedido, recusada ou
-- já realizada.
CREATE OR REPLACE FUNCTION public.charge_lesson_absence(_lesson uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _pct int;
  _row public.lessons;
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT absence_charge_percent INTO _pct FROM public.settings
   WHERE account_id = _acct AND charge_absence;
  IF _pct IS NULL THEN
    RAISE EXCEPTION 'A cobrança de falta está desligada nas configurações.'
      USING ERRCODE = 'check_violation', HINT = 'falta_desligada';
  END IF;

  UPDATE public.lessons l
     SET status = 'realizada',
         absence_charged = true,
         price = round(l.price * _pct / 100.0, 2),
         class_summary = coalesce(nullif(btrim(l.class_summary), ''), 'Falta')
   WHERE l.id = _lesson
     AND l.account_id = _acct
     AND l.status IN ('agendada', 'cancelada')
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Só dá para cobrar falta de uma aula marcada ou desmarcada.'
      USING ERRCODE = 'check_violation', HINT = 'falta_status';
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'price', _row.price, 'percent', _pct);
END;
$$;

REVOKE ALL ON FUNCTION public.charge_lesson_absence(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.charge_lesson_absence(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pacotes de cada empresa
-- ---------------------------------------------------------------------------
-- Um pacote é "N aulas por R$ X". O desconto não mexe no valor da aula: na
-- hora de registrar, a tela lança o dinheiro e um voucher com a diferença
-- (N x valor da hora da empresa - X), como os botões antigos faziam. Por isso
-- aqui só se guarda o que a empresa combinou; o voucher é conta da hora.

CREATE TABLE IF NOT EXISTS public.lesson_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL DEFAULT public.current_account_id() REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  lessons integer NOT NULL CHECK (lessons BETWEEN 1 AND 200),
  price numeric(10,2) NOT NULL CHECK (price > 0),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_packages_account_idx ON public.lesson_packages (account_id, sort_order);

ALTER TABLE public.lesson_packages ENABLE ROW LEVEL SECURITY;

-- Só o admin da própria empresa lê e mexe. Família e professor não precisam
-- ver a tabela de preços.
DROP POLICY IF EXISTS "admins manage own packages" ON public.lesson_packages;
CREATE POLICY "admins manage own packages" ON public.lesson_packages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id());

REVOKE ALL ON public.lesson_packages FROM anon;

-- Pacote é do Pro (plan_features.packages): no Essencial não se cria nem se
-- liga um. Os que existirem ficam guardados, só não são oferecidos.
CREATE OR REPLACE FUNCTION public.enforce_package_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.active AND NOT public.account_can('packages', NEW.account_id) THEN
    RAISE EXCEPTION 'Pacotes são do Cronys Pro.'
      USING ERRCODE = 'check_violation', HINT = 'pacote_pro';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_package_plan() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS lesson_packages_plan ON public.lesson_packages;
CREATE TRIGGER lesson_packages_plan
  BEFORE INSERT OR UPDATE ON public.lesson_packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_package_plan();

-- Os dois pacotes que estavam no código passam a ser do Portal de Aulas (é
-- onde foram combinados) e da Demonstração (para o revisor ver a função).
INSERT INTO public.lesson_packages (account_id, name, lessons, price, sort_order)
SELECT a.id, p.name, p.lessons, p.price, p.sort_order
  FROM public.accounts a
 CROSS JOIN (VALUES ('Pacote 10 aulas', 10, 2000.00, 1), ('Pacote 5 aulas', 5, 1050.00, 2)) AS p(name, lessons, price, sort_order)
 WHERE a.slug IN ('portaldeaulas', 'demo')
   AND NOT EXISTS (SELECT 1 FROM public.lesson_packages x WHERE x.account_id = a.id);

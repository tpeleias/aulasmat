-- Serviços (Thiago, 25/09):
--   - A empresa cadastra os serviços que oferece, cada um com duração, preço
--     (por atendimento) e cor.
--   - Cada profissional faz todos (a etiqueta "faz todos os serviços", padrão)
--     ou só os escolhidos.
--   - A família escolhe o serviço e só vê quem faz aquele serviço, ou pede
--     "qualquer profissional": o app escolhe o primeiro livre na lista de
--     prioridade que o admin montou (teachers.sort_order).
--   - Cada profissional tem uma cor escolhida pelo admin na agenda.
-- Planos: Essencial = 1 serviço; Pro = vários serviços; Max = Pro + serviços
-- por profissional + "qualquer profissional".

-- ---------------------------------------------------------------------------
-- Cores que o app sabe pintar (src/lib/teacherColors.ts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_palette_color(_c text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT _c IS NULL OR _c IN ('azul', 'rosa', 'verde', 'ambar', 'ceu', 'violeta', 'vermelho', 'laranja', 'turquesa', 'cinza')
$$;

-- ---------------------------------------------------------------------------
-- Serviços
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL DEFAULT public.current_account_id() REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 600),
  -- Preço do atendimento inteiro (não por hora). Nulo = o preço padrão da empresa.
  price numeric(10,2) CHECK (price IS NULL OR price >= 0),
  -- presencial | online | ambos
  mode text NOT NULL DEFAULT 'ambos' CHECK (mode IN ('presencial', 'online', 'ambos')),
  color text CHECK (public.is_palette_color(color)),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS services_account_idx ON public.services (account_id, sort_order);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Todos da empresa leem (a família escolhe o serviço no pedido); só o admin mexe.
DROP POLICY IF EXISTS "account reads services" ON public.services;
CREATE POLICY "account reads services" ON public.services
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id());
DROP POLICY IF EXISTS "admins manage services" ON public.services;
CREATE POLICY "admins manage services" ON public.services
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id())
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id());

REVOKE ALL ON public.services FROM anon;

-- Essencial: um serviço ativo. Os outros ficam guardados, desligados.
CREATE OR REPLACE FUNCTION public.enforce_services_plan()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.active AND NOT public.account_can('services_multi', NEW.account_id) AND EXISTS (
    SELECT 1 FROM public.services s
     WHERE s.account_id = NEW.account_id AND s.active AND s.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'No Cronys Essencial é um serviço. Vários serviços são do Cronys Pro.'
      USING ERRCODE = 'check_violation', HINT = 'servicos_pro';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_services_plan() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS services_plan ON public.services;
CREATE TRIGGER services_plan
  BEFORE INSERT OR UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.enforce_services_plan();

-- ---------------------------------------------------------------------------
-- O que cada profissional faz
-- ---------------------------------------------------------------------------
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS all_services boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE public.teachers DROP CONSTRAINT IF EXISTS teachers_color_palette;
ALTER TABLE public.teachers ADD CONSTRAINT teachers_color_palette CHECK (public.is_palette_color(color));

COMMENT ON COLUMN public.teachers.all_services IS
  'Etiqueta "faz todos os serviços". Desligada, vale a lista em teacher_services.';
COMMENT ON COLUMN public.teachers.color IS
  'Cor na agenda, escolhida pelo admin (paleta de is_palette_color). Nula = pela posição.';
COMMENT ON COLUMN public.teachers.sort_order IS
  'Ordem da lista e prioridade no pedido de "qualquer profissional" (menor primeiro).';

CREATE TABLE IF NOT EXISTS public.teacher_services (
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  account_id uuid NOT NULL DEFAULT public.current_account_id() REFERENCES public.accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, service_id)
);

CREATE INDEX IF NOT EXISTS teacher_services_account_idx ON public.teacher_services (account_id);

ALTER TABLE public.teacher_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account reads teacher_services" ON public.teacher_services;
CREATE POLICY "account reads teacher_services" ON public.teacher_services
  FOR SELECT TO authenticated
  USING (account_id = public.current_account_id());
-- O profissional e o serviço têm que ser da mesma empresa de quem grava.
DROP POLICY IF EXISTS "admins manage teacher_services" ON public.teacher_services;
CREATE POLICY "admins manage teacher_services" ON public.teacher_services
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id())
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role) AND account_id = public.current_account_id()
    AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_id AND t.account_id = public.current_account_id())
    AND EXISTS (SELECT 1 FROM public.services s WHERE s.id = service_id AND s.account_id = public.current_account_id())
  );

REVOKE ALL ON public.teacher_services FROM anon;

-- Quem faz o serviço. Serviço por profissional é do Max: fora dele, todo
-- profissional faz todos.
CREATE OR REPLACE FUNCTION public.teacher_does_service(_teacher_slug text, _service uuid, _account uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _service IS NULL
      OR NOT public.account_can('teacher_services', _account)
      OR EXISTS (
        SELECT 1 FROM public.teachers t
         WHERE t.account_id = _account
           AND public.teacher_slug(t.name) = public.teacher_slug(_teacher_slug)
           AND (t.all_services OR EXISTS (
                 SELECT 1 FROM public.teacher_services ts WHERE ts.teacher_id = t.id AND ts.service_id = _service)))
$$;

REVOKE ALL ON FUNCTION public.teacher_does_service(text, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.teacher_does_service(text, uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A aula guarda o serviço, e o preço sai dele
-- ---------------------------------------------------------------------------
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.services(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS lessons_service_idx ON public.lessons (service_id) WHERE service_id IS NOT NULL;

-- lessons.price é o valor da HORA (a cobrança é price × duração / 60). O
-- serviço tem o preço do atendimento inteiro, então vira valor da hora pela
-- duração do serviço.
CREATE OR REPLACE FUNCTION public.fill_lesson_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _svc public.services;
BEGIN
  IF NEW.service_id IS NOT NULL THEN
    SELECT * INTO _svc FROM public.services WHERE id = NEW.service_id AND account_id = NEW.account_id;
    IF _svc.id IS NULL THEN
      RAISE EXCEPTION 'Serviço não encontrado.' USING ERRCODE = 'check_violation', HINT = 'servico_invalido';
    END IF;
    -- Pedido da família: só serviço ligado, e com quem faz o serviço.
    IF NEW.status = 'solicitada' THEN
      IF NOT _svc.active THEN
        RAISE EXCEPTION 'Este serviço não está disponível.' USING ERRCODE = 'check_violation', HINT = 'servico_inativo';
      END IF;
      IF NOT public.teacher_does_service(NEW.teacher, NEW.service_id, NEW.account_id) THEN
        RAISE EXCEPTION 'Este profissional não faz este serviço.' USING ERRCODE = 'check_violation', HINT = 'servico_profissional';
      END IF;
    END IF;
    IF NEW.price IS NULL AND _svc.price IS NOT NULL THEN
      NEW.price := round(_svc.price * 60.0 / _svc.duration_minutes, 2);
    END IF;
  END IF;
  IF NEW.price IS NULL THEN
    NEW.price := public.account_lesson_price(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$;

-- O gatilho existente é só BEFORE INSERT; a troca de serviço numa aula já
-- criada vem com o preço do app (LessonDialog), então basta o insert.

-- ---------------------------------------------------------------------------
-- O que cada plano tem
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'pro' THEN jsonb_build_object(
      'nome',               'Cronys Max',
      -- Sem teto: acima dos incluídos, cada profissional ativo é cobrado.
      'max_teachers',       null,
      'included_teachers',  5,
      'max_students',       null,
      -- O assistente em si é decidido por account_can (só com assinatura paga).
      'assistant',          false,
      'assistant_included', true,
      'assistant_messages', 200,
      'assistant_cost_usd', 5.00,
      'packages',           true,
      'recurring_blocks',   true,
      'vocabulary',         true,
      'whatsapp_link',      true,
      'whatsapp_auto',      true,
      'arrival_location',   true,
      'services_multi',     true,
      'teacher_services',   true,
      'any_teacher',        true
    )
    WHEN 'pro_solo' THEN jsonb_build_object(
      'nome',               'Cronys Pro',
      'max_teachers',       1,
      'included_teachers',  1,
      'max_students',       null,
      'assistant',          false,
      'assistant_included', false,
      'assistant_messages', 100,
      'assistant_cost_usd', 3.00,
      'packages',           true,
      'recurring_blocks',   true,
      'vocabulary',         true,
      'whatsapp_link',      true,
      'whatsapp_auto',      false,
      'arrival_location',   false,
      'services_multi',     true,
      'teacher_services',   false,
      'any_teacher',        false
    )
    ELSE jsonb_build_object(
      'nome',               'Cronys Essencial',
      'max_teachers',       1,
      'included_teachers',  1,
      'max_students',       5,
      'assistant',          false,
      'assistant_included', false,
      'assistant_messages', 100,
      'assistant_cost_usd', 3.00,
      'packages',           false,
      'recurring_blocks',   false,
      'vocabulary',         false,
      'whatsapp_link',      false,
      'whatsapp_auto',      false,
      'arrival_location',   false,
      'services_multi',     false,
      'teacher_services',   false,
      'any_teacher',        false
    )
  END
$$;

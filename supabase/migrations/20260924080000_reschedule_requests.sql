-- A família pede TROCA de horário, e a empresa define a antecedência mínima
-- dos pedidos.
--
-- Até aqui a família só pedia horário novo e retirava o próprio pedido. Para
-- trocar uma aula marcada ela precisava pedir outra e combinar por fora que a
-- antiga saísse - e a antiga ficava na agenda até alguém lembrar.
--
-- A troca é um pedido comum (status 'solicitada') que aponta para a aula que
-- ele substitui (reschedule_of). Nada muda até o professor responder:
--   aprovar  -> o pedido vira 'agendada' e a aula antiga vira 'cancelada',
--               na mesma transação (gatilho abaixo);
--   recusar  -> o pedido vira 'recusada' e a aula antiga fica como estava;
--   retirar  -> igual a recusar, pela família (cancel_own_lesson_request).
--
-- Por que um gatilho e não a tela: aprovar é um UPDATE que o admin e o
-- professor já fazem hoje (LessonRequests, agenda, assistente). Se quem
-- desmarcasse a antiga fosse a tela, aprovar por qualquer outro caminho
-- deixaria as duas aulas valendo - e as duas viram cobrança quando passam.

-- ---------------------------------------------------------------------------
-- 1. As colunas
-- ---------------------------------------------------------------------------

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS reschedule_of uuid REFERENCES public.lessons(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.lessons.reschedule_of IS
  'Num pedido de troca, a aula que ele substitui. Aprovar o pedido cancela essa aula (gatilho lessons_apply_reschedule).';

-- Um pedido de troca aberto por aula: dois pedidos para a mesma aula
-- obrigariam o professor a escolher, e aprovar os dois cancelaria a antiga
-- uma vez e deixaria duas novas.
CREATE UNIQUE INDEX IF NOT EXISTS lessons_one_open_reschedule
  ON public.lessons (reschedule_of)
  WHERE reschedule_of IS NOT NULL AND status = 'solicitada';

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS min_request_notice_hours integer NOT NULL DEFAULT 0;

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_min_request_notice_hours_range;
ALTER TABLE public.settings
  ADD CONSTRAINT settings_min_request_notice_hours_range
  CHECK (min_request_notice_hours BETWEEN 0 AND 168);

COMMENT ON COLUMN public.settings.min_request_notice_hours IS
  'Antecedência mínima, em horas, dos pedidos da família: o horário pedido e, numa troca, a aula que sai precisam estar pelo menos isso à frente. 0 = sem mínimo.';

-- ---------------------------------------------------------------------------
-- 2. O que a família pode inserir
-- ---------------------------------------------------------------------------
-- A política de 20260919130000 com duas condições a mais:
--   - o horário pedido respeita a antecedência mínima da empresa (com 0, basta
--     ser no futuro - pedir horário que já passou nunca fez sentido);
--   - numa troca, a aula que sai é desta família, desta empresa, ainda
--     'agendada' e também dentro da antecedência. Sem isso, um pedido de
--     troca apontando para a aula de OUTRA família cancelaria a aula dela
--     quando o professor aprovasse sem olhar.

-- Em função (e não num EXISTS na política) porque a política precisa ler a
-- aula antiga e as configurações; SECURITY DEFINER deixa a regra num lugar só
-- e não depende do que a política de SELECT da família mostra.
CREATE OR REPLACE FUNCTION public.can_request_reschedule(_original uuid, _student text, _guardian text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lessons o
      JOIN public.settings s ON s.account_id = o.account_id
     WHERE o.id = _original
       AND o.account_id = public.current_account_id()
       AND o.status = 'agendada'
       AND o.start_at >= now() + make_interval(hours => s.min_request_notice_hours)
       -- A troca é da mesma aula-família: o pedido e a aula que sai têm o
       -- mesmo aluno, e esse aluno é de quem está pedindo.
       AND lower(btrim(o.student_name)) = lower(btrim(_student))
       AND coalesce(nullif(btrim(o.guardian_name), ''), '') = coalesce(nullif(btrim(_guardian), ''), '')
       AND public.student_account_matches(o.student_name, o.guardian_name)
  )
$$;

REVOKE ALL ON FUNCTION public.can_request_reschedule(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_request_reschedule(uuid, text, text) TO authenticated;

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
         AND lessons.start_at >= now() + make_interval(hours => s.min_request_notice_hours)
    )
    AND (
      reschedule_of IS NULL
      OR public.can_request_reschedule(reschedule_of, student_name, guardian_name)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Aprovar a troca desmarca a aula antiga
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: quem aprova pode ser o login de professor, que só altera
-- as próprias aulas - e a família pode ter pedido a troca para outro
-- professor. A aula antiga continua presa à mesma empresa do pedido.
--
-- Só cancela se ela ainda estiver 'agendada'. Se já foi dada (realizada) ou
-- alguém já desmarcou, não mexe: desfazer uma aula realizada apagaria
-- cobrança.

CREATE OR REPLACE FUNCTION public.apply_lesson_reschedule()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.reschedule_of IS NOT NULL
     AND OLD.status = 'solicitada'
     AND NEW.status = 'agendada' THEN
    UPDATE public.lessons o
       SET status = 'cancelada'
     WHERE o.id = NEW.reschedule_of
       AND o.account_id = NEW.account_id
       AND o.status = 'agendada';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_lesson_reschedule() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS lessons_apply_reschedule ON public.lessons;
CREATE TRIGGER lessons_apply_reschedule
  AFTER UPDATE OF status ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.apply_lesson_reschedule();

-- ---------------------------------------------------------------------------
-- O que NÃO muda
-- ---------------------------------------------------------------------------
-- cancel_own_lesson_request (retirar) segue igual: retira o pedido e, como a
-- aula antiga nunca foi tocada, ela continua marcada.
--
-- A trava de sobreposição continua valendo entre o pedido e a aula antiga.
-- Trocar para um horário que encosta na própria aula (mesmo professor, meia
-- hora depois) é recusado como horário ocupado; a família pede outro horário
-- ou fala com o professor. Afrouxar a constraint para esse caso não vale o
-- risco de mexer na trava que segura a agenda inteira.
--
-- Nada de dinheiro: o pedido e a aula cancelada não são 'realizada', então
-- sync_lesson_wallet não lança nada. A cobrança nasce quando a aula nova
-- acontece, como qualquer outra.

-- Atendimento sem serviço, mas com a descrição igual ao nome de um serviço,
-- passa a ser daquele serviço (Thiago, 27/09).
--
-- As aulas marcadas antes de o serviço existir ficaram só com o texto
-- ("Matemática") e sem service_id: a cor nova do serviço não chegava nelas, e
-- a agenda mostrava "Matemática" com cor ao lado de "Matemática" sem cor.
--
-- O vínculo é pelo nome, sem diferença de maiúsculas nem espaços nas pontas, e
-- só quando um serviço só da empresa tem aquele nome. O preço e a duração que
-- a aula já tem não mudam.

-- Carteira: mudar só o serviço de uma aula não recalcula a cobrança dela. Sem
-- isto, ligar as aulas antigas ao serviço reescreveria os lançamentos delas
-- com o desconto de hoje. Fora a primeira linha do corpo, igual ao que estava
-- em produção.
CREATE OR REPLACE FUNCTION public.sync_lesson_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _charge numeric;
  _discount numeric;
  _label text;
  _desc text;
BEGIN
  -- set_account_discount recalcula "tocando" a aula sem mudar nada (só
  -- updated_at): esse caso continua passando. Só o serviço mudado é pulado.
  IF TG_OP = 'UPDATE' AND NEW.service_id IS DISTINCT FROM OLD.service_id
     AND (to_jsonb(NEW) - 'service_id' - 'updated_at') = (to_jsonb(OLD) - 'service_id' - 'updated_at') THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'realizada' AND NEW.status IS DISTINCT FROM 'realizada' THEN
    DELETE FROM public.wallet_transactions
     WHERE lesson_id = NEW.id AND kind IN ('lesson', 'voucher');
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM 'realizada' THEN
    RETURN NULL;
  END IF;

  _charge := ROUND((NEW.price * NEW.duration_minutes / 60.0)::numeric, 2);
  _desc := 'Aula em ' || to_char(NEW.start_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
           || ' (' || NEW.duration_minutes || ' min)';

  SELECT LEAST(
           ROUND(CASE WHEN d.kind = 'percent' THEN _charge * d.value / 100 ELSE d.value END, 2),
           _charge
         ),
         CASE WHEN d.kind = 'percent'
           THEN 'Desconto de '
                || replace(rtrim(trim(to_char(d.value, 'FM999990.99')), '.'), '.', ',') || '%'
           ELSE 'Desconto de R$ ' || replace(to_char(d.value, 'FM999999990.00'), '.', ',')
         END
    INTO _discount, _label
    FROM public.account_discounts d
   WHERE d.account_id = NEW.account_id
     AND public.account_key(d.student_name, d.guardian_name)
       = public.account_key(NEW.student_name, NEW.guardian_name);

  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'realizada' THEN
    INSERT INTO public.wallet_transactions
      (guardian_name, student_name, amount, kind, lesson_id, description, account_id)
    VALUES (NULLIF(trim(NEW.guardian_name), ''), NEW.student_name, -_charge, 'lesson', NEW.id,
            _desc, NEW.account_id);
  ELSE
    UPDATE public.wallet_transactions
       SET amount = -_charge,
           guardian_name = NULLIF(trim(NEW.guardian_name), ''),
           student_name = NEW.student_name,
           description = _desc
     WHERE lesson_id = NEW.id AND kind = 'lesson';
  END IF;

  IF _discount IS NULL OR _discount <= 0 THEN
    DELETE FROM public.wallet_transactions WHERE lesson_id = NEW.id AND kind = 'voucher';
  ELSE
    UPDATE public.wallet_transactions
       SET amount = _discount,
           guardian_name = NULLIF(trim(NEW.guardian_name), ''),
           student_name = NEW.student_name,
           description = _label || ' - ' || _desc
     WHERE lesson_id = NEW.id AND kind = 'voucher';
    IF NOT FOUND THEN
      INSERT INTO public.wallet_transactions
        (guardian_name, student_name, amount, kind, lesson_id, description, account_id)
      VALUES (NULLIF(trim(NEW.guardian_name), ''), NEW.student_name, _discount, 'voucher', NEW.id,
              _label || ' - ' || _desc, NEW.account_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.service_by_name(_account uuid, _name text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(s.id))[1] END
    FROM public.services s
   WHERE s.account_id = _account
     AND nullif(btrim(_name), '') IS NOT NULL
     AND lower(btrim(s.name)) = lower(btrim(_name));
$$;
REVOKE ALL ON FUNCTION public.service_by_name(uuid, text) FROM public, anon, authenticated;

-- Aula nova ou com a descrição mudada. "aa" no nome: roda antes de
-- lessons_fill_price, que usa o serviço para o preço de uma aula nova.
CREATE OR REPLACE FUNCTION public.lessons_link_service()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.service_id IS NULL AND NEW.subject IS NOT NULL THEN
    NEW.service_id := public.service_by_name(NEW.account_id, NEW.subject);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lessons_aa_link_service ON public.lessons;
CREATE TRIGGER lessons_aa_link_service
  BEFORE INSERT OR UPDATE OF subject, service_id ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_link_service();

-- Serviço criado ou renomeado: as aulas soltas com aquele nome entram nele.
CREATE OR REPLACE FUNCTION public.services_link_lessons()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF public.service_by_name(NEW.account_id, NEW.name) = NEW.id THEN
    UPDATE public.lessons l SET service_id = NEW.id
     WHERE l.account_id = NEW.account_id AND l.service_id IS NULL
       AND lower(btrim(l.subject)) = lower(btrim(NEW.name));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS services_link_lessons ON public.services;
CREATE TRIGGER services_link_lessons
  AFTER INSERT OR UPDATE OF name ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.services_link_lessons();

-- As que já existem.
UPDATE public.lessons l SET service_id = public.service_by_name(l.account_id, l.subject)
 WHERE l.service_id IS NULL AND l.subject IS NOT NULL
   AND public.service_by_name(l.account_id, l.subject) IS NOT NULL;

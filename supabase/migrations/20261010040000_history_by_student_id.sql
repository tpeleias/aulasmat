-- Aula, lançamento e pacote ligados ao cadastro do aluno (10/10). Até aqui o
-- elo era só o texto do nome (e do responsável): dois "Pedro" sem responsável
-- viravam um só, e um nome mudado separava o histórico (caso do Rafael). Agora
-- cada linha guarda também student_id, e mudar o cadastro leva junto o que é
-- dele pelo id. A conta do Financeiro continua sendo a do responsável (ou do
-- aluno, sem responsável), como antes.
--
-- Quem grava não precisa mandar o id: o gatilho acha o cadastro pelo nome
-- (nome + responsável; sem isso, só o nome, quando há um só). O lançamento da
-- aula ou do pacote herda o da aula ou do pacote. Cadastro excluído: o id
-- vira nulo e o histórico fica, como sempre ficou.

ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE SET NULL;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE SET NULL;
ALTER TABLE public.package_purchases ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lessons_student_id_idx ON public.lessons (student_id);
CREATE INDEX IF NOT EXISTS wallet_transactions_student_id_idx ON public.wallet_transactions (student_id);
CREATE INDEX IF NOT EXISTS package_purchases_student_id_idx ON public.package_purchases (student_id);
CREATE INDEX IF NOT EXISTS students_account_name_idx ON public.students (account_id, lower(btrim(student_name)));

-- O cadastro de (aluno, responsável): o que bate nos dois; sem isso, o único
-- com aquele nome. Ambíguo ou nenhum: nulo.
CREATE OR REPLACE FUNCTION public.resolve_student_id(_acct uuid, _student text, _guardian text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ids uuid[];
BEGIN
  IF _acct IS NULL OR btrim(coalesce(_student, '')) = '' THEN RETURN NULL; END IF;
  SELECT array_agg(id) INTO _ids FROM public.students
   WHERE account_id = _acct AND lower(btrim(student_name)) = lower(btrim(_student))
     AND lower(coalesce(nullif(btrim(guardian_name), ''), '')) = lower(coalesce(nullif(btrim(_guardian), ''), ''));
  IF cardinality(_ids) = 1 THEN RETURN _ids[1]; END IF;
  IF cardinality(_ids) > 1 THEN RETURN NULL; END IF;
  SELECT array_agg(id) INTO _ids FROM public.students
   WHERE account_id = _acct AND lower(btrim(student_name)) = lower(btrim(_student));
  RETURN CASE WHEN cardinality(_ids) = 1 THEN _ids[1] END;
END $$;
REVOKE ALL ON FUNCTION public.resolve_student_id(uuid, text, text) FROM public, anon, authenticated;

-- O cadastro ainda é o desta linha? (Mesma empresa e mesmos nomes.)
CREATE OR REPLACE FUNCTION public.student_matches_row(_id uuid, _acct uuid, _student text, _guardian text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.students s WHERE s.id = _id AND s.account_id = _acct
    AND lower(btrim(s.student_name)) = lower(btrim(_student))
    AND lower(coalesce(nullif(btrim(s.guardian_name), ''), '')) = lower(coalesce(nullif(btrim(_guardian), ''), '')))
$$;
REVOKE ALL ON FUNCTION public.student_matches_row(uuid, uuid, text, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.link_student_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _from uuid;
BEGIN
  -- Id de outra empresa não vale.
  IF NEW.student_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.id = NEW.student_id AND s.account_id = NEW.account_id) THEN
    NEW.student_id := NULL;
  END IF;

  -- Id escolhido que não bate com os nomes (mudou o responsável depois de
  -- escolher): vale o cadastro dos nomes, se houver um.
  IF NEW.student_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.student_id IS DISTINCT FROM OLD.student_id)
     AND NOT public.student_matches_row(NEW.student_id, NEW.account_id, NEW.student_name, NEW.guardian_name) THEN
    NEW.student_id := coalesce(public.resolve_student_id(NEW.account_id, NEW.student_name, NEW.guardian_name), NEW.student_id);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id THEN
    -- Ninguém mexeu no id; se os nomes mudaram, ele continua só se ainda bater.
    IF NEW.student_name IS DISTINCT FROM OLD.student_name OR NEW.guardian_name IS DISTINCT FROM OLD.guardian_name THEN
      IF NEW.student_id IS NULL OR NOT public.student_matches_row(NEW.student_id, NEW.account_id, NEW.student_name, NEW.guardian_name) THEN
        NEW.student_id := NULL;
      END IF;
    ELSIF NEW.student_id IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.student_id IS NULL AND TG_TABLE_NAME = 'wallet_transactions' THEN
    IF NEW.lesson_id IS NOT NULL THEN
      SELECT l.student_id INTO _from FROM public.lessons l WHERE l.id = NEW.lesson_id;
    ELSIF NEW.package_purchase_id IS NOT NULL THEN
      SELECT p.student_id INTO _from FROM public.package_purchases p WHERE p.id = NEW.package_purchase_id;
    END IF;
    NEW.student_id := _from;
  END IF;
  IF NEW.student_id IS NULL THEN
    NEW.student_id := public.resolve_student_id(NEW.account_id, NEW.student_name, NEW.guardian_name);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.link_student_id() FROM public, anon, authenticated;

-- "aa_" para rodar antes dos outros BEFORE (ordem alfabética).
CREATE OR REPLACE TRIGGER lessons_aa_student_id BEFORE INSERT OR UPDATE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.link_student_id();
CREATE OR REPLACE TRIGGER wallet_aa_student_id BEFORE INSERT OR UPDATE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.link_student_id();
CREATE OR REPLACE TRIGGER package_purchases_aa_student_id BEFORE INSERT OR UPDATE ON public.package_purchases
  FOR EACH ROW EXECUTE FUNCTION public.link_student_id();

-- Preenche o que já existe sem disparar os outros gatilhos (refazer cobrança,
-- e-mail, agenda): só a coluna nova muda.
ALTER TABLE public.lessons DISABLE TRIGGER USER;
UPDATE public.lessons SET student_id = public.resolve_student_id(account_id, student_name, guardian_name) WHERE student_id IS NULL;
ALTER TABLE public.lessons ENABLE TRIGGER USER;
ALTER TABLE public.package_purchases DISABLE TRIGGER USER;
UPDATE public.package_purchases SET student_id = public.resolve_student_id(account_id, student_name, guardian_name) WHERE student_id IS NULL;
ALTER TABLE public.package_purchases ENABLE TRIGGER USER;
ALTER TABLE public.wallet_transactions DISABLE TRIGGER USER;
UPDATE public.wallet_transactions w SET student_id = coalesce(
    (SELECT l.student_id FROM public.lessons l WHERE l.id = w.lesson_id),
    (SELECT p.student_id FROM public.package_purchases p WHERE p.id = w.package_purchase_id),
    public.resolve_student_id(w.account_id, w.student_name, w.guardian_name))
 WHERE w.student_id IS NULL;
ALTER TABLE public.wallet_transactions ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- Mudar o cadastro leva o histórico pelo id (versão de 20261010020000, agora
-- também pelo id: dois homônimos sem responsável se separam certo).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_client_history(
  _acct uuid, _student_id uuid,
  _old_student text, _old_guardian text, _new_student text, _new_guardian text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _old_key text := public.account_key(_old_student, _old_guardian);
  _new_key text := public.account_key(_new_student, _new_guardian);
  _os text := lower(btrim(coalesce(_old_student, '')));
  _ns text := btrim(coalesce(_new_student, ''));
  _ng text := nullif(btrim(coalesce(_new_guardian, '')), '');
  _family boolean := _old_key LIKE 'g:%';
  _by_id boolean := _student_id IS NOT NULL;
  _whole boolean;
  _lessons int := 0; _wallet int := 0; _packages int := 0;
  _lesson_ids uuid[]; _purchase_ids uuid[];
BEGIN
  IF _acct IS NULL OR _ns = '' OR _os = '' THEN RETURN jsonb_build_object('lessons', 0, 'wallet', 0, 'packages', 0); END IF;
  IF _old_key = _new_key AND _os = lower(_ns) THEN RETURN jsonb_build_object('lessons', 0, 'wallet', 0, 'packages', 0); END IF;

  -- A conta antiga é só deste aluno? Se outro cadastro ainda usa a mesma
  -- chave, é família (irmãos) ou homônimo: vai só o que é dele - pelo id e,
  -- na família, também pelo nome. Homônimo sem id para separar: não mexe.
  _whole := NOT EXISTS (SELECT 1 FROM public.students s
                         WHERE s.account_id = _acct AND s.id IS DISTINCT FROM _student_id
                           AND public.account_key(s.student_name, s.guardian_name) = _old_key);
  IF NOT _whole AND NOT _family AND NOT _by_id THEN RETURN jsonb_build_object('lessons', 0, 'wallet', 0, 'packages', 0); END IF;

  SELECT coalesce(array_agg(id), '{}') INTO _lesson_ids FROM public.lessons
   WHERE account_id = _acct AND public.account_key(student_name, guardian_name) = _old_key
     AND (_whole OR (_by_id AND student_id = _student_id)
          OR (_family AND student_id IS NULL AND lower(btrim(student_name)) = _os));
  SELECT coalesce(array_agg(id), '{}') INTO _purchase_ids FROM public.package_purchases
   WHERE account_id = _acct AND public.account_key(student_name, guardian_name) = _old_key
     AND (_whole OR (_by_id AND student_id = _student_id)
          OR (_family AND student_id IS NULL AND lower(btrim(student_name)) = _os));

  PERFORM set_config('cronys.movendo_historico', 'on', true);
  PERFORM set_config('cronys.renomeando_professor', 'on', true);

  IF _whole THEN
    IF EXISTS (SELECT 1 FROM public.account_discounts d WHERE d.account_id = _acct
                AND public.account_key(d.student_name, d.guardian_name) = _new_key) THEN
      DELETE FROM public.account_discounts d WHERE d.account_id = _acct
         AND public.account_key(d.student_name, d.guardian_name) = _old_key;
    ELSE
      UPDATE public.account_discounts d SET student_name = _ns, guardian_name = _ng
       WHERE d.account_id = _acct AND public.account_key(d.student_name, d.guardian_name) = _old_key;
    END IF;
  END IF;

  UPDATE public.package_purchases SET student_name = _ns, guardian_name = _ng,
         student_id = coalesce(_student_id, student_id)
   WHERE id = ANY(_purchase_ids);
  GET DIAGNOSTICS _packages = ROW_COUNT;

  -- Pagamento de família fica com a família; o de homônimo (sem responsável)
  -- vai com o dono, pelo id.
  UPDATE public.wallet_transactions w
     SET guardian_name = _ng,
         student_name = CASE WHEN _ng IS NULL OR lower(btrim(w.student_name)) = _os THEN _ns ELSE w.student_name END,
         student_id = CASE WHEN _by_id AND (w.student_id IS NULL OR w.student_id = _student_id) THEN _student_id ELSE w.student_id END
   WHERE w.account_id = _acct
     AND public.account_key(w.student_name, w.guardian_name) = _old_key
     AND (_whole OR w.lesson_id = ANY(_lesson_ids) OR w.package_purchase_id = ANY(_purchase_ids)
          OR (_by_id AND NOT _family AND w.student_id = _student_id));
  GET DIAGNOSTICS _wallet = ROW_COUNT;

  UPDATE public.lessons SET student_name = _ns, guardian_name = _ng,
         student_id = coalesce(_student_id, student_id)
   WHERE id = ANY(_lesson_ids);
  GET DIAGNOSTICS _lessons = ROW_COUNT;

  IF _whole THEN
    UPDATE public.online_payments o SET student_name = _ns, guardian_name = _ng
     WHERE o.account_id = _acct AND public.account_key(o.student_name, o.guardian_name) = _old_key;
    IF EXISTS (SELECT 1 FROM public.pay_links p WHERE p.account_id = _acct AND p.account_key = _new_key) THEN
      DELETE FROM public.pay_links p WHERE p.account_id = _acct AND p.account_key = _old_key;
    ELSE
      UPDATE public.pay_links p SET account_key = _new_key, student_name = _ns, guardian_name = _ng
       WHERE p.account_id = _acct AND p.account_key = _old_key;
    END IF;
  END IF;

  PERFORM set_config('cronys.renomeando_professor', 'off', true);
  PERFORM set_config('cronys.movendo_historico', 'off', true);

  PERFORM public.reassign_packages(_acct, _new_key, true);
  PERFORM public.reassign_packages(_acct, _old_key, true);
  PERFORM public.recompute_payment_status(_ns, _ng, _acct);
  PERFORM public.recompute_payment_status(_old_student, _old_guardian, _acct);

  RETURN jsonb_build_object('lessons', _lessons, 'wallet', _wallet, 'packages', _packages);
END $$;
REVOKE ALL ON FUNCTION public.move_client_history(uuid, uuid, text, text, text, text) FROM public, anon, authenticated;

-- Juntar conta separada: agora passa o cadastro (as linhas sem id ou com o
-- id dele vão juntas).
CREATE OR REPLACE FUNCTION public.merge_client_history(_student_id uuid, _from_guardian text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _st record;
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT id, student_name, guardian_name INTO _st FROM public.students WHERE id = _student_id AND account_id = _acct;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found'; END IF;
  RETURN public.move_client_history(_acct, _st.id, _st.student_name, _from_guardian, _st.student_name, _st.guardian_name);
END $$;
REVOKE ALL ON FUNCTION public.merge_client_history(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merge_client_history(uuid, text) TO authenticated;

-- O histórico acompanha o cadastro (10/10). A esposa do Thiago cadastrou o
-- Rafael sem responsável, deu aulas e registrou pagamentos; depois pôs o nome
-- da responsável (Thaciana) e o Financeiro passou a mostrar duas contas: as
-- aulas antigas ficaram em "Rafael" (sem responsável) e o novo em "Thaciana".
-- Cada aula, lançamento e pacote guarda o nome do aluno e do responsável, e a
-- conta é a chave account_key(aluno, responsável).
--
-- Agora:
-- 1. Mudou o responsável (ou o nome) no cadastro, o histórico vai junto
--    (gatilho em students).
-- 2. Conta que já ficou separada aparece num aviso com "Juntar"
--    (split_client_histories + merge_client_history).
--
-- Quando o responsável antigo ainda tem outros filhos cadastrados, só vai o
-- que é deste aluno (aulas e pacotes dele); os pagamentos ficam com a família.

-- ---------------------------------------------------------------------------
-- Durante a mudança, os recálculos por linha esperam: refaz tudo uma vez no fim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lessons_packages_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('cronys.movendo_historico', true), '') = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'realizada' THEN
      PERFORM public.reassign_packages(OLD.account_id, public.account_key(OLD.student_name, OLD.guardian_name));
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND public.lesson_only_payment_status_changed(NEW, OLD) THEN RETURN NULL; END IF;
  IF NEW.status = 'realizada' OR (TG_OP = 'UPDATE' AND OLD.status = 'realizada') THEN
    PERFORM public.reassign_packages(NEW.account_id, public.account_key(NEW.student_name, NEW.guardian_name));
    IF TG_OP = 'UPDATE' AND public.account_key(NEW.student_name, NEW.guardian_name) IS DISTINCT FROM public.account_key(OLD.student_name, OLD.guardian_name) THEN
      PERFORM public.reassign_packages(OLD.account_id, public.account_key(OLD.student_name, OLD.guardian_name));
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.lessons_packages_sync() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.package_purchases_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_WHEN = 'BEFORE' THEN
    -- A cobrança do pacote (e o ajuste da conversão) saem junto; pagamento recebido fica.
    DELETE FROM public.wallet_transactions WHERE package_purchase_id = OLD.id AND amount < 0;
    RETURN OLD;
  END IF;
  IF coalesce(current_setting('cronys.movendo_historico', true), '') = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public.reassign_packages(OLD.account_id, public.account_key(OLD.student_name, OLD.guardian_name), true);
    RETURN NULL;
  END IF;
  PERFORM public.reassign_packages(NEW.account_id, public.account_key(NEW.student_name, NEW.guardian_name));
  IF TG_OP = 'UPDATE' AND public.account_key(NEW.student_name, NEW.guardian_name) IS DISTINCT FROM public.account_key(OLD.student_name, OLD.guardian_name) THEN
    PERFORM public.reassign_packages(OLD.account_id, public.account_key(OLD.student_name, OLD.guardian_name), true);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.package_purchases_sync() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_recompute_from_lesson()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('cronys.movendo_historico', true), '') = 'on' THEN RETURN NULL; END IF;
  PERFORM public.recompute_payment_status(NEW.student_name, NEW.guardian_name, NEW.account_id);
  IF TG_OP = 'UPDATE' AND (OLD.student_name IS DISTINCT FROM NEW.student_name
                           OR OLD.guardian_name IS DISTINCT FROM NEW.guardian_name) THEN
    PERFORM public.recompute_payment_status(OLD.student_name, OLD.guardian_name, OLD.account_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recompute_from_wallet()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(current_setting('cronys.movendo_historico', true), '') = 'on' THEN RETURN NULL; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recompute_payment_status(NEW.student_name, NEW.guardian_name, NEW.account_id);
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM public.recompute_payment_status(OLD.student_name, OLD.guardian_name, OLD.account_id);
  END IF;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Leva o histórico de (aluno, responsável) antigos para os novos
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
  _whole boolean;
  _lessons int := 0; _wallet int := 0; _packages int := 0;
  _lesson_ids uuid[]; _purchase_ids uuid[];
BEGIN
  IF _acct IS NULL OR _ns = '' OR _os = '' THEN RETURN jsonb_build_object('lessons', 0, 'wallet', 0, 'packages', 0); END IF;
  IF _old_key = _new_key AND _os = lower(_ns) THEN RETURN jsonb_build_object('lessons', 0, 'wallet', 0, 'packages', 0); END IF;

  -- A conta antiga é só deste aluno? Se outro cadastro ainda usa a mesma
  -- chave, é família (irmãos): vai só o que é dele. Sem responsável e com
  -- outro cadastro de mesmo nome, não dá para saber de quem é: não mexe.
  _whole := NOT EXISTS (SELECT 1 FROM public.students s
                         WHERE s.account_id = _acct AND s.id IS DISTINCT FROM _student_id
                           AND public.account_key(s.student_name, s.guardian_name) = _old_key);
  IF NOT _whole AND _old_key LIKE 's:%' THEN RETURN jsonb_build_object('lessons', 0, 'wallet', 0, 'packages', 0); END IF;

  SELECT coalesce(array_agg(id), '{}') INTO _lesson_ids FROM public.lessons
   WHERE account_id = _acct AND public.account_key(student_name, guardian_name) = _old_key
     AND (_whole OR lower(btrim(student_name)) = _os);
  SELECT coalesce(array_agg(id), '{}') INTO _purchase_ids FROM public.package_purchases
   WHERE account_id = _acct AND public.account_key(student_name, guardian_name) = _old_key
     AND (_whole OR lower(btrim(student_name)) = _os);

  -- Não refaz cobrança a cada linha, não barra por plano (nada novo é
  -- marcado) e não manda e-mail (só atualiza linhas existentes).
  PERFORM set_config('cronys.movendo_historico', 'on', true);
  PERFORM set_config('cronys.renomeando_professor', 'on', true);

  -- Desconto da conta: vai junto, se a conta nova ainda não tem um.
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

  UPDATE public.package_purchases SET student_name = _ns, guardian_name = _ng
   WHERE id = ANY(_purchase_ids);
  GET DIAGNOSTICS _packages = ROW_COUNT;

  UPDATE public.wallet_transactions w
     SET guardian_name = _ng,
         student_name = CASE WHEN _ng IS NULL OR lower(btrim(w.student_name)) = _os THEN _ns ELSE w.student_name END
   WHERE w.account_id = _acct
     AND public.account_key(w.student_name, w.guardian_name) = _old_key
     AND (_whole OR w.lesson_id = ANY(_lesson_ids) OR w.package_purchase_id = ANY(_purchase_ids));
  GET DIAGNOSTICS _wallet = ROW_COUNT;

  UPDATE public.lessons SET student_name = _ns, guardian_name = _ng
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

  -- Refaz pacotes, descontos e "pago/pendente" das duas contas, uma vez.
  PERFORM public.reassign_packages(_acct, _new_key, true);
  PERFORM public.reassign_packages(_acct, _old_key, true);
  PERFORM public.recompute_payment_status(_ns, _ng, _acct);
  PERFORM public.recompute_payment_status(_old_student, _old_guardian, _acct);

  RETURN jsonb_build_object('lessons', _lessons, 'wallet', _wallet, 'packages', _packages);
END $$;
REVOKE ALL ON FUNCTION public.move_client_history(uuid, uuid, text, text, text, text) FROM public, anon, authenticated;

-- 1. Mudou no cadastro: o histórico vai junto.
CREATE OR REPLACE FUNCTION public.students_history_follows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN RETURN NULL; END IF;
  PERFORM public.move_client_history(NEW.account_id, NEW.id,
    OLD.student_name, OLD.guardian_name, NEW.student_name, NEW.guardian_name);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.students_history_follows() FROM public, anon, authenticated;

CREATE OR REPLACE TRIGGER students_history_follows
  AFTER UPDATE OF student_name, guardian_name ON public.students
  FOR EACH ROW
  WHEN (public.account_key(OLD.student_name, OLD.guardian_name) IS DISTINCT FROM public.account_key(NEW.student_name, NEW.guardian_name)
        OR lower(btrim(OLD.student_name)) IS DISTINCT FROM lower(btrim(NEW.student_name)))
  EXECUTE FUNCTION public.students_history_follows();

-- 2. Contas que já ficaram separadas: histórico com o nome de um cadastro,
-- mas com outro responsável (ou sem), que nenhum cadastro usa.
CREATE OR REPLACE FUNCTION public.split_client_histories()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _acct uuid := public.current_account_id();
BEGIN
  IF _acct IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    WITH hist AS (
      SELECT student_name, guardian_name, 1 AS lesson, 0 AS tx, 0::numeric AS amount FROM public.lessons WHERE account_id = _acct
      UNION ALL SELECT student_name, guardian_name, 0, 1, amount FROM public.wallet_transactions WHERE account_id = _acct
      UNION ALL SELECT student_name, guardian_name, 0, 0, 0 FROM public.package_purchases WHERE account_id = _acct
    ), groups AS (
      SELECT lower(btrim(student_name)) AS s, public.account_key(student_name, guardian_name) AS k,
             min(nullif(btrim(guardian_name), '')) AS g,
             sum(lesson)::int AS lessons, sum(tx)::int AS txs, sum(amount) AS balance
        FROM hist WHERE btrim(coalesce(student_name, '')) <> '' GROUP BY 1, 2
    )
    SELECT jsonb_agg(jsonb_build_object(
             'student_id', st.id, 'student_name', st.student_name, 'guardian_name', nullif(btrim(st.guardian_name), ''),
             'from_guardian', gr.g, 'lessons', gr.lessons, 'transactions', gr.txs, 'balance', round(gr.balance, 2))
             ORDER BY st.student_name)
      FROM groups gr
      JOIN public.students st ON st.account_id = _acct AND lower(btrim(st.student_name)) = gr.s
     WHERE gr.k <> public.account_key(st.student_name, st.guardian_name)
       -- Chave que algum cadastro usa é de uma família viva (um pagamento
       -- com o nome do irmão, por exemplo): não é conta perdida.
       AND NOT EXISTS (SELECT 1 FROM public.students x WHERE x.account_id = _acct
                        AND public.account_key(x.student_name, x.guardian_name) = gr.k)
       AND (SELECT count(*) FROM public.students y WHERE y.account_id = _acct AND lower(btrim(y.student_name)) = gr.s) = 1
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.split_client_histories() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.split_client_histories() TO authenticated;

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
  RETURN public.move_client_history(_acct, NULL, _st.student_name, _from_guardian, _st.student_name, _st.guardian_name);
END $$;
REVOKE ALL ON FUNCTION public.merge_client_history(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.merge_client_history(uuid, text) TO authenticated;

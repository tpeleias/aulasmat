-- Conserta o registro de pagamento, quebrado pela parte 1.
--
-- register_payment grava na carteira sem dizer a empresa, contando com o
-- preenchimento automático da coluna (a empresa de quem está logado). Isso
-- funciona quando quem chama é o admin pela tela de Cobrança, mas é vazio
-- quando quem chama é o assistente de IA, que usa a chave mestra e não tem
-- usuário logado - e aí o registro falha por falta de empresa.
--
-- Uma varredura de todas as rotinas que gravam em tabelas marcadas por empresa
-- encontrou exatamente três: log_lesson_audit e sync_lesson_wallet (já
-- corrigidas na parte 1) e esta.
--
-- O parâmetro novo vai no fim e é opcional, então a tela de Cobrança, que
-- chama por nome sem passá-lo, continua funcionando igual.

DROP FUNCTION IF EXISTS public.register_payment(text, text, numeric, text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.register_payment(
  _student text,
  _guardian text,
  _amount numeric,
  _kind text DEFAULT 'adjustment'::text,
  _description text DEFAULT NULL::text,
  _voucher numeric DEFAULT 0,
  _voucher_description text DEFAULT NULL::text,
  _account uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _g text := nullif(btrim(coalesce(_guardian, '')), '');
  _s text := btrim(coalesce(_student, ''));
  _acct uuid := coalesce(_account, public.current_account_id());
  _payment_id uuid;
  _voucher_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
          OR current_user IN ('postgres', 'service_role', 'supabase_admin')
          OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  -- Sem empresa não há onde lançar o dinheiro com segurança: melhor recusar
  -- do que adivinhar e creditar na carteira da empresa errada.
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'account is required';
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
    INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description, account_id)
    VALUES (_s, _g, _amount, CASE WHEN _amount < 0 THEN 'adjustment' ELSE _kind END,
            nullif(btrim(coalesce(_description, '')), ''), _acct)
    RETURNING id INTO _payment_id;
  END IF;

  IF coalesce(_voucher, 0) > 0 THEN
    INSERT INTO public.wallet_transactions (student_name, guardian_name, amount, kind, description, account_id)
    VALUES (_s, _g, _voucher, 'voucher',
            coalesce(nullif(btrim(coalesce(_voucher_description, '')), ''), 'Voucher'), _acct)
    RETURNING id INTO _voucher_id;
  END IF;

  RETURN jsonb_build_object('payment_id', _payment_id, 'voucher_id', _voucher_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.register_payment(text, text, numeric, text, text, numeric, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_payment(text, text, numeric, text, text, numeric, text, uuid) TO authenticated, service_role;

-- Três acabamentos do gestor e dos planos.
--
-- 1. O app precisa saber POR QUE o assistente está desligado, e não só que
--    está. Desligado por ser Essencial e desligado à mão pela Cronys são duas
--    conversas diferentes com o professor: a primeira é uma venda, a segunda é
--    um aviso. Mostrar a tela de venda para uma empresa Pro que foi desligada
--    à mão seria mentira.
-- 2. Renomear empresa - hoje o nome só se muda por SQL.

-- ---------------------------------------------------------------------------
-- 1. my_plan() conta a exceção, não só o resultado
-- ---------------------------------------------------------------------------

-- `assistant` continua sendo a resposta final (é ela que manda na tela).
-- `assistant_override` é o porquê: nulo = segue o plano; false = a Cronys
-- desligou à mão; true = a Cronys ligou à mão (cortesia num Essencial).
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.plan_features(public.account_plan(NULL))
      || jsonb_build_object(
           'plano', public.account_plan(NULL),
           'assistant', public.account_can('assistant'),
           'assistant_override',
             (SELECT a.assistant_override FROM public.accounts a
               WHERE a.id = public.current_account_id()))
$$;

REVOKE ALL ON FUNCTION public.my_plan() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Renomear uma empresa
-- ---------------------------------------------------------------------------

-- Só o nome. O apelido (slug) fica de fora de propósito: ele vira o endereço
-- próprio da empresa quando houver domínio, e trocar endereço publicado quebra
-- link que já foi passado para família. Quando isso for preciso, vai ser uma
-- decisão com redirecionamento junto, não um campo de texto.
--
-- O nome é o que a tela de exclusão pede para digitar. Não há problema nisso:
-- a checagem lê o nome atual, então renomear muda o que precisa ser digitado -
-- e nunca destrava uma exclusão sozinha.
CREATE OR REPLACE FUNCTION public.platform_rename_account(_account uuid, _name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _n text := btrim(coalesce(_name, ''));
  _row public.accounts;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF _n = '' THEN
    RAISE EXCEPTION 'o nome da empresa é obrigatório';
  END IF;
  IF length(_n) > 120 THEN
    RAISE EXCEPTION 'o nome da empresa é longo demais';
  END IF;

  UPDATE public.accounts SET name = _n WHERE id = _account RETURNING * INTO _row;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'empresa não encontrada';
  END IF;

  RETURN jsonb_build_object('id', _row.id, 'name', _row.name, 'slug', _row.slug);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_rename_account(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_rename_account(uuid, text) TO authenticated, service_role;

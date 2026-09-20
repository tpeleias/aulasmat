-- O responsável pode retirar o próprio pedido, enquanto nenhum admin respondeu.
--
-- Sem isso, um toque errado prendia o horário até alguém recusar: o pedido ocupa
-- o slot, e o aluno não tinha como desfazer.
--
-- Feito com uma FUNÇÃO e não com uma política de UPDATE, de propósito. Uma
-- política de UPDATE em `lessons` para o aluno diria "quais LINHAS ele pode
-- alterar" e "como a linha tem que ficar depois" - mas não diria QUAIS COLUNAS
-- ele mexeu. Ou seja: com política, o mesmo UPDATE que cancela poderia, no
-- caminho, trocar o preço, o horário ou o resumo da aula, desde que terminasse
-- em 'cancelada'. A função fecha isso porque ela é quem escreve: só o status
-- muda, e só nessa direção.
--
-- Com isso segue valendo o que a migration 20260919130000 anotou: o aluno não
-- tem política de UPDATE em `lessons`. Ele tem uma porta estreita, e nada além.

CREATE OR REPLACE FUNCTION public.cancel_own_lesson_request(_lesson_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _acct uuid := public.current_account_id();
  _linhas integer;
BEGIN
  -- Sem empresa não há como saber de quem é o pedido, e esta função roda com os
  -- poderes de quem a criou. Recusar é a única resposta segura.
  IF _acct IS NULL THEN
    RETURN 'sem-empresa';
  END IF;

  -- As três condições que fazem a porta ser estreita:
  --   mesma empresa | ainda em 'solicitada' | é o cadastro deste responsável
  -- student_account_matches usa auth.uid(), que dentro de uma função
  -- SECURITY DEFINER continua sendo quem chamou - não o dono do banco.
  UPDATE public.lessons l
     SET status = 'cancelada'
   WHERE l.id = _lesson_id
     AND l.account_id = _acct
     AND l.status = 'solicitada'
     AND public.student_account_matches(l.student_name, l.guardian_name);

  GET DIAGNOSTICS _linhas = ROW_COUNT;
  IF _linhas = 1 THEN
    RETURN 'ok';
  END IF;

  -- Não cancelou. Separar "já respondido" de "não é seu" vale a consulta extra,
  -- porque a primeira é corrida normal com o admin (a família merece uma
  -- explicação) e a segunda não deveria acontecer pela tela.
  IF EXISTS (
    SELECT 1 FROM public.lessons l
     WHERE l.id = _lesson_id
       AND l.account_id = _acct
       AND public.student_account_matches(l.student_name, l.guardian_name)
  ) THEN
    RETURN 'ja-respondido';
  END IF;

  RETURN 'nao-encontrado';
END;
$$;

COMMENT ON FUNCTION public.cancel_own_lesson_request(uuid) IS
  'Responsável retira o próprio pedido de aula enquanto está em solicitada. Só mexe no status, e só de solicitada para cancelada.';

-- Visitante sem login não tem pedido para retirar.
REVOKE ALL ON FUNCTION public.cancel_own_lesson_request(uuid) FROM public;
REVOKE ALL ON FUNCTION public.cancel_own_lesson_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_own_lesson_request(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- O que retirar faz com o horário, e o que não faz com o dinheiro
-- ---------------------------------------------------------------------------
-- Vira 'cancelada', que a constraint lessons_sem_sobreposicao e as funções de
-- horário livre já ignoram - então o horário volta na hora para a vitrine, sem
-- precisar de mais nada aqui.
--
-- sync_lesson_wallet só mexe na carteira em 'realizada', e nem 'solicitada' nem
-- 'cancelada' são, então retirar não lança nem apaga cobrança.
--
-- Fica usando 'cancelada' em vez de um status próprio ('retirada') porque um
-- status novo obrigaria a mexer na constraint, nas duas funções de horário, nos
-- rótulos das telas e no enum do assistente - muito para o ganho, que seria o
-- admin distinguir "a família desistiu" de "eu desmarquei". Se essa distinção
-- passar a importar, é aí que vale o status novo.

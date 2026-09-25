-- Profissional novo entra no FIM da lista de prioridade (Thiago, 25/09). Antes
-- nascia com sort_order 0 e, com a ordem por (sort_order, nome), podia pular
-- para o 1º lugar do "qualquer profissional". Vale para qualquer caminho de
-- cadastro (tela, cadastro da empresa, gestor).
CREATE OR REPLACE FUNCTION public.teacher_goes_last()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(NEW.sort_order, 0) = 0 THEN
    NEW.sort_order := coalesce((SELECT max(t.sort_order) FROM public.teachers t WHERE t.account_id = NEW.account_id), 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_goes_last() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS teachers_go_last ON public.teachers;
CREATE TRIGGER teachers_go_last
  BEFORE INSERT ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.teacher_goes_last();

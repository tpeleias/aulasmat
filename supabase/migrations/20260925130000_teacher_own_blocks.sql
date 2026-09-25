-- Professor vê só a própria agenda (Thiago, 25/09): as aulas já eram só as
-- dele (20260925100000), mas os bloqueios de todos os professores da empresa
-- continuavam legíveis. Agora lê só os próprios e os da empresa inteira
-- ('both', que também ocupam a agenda dele).
DROP POLICY IF EXISTS "teachers read blocks" ON public.blocks;
CREATE POLICY "teachers read own blocks" ON public.blocks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'teacher'::app_role)
         AND account_id = public.current_account_id()
         AND (teacher = 'both' OR public.teacher_slug(teacher) = public.current_teacher_slug()));

DROP POLICY IF EXISTS "teachers read block exceptions" ON public.block_exceptions;
CREATE POLICY "teachers read own block exceptions" ON public.block_exceptions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'teacher'::app_role)
         AND account_id = public.current_account_id()
         AND EXISTS (SELECT 1 FROM public.blocks b
                      WHERE b.id = block_exceptions.block_id
                        AND b.account_id = public.current_account_id()
                        AND (b.teacher = 'both' OR public.teacher_slug(b.teacher) = public.current_teacher_slug())));

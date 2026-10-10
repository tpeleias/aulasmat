-- Tarefa ligada a um material (11/10, Thiago): "faça a Lista 1" abre a
-- própria Lista 1. O material apagado só solta a ligação; a tarefa fica.
ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES public.student_materials(id) ON DELETE SET NULL;

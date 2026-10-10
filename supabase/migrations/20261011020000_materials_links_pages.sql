-- Materiais além de arquivo (11/10, Thiago): link (Google Drive, YouTube...)
-- e página escrita (texto com fórmulas, que a IA manda pelo conector e o
-- aluno lê no portal e salva em PDF). O arquivo continua como era.

ALTER TABLE public.student_materials
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'file',
  ADD COLUMN IF NOT EXISTS url text,
  ADD COLUMN IF NOT EXISTS content text;

ALTER TABLE public.student_materials ALTER COLUMN file_path DROP NOT NULL;

ALTER TABLE public.student_materials ADD CONSTRAINT student_materials_kind_check CHECK (
  (kind = 'file' AND file_path IS NOT NULL)
  OR (kind = 'link' AND url ~* '^https?://' AND length(url) <= 2000)
  OR (kind = 'page' AND content IS NOT NULL AND length(content) BETWEEN 1 AND 30000)
);

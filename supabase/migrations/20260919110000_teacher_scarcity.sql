-- Escassez personalizada por professor.
--
-- A escassez por dia da semana passou a existir em settings na migration
-- anterior, valendo para a empresa inteira. Aqui cada professor pode ter a
-- própria: nulo significa "usa a da empresa", que é como todos começam.
--
-- O valor da empresa continua necessário: a página pública sem professor
-- (/disponibilidade, que mostra todos juntos) não tem de quem herdar.

ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS scarcity jsonb;

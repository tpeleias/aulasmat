-- Ordem explícita dos professores dentro da empresa.
--
-- As cores da agenda estavam escritas à mão no código ("se for a mayara, rosa;
-- senão, azul"), o que só funciona para uma empresa com esses dois nomes. Para
-- o app tirar as cores da tabela, ele precisa de uma ordem estável - e ordenar
-- por nome ou por data de criação não serve: os dois professores atuais foram
-- inseridos no mesmo instante, então a ordem sairia aleatória e as cores
-- poderiam trocar de um carregamento para o outro.

ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Mantém exatamente as cores de hoje: thiago em azul (primeiro), mayara em rosa.
UPDATE public.teachers SET sort_order = 0 WHERE lower(btrim(name)) = 'thiago';
UPDATE public.teachers SET sort_order = 1 WHERE lower(btrim(name)) = 'mayara';

-- A matéria de cada professor também estava escrita no código, em dois lugares:
-- no título da página pública de horários e na matéria que já vem preenchida ao
-- criar uma aula. Passa a ser um dado do professor, como deveria.
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS subject text;

UPDATE public.teachers SET subject = 'Matemática' WHERE lower(btrim(name)) = 'thiago' AND subject IS NULL;
UPDATE public.teachers SET subject = 'Química'    WHERE lower(btrim(name)) = 'mayara' AND subject IS NULL;

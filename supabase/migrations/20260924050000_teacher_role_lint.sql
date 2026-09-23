-- Dois avisos do linter do Supabase sobre a migration anterior (24/09).
--
-- teacher_slug sem search_path fixo: só usa funções do pg_catalog, que é
-- sempre procurado primeiro, então fixar em vazio não muda nada no resultado.
ALTER FUNCTION public.teacher_slug(text) SET search_path = '';

-- A função do gatilho de preço não tem por que ser chamada pela API. Tirar o
-- EXECUTE não afeta o gatilho, que roda com o dono da tabela.
REVOKE ALL ON FUNCTION public.enforce_teacher_lesson_price() FROM public, anon, authenticated;

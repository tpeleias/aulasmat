-- Papel "professor", separado de "admin" (24/09). Fica sozinho neste arquivo
-- porque o Postgres não deixa usar um valor novo de enum na mesma transação
-- em que ele foi criado - as regras que usam 'teacher' vêm no próximo.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'teacher';

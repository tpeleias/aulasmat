-- Mantém a página pública no ar quando existir mais de uma empresa.
--
-- Na parte 1, public_account_id() devolve nulo assim que aparece a segunda
-- empresa - de propósito, para a página pública fechar em vez de servir os
-- dados da empresa errada. Só que isso derruba a página que as famílias já
-- usam hoje, no minuto em que a segunda empresa for criada.
--
-- Aqui uma empresa passa a poder ser marcada como a dona do endereço padrão.
-- O endereço sem subdomínio continua servindo ela, e as demais empresas
-- ficam sem página pública até a parte 2 dar um endereço próprio a cada uma
-- (o lado administrativo delas, que é logado, funciona normalmente).

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS is_public_default boolean NOT NULL DEFAULT false;

-- Só uma empresa pode ser a do endereço padrão.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_single_public_default
  ON public.accounts ((true)) WHERE is_public_default;

-- A empresa que já existe é a dona do endereço atual.
UPDATE public.accounts SET is_public_default = true
 WHERE id = (SELECT id FROM public.accounts ORDER BY created_at LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE is_public_default);

CREATE OR REPLACE FUNCTION public.public_account_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id FROM public.accounts WHERE active AND is_public_default LIMIT 1
$$;

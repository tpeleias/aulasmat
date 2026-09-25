-- Novos nomes e preços (Thiago, 25/09): Essencial (grátis), Pro (R$ 79,90,
-- ex-Pro Solo) e Max (R$ 159,90, ex-Pro Equipe). Os slugs internos não mudam
-- (pro_solo e pro), só o nome que o cliente vê. Preço mora no Stripe.

CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _plan
    WHEN 'pro' THEN jsonb_build_object(
      'nome',              'Cronys Max',
      -- Sem teto: acima dos incluídos, cada profissional ativo é cobrado.
      'max_teachers',      null,
      'included_teachers', 5,
      'max_students',      null,
      'assistant',         false,
      'packages',          true,
      'recurring_blocks',  true,
      'vocabulary',        true
    )
    WHEN 'pro_solo' THEN jsonb_build_object(
      'nome',              'Cronys Pro',
      'max_teachers',      1,
      'included_teachers', 1,
      'max_students',      null,
      'assistant',         false,
      'packages',          true,
      'recurring_blocks',  true,
      'vocabulary',        true
    )
    ELSE jsonb_build_object(
      'nome',              'Cronys Essencial',
      'max_teachers',      1,
      'included_teachers', 1,
      'max_students',      5,
      'assistant',         false,
      'packages',          false,
      'recurring_blocks',  false,
      'vocabulary',        false
    )
  END
$$;

COMMENT ON COLUMN public.accounts.lifetime IS
  'Tudo liberado para sempre: plano Max (slug pro) fixo; nenhuma rotina, webhook ou painel rebaixa.';

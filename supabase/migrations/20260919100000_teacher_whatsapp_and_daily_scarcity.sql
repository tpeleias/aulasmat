-- Duas coisas que estavam presas ao formato do negócio do Thiago.

-- ---------------------------------------------------------------------------
-- 1. WhatsApp passa a ser do professor
-- ---------------------------------------------------------------------------
--
-- Eram duas colunas em settings, whatsapp_thiago e whatsapp_mayara: o nome das
-- pessoas dentro do banco. Professor novo não tinha onde pôr o número, e outra
-- empresa herdava campos com os nomes errados.
--
-- whatsapp_enabled separa "não tem número" de "tem, mas não quer divulgar":
-- desligar esconde o botão no app sem apagar o número do cadastro.

ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT true;

UPDATE public.teachers t SET whatsapp = s.whatsapp_thiago
  FROM public.settings s
 WHERE s.account_id = t.account_id
   AND lower(btrim(t.name)) = 'thiago' AND t.whatsapp IS NULL;

UPDATE public.teachers t SET whatsapp = s.whatsapp_mayara
  FROM public.settings s
 WHERE s.account_id = t.account_id
   AND lower(btrim(t.name)) = 'mayara' AND t.whatsapp IS NULL;

ALTER TABLE public.settings DROP COLUMN IF EXISTS whatsapp_thiago;
ALTER TABLE public.settings DROP COLUMN IF EXISTS whatsapp_mayara;

-- ---------------------------------------------------------------------------
-- 2. Escassez por dia da semana
-- ---------------------------------------------------------------------------
--
-- Eram dois pares de números: um para dia de semana, outro para fim de semana.
-- Agora é um par por dia, guardado como um objeto com chave 0 (domingo) a 6.
-- O preenchimento inicial repete exatamente os valores atuais, então nada muda
-- no que a página pública mostra até alguém mexer.

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS scarcity jsonb;

UPDATE public.settings SET scarcity = jsonb_build_object(
  '0', jsonb_build_object('min', scarcity_weekend_min, 'max', scarcity_weekend_max),
  '1', jsonb_build_object('min', scarcity_weekday_min, 'max', scarcity_weekday_max),
  '2', jsonb_build_object('min', scarcity_weekday_min, 'max', scarcity_weekday_max),
  '3', jsonb_build_object('min', scarcity_weekday_min, 'max', scarcity_weekday_max),
  '4', jsonb_build_object('min', scarcity_weekday_min, 'max', scarcity_weekday_max),
  '5', jsonb_build_object('min', scarcity_weekday_min, 'max', scarcity_weekday_max),
  '6', jsonb_build_object('min', scarcity_weekend_min, 'max', scarcity_weekend_max)
) WHERE scarcity IS NULL;

-- Empresa nova já nasce com um padrão razoável, sem depender das colunas antigas.
ALTER TABLE public.settings ALTER COLUMN scarcity SET DEFAULT jsonb_build_object(
  '0', jsonb_build_object('min', 3, 'max', 7),
  '1', jsonb_build_object('min', 1, 'max', 3),
  '2', jsonb_build_object('min', 1, 'max', 3),
  '3', jsonb_build_object('min', 1, 'max', 3),
  '4', jsonb_build_object('min', 1, 'max', 3),
  '5', jsonb_build_object('min', 1, 'max', 3),
  '6', jsonb_build_object('min', 3, 'max', 7)
);

-- As quatro colunas antigas somem: dois lugares guardando a mesma regra é como
-- se descobre, meses depois, que a tela mexe em uma e a página pública lê a outra.
ALTER TABLE public.settings DROP COLUMN IF EXISTS scarcity_weekday_min;
ALTER TABLE public.settings DROP COLUMN IF EXISTS scarcity_weekday_max;
ALTER TABLE public.settings DROP COLUMN IF EXISTS scarcity_weekend_min;
ALTER TABLE public.settings DROP COLUMN IF EXISTS scarcity_weekend_max;

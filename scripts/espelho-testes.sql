-- Testes do valor da aula por empresa e do desconto por família.
--
-- Rodam como o papel `authenticated`, com request.jwt.claim.sub apontando para
-- o usuário da vez. Rodar como dono do banco ignoraria RLS e daria um "tudo
-- certo" falso - foi esse cuidado que pegou os bugs registrados em
-- docs/proximos-passos.md. Ver scripts/espelho-local.sh.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.assert(_ok boolean, _what text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _what; END IF;
  RAISE NOTICE '  ok - %', _what;
END $$;

-- O switch geral do assistente (migration 20260926120000) nasce desligado.
-- Os blocos antigos testam o assistente que vem pelo plano, então ele fica
-- ligado aqui; o bloco 45 testa o desligado.
UPDATE public.platform_settings SET assistant_enabled = true;

-- ---------------------------------------------------------------------------
-- Cenário: duas empresas, a mesma responsável "Ana" nas duas
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  _a uuid := (SELECT id FROM public.accounts WHERE slug = 'portaldeaulas');
  _b uuid;
  _ua uuid := gen_random_uuid();
  _ub uuid := gen_random_uuid();
  _ualuno uuid := gen_random_uuid();
BEGIN
  -- Pro de proposito: os blocos 3 a 8 testam ISOLAMENTO entre empresas, nao
  -- plano. Se ela nascesse no Essencial, eles falhariam por falta de plano e
  -- nao por vazamento - que e o que eles existem para pegar.
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Empresa B', 'b', 'pro') RETURNING id INTO _b;

  -- handle_new_user joga todo usuário novo na empresa pública; com duas
  -- empresas ele deixa nulo. Os papéis são postos na mão, como manda a nota
  -- sobre criar login por SQL em docs/proximos-passos.md.
  INSERT INTO auth.users (id, email) VALUES (_ua, 'admin-a@x'), (_ub, 'admin-b@x'), (_ualuno, 'aluno-a@x');
  DELETE FROM public.user_roles WHERE user_id IN (_ua, _ub, _ualuno);
  INSERT INTO public.user_roles (user_id, role, account_id)
  VALUES (_ua, 'admin', _a), (_ub, 'admin', _b), (_ualuno, 'student', _a);

  INSERT INTO public.settings (account_id, default_lesson_price) VALUES (_b, 300.00);

  INSERT INTO public.students (account_id, student_name, guardian_name, user_id)
  VALUES (_a, 'Bia', 'Ana', _ualuno), (_a, 'Caio', 'Ana', NULL), (_b, 'Duda', 'Ana', NULL);

  PERFORM set_config('teste.a', _a::text, false);
  PERFORM set_config('teste.b', _b::text, false);
  PERFORM set_config('teste.ua', _ua::text, false);
  PERFORM set_config('teste.ub', _ub::text, false);
  PERFORM set_config('teste.ualuno', _ualuno::text, false);
END $$;

\echo ''
\echo '--- 1. O valor da aula sai das configurações da empresa ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);

-- Sem informar preço: o gatilho preenche com o valor da empresa A.
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES ('Bia', 'Ana', 'thiago', '2026-10-01 10:00-03', 60);
SELECT public.assert((SELECT price FROM public.lessons WHERE student_name = 'Bia') = 220.00,
  'aula sem preço nasce com o valor da empresa (220)');

-- Preço informado à mão continua valendo.
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, price)
VALUES ('Caio', 'Ana', 'thiago', '2026-10-01 14:00-03', 60, 150.00);
SELECT public.assert((SELECT price FROM public.lessons WHERE student_name = 'Caio') = 150.00,
  'preço informado na aula não é sobrescrito');
COMMIT;

-- Trocar o valor nas configurações muda as próximas aulas, não as antigas.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
UPDATE public.settings SET default_lesson_price = 250.00 WHERE account_id = current_setting('teste.a')::uuid;
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES ('Bia', 'Ana', 'thiago', '2026-10-08 10:00-03', 60);
SELECT public.assert(
  (SELECT price FROM public.lessons WHERE student_name = 'Bia' AND start_at = '2026-10-08 10:00-03') = 250.00,
  'aula nova pega o valor novo');
SELECT public.assert(
  (SELECT price FROM public.lessons WHERE student_name = 'Bia' AND start_at = '2026-10-01 10:00-03') = 220.00,
  'aula antiga fica com o valor que tinha');
UPDATE public.settings SET default_lesson_price = 220.00 WHERE account_id = current_setting('teste.a')::uuid;
DELETE FROM public.lessons WHERE start_at = '2026-10-08 10:00-03';
COMMIT;

\echo ''
\echo '--- 2. O valor é o da empresa DONA da aula, não o de quem está logado ---'

-- O caso que motivou account_lesson_price(uuid) em vez de effective_account_id():
-- o assistente de IA grava com chave mestra, sem usuário logado. Uma função
-- baseada na empresa "em vigor" cairia na dona do endereço público (a empresa A)
-- e carimbaria o preço do Thiago dentro da aula da empresa B.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES (current_setting('teste.b')::uuid, 'Duda', 'Ana', 'bruno', '2026-10-02 10:00-03', 60);
SELECT public.assert((SELECT price FROM public.lessons WHERE student_name = 'Duda') = 300.00,
  'aula da empresa B criada sem login usa o valor de B (300), não o de A');
COMMIT;

\echo ''
\echo '--- 3. Desconto fixo em porcentagem ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);

SELECT public.set_account_discount('Bia', 'Ana', 'percent', 10);

-- A aula ainda não é realizada: não há cobrança nem desconto.
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions WHERE guardian_name = 'Ana') = 0,
  'aula agendada não gera cobrança nem desconto');

UPDATE public.lessons SET status = 'realizada' WHERE student_name = 'Bia' AND start_at = '2026-10-01 10:00-03';

SELECT public.assert((SELECT amount FROM public.wallet_transactions
                       WHERE student_name = 'Bia' AND kind = 'lesson') = -220.00,
  'a cobrança entra pelo valor cheio');
SELECT public.assert((SELECT amount FROM public.wallet_transactions
                       WHERE student_name = 'Bia' AND kind = 'voucher') = 22.00,
  'o desconto de 10% entra como crédito de 22,00');
SELECT public.assert((SELECT description FROM public.wallet_transactions
                       WHERE student_name = 'Bia' AND kind = 'voucher') LIKE 'Desconto de 10%%',
  'o crédito se descreve como "Desconto de 10%"');
COMMIT;

\echo ''
\echo '--- 4. O desconto é da família inteira, não de um aluno ---'

-- Mesma regra da tela: havendo responsável, a conta é dele - é por isso que
-- dois irmãos dividem uma carteira só.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
UPDATE public.lessons SET status = 'realizada' WHERE student_name = 'Caio';
SELECT public.assert((SELECT amount FROM public.wallet_transactions
                       WHERE student_name = 'Caio' AND kind = 'voucher') = 15.00,
  'o irmão Caio (aula de 150) recebe os mesmos 10%');
COMMIT;

\echo ''
\echo '--- 5. Mudar e tirar o desconto recalcula o que já existe ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);

SELECT public.set_account_discount('Bia', 'Ana', 'percent', 50);
SELECT public.assert((SELECT amount FROM public.wallet_transactions
                       WHERE student_name = 'Bia' AND kind = 'voucher') = 110.00,
  'subir para 50% recalcula a aula já realizada');

-- Em reais o desconto sai de CADA aula, e nunca passa do valor dela.
SELECT public.set_account_discount('Bia', 'Ana', 'amount', 500);
SELECT public.assert((SELECT amount FROM public.wallet_transactions
                       WHERE student_name = 'Bia' AND kind = 'voucher') = 220.00,
  'desconto em reais maior que a aula é aparado no valor da aula');
SELECT public.assert((SELECT sum(amount) FROM public.wallet_transactions WHERE student_name = 'Bia') = 0,
  'aparado assim, a conta da aula fecha em zero e não vira crédito do nada');

SELECT public.set_account_discount('Bia', 'Ana', NULL, NULL);
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions
                       WHERE guardian_name = 'Ana' AND kind = 'voucher') = 0,
  'tirar o desconto apaga os créditos que ele tinha lançado');
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 0,
  'e apaga a regra');
COMMIT;

\echo ''
\echo '--- 6. Voucher lançado à mão não é mexido pelo desconto fixo ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);

-- É o desconto avulso da tela de Cobrança: sem lesson_id, e por isso fora do
-- alcance de sync_lesson_wallet.
SELECT public.register_payment('Bia', 'Ana', 0, 'voucher', NULL, 30, 'Cortesia combinada');
SELECT public.set_account_discount('Bia', 'Ana', 'percent', 10);
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions
                       WHERE guardian_name = 'Ana' AND kind = 'voucher' AND lesson_id IS NULL) = 1,
  'o voucher avulso continua lá depois de pôr um desconto fixo');

SELECT public.set_account_discount('Bia', 'Ana', NULL, NULL);
SELECT public.assert((SELECT amount FROM public.wallet_transactions
                       WHERE guardian_name = 'Ana' AND kind = 'voucher' AND lesson_id IS NULL) = 30.00,
  'e continua lá depois de tirar o desconto fixo');
DELETE FROM public.wallet_transactions WHERE lesson_id IS NULL AND kind = 'voucher';
COMMIT;

\echo ''
\echo '--- 7. Aula que deixa de ser realizada leva cobrança e desconto junto ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.set_account_discount('Bia', 'Ana', 'percent', 10);
UPDATE public.lessons SET status = 'cancelada' WHERE student_name = 'Bia' AND start_at = '2026-10-01 10:00-03';
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions WHERE student_name = 'Bia') = 0,
  'cancelar a aula tira a cobrança e o desconto dela');

UPDATE public.lessons SET status = 'realizada' WHERE student_name = 'Bia' AND start_at = '2026-10-01 10:00-03';
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions
                       WHERE student_name = 'Bia' AND kind = 'voucher') = 1,
  'voltar para realizada lança os dois de novo, sem duplicar');
COMMIT;

\echo ''
\echo '--- 8. O desconto não atravessa a parede entre empresas ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ub'), true);

-- A empresa B tem uma responsável "Ana" também. O desconto da Ana da empresa A
-- não pode valer para ela.
UPDATE public.lessons SET status = 'realizada' WHERE student_name = 'Duda';
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions
                       WHERE student_name = 'Duda' AND kind = 'voucher') = 0,
  'a "Ana" da empresa B não herda o desconto da "Ana" da empresa A');
SELECT public.assert((SELECT amount FROM public.wallet_transactions
                       WHERE student_name = 'Duda' AND kind = 'lesson') = -300.00,
  'e a aula dela é cobrada pelo valor de B');

-- O admin de B não enxerga nem alcança a regra de desconto de A.
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 0,
  'o admin de B não lê o desconto de A');
-- Mexer no desconto da "Ana" daqui alcança só a aula da Ana DAQUI (a Duda).
-- As duas aulas da Ana da empresa A não entram na conta.
SELECT public.assert((SELECT public.set_account_discount('Bia', 'Ana', 'percent', 90)
                      ->> 'lessons_recalculated')::int = 1,
  'mexer no desconto da "Ana" de B recalcula 1 aula (a de B), não as 2 de A');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 1,
  'o admin de A continua vendo só o desconto dele');
SELECT public.assert((SELECT value FROM public.account_discounts) = 10.00,
  'e o valor dele não virou os 90% que o admin de B acabou de pôr');
SELECT public.assert((SELECT amount FROM public.wallet_transactions
                       WHERE student_name = 'Bia' AND kind = 'voucher') = 22.00,
  'e o crédito das aulas de A segue nos 10% de sempre');
COMMIT;

\echo ''
\echo '--- 9. Quem não é admin não chega perto ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 0,
  'o responsável não lê a tabela de descontos');
DO $$
BEGIN
  PERFORM public.set_account_discount('Bia', 'Ana', 'percent', 90);
  RAISE EXCEPTION 'FALHOU: o responsável conseguiu dar desconto a si mesmo';
EXCEPTION WHEN sqlstate '42501' OR sqlstate 'P0001' THEN
  IF sqlstate = 'P0001' AND sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - o responsável não consegue dar desconto a si mesmo';
END $$;

-- O mesmo caminho em register_payment estava aberto: a guarda olhava
-- current_user, que dentro de SECURITY DEFINER é sempre o dono da função.
-- Qualquer responsável logado creditava o que quisesse na própria carteira.
-- Ver a seção 6 da migration 20260921120000.
DO $$
BEGIN
  PERFORM public.register_payment('Bia', 'Ana', 9999.00, 'adjustment', 'me perdoei');
  RAISE EXCEPTION 'FALHOU: o responsável conseguiu se creditar dinheiro';
EXCEPTION WHEN sqlstate '42501' OR sqlstate 'P0001' THEN
  IF sqlstate = 'P0001' AND sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - o responsável não consegue se creditar dinheiro';
END $$;
ROLLBACK;

-- E a chave mestra, que é quem o assistente de IA usa, continua passando.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.assert(
  (public.register_payment('Bia', 'Ana', 10.00, 'adjustment', 'pelo assistente',
                           0, NULL, current_setting('teste.a')::uuid) ->> 'payment_id') IS NOT NULL,
  'a chave mestra (assistente de IA) continua podendo lançar pagamento');
ROLLBACK;

\echo ''
\echo '--- 10. Valores impossíveis são recusados ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('percent', 150.0, 'porcentagem acima de 100'),
    ('percent', 0.0,   'porcentagem zero'),
    ('amount',  -5.0,  'desconto negativo'),
    ('cupom',   10.0,  'tipo que não existe')
  ) AS t(k, v, what) LOOP
    BEGIN
      PERFORM public.set_account_discount('Bia', 'Ana', r.k, r.v);
      RAISE EXCEPTION 'FALHOU: aceitou %', r.what;
    EXCEPTION WHEN sqlstate 'P0001' THEN
      IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
      RAISE NOTICE '  ok - recusa %', r.what;
    END;
  END LOOP;
END $$;

-- Valor da aula zerado ou negativo também não passa.
DO $$
BEGIN
  UPDATE public.settings SET default_lesson_price = 0 WHERE account_id = current_setting('teste.a')::uuid;
  RAISE EXCEPTION 'FALHOU: aceitou valor de aula zero';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - recusa valor de aula zero';
END $$;
ROLLBACK;

\echo ''
\echo '--- 11. O extrato fecha ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.set_account_discount('Bia', 'Ana', 'percent', 10);
-- Bia 220 e Caio 150, ambas realizadas, 10% de desconto: devidos 333,00.
SELECT public.assert((SELECT -sum(amount) FROM public.wallet_transactions WHERE guardian_name = 'Ana') = 333.00,
  'duas aulas (220 + 150) com 10% deixam 333,00 a receber');
SELECT public.register_payment('Bia', 'Ana', 333.00, 'adjustment', 'Pix');
SELECT public.assert((SELECT sum(amount) FROM public.wallet_transactions WHERE guardian_name = 'Ana') = 0,
  'pago o valor com desconto, a conta fecha em zero');
COMMIT;

\echo ''
\echo '=== TODOS OS TESTES PASSARAM ==='

\echo ''
\echo '--- 12. A rotina noturna também aplica o desconto ---'

-- Em produção quase nenhuma aula é marcada como realizada à mão: quem marca é
-- mark_past_lessons_realizada, agendada no pg_cron, sem ninguém logado. Se o
-- desconto dependesse de auth.uid() funcionaria na tela e falharia todas as
-- noites - em silêncio, porque ninguém está olhando.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, status)
VALUES ('Bia', 'Ana', 'thiago', now() - interval '2 hours', 60, 'agendada');
COMMIT;

-- Como a rotina roda: sem usuário, com os poderes de quem a criou.
BEGIN;
SELECT public.mark_past_lessons_realizada();
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((SELECT count(*) FROM public.lessons
                       WHERE student_name = 'Bia' AND status = 'realizada') = 2,
  'a rotina marcou a aula passada como realizada');
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions
                       WHERE student_name = 'Bia' AND kind = 'voucher') = 2,
  'e o desconto de 10% foi lançado na aula que ela marcou, sem ninguém logado');
COMMIT;

\echo ''

\echo ''
\echo '--- 13. O gestor da plataforma ---'

DO $$
DECLARE _op uuid := gen_random_uuid();
BEGIN
  -- O operador é uma conta SEM empresa: nenhuma linha em user_roles.
  INSERT INTO auth.users (id, email) VALUES (_op, 'gestor@x');
  DELETE FROM public.user_roles WHERE user_id = _op;
  INSERT INTO public.platform_admins (user_id, note) VALUES (_op, 'teste');
  PERFORM set_config('teste.op', _op::text, false);
END $$;

-- A trava que mais importa: o operador enxerga CONTAGENS e nada mais.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);

SELECT public.assert((SELECT count(*) FROM public.platform_accounts_overview()) = 2,
  'o operador vê as 2 empresas no painel');
SELECT public.assert((SELECT alunos FROM public.platform_accounts_overview() WHERE slug = 'portaldeaulas') = 2,
  'e as contagens de cada uma (2 alunos na empresa A)');
SELECT public.assert((SELECT responsaveis FROM public.platform_accounts_overview() WHERE slug = 'portaldeaulas') = 1,
  'responsáveis contam a família, não o aluno (Bia e Caio = 1 responsável)');

-- Sem empresa, as políticas de acesso não devolvem linha nenhuma.
SELECT public.assert((SELECT count(*) FROM public.lessons) = 0, 'o operador não lê aula de ninguém');
SELECT public.assert((SELECT count(*) FROM public.students) = 0, 'nem aluno');
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions) = 0, 'nem o financeiro');
SELECT public.assert((SELECT count(*) FROM public.platform_admins) = 0, 'nem a própria lista de operadores');
SELECT public.assert((SELECT count(*) FROM public.deleted_account_archives) = 0, 'nem o arquivo de exclusões');
COMMIT;

-- Quem não é operador não chega ao painel, nem sendo admin da própria empresa.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
DO $$
BEGIN
  PERFORM public.platform_accounts_overview();
  RAISE EXCEPTION 'FALHOU: o admin de uma empresa abriu o painel da plataforma';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - o admin de uma empresa não abre o painel da plataforma';
END $$;
DO $$
BEGIN
  PERFORM public.platform_create_account('Pirata', 'pirata');
  RAISE EXCEPTION 'FALHOU: o admin de uma empresa criou outra empresa';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - nem cria empresa';
END $$;
ROLLBACK;

\echo ''
\echo '--- 14. Criar empresa ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);

SELECT public.assert((public.platform_create_account('Empresa C', 'empresa-c') ->> 'id') IS NOT NULL,
  'o operador cria uma empresa');

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Outra', 'empresa-c',    'apelido repetido'),
    ('Outra', 'AB',           'apelido curto demais'),
    ('Outra', 'Com Maiúscula','apelido com maiúscula e espaço'),
    ('',      'valido',       'nome vazio')
  ) AS t(n, s, what) LOOP
    BEGIN
      PERFORM public.platform_create_account(r.n, r.s);
      RAISE EXCEPTION 'FALHOU: aceitou %', r.what;
    EXCEPTION WHEN sqlstate 'P0001' THEN
      IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
      RAISE NOTICE '  ok - recusa %', r.what;
    END;
  END LOOP;
END $$;
COMMIT;

-- Conferido de fora do RLS, porque o operador não enxerga linha de empresa
-- nenhuma - inclusive a que ele acabou de criar. Essa é justamente a trava
-- que o bloco 13 verifica.
SELECT public.assert((SELECT count(*) FROM public.settings s JOIN public.accounts a ON a.id = s.account_id
                       WHERE a.slug = 'empresa-c') = 1,
  'a empresa nova já nasce com configurações (senão a primeira tela parece quebrada)');
SELECT public.assert((SELECT default_lesson_price FROM public.settings s JOIN public.accounts a ON a.id = s.account_id
                       WHERE a.slug = 'empresa-c') = 220.00,
  'e com o valor de aula padrão, que o dono dela troca depois');

\echo ''
\echo '--- 15. Desativar, e só então excluir ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);

-- A empresa de produção é a do endereço público: não se desativa nem se apaga.
DO $$
BEGIN
  PERFORM public.platform_set_account_active(current_setting('teste.a')::uuid, false);
  RAISE EXCEPTION 'FALHOU: desativou a empresa do endereço público';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - não desativa a empresa do endereço público';
END $$;

-- Empresa ativa não se apaga, nem com o nome certo.
DO $$
BEGIN
  PERFORM public.platform_delete_account(current_setting('teste.b')::uuid, 'Empresa B');
  RAISE EXCEPTION 'FALHOU: apagou uma empresa ativa';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - não apaga empresa ativa (precisa desativar antes)';
END $$;

SELECT public.platform_set_account_active(current_setting('teste.b')::uuid, false);

-- Desativada, mas com o nome errado: continua não apagando.
DO $$
BEGIN
  PERFORM public.platform_delete_account(current_setting('teste.b')::uuid, 'empresa b');
  RAISE EXCEPTION 'FALHOU: apagou com o nome digitado errado';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - não apaga com o nome digitado errado';
END $$;
COMMIT;

\echo ''
\echo '--- 16. A exclusão apaga tudo, e guarda tudo ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_delete_account(current_setting('teste.b')::uuid, 'Empresa B')
                      -> 'counts' ->> 'lessons')::int = 1,
  'a exclusão relata o que levou junto (1 aula da empresa B)');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((SELECT count(*) FROM public.platform_accounts_overview() WHERE slug = 'b') = 0,
  'a empresa sumiu do painel');
COMMIT;

-- Nada da empresa B sobrou espalhado pelo banco...
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE student_name = 'Duda') = 0,
  'e as aulas dela sumiram junto');
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions
                       WHERE account_id = current_setting('teste.b')::uuid) = 0,
  'e o financeiro dela também');

-- ...mas está tudo guardado, que é o que torna essa exclusão reversível.
SELECT public.assert((SELECT jsonb_array_length(payload -> 'lessons') FROM public.deleted_account_archives
                       WHERE slug = 'b') = 1,
  'o arquivo guardou a aula, linha por linha, para dar para voltar atrás');
SELECT public.assert((SELECT payload -> 'account' ->> 'name' FROM public.deleted_account_archives
                       WHERE slug = 'b') = 'Empresa B',
  'e guardou a própria empresa');

-- A empresa de produção passou por tudo isso intacta.
SELECT public.assert((SELECT count(*) FROM public.lessons
                       WHERE account_id = current_setting('teste.a')::uuid) = 3,
  'a empresa A não perdeu nenhuma das 3 aulas dela no processo');


\echo ''
\echo '--- 17. Planos: o limite e do banco, nao da tela (clientes ATIVOS) ---'

-- A empresa A e Pro (dona do endereco publico). Criamos uma Essencial do zero.
DO $$
DECLARE _e uuid; _ua uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Essencial Ltda', 'essencial-ltda', 'essencial')
  RETURNING id INTO _e;
  INSERT INTO public.settings (account_id) VALUES (_e);
  INSERT INTO auth.users (id, email) VALUES (_ua, 'admin-e@x');
  DELETE FROM public.user_roles WHERE user_id = _ua;
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_ua, 'admin', _e);
  PERFORM set_config('teste.e', _e::text, false);
  PERFORM set_config('teste.uae', _ua::text, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);

SELECT public.assert(public.account_plan() = 'essencial', 'a empresa nova nasce no Essencial');
SELECT public.assert(public.account_limit('students') IS NULL, 'cadastrar cliente e livre');
SELECT public.assert((public.my_plan() ->> 'max_active_clients')::int = 10, 'o limite e de 10 clientes ATIVOS');
SELECT public.assert((public.my_plan() ->> 'active_client_days')::int = 60, 'ativo = atendimento nos ultimos 60 dias ou marcado');
SELECT public.assert(public.account_limit('teachers') = 1, 'e de 1 professor');
SELECT public.assert(public.account_can('assistant') = false, 'sem assistente');
SELECT public.assert(public.account_can('packages') = false, 'sem pacotes/vouchers');
SELECT public.assert(public.account_can('recurring_blocks') = false, 'sem bloqueio recorrente');
SELECT public.assert(public.account_can('vocabulary') = true, 'palavras do ramo agora vem no Essencial');

-- Cadastro livre: 12 clientes entram.
INSERT INTO public.students (student_name, guardian_name) VALUES
  ('A1','R1'), ('A2','R2'), ('A3','R3'), ('A4','R4'), ('A5','R5');
INSERT INTO public.students (student_name) VALUES ('B6'),('B7'),('B8'),('B9'),('B10'),('B11'),('B12');
SELECT public.assert((SELECT count(*) FROM public.students) = 12, 'doze clientes cadastrados, sem limite de cadastro');

-- 1 professor passa; o segundo nao.
INSERT INTO public.teachers (name, active) VALUES ('Unico', true);
DO $$
BEGIN
  INSERT INTO public.teachers (name, active) VALUES ('Segundo', true);
  RAISE EXCEPTION 'FALHOU: cadastrou o segundo professor no Essencial';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - o segundo professor e recusado';
END $$;

-- Desligar e religar nao burla o limite.
INSERT INTO public.teachers (name, active) VALUES ('Reserva', false);
DO $$
BEGIN
  UPDATE public.teachers SET active = true WHERE name = 'Reserva';
  RAISE EXCEPTION 'FALHOU: reativou um segundo professor';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - reativar um professor desativado tambem respeita o limite';
END $$;

-- Dez clientes com atendimento marcado: todos entram.
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
SELECT n, g, 'unico', now() + make_interval(days => 3, hours => i), 60
  FROM (VALUES (1,'A1','R1'),(2,'A2','R2'),(3,'A3','R3'),(4,'A4','R4'),(5,'A5','R5'),
               (6,'B6',NULL),(7,'B7',NULL),(8,'B8',NULL),(9,'B9',NULL),(10,'B10',NULL)) v(i, n, g);
SELECT public.assert(public.active_client_count() = 10, '10 clientes ativos');
-- O decimo primeiro nao.
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, teacher, start_at, duration_minutes)
  VALUES ('B11', 'unico', now() + interval '5 days', 60);
  RAISE EXCEPTION 'FALHOU: marcou para o 11o cliente ativo';
EXCEPTION WHEN check_violation THEN
  IF sqlerrm NOT LIKE '%clientes novos%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - o 11o cliente ativo e recusado pelo BANCO';
END $$;
-- Quem ja e ativo continua marcando.
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES ('A1', 'R1', 'unico', now() + interval '10 days', 60);
SELECT public.assert(public.active_client_count() = 10, 'segundo atendimento do mesmo cliente nao conta de novo');
-- Atendimento antigo (fora dos 60 dias) nao torna ninguem ativo.
INSERT INTO public.lessons (student_name, teacher, start_at, duration_minutes, status)
VALUES ('B12', 'unico', now() - interval '90 days', 60, 'realizada');
SELECT public.assert(public.active_client_count() = 10, 'atendimento de 90 dias atras nao conta');
-- Desmarcar libera vaga, e o inativo pode voltar.
UPDATE public.lessons SET status = 'cancelada' WHERE student_name = 'B10';
SELECT public.assert(public.active_client_count() = 9, 'desmarcado nao conta');
INSERT INTO public.lessons (student_name, teacher, start_at, duration_minutes)
VALUES ('B12', 'unico', now() + interval '6 days', 60);
SELECT public.assert(public.active_client_count() = 10, 'o cliente inativo volta quando ha vaga');
-- Marcar como feito nao e "cliente novo".
UPDATE public.lessons SET status = 'realizada' WHERE student_name = 'B9';
SELECT public.assert((SELECT status FROM public.lessons WHERE student_name = 'B9') = 'realizada',
  'marcar como feito no limite continua livre');

-- Bloqueio pontual sim, recorrente nao.
INSERT INTO public.blocks (title, teacher, block_type, start_at, end_at)
VALUES ('Consulta', 'unico', 'one_off', '2026-11-10 14:00-03', '2026-11-10 16:00-03');
SELECT public.assert((SELECT count(*) FROM public.blocks) = 1, 'bloqueio pontual vale no Essencial');
DO $$
BEGIN
  INSERT INTO public.blocks (title, teacher, block_type, weekday, start_time, end_time)
  VALUES ('Toda terca', 'unico', 'recurring', 2, '14:00', '16:00');
  RAISE EXCEPTION 'FALHOU: criou bloqueio recorrente no Essencial';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - bloqueio recorrente e recusado no Essencial';
END $$;

-- Dinheiro recebido sim; pacote e voucher nao.
SELECT public.assert((public.register_payment('A1','R1', 100, 'adjustment', 'Pix') ->> 'payment_id') IS NOT NULL,
  'registrar pagamento recebido continua valendo no Essencial');
DO $$
BEGIN
  PERFORM public.register_payment('A1','R1', 2000, 'package', 'Pacote', 200, 'Voucher');
  RAISE EXCEPTION 'FALHOU: lancou pacote no Essencial';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - pacote/voucher e recusado no Essencial';
END $$;
DO $$
BEGIN
  PERFORM public.set_account_discount('A1','R1','percent',10);
  RAISE EXCEPTION 'FALHOU: criou desconto fixo no Essencial';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - desconto por familia e recusado no Essencial';
END $$;
COMMIT;

-- Outra empresa nao ve a contagem desta.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
DO $$
BEGIN
  PERFORM public.active_client_count_for(current_setting('teste.a')::uuid);
  RAISE EXCEPTION 'FALHOU: admin contou clientes de outra empresa';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - a contagem por empresa nao e publica';
END $$;
ROLLBACK;

\echo ''
\echo '--- 18. Subir e rebaixar: nada se apaga, cliente nao trava, profissional o admin escolhe ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.e')::uuid, 'pro') ->> 'plan') = 'pro',
  'o gestor muda a empresa para Max');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
SELECT public.assert((public.my_plan() ->> 'max_active_clients') IS NULL, 'no Max nao ha limite de clientes');
SELECT public.assert(public.account_can('assistant') = false, 'Max sem assinatura paga nao traz o assistente');
INSERT INTO public.students (student_name) VALUES ('A6');
INSERT INTO public.teachers (name, active) VALUES ('Segundo', true);
INSERT INTO public.blocks (title, teacher, block_type, weekday, start_time, end_time)
VALUES ('Toda terca', 'unico', 'recurring', 2, '14:00', '16:00');
SELECT public.assert((public.set_account_discount('A1','R1','percent',10) ->> 'removed') = 'false',
  'e o desconto por familia passa a ser aceito');
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES ('A6', NULL, 'segundo', now() + interval '20 days', 60);
SELECT public.assert(public.active_client_count() = 11, '11 clientes ativos no Max');
COMMIT;

-- Rebaixar: cliente NENHUM trava; os 2 professores ativos (limite 1) ficam pausados.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert(
  (SELECT coalesce(r ->> 'alunos_travados', '0') = '0' AND r ->> 'professores_travados' = '2'
     FROM (SELECT public.platform_set_account_plan(current_setting('teste.e')::uuid, 'essencial') AS r) x),
  'rebaixar nao trava cliente; pausa os 2 profissionais ativos');
SELECT public.assert(
  (SELECT alunos_travados = 0 AND professores_travados = 2
     FROM public.platform_accounts_overview() WHERE id = current_setting('teste.e')::uuid),
  'e o painel do gestor mostra isso');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
SELECT public.assert((SELECT count(*) FROM public.students) = 13, 'nada e apagado: os 13 clientes continuam');
SELECT public.assert((SELECT count(*) FROM public.students WHERE plan_locked) = 0, 'nenhum cliente travado');
SELECT public.assert((SELECT count(*) FROM public.lessons) = 14, 'nenhum atendimento apagado');
SELECT public.assert((SELECT count(*) FROM public.teachers WHERE active) = 0, 'nenhum profissional ativo ate o admin escolher');
SELECT public.assert((SELECT active FROM public.teachers WHERE name = 'Reserva') = false
                     AND (SELECT plan_locked FROM public.teachers WHERE name = 'Reserva') = false,
  'o professor que o dono ja tinha desligado NAO vira travado-pelo-plano');
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE student_name = 'A6' AND status = 'agendada') = 1,
  'o atendimento ja marcado continua marcado');
SELECT public.assert((SELECT count(*) FROM public.blocks WHERE block_type='recurring') = 1,
  'o bloqueio recorrente que ja existia continua');
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 1,
  'e o desconto que ja existia tambem');
UPDATE public.students SET guardian_name = 'R1 editado' WHERE student_name = 'A1';
SELECT public.assert((SELECT count(*) FROM public.students WHERE guardian_name='R1 editado') = 1,
  'editar cliente continua funcionando');
SELECT public.assert((public.set_account_discount('A1','R1 editado', NULL, NULL) ->> 'removed') = 'true',
  'e tirar um desconto continua livre, para ela poder desfazer');

-- O admin escolhe o profissional que fica.
UPDATE public.teachers SET active = true WHERE name = 'Unico';
SELECT public.assert((SELECT plan_locked FROM public.teachers WHERE name = 'Unico') = false,
  'reativar o professor limpa a marca de travado');
UPDATE public.lessons SET guardian_name = 'R1 editado' WHERE student_name = 'A1';
DO $$
BEGIN
  UPDATE public.teachers SET active = true WHERE name = 'Segundo';
  RAISE EXCEPTION 'FALHOU: reativou o segundo professor';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - o segundo professor nao volta';
END $$;

-- 11 ativos com limite 10: os que ja sao ativos seguem; cliente novo nao entra.
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES ('A1', 'R1 editado', 'unico', now() + interval '12 days', 60);
SELECT public.assert(true, 'cliente ja ativo continua recebendo atendimento acima do limite');
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, teacher, start_at, duration_minutes)
  VALUES ('B11', 'unico', now() + interval '13 days', 60);
  RAISE EXCEPTION 'FALHOU: entrou cliente novo acima do limite';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - cliente novo nao entra ate ficar abaixo do limite';
END $$;
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
  VALUES ('A1', 'R1 editado', 'segundo', now() + interval '14 days', 60);
  RAISE EXCEPTION 'FALHOU: marcou com professor pausado';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - professor pausado nao recebe atendimento novo';
END $$;
-- Mudar horario e desmarcar continuam livres.
UPDATE public.lessons SET start_at = start_at + interval '1 hour' WHERE student_name = 'A6';
UPDATE public.lessons SET status = 'cancelada' WHERE student_name = 'A6';
SELECT public.assert((SELECT status FROM public.lessons WHERE student_name = 'A6') = 'cancelada',
  'mudar horario e desmarcar continuam livres');
COMMIT;

-- O admin NAO chama a trava diretamente (ela recebe a empresa por parametro).
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
DO $$
BEGIN
  PERFORM public.lock_over_plan_limits(current_setting('teste.a')::uuid);
  RAISE EXCEPTION 'FALHOU: admin chamou lock_over_plan_limits';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - admin nao trava nada de outra empresa';
END $$;
DO $$
BEGIN
  PERFORM public.release_plan_locks(current_setting('teste.e')::uuid);
  RAISE EXCEPTION 'FALHOU: admin chamou release_plan_locks';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - nem se destrava sozinho';
END $$;
ROLLBACK;

-- Voltar ao Max solta o profissional que o plano pausou.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert(
  (SELECT r ->> 'professores_liberados' = '1'
     FROM (SELECT public.platform_set_account_plan(current_setting('teste.e')::uuid, 'pro') AS r) x),
  'voltar ao Max libera o professor que ficou pausado');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
SELECT public.assert((SELECT active FROM public.teachers WHERE name = 'Segundo'), 'o Segundo volta ativo');
SELECT public.assert((SELECT active FROM public.teachers WHERE name = 'Reserva') = false,
  'e o Reserva, que o dono tinha desligado, continua desligado');
COMMIT;

-- Deixa a empresa no Essencial para os blocos seguintes.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.platform_set_account_plan(current_setting('teste.e')::uuid, 'essencial');
COMMIT;

\echo ''
\echo '--- 19. O assistente pode ser dado a mao, sem mudar o plano ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.e')::uuid, NULL, true) ->> 'assistant') = 'true',
  'o gestor liga o assistente sem mudar o plano (cortesia/teste)');
-- Pela funcao, e nao pela tabela: o operador nao le accounts (bloco 13).
SELECT public.assert(public.account_plan(current_setting('teste.e')::uuid) = 'essencial',
  'e a empresa continua no Essencial');
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.e')::uuid, NULL, NULL, true) ->> 'assistant') = 'false',
  'e limpar a excecao devolve a decisao ao plano');
COMMIT;

-- Quem nao e gestor nao muda plano nenhum.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
DO $$
BEGIN
  PERFORM public.platform_set_account_plan(current_setting('teste.e')::uuid, 'pro');
  RAISE EXCEPTION 'FALHOU: o admin da empresa deu Pro para si mesmo';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - o admin da empresa NAO consegue se dar o Pro';
END $$;
ROLLBACK;

\echo ''
\echo '--- 20. A empresa de producao nao foi afetada ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert(public.account_plan() = 'pro', 'a empresa do endereco publico e Pro');
SELECT public.assert(public.account_limit('students') IS NULL, 'sem limite de alunos');
SELECT public.assert(public.account_can('assistant'), 'com assistente (empresa do Thiago: tudo liberado para sempre)');
SELECT public.assert((public.my_plan() ->> 'nome') = 'Cronys Max' AND (public.my_plan() ->> 'plano') = 'pro', 'e my_plan() se apresenta como Cronys Max (plano "pro")');
COMMIT;


\echo ''
\echo '--- 21. Desligar o assistente de uma empresa PRO, a mao ---'

-- A empresa A e Pro. O gestor desliga o assistente dela sem rebaixar o plano.
-- Ela e a empresa marcada como "para sempre" (bloco 31): o teste tira a marca
-- enquanto roda, porque aqui o que se testa e uma empresa Pro comum.
UPDATE public.accounts SET lifetime = false, lifetime_assistant = false WHERE id = current_setting('teste.a')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.a')::uuid, NULL, false) ->> 'assistant') = 'false',
  'o gestor desliga o assistente de uma empresa Pro');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((public.my_plan() ->> 'plano') = 'pro',
  'a empresa continua Pro');
SELECT public.assert((public.my_plan() ->> 'assistant') = 'false',
  'mas sem assistente');
SELECT public.assert((public.my_plan() ->> 'assistant_override') = 'false',
  'e o app sabe que foi desligado A MAO, nao pelo plano - e o que decide se a tela vende ou avisa');
-- O resto do Pro continua de pe: desligar o assistente nao rebaixa nada.
SELECT public.assert((public.my_plan() -> 'max_students') = 'null'::jsonb,
  'e o resto do Pro continua: sem limite de alunos');
SELECT public.assert((public.my_plan() ->> 'packages') = 'true',
  'e com pacotes');
COMMIT;

-- E a recusa vale de verdade: nao e so a tela que esconde.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert(public.account_can('assistant') = false,
  'o banco tambem recusa o assistente para ela (e o que a edge function consulta)');
COMMIT;

-- Devolver ao plano religa.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.a')::uuid, NULL, NULL, true) ->> 'assistant') = 'true',
  'limpar a excecao religa o assistente da empresa Pro');
COMMIT;
UPDATE public.accounts SET lifetime = true, lifetime_assistant = true WHERE id = current_setting('teste.a')::uuid;

\echo ''
\echo '--- 22. Renomear empresa ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);

SELECT public.assert((public.platform_rename_account(current_setting('teste.e')::uuid, '  Escola Nova  ') ->> 'name') = 'Escola Nova',
  'o gestor renomeia a empresa (e o nome vem sem espacos nas pontas)');
SELECT public.assert((SELECT name FROM public.platform_accounts_overview() WHERE slug = 'essencial-ltda') = 'Escola Nova',
  'e o painel ja mostra o nome novo');
SELECT public.assert((SELECT slug FROM public.platform_accounts_overview() WHERE name = 'Escola Nova') = 'essencial-ltda',
  'o apelido NAO muda junto - ele vira endereco e quebraria link ja divulgado');

DO $$
BEGIN
  PERFORM public.platform_rename_account(current_setting('teste.e')::uuid, '   ');
  RAISE EXCEPTION 'FALHOU: aceitou nome vazio';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - recusa nome vazio';
END $$;
COMMIT;

-- Renomear nao destrava exclusao: a checagem le o nome ATUAL.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.platform_set_account_active(current_setting('teste.e')::uuid, false);
DO $$
BEGIN
  PERFORM public.platform_delete_account(current_setting('teste.e')::uuid, 'Essencial Ltda');
  RAISE EXCEPTION 'FALHOU: apagou usando o nome ANTIGO';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - o nome antigo nao serve mais para confirmar a exclusao';
END $$;
ROLLBACK;

-- E o admin da empresa nao renomeia a propria empresa.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
DO $$
BEGIN
  PERFORM public.platform_rename_account(current_setting('teste.e')::uuid, 'Eu Mesmo SA');
  RAISE EXCEPTION 'FALHOU: o admin da empresa se renomeou';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - o admin da empresa nao renomeia a propria empresa';
END $$;
ROLLBACK;

\echo ''

\echo ''
\echo '--- 23. Renomear professor leva aulas e bloqueios junto, e só da própria empresa ---'

-- Um professor da empresa A, para ver que a empresa R não o alcança.
INSERT INTO public.teachers (account_id, name, active)
SELECT current_setting('teste.a')::uuid, 'Prof A', true
 WHERE NOT EXISTS (SELECT 1 FROM public.teachers WHERE account_id = current_setting('teste.a')::uuid AND name = 'Prof A');
SELECT set_config('teste.prof_a', (SELECT id::text FROM public.teachers WHERE account_id = current_setting('teste.a')::uuid AND name = 'Prof A'), false);
SELECT set_config('teste.aulas_a', (SELECT count(*)::text FROM public.lessons WHERE account_id = current_setting('teste.a')::uuid), false);

-- Empresa e admin proprios deste bloco: os de B ja foram desmontados pelos
-- blocos anteriores.
DO $$
DECLARE
  _r uuid;
  _ur uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Empresa R', 'r', 'pro') RETURNING id INTO _r;
  INSERT INTO auth.users (id, email) VALUES (_ur, 'admin-r@x');
  DELETE FROM public.user_roles WHERE user_id = _ur;
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_ur, 'admin', _r);
  INSERT INTO public.students (account_id, student_name, guardian_name) VALUES (_r, 'Duda', 'Ana');
  PERFORM set_config('teste.ur', _ur::text, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ur'), true);
INSERT INTO public.teachers (name, active) VALUES ('Ana Júlia', true);
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES ('Duda', 'Ana', 'ana-julia', '2027-02-01 10:00-03', 60);
INSERT INTO public.blocks (title, teacher, block_type, start_at, end_at)
VALUES ('Folga', 'ana-julia', 'one_off', '2027-02-02 10:00-03', '2027-02-02 12:00-03');
SELECT public.assert(
  (SELECT r ->> 'aulas' = '1' AND r ->> 'bloqueios' = '1'
     FROM (SELECT public.rename_teacher((SELECT id FROM public.teachers WHERE name = 'Ana Júlia'),
                                        'Ana Julia Souza', 'ana-julia', 'ana-julia-souza') AS r) x),
  'renomear leva a aula e o bloqueio junto');
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE teacher = 'ana-julia') = 0
                     AND (SELECT count(*) FROM public.lessons WHERE teacher = 'ana-julia-souza') = 1,
  'nenhuma aula fica órfã no apelido antigo');
SELECT public.assert((SELECT count(*) FROM public.teachers WHERE name = 'Ana Julia Souza') = 1, 'e o nome mudou');
DO $$
BEGIN
  PERFORM public.rename_teacher((SELECT id FROM public.teachers WHERE name = 'Ana Julia Souza'), 'Both', 'ana-julia-souza', 'both');
  RAISE EXCEPTION 'FALHOU: aceitou o apelido reservado';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - recusa o apelido reservado (both vale para todos)';
END $$;
DO $$
BEGIN
  PERFORM public.rename_teacher(current_setting('teste.prof_a')::uuid, 'Invasor', 'prof-a', 'invasor');
  RAISE EXCEPTION 'FALHOU: renomeou professor de outra empresa';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - admin de R nao renomeia professor de A';
END $$;
COMMIT;

SELECT public.assert((SELECT name FROM public.teachers WHERE id = current_setting('teste.prof_a')::uuid) = 'Prof A',
  'o professor de A continua com o nome dele');
SELECT public.assert((SELECT count(*)::text FROM public.lessons WHERE account_id = current_setting('teste.a')::uuid) = current_setting('teste.aulas_a'),
  'e as aulas de A nao foram tocadas');

-- Professor e aluno pausados pelo plano: renomear nao e marcar aula nova, e
-- a trava nao pode barrar. Mas a excecao nao pode sobrar depois.
UPDATE public.teachers SET plan_locked = true WHERE name = 'Ana Julia Souza';
UPDATE public.students SET plan_locked = true WHERE student_name = 'Duda' AND account_id = (SELECT id FROM public.accounts WHERE slug = 'r');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ur'), true);
SELECT public.assert(
  (public.rename_teacher((SELECT id FROM public.teachers WHERE name = 'Ana Julia Souza'), 'Ana J', 'ana-julia-souza', 'ana-j') ->> 'aulas') = '1',
  'renomear professor pausado, com aula de aluno pausado, funciona');
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
  VALUES ('Duda', 'Ana', 'ana-j', '2027-02-03 10:00-03', 60);
  RAISE EXCEPTION 'FALHOU: a excecao do renomear sobrou na transacao';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - e logo depois a trava volta a valer';
END $$;
ROLLBACK;
UPDATE public.students SET plan_locked = false WHERE student_name = 'Duda' AND account_id = (SELECT id FROM public.accounts WHERE slug = 'r');


\echo ''
\echo '--- 24. Escola se cadastra sozinha, com teste do Pro; familia entra por codigo ---'

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('24000000-0000-0000-0000-000000000001', 'dona@escola.x', '{"signup_kind":"school","school_name":"Escola Ávila","teacher_name":"Ana Paula"}');
SELECT set_config('teste.u24', '24000000-0000-0000-0000-000000000001', false);
SELECT set_config('teste.a24', (SELECT account_id::text FROM public.user_roles WHERE user_id = current_setting('teste.u24')::uuid), false);

SELECT public.assert((SELECT role::text FROM public.user_roles WHERE user_id = current_setting('teste.u24')::uuid) = 'admin',
  'quem cria a escola vira admin dela');
SELECT public.assert((SELECT slug FROM public.accounts WHERE id = current_setting('teste.a24')::uuid) = 'escola-avila',
  'o codigo da escola sai do nome, sem acento');
SELECT public.assert((SELECT plan = 'pro_solo' AND trial_ends_at > now() + interval '13 days' AND trial_ends_at < now() + interval '15 days'
                        FROM public.accounts WHERE id = current_setting('teste.a24')::uuid),
  'nasce no Pro (pro_solo, nao no Max) com 14 dias de teste');
SELECT public.assert((SELECT count(*) FROM public.settings WHERE account_id = current_setting('teste.a24')::uuid) = 1
                     AND (SELECT name FROM public.teachers WHERE account_id = current_setting('teste.a24')::uuid) = 'ana paula',
  'ja nasce com configuracoes e com o professor');
SELECT public.assert((SELECT admin_user_id FROM public.teachers WHERE account_id = current_setting('teste.a24')::uuid) = current_setting('teste.u24')::uuid,
  'o professor que nasce com a escola ja e o "sou eu" de quem criou (Google Agenda)');
SELECT public.assert((SELECT public_account_id() <> current_setting('teste.a24')::uuid),
  'e NAO cai na empresa do endereco publico');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('24000000-0000-0000-0000-000000000002', 'outra@escola.x', '{"signup_kind":"school","school_name":"Escola Avila","teacher_name":"Bia"}');
SELECT public.assert((SELECT a.slug FROM public.accounts a JOIN public.user_roles r ON r.account_id = a.id
                       WHERE r.user_id = '24000000-0000-0000-0000-000000000002') = 'escola-avila-1',
  'nome repetido ganha codigo diferente');

DO $$
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('24000000-0000-0000-0000-000000000009', 'sem@nome.x', '{"signup_kind":"school","school_name":"  "}');
  RAISE EXCEPTION 'FALHOU: criou escola sem nome';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - escola sem nome e recusada';
END $$;

-- Familia pelo codigo: papel de familia, na escola certa. Nunca admin.
INSERT INTO public.accounts (name, slug, plan) VALUES ('Sem admin', 'sem-admin', 'pro');
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('24000000-0000-0000-0000-000000000003', 'mae@x', '{"school_code":"escola-avila"}'),
  ('24000000-0000-0000-0000-000000000004', 'pai@x', '{"school_code":"sem-admin"}'),
  ('24000000-0000-0000-0000-000000000005', 'errou@x', '{"school_code":"nao-existe"}');
SELECT public.assert((SELECT role::text || '@' || account_id::text FROM public.user_roles WHERE user_id = '24000000-0000-0000-0000-000000000003')
                     = 'student@' || current_setting('teste.a24'),
  'familia com codigo entra como familia daquela escola');
SELECT public.assert((SELECT role::text FROM public.user_roles WHERE user_id = '24000000-0000-0000-0000-000000000004') = 'student',
  'nem numa escola sem admin o codigo vira admin');
SELECT public.assert((SELECT account_id FROM public.user_roles WHERE user_id = '24000000-0000-0000-0000-000000000005') IS NULL,
  'codigo errado nao cai em escola nenhuma (e nao na de producao)');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.u24'), true);
SELECT public.assert((public.my_plan() ->> 'school_code') = 'escola-avila' AND (public.my_plan() ->> 'trial_ends_at') IS NOT NULL,
  'o app sabe o codigo da escola e o fim do teste');
DO $$
BEGIN
  PERFORM public.expire_trials();
  RAISE EXCEPTION 'FALHOU: admin chamou expire_trials';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - admin nao chama expire_trials';
END $$;
INSERT INTO public.students (student_name) SELECT 'Aluno ' || g FROM generate_series(1, 6) g;
COMMIT;

-- Fim do teste: vira Essencial de verdade; nada e apagado nem travado (o limite e de clientes ATIVOS).
UPDATE public.accounts SET trial_ends_at = now() - interval '1 minute' WHERE id = current_setting('teste.a24')::uuid;
SELECT public.assert(public.expire_trials() >= 1, 'o teste vencido e encerrado pela rotina diaria');
SELECT public.assert((SELECT plan = 'essencial' AND trial_ends_at IS NULL FROM public.accounts WHERE id = current_setting('teste.a24')::uuid),
  'a escola passa para o Essencial');
SELECT public.assert((SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.a24')::uuid) = 6
                     AND (SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.a24')::uuid AND plan_locked) = 0,
  'e os 6 alunos continuam la, sem trava');

-- O gestor definir o plano encerra o teste.
UPDATE public.accounts SET plan = 'pro', trial_ends_at = now() + interval '5 days' WHERE id = current_setting('teste.a24')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.platform_set_account_plan(current_setting('teste.a24')::uuid, 'pro');
COMMIT;
SELECT public.assert((SELECT trial_ends_at IS NULL FROM public.accounts WHERE id = current_setting('teste.a24')::uuid),
  'plano definido pelo gestor encerra o teste');

\echo ''
\echo '--- 25. Papel professor: so ve as proprias aulas e os proprios alunos ---'

DO $$
DECLARE
  _t uuid;
  _adm uuid := gen_random_uuid();
  _prof uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Escola T', 'escola-t', 'pro') RETURNING id INTO _t;
  INSERT INTO public.settings (account_id, default_lesson_price) VALUES (_t, 200.00);
  INSERT INTO auth.users (id, email) VALUES (_adm, 'adm-t@x'), (_prof, 'prof-t@x');
  DELETE FROM public.user_roles WHERE user_id IN (_adm, _prof);
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_adm, 'admin', _t), (_prof, 'teacher', _t);
  INSERT INTO public.teachers (account_id, name, active, user_id) VALUES (_t, 'Ana Júlia', true, _prof), (_t, 'Beto', true, NULL);
  -- Caio: a Ana ja deu aula e vai dar outra. Fabio: a Ana so vai dar.
  -- Eva: so tem aula com o Beto.
  INSERT INTO public.students (id, account_id, student_name, guardian_name) VALUES
    ('25000000-0000-0000-0000-00000000000c', _t, 'Caio', 'Dora'),
    ('25000000-0000-0000-0000-00000000000f', _t, 'Fabio', NULL),
    ('25000000-0000-0000-0000-00000000000e', _t, 'Eva', 'Gil');
  INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status) VALUES
    (_t, 'Caio', 'Dora', 'ana-julia', '2026-03-01 10:00-03', 60, 'realizada'),
    (_t, 'Caio', 'Dora', 'ana-julia', '2027-03-01 10:00-03', 60, 'agendada'),
    (_t, 'Fabio', NULL, 'ana-julia', '2027-03-02 11:00-03', 60, 'agendada'),
    (_t, 'Eva', 'Gil', 'beto', '2027-03-02 10:00-03', 60, 'agendada');
  INSERT INTO public.wallet_transactions (account_id, student_name, guardian_name, amount, kind, description)
  VALUES (_t, 'Caio', 'Dora', 500, 'adjustment', 'Pix');
  INSERT INTO public.account_discounts (account_id, student_name, guardian_name, kind, value) VALUES (_t, 'Caio', 'Dora', 'percent', 10);
  INSERT INTO public.homework (account_id, student_id, title, deadline) VALUES
    (_t, '25000000-0000-0000-0000-00000000000e', 'Tarefa da Eva', now() + interval '3 days');
  INSERT INTO storage.buckets (id, name) VALUES ('student-materials', 'student-materials'), ('homework-submissions', 'homework-submissions')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.objects (bucket_id, name) VALUES
    ('student-materials', '25000000-0000-0000-0000-00000000000e/eva.pdf'),
    ('student-materials', '25000000-0000-0000-0000-00000000000c/caio.pdf');
  PERFORM set_config('teste.t', _t::text, false);
  PERFORM set_config('teste.prof', _prof::text, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.prof'), true);
SELECT public.assert(public.current_teacher_slug() = 'ana-julia', 'o login sabe qual professor e');
SELECT public.assert((SELECT count(*) FROM public.lessons) = 3 AND (SELECT count(DISTINCT teacher) FROM public.lessons) = 1,
  've so as proprias aulas');
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions) = 0, 'nao ve pagamentos');
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 0, 'nao ve descontos');
SELECT public.assert((SELECT count(*) FROM public.audit_log) = 0, 'nao ve o historico');
SELECT public.assert((SELECT string_agg(student_name, ',' ORDER BY student_name) FROM public.students) = 'Caio,Fabio',
  've so os alunos com quem tem aula (nao ve a Eva, do Beto)');
SELECT public.assert((SELECT count(*) FROM public.homework) = 0, 'nao ve tarefa de aluno que nao e dele');
SELECT public.assert((SELECT count(*) FROM storage.objects WHERE bucket_id = 'student-materials') = 1,
  'arquivos: so os dos proprios alunos');
SELECT public.assert((SELECT count(*) FROM public.teachers) = 2, 've os professores da escola');

DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
  VALUES ('Caio', 'Dora', 'ana-julia', '2027-03-03 10:00-03', 60);
  RAISE EXCEPTION 'FALHOU: professor marcou aula';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - professor nao marca aula (nem a propria)';
END $$;
UPDATE public.lessons SET status = 'realizada', notes = 'x' WHERE start_at = '2027-03-01 10:00-03';
DELETE FROM public.lessons WHERE start_at = '2027-03-01 10:00-03';
DO $$
BEGIN
  INSERT INTO public.students (student_name) VALUES ('Novo aluno');
  RAISE EXCEPTION 'FALHOU: professor cadastrou aluno';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - professor nao cadastra aluno';
END $$;

-- Material e tarefa: so para quem ja teve aula com ele.
INSERT INTO public.homework (student_id, title, deadline) VALUES ('25000000-0000-0000-0000-00000000000c', 'Lista 1', now() + interval '7 days');
INSERT INTO public.student_materials (student_id, title, file_path) VALUES ('25000000-0000-0000-0000-00000000000c', 'Apostila', '25000000-0000-0000-0000-00000000000c/apostila.pdf');
INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('student-materials', '25000000-0000-0000-0000-00000000000c/apostila.pdf', auth.uid());
SELECT public.assert((SELECT created_by FROM public.homework WHERE title = 'Lista 1') = auth.uid(),
  'o banco anota quem criou a tarefa');
DO $$
BEGIN
  INSERT INTO public.homework (student_id, title, deadline) VALUES ('25000000-0000-0000-0000-00000000000f', 'X', now());
  RAISE EXCEPTION 'FALHOU: tarefa para aluno que ainda nao teve aula';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao da tarefa para quem ainda nao teve aula com ele';
END $$;
DO $$
BEGIN
  INSERT INTO public.student_materials (student_id, title, file_path) VALUES ('25000000-0000-0000-0000-00000000000e', 'X', 'x');
  RAISE EXCEPTION 'FALHOU: material para aluno de outro professor';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao poe material para aluno de outro professor';
END $$;
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('student-materials', '25000000-0000-0000-0000-00000000000e/x.pdf', auth.uid());
  RAISE EXCEPTION 'FALHOU: arquivo na pasta de aluno de outro professor';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao sobe arquivo na pasta de aluno de outro professor';
END $$;

UPDATE public.settings SET default_lesson_price = 1;
UPDATE public.teachers SET name = 'invasor';
INSERT INTO public.blocks (title, teacher, block_type, start_at, end_at) VALUES ('Folga', 'ana-julia', 'one_off', '2027-03-05 10:00-03', '2027-03-05 12:00-03');
DO $$
BEGIN
  INSERT INTO public.blocks (title, teacher, block_type, start_at, end_at) VALUES ('X', 'beto', 'one_off', '2027-03-05 10:00-03', '2027-03-05 12:00-03');
  RAISE EXCEPTION 'FALHOU: bloqueou agenda de outro professor';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao bloqueia a agenda de outro professor';
END $$;
DO $$
BEGIN
  PERFORM public.register_payment('Caio', 'Dora', 100, 'adjustment', 'x');
  RAISE EXCEPTION 'FALHOU: professor registrou pagamento';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - professor nao registra pagamento';
END $$;
COMMIT;

SELECT public.assert((SELECT status FROM public.lessons WHERE account_id = current_setting('teste.t')::uuid AND start_at = '2027-03-01 10:00-03') = 'agendada',
  'professor nao muda a aula (nem marca como realizada) nem apaga');
SELECT public.assert((SELECT count(*) FROM public.blocks WHERE account_id = current_setting('teste.t')::uuid AND title = 'Folga') = 1,
  'mas bloqueia a propria agenda');
SELECT public.assert((SELECT default_lesson_price FROM public.settings WHERE account_id = current_setting('teste.t')::uuid) = 200.00,
  'nao mexe nas configuracoes');
SELECT public.assert((SELECT count(*) FROM public.teachers WHERE account_id = current_setting('teste.t')::uuid AND name = 'invasor') = 0,
  'nao mexe nos professores');
SELECT public.assert((SELECT count(*) FROM public.homework WHERE account_id = current_setting('teste.t')::uuid AND title = 'Lista 1') = 1
                     AND (SELECT count(*) FROM public.student_materials WHERE account_id = current_setting('teste.t')::uuid) = 1,
  'poe tarefa e material para aluno que ja teve aula com ele');

-- Arquivos: o admin de OUTRA empresa nao ve os da Escola T.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((SELECT count(*) FROM storage.objects WHERE name LIKE '25000000-%') = 0,
  'admin de outra empresa nao ve os arquivos desta');
COMMIT;

\echo ''
\echo '--- 26. Tipo de negocio e vocabulario por empresa ---'

SELECT public.assert((SELECT business_model FROM public.accounts WHERE slug = 'portaldeaulas') = 'aulas',
  'a empresa que ja existia fica como aulas');
SELECT public.assert((SELECT business_model FROM public.accounts WHERE id = current_setting('teste.a24')::uuid) IS NULL,
  'empresa criada pelo cadastro nasce sem tipo (vai para a tela de boas-vindas)');

-- Sem login: as palavras da empresa do endereco publico.
BEGIN;
SET LOCAL ROLE anon;
SELECT public.assert((public.my_vocabulary() ->> 'business_model') = 'aulas',
  'a pagina publica le o tipo da empresa do endereco');
DO $$
BEGIN
  PERFORM public.set_business_model('saude');
  RAISE EXCEPTION 'FALHOU: visitante trocou o tipo';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - visitante nao troca o tipo';
END $$;
COMMIT;

-- A escola do bloco 24 esta no Pro (o gestor definiu).
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.u24'), true);
SELECT public.assert(public.my_vocabulary() ->> 'business_model' IS NULL, 'o dono ve que ainda nao escolheu');
SELECT public.assert((public.set_business_model('saude') ->> 'business_model') = 'saude', 'o dono escolhe o tipo');
DO $$
BEGIN
  PERFORM public.set_business_model('cassino');
  RAISE EXCEPTION 'FALHOU: aceitou tipo inventado';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - tipo inventado e recusado';
END $$;
SELECT public.assert((public.my_vocabulary() ->> 'active')::boolean, 'no Pro, as palavras do tipo valem');
SELECT public.assert((public.set_custom_vocabulary('{"staff":{"s":"Dentista","p":"Dentistas","g":"m"}}')
                       -> 'custom' -> 'staff' ->> 'p') = 'Dentistas',
  'no Pro, o dono edita as palavras');
DO $$
BEGIN
  PERFORM public.set_custom_vocabulary('{"senha":{"s":"x","p":"x","g":"m"}}');
  RAISE EXCEPTION 'FALHOU: aceitou termo desconhecido';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - termo desconhecido e recusado';
END $$;
DO $$
BEGIN
  PERFORM public.set_custom_vocabulary('{"staff":{"s":"Dentista","p":"","g":"m"}}');
  RAISE EXCEPTION 'FALHOU: aceitou plural vazio';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - plural vazio e recusado';
END $$;
DO $$
BEGIN
  PERFORM public.set_custom_vocabulary('{"staff":{"s":"Dentista","p":"Dentistas","g":"x"}}');
  RAISE EXCEPTION 'FALHOU: aceitou genero invalido';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - genero invalido e recusado';
END $$;
COMMIT;

SELECT public.assert((SELECT business_model FROM public.accounts WHERE slug = 'escola-t') IS NULL
                     AND (SELECT vocabulary FROM public.accounts WHERE slug = 'escola-t') IS NULL,
  'a escolha de uma empresa nao alcanca outra');

-- O professor le, mas nao muda.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.prof'), true);
SELECT public.assert(public.my_vocabulary() IS NOT NULL, 'o professor le as palavras da propria empresa');
DO $$
BEGIN
  PERFORM public.set_business_model('beleza');
  RAISE EXCEPTION 'FALHOU: professor trocou o tipo';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - professor nao troca o tipo';
END $$;
DO $$
BEGIN
  PERFORM public.set_custom_vocabulary('{"staff":{"s":"X","p":"Xs","g":"m"}}');
  RAISE EXCEPTION 'FALHOU: professor editou as palavras';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - professor nao edita as palavras';
END $$;
COMMIT;

-- Desde 26/09 as palavras do ramo valem tambem no Essencial.
UPDATE public.accounts SET plan = 'essencial' WHERE id = current_setting('teste.a24')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.u24'), true);
SELECT public.assert((public.my_vocabulary() ->> 'active')::boolean
                     AND (public.my_vocabulary() ->> 'business_model') = 'saude',
  'no Essencial as palavras do ramo continuam valendo');
SELECT public.assert((public.set_custom_vocabulary('{"staff":{"s":"X","p":"Xs","g":"m"}}') ->> 'custom_saved')::boolean,
  'e o Essencial edita as palavras');

-- Mensagem neutra, com a chave que a tela traduz.
DO $$
DECLARE _h text;
BEGIN
  INSERT INTO public.teachers (name, active) VALUES ('segundo', true);
  RAISE EXCEPTION 'FALHOU: passou do limite de professores';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS _h = PG_EXCEPTION_HINT;
  PERFORM public.assert(_h = 'limite_profissionais_cadastrar:1', 'o limite do plano vem com a chave para a tela (' || _h || ')');
  PERFORM public.assert(sqlerrm NOT ILIKE '%professor%', 'e a mensagem nao fala em professor');
END $$;

SELECT public.assert(public.set_custom_vocabulary(NULL) ->> 'custom_saved' = 'false',
  'mas volta as palavras do tipo em qualquer plano');
SELECT public.assert((public.set_business_model('oficina') ->> 'business_model') = 'oficina',
  'e troca de tipo em qualquer plano');
COMMIT;

\echo ''
\echo '--- 27. Assistente so com liberacao do gestor, em qualquer plano ---'

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('27000000-0000-0000-0000-000000000001', 'nova@x', '{"signup_kind":"school","school_name":"Clinica Nova","teacher_name":"Dra Ana"}');
SELECT set_config('teste.a27', (SELECT account_id::text FROM public.user_roles WHERE user_id = '27000000-0000-0000-0000-000000000001'), false);

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27000000-0000-0000-0000-000000000001', true);
-- A IA do Pro (100 mensagens desde 10/10) é só para quem paga (10/10): no teste, sem IA.
SELECT public.assert(public.account_plan() = 'pro_solo' AND public.account_can('assistant') = false,
  'empresa nova, no teste do Pro, ainda sem a IA (so pagando)');
SELECT public.assert((public.my_plan() -> 'assistant_usage' ->> 'limit')::int = 100,
  'com 100 mensagens por mes');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.a27')::uuid, NULL, true) ->> 'assistant') = 'true',
  'o gestor libera');
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.a27')::uuid, NULL, false) ->> 'assistant') = 'false',
  'tirar a liberacao manual, no teste gratis, deixa sem IA (a amostra e so pagando)');
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.a27')::uuid, NULL, NULL, true) ->> 'assistant') = 'true',
  'o painel antigo (que manda "limpar" para ligar no Pro) continua ligando');
COMMIT;


\echo ''
\echo '--- 28. Troca de horario pedida pela familia, e antecedencia minima ---'

-- Duas aulas marcadas da Bia (familia da Ana, empresa A) e uma do Caio, que e
-- de outra familia para este teste: a Ana nao tem login ligado a ele.
DO $$
DECLARE _a uuid := current_setting('teste.a')::uuid;
BEGIN
  UPDATE public.settings SET allow_student_booking = true, min_request_notice_hours = 0 WHERE account_id = _a;
  INSERT INTO public.lessons (id, account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status)
  VALUES ('28000000-0000-0000-0000-000000000001', _a, 'Bia', 'Ana', 'thiago', date_trunc('hour', now()) + interval '10 days 3 hours', 60, 'agendada'),
         ('28000000-0000-0000-0000-000000000002', _a, 'Bia', 'Ana', 'thiago', date_trunc('hour', now()) + interval '5 hours', 60, 'agendada');
  UPDATE public.students SET user_id = NULL WHERE account_id = _a AND student_name = 'Caio';
  INSERT INTO public.lessons (id, account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status)
  VALUES ('28000000-0000-0000-0000-000000000003', _a, 'Caio', 'Ana', 'thiago', date_trunc('hour', now()) + interval '11 days 3 hours', 60, 'agendada');
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);

INSERT INTO public.lessons (id, student_name, guardian_name, teacher, start_at, duration_minutes, status, reschedule_of)
VALUES ('28000000-0000-0000-0000-000000000011', 'Bia', 'Ana', 'thiago', date_trunc('hour', now()) + interval '12 days 3 hours', 60, 'solicitada',
        '28000000-0000-0000-0000-000000000001');
SELECT public.assert(true, 'a familia pede troca de uma aula dela');

SELECT public.assert((SELECT status FROM public.lessons WHERE id = '28000000-0000-0000-0000-000000000001') = 'agendada',
  'e a aula antiga continua marcada ate o professor responder');

DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, status, reschedule_of)
  VALUES ('Bia', 'Ana', 'thiago', date_trunc('hour', now()) + interval '13 days 3 hours', 60, 'solicitada',
          '28000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU: dois pedidos de troca abertos para a mesma aula';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE '  ok - um pedido de troca aberto por aula';
END $$;

DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, status, reschedule_of)
  VALUES ('Bia', 'Ana', 'thiago', date_trunc('hour', now()) + interval '14 days 3 hours', 60, 'solicitada',
          '28000000-0000-0000-0000-000000000003');
  RAISE EXCEPTION 'FALHOU: pediu troca da aula de outra familia';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao pede troca da aula de outra familia';
END $$;

DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, status)
  VALUES ('Bia', 'Ana', 'thiago', now() - interval '2 hours', 60, 'solicitada');
  RAISE EXCEPTION 'FALHOU: pediu horario que ja passou';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao pede horario que ja passou';
END $$;
COMMIT;

-- Antecedencia de 24h: a aula daqui a 5h ja nao pode ser trocada, e nao da
-- para pedir horario para daqui a 5h.
UPDATE public.settings SET min_request_notice_hours = 24 WHERE account_id = current_setting('teste.a')::uuid;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, status, reschedule_of)
  VALUES ('Bia', 'Ana', 'thiago', date_trunc('hour', now()) + interval '15 days 3 hours', 60, 'solicitada',
          '28000000-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'FALHOU: trocou aula dentro da antecedencia minima';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - aula dentro da antecedencia minima nao se troca pelo portal';
END $$;
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, status)
  VALUES ('Bia', 'Ana', 'thiago', date_trunc('hour', now()) + interval '1 day 7 hours' - interval '1 day', 60, 'solicitada');
  RAISE EXCEPTION 'FALHOU: pediu horario dentro da antecedencia minima';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nem se pede horario dentro da antecedencia minima';
END $$;
COMMIT;

UPDATE public.settings SET min_request_notice_hours = 0 WHERE account_id = current_setting('teste.a')::uuid;

-- O admin aprova: o pedido entra, a aula antiga sai.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
UPDATE public.lessons SET status = 'agendada' WHERE id = '28000000-0000-0000-0000-000000000011';
SELECT public.assert((SELECT status FROM public.lessons WHERE id = '28000000-0000-0000-0000-000000000001') = 'cancelada',
  'aprovar a troca desmarca a aula antiga');
COMMIT;

-- Recusar nao mexe na aula antiga.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
INSERT INTO public.lessons (id, student_name, guardian_name, teacher, start_at, duration_minutes, status, reschedule_of)
VALUES ('28000000-0000-0000-0000-000000000012', 'Bia', 'Ana', 'thiago', date_trunc('hour', now()) + interval '16 days 3 hours', 60, 'solicitada',
        '28000000-0000-0000-0000-000000000002');
COMMIT;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
UPDATE public.lessons SET status = 'recusada' WHERE id = '28000000-0000-0000-0000-000000000012';
SELECT public.assert((SELECT status FROM public.lessons WHERE id = '28000000-0000-0000-0000-000000000002') = 'agendada',
  'recusar a troca deixa a aula antiga marcada');
COMMIT;

-- Aprovar uma troca cuja aula antiga ja foi dada nao desfaz a aula dada.
DO $$
BEGIN
  INSERT INTO public.lessons (id, account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, reschedule_of)
  VALUES ('28000000-0000-0000-0000-000000000013', current_setting('teste.a')::uuid, 'Bia', 'Ana', 'thiago',
          date_trunc('hour', now()) + interval '17 days 3 hours', 60, 'solicitada', '28000000-0000-0000-0000-000000000002');
  UPDATE public.lessons SET status = 'realizada' WHERE id = '28000000-0000-0000-0000-000000000002';
  UPDATE public.lessons SET status = 'agendada' WHERE id = '28000000-0000-0000-0000-000000000013';
  PERFORM public.assert((SELECT status FROM public.lessons WHERE id = '28000000-0000-0000-0000-000000000002') = 'realizada',
    'aprovar troca de aula ja realizada nao mexe nela (nem na cobranca)');
END $$;


\echo ''
\echo '--- 29. Planos Solo/Equipe, assinatura pelo Stripe e limite do assistente ---'

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('29000000-0000-0000-0000-000000000001', 'solo@x', '{"signup_kind":"school","school_name":"Estudio Solo","teacher_name":"Rita"}');
SELECT set_config('teste.a29', (SELECT account_id::text FROM public.user_roles WHERE user_id = '29000000-0000-0000-0000-000000000001'), false);
SELECT public.assert((SELECT plan = 'pro_solo' AND trial_ends_at IS NOT NULL FROM public.accounts WHERE id = current_setting('teste.a29')::uuid),
  'o teste gratis e do Pro');
-- O resto do bloco testa o Max: poe a conta no Max em teste, como as antigas.
UPDATE public.accounts SET plan = 'pro' WHERE id = current_setting('teste.a29')::uuid;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000001', true);
SELECT public.assert(public.my_plan() ->> 'plano' = 'pro' AND public.my_plan() ->> 'tier' = 'pro'
                     AND public.my_plan() ->> 'nome' = 'Cronys Max',
  'o Max se apresenta como Cronys Max, e o app antigo continua vendo "pro"');
-- Equipe: sem teto, 5 incluidos; o sexto e o setimo viram extra, nao erro.
INSERT INTO public.teachers (name, active) VALUES ('p2', true), ('p3', true), ('p4', true), ('p5', true), ('p6', true), ('p7', true);
SELECT public.assert((public.my_plan() ->> 'extra_teachers')::int = 2,
  'no Equipe, 7 profissionais ativos = 2 extras cobrados, sem bloqueio');
INSERT INTO public.students (student_name) SELECT 'c' || g FROM generate_series(1, 8) g;
COMMIT;

-- Cronys (gestor) passa a empresa para o Solo: profissionais passam do limite
-- e ficam pausados; clientes, que no Solo nao tem limite, continuam liberados.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.platform_set_account_plan(current_setting('teste.a29')::uuid, 'pro_solo');
COMMIT;
SELECT public.assert((SELECT count(*) FROM public.teachers WHERE account_id = current_setting('teste.a29')::uuid AND active) = 0
                     AND (SELECT count(*) FROM public.teachers WHERE account_id = current_setting('teste.a29')::uuid AND plan_locked) = 7,
  'Equipe -> Solo pausa os profissionais para a empresa escolher 1');
SELECT public.assert((SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.a29')::uuid AND plan_locked) = 0,
  'e nao pausa cliente nenhum (Solo nao tem limite de clientes)');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000001', true);
UPDATE public.teachers SET active = true WHERE name = 'rita';
SELECT public.assert((SELECT count(*) FROM public.teachers WHERE active) = 1, 'a empresa escolhe o profissional que fica');
SELECT public.assert(public.my_plan() ->> 'plano' = 'pro' AND public.my_plan() ->> 'tier' = 'pro_solo',
  'Solo: plano "pro" para o app antigo, faixa pro_solo para o novo');
DO $$
BEGIN
  PERFORM public.account_extra_teachers(current_setting('teste.a')::uuid);
  RAISE EXCEPTION 'FALHOU: contou a equipe de outra empresa';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao conta a equipe nem o uso do assistente de outra empresa';
END $$;
DO $$
BEGIN
  PERFORM public.assistant_usage_status(current_setting('teste.a')::uuid);
  RAISE EXCEPTION 'FALHOU: viu o uso do assistente de outra empresa';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
-- Desde 26/09 o Pro aceita ate 3 profissionais (1 incluido + 2 extras).
UPDATE public.teachers SET active = true WHERE name IN ('p2', 'p3');
SELECT public.assert((public.my_plan() ->> 'extra_teachers')::int = 2, 'no Pro, 3 profissionais = 2 extras');
DO $$
BEGIN
  UPDATE public.teachers SET active = true WHERE name = 'p4';
  RAISE EXCEPTION 'FALHOU: Pro reativou um quarto profissional';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - no Pro, no maximo 3 profissionais (o 4o e o Max)';
END $$;
UPDATE public.teachers SET active = false WHERE name IN ('p2', 'p3');
DO $$
BEGIN
  PERFORM public.billing_apply_subscription(current_setting('teste.a29')::uuid, 'cus_x', 'sub_x', 'active', 'pro', 'month', now() + interval '1 month');
  RAISE EXCEPTION 'FALHOU: cliente se deu o plano chamando a funcao do webhook';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - so o webhook (chave mestra) aplica assinatura';
END $$;
DO $$
BEGIN
  INSERT INTO public.assistant_usage (account_id, month, messages) VALUES (current_setting('teste.a29')::uuid, public.assistant_month(), -1000);
  RAISE EXCEPTION 'FALHOU: cliente mexeu no proprio uso do assistente';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - cliente nao mexe no proprio uso do assistente';
END $$;
COMMIT;

-- Webhook: pagou o Solo.
SELECT public.billing_apply_subscription(current_setting('teste.a29')::uuid, 'cus_29', 'sub_29', 'active', 'pro_solo', 'month', now() + interval '1 month');
SELECT public.assert((SELECT plan = 'pro_solo' AND billing_status = 'active' AND trial_ends_at IS NULL AND stripe_customer_id = 'cus_29'
                        FROM public.accounts WHERE id = current_setting('teste.a29')::uuid),
  'pagamento confirmado: plano da assinatura, teste encerrado');

-- Atrasou: continua no plano durante a tolerancia.
SELECT public.billing_apply_subscription(current_setting('teste.a29')::uuid, 'cus_29', 'sub_29', 'past_due', 'pro_solo', 'month', NULL);
SELECT public.expire_unpaid_subscriptions();
SELECT public.assert((SELECT plan FROM public.accounts WHERE id = current_setting('teste.a29')::uuid) = 'pro_solo',
  'atraso dentro da tolerancia: continua no plano');
UPDATE public.accounts SET past_due_since = now() - make_interval(days => public.billing_grace_days() + 1)
 WHERE id = current_setting('teste.a29')::uuid;
SELECT public.assert(public.expire_unpaid_subscriptions() = 1, 'a rotina diaria rebaixa quem passou da tolerancia');
SELECT public.assert((SELECT plan FROM public.accounts WHERE id = current_setting('teste.a29')::uuid) = 'essencial',
  'passou da tolerancia: cai para o Essencial');
SELECT public.assert((SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.a29')::uuid) = 8
                     AND (SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.a29')::uuid AND plan_locked) = 0,
  'rebaixado: nada apagado, nenhum cliente pausado');
SELECT public.assert((SELECT count(*) FROM public.accounts WHERE billing_status = 'none' AND plan <> 'essencial') > 0
                     AND (SELECT plan FROM public.accounts WHERE slug = 'portaldeaulas') = 'pro',
  'empresa sem assinatura no Stripe nao e tocada pela rotina');

-- Pagou atrasado: o plano volta e os clientes sao liberados.
SELECT public.billing_apply_subscription(current_setting('teste.a29')::uuid, 'cus_29', 'sub_29', 'active', 'pro_solo', 'month', now() + interval '1 month');
SELECT public.assert((SELECT plan FROM public.accounts WHERE id = current_setting('teste.a29')::uuid) = 'pro_solo'
                     AND (SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.a29')::uuid AND plan_locked) = 0,
  'pagou depois: plano de volta e clientes liberados');

-- Cancelou: Essencial na hora.
SELECT public.billing_apply_subscription(current_setting('teste.a29')::uuid, 'cus_29', 'sub_29', 'canceled', NULL, NULL, NULL);
SELECT public.assert((SELECT plan = 'essencial' AND billing_status = 'canceled' AND stripe_subscription_id IS NULL
                        FROM public.accounts WHERE id = current_setting('teste.a29')::uuid),
  'assinatura cancelada: Essencial');

-- Assistente: limite de mensagens e de custo.
UPDATE public.accounts SET assistant_monthly_messages = 2, assistant_monthly_cost_usd = 1.00 WHERE id = current_setting('teste.a29')::uuid;
SELECT public.assert((public.assistant_usage_status(current_setting('teste.a29')::uuid) ->> 'allowed')::boolean,
  'assistente: mes novo, pode usar');
SELECT public.assistant_usage_add(current_setting('teste.a29')::uuid, 1000, 100, 0, 0, 0.05);
SELECT public.assistant_usage_add(current_setting('teste.a29')::uuid, 1000, 100, 0, 0, 0.05);
SELECT public.assert(NOT (public.assistant_usage_status(current_setting('teste.a29')::uuid) ->> 'allowed')::boolean
                     AND (public.assistant_usage_status(current_setting('teste.a29')::uuid) ->> 'used')::int = 2,
  'assistente: bateu o limite de mensagens');
UPDATE public.accounts SET assistant_monthly_messages = 100 WHERE id = current_setting('teste.a29')::uuid;
SELECT public.assistant_usage_add(current_setting('teste.a29')::uuid, 1000, 100, 0, 0, 0.95);
SELECT public.assert(NOT (public.assistant_usage_status(current_setting('teste.a29')::uuid) ->> 'allowed')::boolean,
  'assistente: bateu o teto de custo, mesmo com mensagens sobrando');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_set_assistant_limits(current_setting('teste.a29')::uuid, 300, 10) ->> 'messages')::int = 300,
  'o gestor aumenta o limite');
SELECT public.assert((SELECT assistant_messages FROM public.platform_accounts_overview() WHERE id = current_setting('teste.a29')::uuid) = 3,
  'e ve o uso do mes no painel');
COMMIT;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000001', true);
DO $$
BEGIN
  PERFORM public.platform_set_assistant_limits(current_setting('teste.a29')::uuid, 99999, 999);
  RAISE EXCEPTION 'FALHOU: cliente aumentou o proprio limite';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - cliente nao aumenta o proprio limite';
END $$;
SELECT public.assert((SELECT count(*) FROM public.assistant_usage) = 1,
  'o admin le o uso da propria empresa');
COMMIT;


\echo ''
\echo '--- 30. Tolerancia de 2 dias; assistente como adicional, fora de venda ---'

SELECT public.assert(public.billing_grace_days() = 2, 'tolerancia de atraso: 2 dias');
SELECT public.assert(public.assistant_on_sale(), 'o adicional do assistente esta a venda (desde 25/09)');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('30000000-0000-0000-0000-000000000001', 'addon@x', '{"signup_kind":"school","school_name":"Clinica Addon","teacher_name":"Lia"}');
SELECT set_config('teste.a30', (SELECT account_id::text FROM public.user_roles WHERE user_id = '30000000-0000-0000-0000-000000000001'), false);

-- Assinou com o adicional: assistente ligado e marcado como comprado.
SELECT public.billing_apply_subscription(current_setting('teste.a30')::uuid, 'cus_30', 'sub_30', 'active', 'pro', 'month', now() + interval '1 month', true);
SELECT public.assert((SELECT assistant_override AND assistant_billed FROM public.accounts WHERE id = current_setting('teste.a30')::uuid),
  'comprou o adicional: assistente ligado');
SELECT public.assert(public.account_can('assistant', current_setting('teste.a30')::uuid), 'e o banco libera o uso');

-- Tirou o adicional (portal): desliga.
SELECT public.billing_apply_subscription(current_setting('teste.a30')::uuid, 'cus_30', 'sub_30', 'active', 'pro', 'month', now() + interval '1 month', false);
SELECT public.assert((SELECT NOT assistant_override AND NOT assistant_billed FROM public.accounts WHERE id = current_setting('teste.a30')::uuid),
  'tirou o adicional: assistente desligado');

-- Cortesia do gestor nao e desligada por uma assinatura sem o adicional.
UPDATE public.accounts SET assistant_override = true, assistant_billed = false WHERE id = current_setting('teste.a30')::uuid;
SELECT public.billing_apply_subscription(current_setting('teste.a30')::uuid, 'cus_30', 'sub_30', 'active', 'pro', 'month', now() + interval '1 month', false);
SELECT public.assert((SELECT assistant_override FROM public.accounts WHERE id = current_setting('teste.a30')::uuid),
  'cortesia do gestor continua ligada');

-- Adicional comprado + atraso alem da tolerancia: perde o assistente junto.
SELECT public.billing_apply_subscription(current_setting('teste.a30')::uuid, 'cus_30', 'sub_30', 'active', 'pro', 'month', now() + interval '1 month', true);
SELECT public.billing_apply_subscription(current_setting('teste.a30')::uuid, 'cus_30', 'sub_30', 'past_due', 'pro', 'month', NULL, NULL);
UPDATE public.accounts SET past_due_since = now() - interval '3 days' WHERE id = current_setting('teste.a30')::uuid;
SELECT public.expire_unpaid_subscriptions();
SELECT public.assert((SELECT plan = 'essencial' AND NOT assistant_override FROM public.accounts WHERE id = current_setting('teste.a30')::uuid),
  '3 dias de atraso: Essencial e sem o assistente comprado');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
SELECT public.assert((public.my_plan() ->> 'assistant_on_sale')::boolean, 'a tela sabe que o adicional esta a venda');
COMMIT;


\echo ''
\echo '--- 31. Portal de Aulas: tudo liberado para sempre ---'

SELECT public.assert((SELECT lifetime AND plan = 'pro' AND assistant_override FROM public.accounts WHERE slug = 'portaldeaulas'),
  'Portal de Aulas: Max e assistente, marcada como para sempre');

-- Todos os caminhos que rebaixam: nenhum pega.
SELECT public.billing_apply_subscription((SELECT id FROM public.accounts WHERE slug = 'portaldeaulas'),
  'cus_pa', 'sub_pa', 'canceled', NULL, NULL, NULL, false);
UPDATE public.accounts SET billing_status = 'past_due', past_due_since = now() - interval '30 days' WHERE slug = 'portaldeaulas';
SELECT public.expire_unpaid_subscriptions();
UPDATE public.accounts SET trial_ends_at = now() - interval '1 day' WHERE slug = 'portaldeaulas';
SELECT public.expire_trials();
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.platform_set_account_plan(current_setting('teste.a')::uuid, 'essencial', false);
COMMIT;
SELECT public.assert((SELECT plan = 'pro' AND assistant_override AND trial_ends_at IS NULL FROM public.accounts WHERE slug = 'portaldeaulas'),
  'cancelamento, atraso, fim de teste e o painel do gestor nao rebaixam');
SELECT public.assert(public.account_can('assistant', (SELECT id FROM public.accounts WHERE slug = 'portaldeaulas')),
  'e o assistente continua liberado');
UPDATE public.accounts SET billing_status = 'none', past_due_since = NULL WHERE slug = 'portaldeaulas';


\echo ''
\echo '--- 32. Demonstracao para sempre; falta cobrada; pacotes por empresa ---'

SELECT public.assert(coalesce((SELECT lifetime AND plan = 'pro' FROM public.accounts WHERE slug = 'demo'), true),
  'Demonstracao (se existir): Max para sempre');
SELECT public.assert(coalesce((SELECT NOT assistant_override FROM public.accounts WHERE slug = 'demo'), true),
  'mas sem o assistente (o robo da Play clica em tudo)');
SELECT public.assert((SELECT lifetime AND lifetime_assistant AND assistant_override FROM public.accounts WHERE slug = 'portaldeaulas'),
  'o Portal de Aulas continua com o assistente para sempre');

-- Falta cobrada. Aula marcada da Bia, na empresa A.
INSERT INTO public.lessons (id, account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, price)
VALUES ('32000000-0000-0000-0000-000000000001', current_setting('teste.a')::uuid, 'Bia', 'Ana', 'thiago',
        date_trunc('hour', now()) + interval '20 days 3 hours', 60, 'agendada', 200.00);

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
DO $$
DECLARE _h text;
BEGIN
  PERFORM public.charge_lesson_absence('32000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU: cobrou falta com a politica desligada';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS _h = PG_EXCEPTION_HINT;
  PERFORM public.assert(_h = 'falta_desligada', 'com a politica desligada, nao se cobra falta');
END $$;
UPDATE public.settings SET charge_absence = true, absence_charge_percent = 50 WHERE account_id = current_setting('teste.a')::uuid;
SELECT public.charge_lesson_absence('32000000-0000-0000-0000-000000000001');
SELECT public.assert((SELECT status = 'realizada' AND absence_charged AND price = 100.00 FROM public.lessons
                        WHERE id = '32000000-0000-0000-0000-000000000001'),
  'falta cobrada: vira realizada, marcada como falta, a 50% do valor');
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions WHERE lesson_id = '32000000-0000-0000-0000-000000000001' AND amount < 0) = 1,
  'e entra na cobranca da familia');
DO $$
BEGIN
  PERFORM public.charge_lesson_absence('32000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU: cobrou falta duas vezes';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - nao cobra falta duas vezes';
END $$;
COMMIT;

-- Outra empresa e a familia nao cobram falta da aula da empresa A.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  PERFORM public.charge_lesson_absence('32000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU: a familia cobrou falta';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - a familia nao cobra falta';
END $$;
COMMIT;

-- Pacotes: cada empresa ve e mexe so nos proprios.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
INSERT INTO public.lesson_packages (name, lessons, price) VALUES ('Pacote 8', 8, 1500);
SELECT public.assert((SELECT count(*) FROM public.lesson_packages WHERE name = 'Pacote 8') = 1, 'o admin cria pacote da propria empresa');
UPDATE public.lesson_packages SET price = 1400 WHERE name = 'Pacote 8';
SELECT public.assert((SELECT price FROM public.lesson_packages WHERE name = 'Pacote 8') = 1400, 'e edita');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ub'), true);
SELECT public.assert((SELECT count(*) FROM public.lesson_packages WHERE name = 'Pacote 8') = 0, 'outra empresa nao ve o pacote');
DELETE FROM public.lesson_packages WHERE name = 'Pacote 8';
COMMIT;
SELECT public.assert((SELECT count(*) FROM public.lesson_packages WHERE name = 'Pacote 8') = 1, 'nem apaga');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert((SELECT count(*) FROM public.lesson_packages) = 0, 'a familia nao ve a tabela de pacotes');
COMMIT;

-- No Essencial nao se cria pacote.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
DO $$
BEGIN
  INSERT INTO public.lesson_packages (name, lessons, price) VALUES ('X', 5, 100);
  RAISE EXCEPTION 'FALHOU: Essencial criou pacote';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - no Essencial nao se cria pacote';
END $$;
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
DELETE FROM public.lesson_packages WHERE name = 'Pacote 8';
SELECT public.assert((SELECT count(*) FROM public.lesson_packages WHERE name = 'Pacote 8') = 0, 'o admin apaga o proprio pacote');
COMMIT;



\echo ''
\echo '--- 33. Max pago traz o assistente; teste no Pro; WhatsApp do cliente ---'

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('33000000-0000-0000-0000-000000000001', 'max@x', '{"signup_kind":"school","school_name":"Escola Max","teacher_name":"Lia"}');
SELECT set_config('teste.a33', (SELECT account_id::text FROM public.user_roles WHERE user_id = '33000000-0000-0000-0000-000000000001'), false);

SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.a33')::uuid),
  'no teste gratis (Pro) ainda sem IA (so pagando, desde 10/10)');
SELECT public.assert(NOT public.account_can('arrival_location', current_setting('teste.a33')::uuid)
                     AND public.account_can('whatsapp_link', current_setting('teste.a33')::uuid),
  'Pro: WhatsApp de um toque sim, localizacao nao');

-- Max de cortesia (sem assinatura): sem assistente.
UPDATE public.accounts SET plan = 'pro', trial_ends_at = NULL WHERE id = current_setting('teste.a33')::uuid;
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.a33')::uuid)
                     AND public.account_can('arrival_location', current_setting('teste.a33')::uuid)
                     AND public.account_can('whatsapp_auto', current_setting('teste.a33')::uuid),
  'Max sem assinatura: localizacao e WhatsApp automatico, mas sem assistente');

-- Max pago: assistente incluso.
SELECT public.billing_apply_subscription(current_setting('teste.a33')::uuid, 'cus_33', 'sub_33', 'active', 'pro', 'month', now() + interval '1 month');
SELECT public.assert(public.account_can('assistant', current_setting('teste.a33')::uuid)
                     AND NOT coalesce((SELECT assistant_override FROM public.accounts WHERE id = current_setting('teste.a33')::uuid), false),
  'Max pago: assistente incluso, sem precisar de liberacao a mao');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33000000-0000-0000-0000-000000000001', true);
SELECT public.assert((public.my_plan() ->> 'assistant')::boolean AND (public.my_plan() ->> 'assistant_included')::boolean,
  'my_plan() mostra o assistente incluso no Max');
INSERT INTO public.students (student_name, whatsapp) VALUES ('Cliente Zap', '11987654321');
DO $$
BEGIN
  INSERT INTO public.students (student_name, whatsapp) VALUES ('Zap torto', '(11) 9876');
  RAISE EXCEPTION 'FALHOU: aceitou WhatsApp com mascara';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - WhatsApp do cliente so com digitos';
END $$;
COMMIT;

-- Voltou para o Pro pelo portal: o assistente incluso vai embora.
SELECT public.billing_apply_subscription(current_setting('teste.a33')::uuid, 'cus_33', 'sub_33', 'active', 'pro_solo', 'month', now() + interval '1 month');
SELECT public.assert(public.account_can('assistant', current_setting('teste.a33')::uuid)
                     AND (SELECT messages FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 100,
  'no Pro sem o adicional: as 100 inclusas');
-- Pro com o adicional comprado: tem.
SELECT public.billing_apply_subscription(current_setting('teste.a33')::uuid, 'cus_33', 'sub_33', 'active', 'pro_solo', 'month', now() + interval '1 month', true);
SELECT public.assert(public.account_can('assistant', current_setting('teste.a33')::uuid)
                     AND (SELECT messages FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 200,
  'Pro com o adicional: as inclusas (100) somam com o adicional (100) = 200');
-- Cancelou: nada.
SELECT public.billing_apply_subscription(current_setting('teste.a33')::uuid, 'cus_33', 'sub_33', 'canceled', NULL, NULL, NULL, false);
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.a33')::uuid),
  'cancelou: sem assistente');


\echo ''
\echo '--- 34. Limite do assistente por plano; um admin por empresa ---'

SELECT public.assert((SELECT messages FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 100
                     AND (SELECT cost_usd FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 3,
  'liberacao manual sem plano que traga IA: a franquia do adicional, 100 mensagens, teto US$ 3');
UPDATE public.accounts SET plan = 'start', assistant_billed = true WHERE id = current_setting('teste.a33')::uuid;
SELECT public.assert((SELECT messages FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 100,
  'Start com o adicional: 100 mensagens');
UPDATE public.accounts SET plan = 'start', assistant_billed = false, assistant_override = NULL WHERE id = current_setting('teste.a33')::uuid;
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.a33')::uuid),
  'Start sem o adicional: sem IA');
UPDATE public.accounts SET plan = 'pro' WHERE id = current_setting('teste.a33')::uuid;
SELECT public.assert((SELECT messages FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 200
                     AND (SELECT cost_usd FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 5,
  'Max: 200 mensagens, teto US$ 5');
UPDATE public.accounts SET assistant_monthly_messages = 500 WHERE id = current_setting('teste.a33')::uuid;
SELECT public.assert((SELECT messages FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 500,
  'o ajuste a mao do gestor vale mais que o do plano');
SELECT public.assert((public.assistant_usage_status(current_setting('teste.a33')::uuid) ->> 'limit')::int = 500,
  'e e o que o assistente confere');
UPDATE public.accounts SET assistant_monthly_messages = NULL WHERE id = current_setting('teste.a33')::uuid;

-- Um admin por empresa.
INSERT INTO auth.users (id, email) VALUES ('34000000-0000-0000-0000-000000000001', 'segundo@x');
DO $$
BEGIN
  INSERT INTO public.user_roles (user_id, role, account_id)
  VALUES ('34000000-0000-0000-0000-000000000001', 'admin', current_setting('teste.a33')::uuid);
  RAISE EXCEPTION 'FALHOU: segundo admin na mesma empresa';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - a empresa tem um admin so';
END $$;
DO $$
BEGIN
  UPDATE public.user_roles SET role = 'admin', account_id = current_setting('teste.a33')::uuid
   WHERE user_id = '34000000-0000-0000-0000-000000000001';
  INSERT INTO public.user_roles (user_id, role, account_id)
  VALUES ('34000000-0000-0000-0000-000000000001', 'teacher', current_setting('teste.a33')::uuid);
  UPDATE public.user_roles SET role = 'admin'
   WHERE user_id = '34000000-0000-0000-0000-000000000001' AND role = 'teacher';
  RAISE EXCEPTION 'FALHOU: professor virou admin';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - professor nao vira admin';
END $$;
UPDATE public.accounts SET multi_admin = true WHERE id = current_setting('teste.a33')::uuid;
INSERT INTO public.user_roles (user_id, role, account_id)
VALUES ('34000000-0000-0000-0000-000000000001', 'admin', current_setting('teste.a33')::uuid);
SELECT public.assert((SELECT count(*) FROM public.user_roles WHERE account_id = current_setting('teste.a33')::uuid AND role = 'admin') = 2,
  'com multi_admin (so o Portal de Aulas), pode ter mais de um');


\echo ''
\echo '--- 35. Servicos: preco, quem faz, limite do Essencial ---'

DO $$
DECLARE
  _m uuid; _e uuid; _o uuid;
  _adm uuid := gen_random_uuid();
  _adm_o uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Clinica S', 'clinica-s', 'pro') RETURNING id INTO _m;
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Clinica E', 'clinica-e', 'essencial') RETURNING id INTO _e;
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Clinica O', 'clinica-o', 'pro') RETURNING id INTO _o;
  INSERT INTO public.settings (account_id, default_lesson_price) VALUES (_m, 100.00), (_e, 100.00), (_o, 100.00);
  INSERT INTO auth.users (id, email) VALUES (_adm, 'adm-s@x'), (_adm_o, 'adm-o@x');
  DELETE FROM public.user_roles WHERE user_id IN (_adm, _adm_o);
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_adm, 'admin', _m), (_adm_o, 'admin', _o);
  INSERT INTO public.teachers (account_id, name, active, all_services, sort_order) VALUES
    (_m, 'Lia', true, true, 1), (_m, 'Rui', true, false, 2);
  PERFORM set_config('teste.sm', _m::text, false);
  PERFORM set_config('teste.se', _e::text, false);
  PERFORM set_config('teste.adm_s', _adm::text, false);
  PERFORM set_config('teste.adm_o', _adm_o::text, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.adm_s'), true);
INSERT INTO public.services (name, duration_minutes, price, color) VALUES ('Limpeza', 30, 90.00, 'verde'), ('Clareamento', 90, 450.00, 'violeta');
INSERT INTO public.teacher_services (teacher_id, service_id)
  SELECT t.id, s.id FROM public.teachers t, public.services s WHERE t.name = 'Rui' AND s.name = 'Limpeza';
SELECT public.assert((SELECT count(*) FROM public.services) = 2, 'admin cadastra servicos da propria empresa');
DO $$
BEGIN
  INSERT INTO public.services (name, color) VALUES ('Cor torta', 'dourado');
  RAISE EXCEPTION 'FALHOU: cor fora da paleta';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - cor so da paleta';
END $$;
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.adm_o'), true);
SELECT public.assert((SELECT count(*) FROM public.services) = 0 AND (SELECT count(*) FROM public.teacher_services) = 0,
  'outra empresa nao ve os servicos');
DO $$
BEGIN
  INSERT INTO public.teacher_services (teacher_id, service_id, account_id)
  SELECT t.id, s.id, current_setting('teste.sm')::uuid FROM public.teachers t, public.services s LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'FALHOU: ligou servico de outra empresa'; END IF;
  RAISE NOTICE '  ok - nao alcanca servico de outra empresa';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao liga servico de outra empresa';
END $$;
COMMIT;

-- Preco: o servico tem o valor do atendimento; a aula guarda o da hora.
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, service_id, status)
SELECT current_setting('teste.sm')::uuid, 'Paciente', 'lia', '2027-05-01 10:00-03', 90, id, 'agendada'
  FROM public.services WHERE name = 'Clareamento';
SELECT public.assert((SELECT price FROM public.lessons WHERE student_name = 'Paciente') = 300.00,
  'servico de R$ 450 em 90 min vira R$ 300/h na aula');
SELECT public.assert((SELECT price * duration_minutes / 60 FROM public.lessons WHERE student_name = 'Paciente') = 450,
  'e a cobranca da o preco do servico');

-- Rui so faz Limpeza: pedido de Clareamento com ele e recusado; com a Lia (faz todos), passa.
DO $$
BEGIN
  INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, service_id, status)
  SELECT current_setting('teste.sm')::uuid, 'Paciente 2', 'rui', '2027-05-02 10:00-03', 90, id, 'solicitada'
    FROM public.services WHERE name = 'Clareamento';
  RAISE EXCEPTION 'FALHOU: pedido com quem nao faz o servico';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - pedido so com quem faz o servico';
END $$;
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, service_id, status)
SELECT current_setting('teste.sm')::uuid, 'Paciente 3', 'rui', '2027-05-03 10:00-03', 30, id, 'solicitada'
  FROM public.services WHERE name = 'Limpeza';
SELECT public.assert((SELECT price FROM public.lessons WHERE student_name = 'Paciente 3') = 180.00, 'Limpeza R$ 90 em 30 min: R$ 180/h');
SELECT public.assert(public.teacher_does_service('lia', (SELECT id FROM public.services WHERE name = 'Clareamento'), current_setting('teste.sm')::uuid),
  'quem tem a etiqueta faz todos');
-- Sem Max, nao existe servico por profissional: todos fazem todos.
UPDATE public.accounts SET plan = 'pro_solo' WHERE id = current_setting('teste.sm')::uuid;
SELECT public.assert(public.teacher_does_service('rui', (SELECT id FROM public.services WHERE name = 'Clareamento'), current_setting('teste.sm')::uuid),
  'no Pro, todo profissional faz todos os servicos');
UPDATE public.accounts SET plan = 'pro' WHERE id = current_setting('teste.sm')::uuid;
-- Servico de outra empresa nao entra na aula.
DO $$
BEGIN
  INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, service_id, status)
  SELECT current_setting('teste.se')::uuid, 'X', 'lia', '2027-05-04 10:00-03', 30, id, 'agendada'
    FROM public.services WHERE name = 'Limpeza';
  RAISE EXCEPTION 'FALHOU: servico de outra empresa na aula';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - servico so da propria empresa';
END $$;
-- Sem servico, continua o preco padrao.
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, status)
VALUES (current_setting('teste.sm')::uuid, 'Paciente 4', 'lia', '2027-05-05 10:00-03', 60, 'agendada');
SELECT public.assert((SELECT price FROM public.lessons WHERE student_name = 'Paciente 4') = 100.00, 'sem servico, o preco padrao');

-- Essencial: um servico ativo.
INSERT INTO public.services (account_id, name) VALUES (current_setting('teste.se')::uuid, 'Consulta');
DO $$
BEGIN
  INSERT INTO public.services (account_id, name) VALUES (current_setting('teste.se')::uuid, 'Retorno');
  RAISE EXCEPTION 'FALHOU: segundo servico no Essencial';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - Essencial fica com um servico';
END $$;
INSERT INTO public.services (account_id, name, active) VALUES (current_setting('teste.se')::uuid, 'Retorno', false);
SELECT public.assert((SELECT count(*) FROM public.services WHERE account_id = current_setting('teste.se')::uuid) = 2,
  'desligado pode ficar guardado');


\echo ''
\echo '--- 36. Servicos na pagina publica (sem login) ---'

INSERT INTO public.services (account_id, name, duration_minutes, price)
SELECT id, 'Reforco publico', 60, 150 FROM public.accounts WHERE slug = 'portaldeaulas';
INSERT INTO public.services (account_id, name, active)
SELECT id, 'Desligado publico', false FROM public.accounts WHERE slug = 'portaldeaulas';

BEGIN;
SET LOCAL ROLE anon;
SELECT public.assert((SELECT string_agg(x ->> 'name', ',') FROM jsonb_array_elements(public.public_services() -> 'services') x) = 'Reforco publico',
  'visitante ve so os servicos ligados da empresa do endereco (nada da Clinica S)');
SELECT public.assert(jsonb_array_length(public.public_services() -> 'teachers') >= 1, 'e quem atende');
DO $$
BEGIN
  PERFORM 1 FROM public.services;
  RAISE EXCEPTION 'FALHOU: visitante leu a tabela de servicos';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - a tabela continua fechada para o visitante';
END $$;
COMMIT;


\echo ''
\echo '--- 37. Professor ve so os proprios bloqueios ---'

INSERT INTO public.blocks (account_id, title, teacher, block_type, start_at, end_at) VALUES
  (current_setting('teste.t')::uuid, 'Da Ana', 'ana-julia', 'one_off', '2027-04-01 10:00-03', '2027-04-01 11:00-03'),
  (current_setting('teste.t')::uuid, 'Do Beto', 'beto', 'one_off', '2027-04-01 10:00-03', '2027-04-01 11:00-03'),
  (current_setting('teste.t')::uuid, 'Feriado', 'both', 'one_off', '2027-04-02 00:00-03', '2027-04-02 23:00-03');
INSERT INTO public.block_exceptions (account_id, block_id, exception_date)
SELECT account_id, id, '2027-04-01' FROM public.blocks WHERE title = 'Do Beto';

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.prof'), true);
SELECT public.assert((SELECT string_agg(title, ',' ORDER BY title) FROM public.blocks) = 'Da Ana,Feriado,Folga',
  'professor ve os proprios bloqueios e os da empresa toda, nao os do Beto');
SELECT public.assert((SELECT count(*) FROM public.block_exceptions) = 0, 'nem as excecoes dos bloqueios do Beto');
COMMIT;


\echo ''
\echo '--- 38. Pagamento e desconto: admin so mexe na propria empresa ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.adm_o'), true);
DO $$
BEGIN
  PERFORM public.register_payment('Paciente', NULL, -500, 'adjustment', 'golpe', 0, NULL, current_setting('teste.sm')::uuid);
  RAISE EXCEPTION 'FALHOU: admin lancou pagamento em outra empresa';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - admin nao lanca pagamento em outra empresa';
END $$;
DO $$
BEGIN
  PERFORM public.set_account_discount('Paciente', NULL, 'percent', 100, 'golpe', current_setting('teste.sm')::uuid);
  RAISE EXCEPTION 'FALHOU: admin deu desconto em outra empresa';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - admin nao mexe no desconto de outra empresa';
END $$;
SELECT public.assert((public.register_payment('Cliente O', NULL, 100, 'adjustment', 'Pix') ->> 'payment_id') IS NOT NULL,
  'na propria empresa (sem passar a empresa) continua funcionando');
COMMIT;
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions WHERE description = 'golpe') = 0, 'nada entrou na outra empresa');


\echo ''
\echo '--- 39. Testador, resumo pelo professor, intervalo, pacote por servico ---'

-- Testador: so o gestor liga; no fim volta ao Essencial.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.adm_s'), true);
DO $$
BEGIN
  PERFORM public.platform_set_tester(current_setting('teste.se')::uuid, 30, true);
  RAISE EXCEPTION 'FALHOU: admin comum virou testador';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - so o gestor da cortesia';
END $$;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.platform_set_tester(current_setting('teste.se')::uuid, 30, true);
COMMIT;
SELECT public.assert((SELECT plan FROM public.accounts WHERE id = current_setting('teste.se')::uuid) = 'pro'
                     AND public.account_can('assistant', current_setting('teste.se')::uuid)
                     AND (SELECT tester_until FROM public.accounts WHERE id = current_setting('teste.se')::uuid) > now() + interval '29 days',
  'testador: Max com assistente por 30 dias');
UPDATE public.accounts SET tester_until = now() - interval '1 minute' WHERE id = current_setting('teste.se')::uuid;
SELECT public.assert(public.expire_testers() >= 1, 'a rotina acha a cortesia vencida');
SELECT public.assert((SELECT plan FROM public.accounts WHERE id = current_setting('teste.se')::uuid) = 'essencial'
                     AND NOT public.account_can('assistant', current_setting('teste.se')::uuid)
                     AND (SELECT tester_until FROM public.accounts WHERE id = current_setting('teste.se')::uuid) IS NULL,
  'vencida: volta ao Essencial, sem assistente');

-- Resumo pelo professor.
INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status) VALUES
  (current_setting('teste.t')::uuid, 'Caio', 'Dora', 'ana-julia', now() - interval '20 minutes', 60, 'agendada'),
  (current_setting('teste.t')::uuid, 'Eva', 'Gil', 'beto', now() - interval '3 hours', 60, 'realizada');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.prof'), true);
SELECT public.assert((public.teacher_save_lesson_summary(
  (SELECT id FROM public.lessons WHERE teacher = 'ana-julia' AND start_at > now() - interval '1 hour' AND start_at <= now()),
  'Revisamos fracoes') ->> 'status') = 'realizada',
  'professor escreve o resumo e a aula que ja comecou vira realizada');
DO $$
BEGIN
  PERFORM public.teacher_save_lesson_summary(
    (SELECT id FROM public.lessons WHERE teacher = 'ana-julia' AND start_at > now() + interval '1 day' ORDER BY start_at LIMIT 1), 'adiantado');
  RAISE EXCEPTION 'FALHOU: resumo de aula futura';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - aula que nao comecou nao recebe resumo';
END $$;
COMMIT;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('teste.prof'), true);
  PERFORM public.teacher_save_lesson_summary(
    (SELECT id FROM public.lessons WHERE teacher = 'beto' AND status = 'realizada' AND account_id = current_setting('teste.t')::uuid LIMIT 1), 'intruso');
  RAISE EXCEPTION 'FALHOU: professor escreveu resumo da aula do Beto';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - nao escreve resumo da aula de outro professor';
END $$;
SELECT set_config('request.jwt.claim.sub', '', false);

-- Intervalo: a pagina publica le.
BEGIN;
SET LOCAL ROLE anon;
SELECT public.assert((SELECT buffer_minutes FROM public.settings LIMIT 1) = 0, 'visitante le o intervalo (padrao 0)');
COMMIT;

-- Pacote so com servico da propria empresa.
DO $$
BEGIN
  INSERT INTO public.lesson_packages (account_id, name, lessons, price, service_id)
  SELECT current_setting('teste.sm')::uuid, 'Pacote torto', 5, 100, id FROM public.services WHERE name = 'Consulta';
  RAISE EXCEPTION 'FALHOU: pacote com servico de outra empresa';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - pacote so com servico da propria empresa';
END $$;
INSERT INTO public.lesson_packages (account_id, name, lessons, price, service_id)
SELECT current_setting('teste.sm')::uuid, '10 clareamentos', 10, 4000, id FROM public.services WHERE name = 'Clareamento';
SELECT public.assert((SELECT service_id FROM public.lesson_packages WHERE name = '10 clareamentos') IS NOT NULL, 'pacote de um servico');


\echo ''
\echo '--- 40. Profissional novo vai para o fim da prioridade ---'

UPDATE public.teachers SET sort_order = 5 WHERE account_id = current_setting('teste.sm')::uuid AND name = 'Rui';
INSERT INTO public.teachers (account_id, name, active) VALUES (current_setting('teste.sm')::uuid, 'Aaron', true);
SELECT public.assert((SELECT name FROM public.teachers WHERE account_id = current_setting('teste.sm')::uuid ORDER BY sort_order DESC, name LIMIT 1) = 'Aaron',
  'o novo entra depois de todos (mesmo com nome que viria primeiro)');
SELECT public.assert((SELECT sort_order FROM public.teachers WHERE account_id = current_setting('teste.sm')::uuid AND name = 'Aaron') = 6,
  'na posicao seguinte ao ultimo');


\echo ''
\echo '--- 41. Lingua e moeda da empresa ---'

SELECT public.assert((SELECT locale || '/' || currency FROM public.accounts WHERE id = current_setting('teste.sm')::uuid) = 'pt-BR/BRL',
  'empresa nasce em portugues e reais');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.adm_s'), true);
SELECT public.assert((public.set_account_locale('en', 'USD') ->> 'locale') = 'en', 'admin muda para ingles');
SELECT public.assert((public.my_vocabulary() ->> 'currency') = 'USD', 'e o app le a moeda');
DO $$
BEGIN
  PERFORM public.set_account_locale('fr', NULL);
  RAISE EXCEPTION 'FALHOU: lingua invalida';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - so linguas conhecidas';
END $$;
COMMIT;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.prof'), true);
DO $$
BEGIN
  PERFORM public.set_account_locale('en', 'USD');
  RAISE EXCEPTION 'FALHOU: professor mudou a lingua';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - professor nao muda a lingua da empresa';
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE anon;
SELECT public.assert((public.my_vocabulary() ->> 'locale') = 'pt-BR', 'pagina publica le a lingua da empresa do endereco');
COMMIT;


\echo ''
\echo '--- 42. Empresa criada em ingles nasce em ingles ---'

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('42000000-0000-0000-0000-000000000001', 'owner@studio.us', '{"signup_kind":"school","school_name":"Studio NY","teacher_name":"Kate","locale":"en","currency":"USD"}'),
  ('42000000-0000-0000-0000-000000000002', 'dono@estudio.br', '{"signup_kind":"school","school_name":"Estudio BR","teacher_name":"Rafa","locale":"xx"}');
SELECT public.assert((SELECT locale || '/' || currency FROM public.accounts WHERE name = 'Studio NY') = 'en/USD', 'cadastro em ingles: en/USD');
SELECT public.assert((SELECT locale || '/' || currency FROM public.accounts WHERE name = 'Estudio BR') = 'pt-BR/BRL', 'lingua invalida vira portugues/real');

\echo ''
\echo '--- 43. Moeda travada enquanto ha assinatura ---'

UPDATE public.accounts SET stripe_subscription_id = 'sub_teste', billing_status = 'active' WHERE id = current_setting('teste.sm')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.adm_s'), true);
DO $$
BEGIN
  PERFORM public.set_account_locale(NULL, 'EUR');
  RAISE EXCEPTION 'FALHOU: trocou a moeda com assinatura ativa';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - moeda travada com assinatura ativa';
END $$;
SELECT public.assert((public.set_account_locale('pt-BR', NULL) ->> 'locale') = 'pt-BR', 'a lingua continua livre');
SELECT public.assert((public.set_account_locale(NULL, 'USD') ->> 'currency') = 'USD', 'repetir a mesma moeda nao e troca');
COMMIT;
UPDATE public.accounts SET stripe_subscription_id = NULL, billing_status = 'canceled' WHERE id = current_setting('teste.sm')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.adm_s'), true);
SELECT public.assert((public.set_account_locale(NULL, 'GBP') ->> 'currency') = 'GBP', 'sem assinatura a moeda muda');
COMMIT;

\echo ''
\echo '--- 44. Start: 25 clientes ativos; pedido da familia no limite ---'

DO $$
DECLARE _s uuid; _ua uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Start Ltda', 'start-ltda', 'start') RETURNING id INTO _s;
  INSERT INTO public.settings (account_id, allow_student_booking, min_request_notice_hours) VALUES (_s, true, 0);
  INSERT INTO auth.users (id, email) VALUES (_ua, 'admin-start@x');
  DELETE FROM public.user_roles WHERE user_id = _ua;
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_ua, 'admin', _s);
  PERFORM set_config('teste.st', _s::text, false);
  PERFORM set_config('teste.ust', _ua::text, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ust'), true);
SELECT public.assert((public.my_plan() ->> 'max_active_clients')::int = 25 AND public.account_can('packages')
                     AND public.account_limit('teachers') = 1 AND NOT public.account_can('assistant'),
  'Start: 25 ativos, recursos pagos, 1 profissional, IA so com o adicional');
INSERT INTO public.teachers (name, active) VALUES ('Tina', true);
INSERT INTO public.lessons (student_name, teacher, start_at, duration_minutes)
SELECT 'S' || g, 'tina', now() + make_interval(days => 2, hours => g), 60 FROM generate_series(1, 25) g;
SELECT public.assert((public.my_plan() ->> 'active_clients')::int = 25, 'my_plan mostra 25 de 25 ativos');
DO $$
DECLARE _h text;
BEGIN
  INSERT INTO public.lessons (student_name, teacher, start_at, duration_minutes)
  VALUES ('S26', 'tina', now() + interval '9 days', 60);
  RAISE EXCEPTION 'FALHOU: 26o cliente ativo no Start';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS _h = PG_EXCEPTION_HINT;
  PERFORM public.assert(_h = 'limite_clientes_ativos:25', 'o limite vem com a chave para a tela (' || _h || ')');
END $$;
COMMIT;

-- A familia de um cliente novo pede horario com a agenda no limite: recusa neutra.
DO $$
DECLARE _f uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_f, 'familia-start@x');
  DELETE FROM public.user_roles WHERE user_id = _f;
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_f, 'student', current_setting('teste.st')::uuid);
  INSERT INTO public.students (account_id, student_name, guardian_name, user_id)
  VALUES (current_setting('teste.st')::uuid, 'Novo', 'Mae', _f);
  PERFORM set_config('teste.fst', _f::text, false);
END $$;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.fst'), true);
DO $$
BEGIN
  INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, package_type, payment_status)
  VALUES (current_setting('teste.st')::uuid, 'Novo', 'Mae', 'tina', now() + interval '8 days', 60, 'solicitada', 'single', 'pendente');
  RAISE EXCEPTION 'FALHOU: pedido de cliente novo passou do limite';
EXCEPTION WHEN check_violation THEN
  IF sqlerrm ILIKE '%plano%' THEN RAISE EXCEPTION 'FALHOU: a familia viu falar de plano'; END IF;
  RAISE NOTICE '  ok - a familia recebe recusa neutra, sem falar de plano';
END $$;
COMMIT;

-- Sobe para o Pro: sem limite, o pedido passa.
UPDATE public.accounts SET plan = 'pro_solo' WHERE id = current_setting('teste.st')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.fst'), true);
INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, package_type, payment_status)
VALUES (current_setting('teste.st')::uuid, 'Novo', 'Mae', 'tina', now() + interval '8 days', 60, 'solicitada', 'single', 'pendente');
SELECT public.assert(true, 'no Pro o pedido do cliente novo entra');
COMMIT;

\echo ''
\echo '--- 45. Switch geral do assistente: desligado, so quem o gestor liberou ---'

DO $$
DECLARE _op uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_op, 'gestor45@x');
  DELETE FROM public.user_roles WHERE user_id = _op;
  INSERT INTO public.platform_admins (user_id, note) VALUES (_op, 'teste 45');
  PERFORM set_config('teste.op45', _op::text, false);
END $$;
INSERT INTO public.accounts (name, slug, plan) VALUES ('Max Pago 45', 'maxpago45', 'pro');
UPDATE public.accounts SET billing_status = 'active', trial_ends_at = NULL WHERE slug = 'maxpago45';
SELECT set_config('teste.m45', (SELECT id::text FROM public.accounts WHERE slug = 'maxpago45'), false);
UPDATE public.accounts SET assistant_billed = true WHERE id = current_setting('teste.st')::uuid;
SELECT public.assert(public.account_can('assistant', current_setting('teste.m45')::uuid)
                     AND public.account_can('assistant', current_setting('teste.st')::uuid),
  'switch ligado: Max pago e Pro com adicional usam o assistente');

-- Admin de empresa nao mexe no switch.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ust'), true);
DO $$
BEGIN
  PERFORM public.platform_set_assistant_enabled(false);
  RAISE EXCEPTION 'FALHOU: admin de empresa desligou o switch geral';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - admin de empresa nao mexe no switch geral';
END $$;
DO $$
BEGIN
  PERFORM 1 FROM public.platform_settings;
  RAISE EXCEPTION 'FALHOU: tabela do switch legivel direto';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - a tabela do switch nao e lida direto';
END $$;
COMMIT;

-- O gestor desliga.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op45'), true);
SELECT public.assert(public.platform_set_assistant_enabled(false) = false, 'o gestor desliga o switch geral');
COMMIT;
SELECT public.assert(NOT public.assistant_on_sale(), 'desligado: o adicional sai de venda');
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.m45')::uuid),
  'desligado: Max pago fica sem assistente');
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.st')::uuid),
  'desligado: amostra do Pro e adicional comprado ficam sem assistente');
SELECT public.assert(public.account_can('assistant', (SELECT id FROM public.accounts WHERE slug = 'portaldeaulas')),
  'desligado: o Portal de Aulas (liberado pelo gestor) continua com assistente');
UPDATE public.accounts SET assistant_override = true WHERE id = current_setting('teste.m45')::uuid;
SELECT public.assert(public.account_can('assistant', current_setting('teste.m45')::uuid),
  'desligado: empresa liberada uma a uma pelo gestor usa o assistente');
UPDATE public.accounts SET assistant_override = false WHERE id = current_setting('teste.m45')::uuid;

-- Religa: volta o que cada plano traz.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op45'), true);
SELECT public.assert(public.platform_set_assistant_enabled(true), 'o gestor religa o switch geral');
SELECT public.assert(public.assistant_enabled_for_plans(), 'o painel le o switch ligado');
COMMIT;
SELECT public.assert(public.account_can('assistant', current_setting('teste.m45')::uuid),
  'religado: Max pago volta a ter o assistente');

\echo ''
\echo '--- 46. Google Agenda: conexao fechada, switches, fila e ocupado importado ---'

DO $$
DECLARE _g uuid; _adm uuid := gen_random_uuid(); _prof uuid := gen_random_uuid(); _sadm uuid := gen_random_uuid(); _s uuid;
BEGIN
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Agenda G', 'agenda-g', 'pro') RETURNING id INTO _g;
  INSERT INTO public.settings (account_id, default_lesson_price) VALUES (_g, 100.00);
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Start G', 'start-g', 'start') RETURNING id INTO _s;
  INSERT INTO public.settings (account_id, default_lesson_price) VALUES (_s, 100.00);
  INSERT INTO auth.users (id, email) VALUES (_adm, 'adm-g@x'), (_prof, 'gabi-g@x'), (_sadm, 'adm-sg@x');
  DELETE FROM public.user_roles WHERE user_id IN (_adm, _prof, _sadm);
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_adm, 'admin', _g), (_prof, 'teacher', _g), (_sadm, 'admin', _s);
  INSERT INTO public.teachers (account_id, name, active, user_id) VALUES (_g, 'Gabi', true, _prof), (_g, 'Hugo', true, NULL);
  -- Solo: o dono que atende (marcado como "sou eu" do admin da Start G).
  INSERT INTO public.teachers (account_id, name, active, user_id, admin_user_id) VALUES (_s, 'Solo', true, NULL, _sadm);
  PERFORM set_config('teste.g', _g::text, false);
  PERFORM set_config('teste.gadm', _adm::text, false);
  PERFORM set_config('teste.gprof', _prof::text, false);
  PERFORM set_config('teste.sgadm', _sadm::text, false);
  PERFORM set_config('teste.gabi', (SELECT id::text FROM public.teachers WHERE account_id = _g AND name = 'Gabi'), false);
  PERFORM set_config('teste.hugo', (SELECT id::text FROM public.teachers WHERE account_id = _g AND name = 'Hugo'), false);
  PERFORM set_config('teste.solo', (SELECT id::text FROM public.teachers WHERE account_id = _s AND name = 'Solo'), false);
  -- O que a funcao faz no retorno do Google (chave de servico).
  INSERT INTO public.google_calendar_connections (teacher_id, account_id, google_email, refresh_token)
  VALUES (current_setting('teste.gabi')::uuid, _g, 'gabi@gmail.com', 'rt-secreto');
  INSERT INTO public.google_calendar_connections (teacher_id, account_id, google_email, refresh_token, import_enabled, export_enabled)
  VALUES (current_setting('teste.solo')::uuid, _s, 'solo@gmail.com', 'rt-solo', false, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.gadm'), true);
DO $$
BEGIN
  PERFORM refresh_token FROM public.google_calendar_connections;
  RAISE EXCEPTION 'FALHOU: admin leu o refresh token';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - ninguem de fora le a tabela de conexoes (refresh token)';
END $$;
SELECT public.assert((SELECT count(*) FROM public.google_calendar_status()) = 2
                     AND (SELECT connected AND import_enabled AND export_enabled AND google_email = 'gabi@gmail.com'
                            FROM public.google_calendar_status() WHERE teacher_name = 'Gabi')
                     AND (SELECT NOT connected FROM public.google_calendar_status() WHERE teacher_name = 'Hugo'),
  'o admin ve os dois profissionais: Gabi conectada, Hugo nao');
SELECT public.assert((SELECT NOT can_manage AND has_login AND NOT claimable FROM public.google_calendar_status() WHERE teacher_name = 'Gabi')
                     AND (SELECT NOT can_manage AND claimable FROM public.google_calendar_status() WHERE teacher_name = 'Hugo'),
  'o admin so ve a Gabi (tem login); o Hugo sem "sou eu" ainda nao e dele');
SELECT public.google_calendar_claim_self(current_setting('teste.hugo')::uuid);
SELECT public.assert((SELECT can_manage AND is_self AND NOT claimable FROM public.google_calendar_status() WHERE teacher_name = 'Hugo'),
  'o admin marca o Hugo como "sou eu" e passa a conectar so ele');
DO $$
DECLARE _h text;
BEGIN
  PERFORM public.google_calendar_claim_self(current_setting('teste.gabi')::uuid);
  RAISE EXCEPTION 'FALHOU: admin marcou como seu um cadastro com login';
EXCEPTION WHEN insufficient_privilege THEN
  GET STACKED DIAGNOSTICS _h = PG_EXCEPTION_HINT;
  PERFORM public.assert(_h = 'google_sou_eu_invalido', 'cadastro com login nao vira "sou eu" do admin (chave ' || _h || ' para a tela traduzir)');
END $$;
DO $$
BEGIN
  PERFORM public.google_calendar_set(current_setting('teste.gabi')::uuid, false, false);
  RAISE EXCEPTION 'FALHOU: admin mexeu no Google de quem tem login proprio';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - admin nao mexe no Google de quem tem login proprio';
END $$;
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.gprof'), true);
SELECT public.assert((SELECT count(*) FROM public.google_calendar_status()) = 1
                     AND (SELECT teacher_name FROM public.google_calendar_status()) = 'Gabi',
  'a profissional ve so a propria linha');
DO $$
BEGIN
  PERFORM public.google_calendar_set(current_setting('teste.hugo')::uuid, true, true);
  RAISE EXCEPTION 'FALHOU: profissional mexeu no Google de outro';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - profissional nao mexe no Google de outro';
END $$;
COMMIT;

-- Aula mexida entra na fila so de quem exporta.
DELETE FROM public.google_sync_queue;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.gadm'), true);
INSERT INTO public.lessons (student_name, teacher, start_at, duration_minutes) VALUES
  ('Ivo', 'hugo', now() + interval '3 days', 60);
COMMIT;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.google_sync_queue), 'aula do Hugo (sem Google) nao entra na fila');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.gadm'), true);
INSERT INTO public.lessons (student_name, teacher, start_at, duration_minutes) VALUES
  ('Juca', 'gabi', now() + interval '4 days', 60);
COMMIT;
SELECT public.assert(EXISTS (SELECT 1 FROM public.google_sync_queue WHERE teacher_id = current_setting('teste.gabi')::uuid),
  'aula nova da Gabi entra na fila de exportacao');
DELETE FROM public.google_sync_queue;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.gadm'), true);
UPDATE public.lessons SET teacher = 'hugo' WHERE student_name = 'Juca' AND account_id = current_setting('teste.g')::uuid;
COMMIT;
SELECT public.assert(EXISTS (SELECT 1 FROM public.google_sync_queue WHERE teacher_id = current_setting('teste.gabi')::uuid),
  'aula que saiu da Gabi enfileira a Gabi (para sair do Google dela)');
DELETE FROM public.google_sync_queue;
UPDATE public.lessons SET teacher = 'gabi' WHERE student_name = 'Juca' AND account_id = current_setting('teste.g')::uuid;
DELETE FROM public.google_sync_queue;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.gadm'), true);
DELETE FROM public.lessons WHERE student_name = 'Juca' AND account_id = current_setting('teste.g')::uuid;
COMMIT;
SELECT public.assert(EXISTS (SELECT 1 FROM public.google_sync_queue WHERE teacher_id = current_setting('teste.gabi')::uuid),
  'aula apagada da Gabi enfileira a Gabi');

-- Ocupado importado (o que a funcao grava) vira bloqueio da Gabi.
SELECT public.assert(public.google_calendar_replace_busy(current_setting('teste.gabi')::uuid,
  now(), now() + interval '60 days',
  jsonb_build_array(jsonb_build_object('start', now() + interval '1 day', 'end', now() + interval '1 day 1 hour'),
                    jsonb_build_object('start', now() + interval '2 days', 'end', now() + interval '2 days 30 minutes'))) = 2,
  'dois intervalos ocupados do Google gravados');
SELECT public.assert(public.google_calendar_replace_busy(current_setting('teste.gabi')::uuid,
  now(), now() + interval '60 days',
  jsonb_build_array(jsonb_build_object('start', now() + interval '1 day', 'end', now() + interval '1 day 1 hour'))) = 1,
  'a passada seguinte regrava o que continua ocupado');
SELECT public.assert((SELECT count(*) FROM public.blocks WHERE source = 'google' AND account_id = current_setting('teste.g')::uuid) = 1,
  'e o compromisso apagado no Google sai daqui');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.gadm'), true);
SELECT public.assert(EXISTS (SELECT 1 FROM public.get_busy_ranges_by_teacher(now(), now() + interval '5 days', 'gabi')
                              WHERE start_at = (SELECT start_at FROM public.blocks WHERE source = 'google' AND teacher = 'gabi')),
  'o ocupado do Google aparece como horario ocupado da Gabi');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.get_busy_ranges_by_teacher(now(), now() + interval '5 days', 'hugo')
                                  WHERE start_at = (SELECT start_at FROM public.blocks WHERE source = 'google' AND teacher = 'gabi')),
  'e nao ocupa o Hugo');
DO $$
BEGIN
  INSERT INTO public.blocks (title, block_type, start_at, end_at, teacher, source)
  VALUES ('x', 'one_off', now(), now() + interval '1 hour', 'gabi', 'google');
  RAISE EXCEPTION 'FALHOU: admin criou bloqueio do Google na mao';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - bloqueio do Google nao se cria pela tela';
END $$;
DO $$
BEGIN
  UPDATE public.blocks SET title = 'meu' WHERE source = 'google';
  RAISE EXCEPTION 'FALHOU: admin editou bloqueio do Google';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - bloqueio do Google nao se edita pela tela';
END $$;
-- Renomear a profissional leva o ocupado junto.
SELECT public.rename_teacher(current_setting('teste.gabi')::uuid, 'Gabriela', 'gabi', 'gabriela');
SELECT public.assert((SELECT count(*) FROM public.blocks WHERE source = 'google' AND teacher = 'gabriela') = 1,
  'renomear a profissional leva o ocupado importado junto');
SELECT public.rename_teacher(current_setting('teste.gabi')::uuid, 'Gabi', 'gabriela', 'gabi');
COMMIT;

-- A propria profissional desliga a importacao: o ocupado some na hora.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.gprof'), true);
SELECT public.google_calendar_set(current_setting('teste.gabi')::uuid, false, true);
SELECT public.assert((SELECT NOT import_enabled AND export_enabled FROM public.google_calendar_status()),
  'a profissional desliga so a importacao');
COMMIT;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.blocks WHERE source = 'google' AND account_id = current_setting('teste.g')::uuid),
  'importacao desligada: o ocupado importado sai na hora');

-- Start nao tem Google Agenda.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.sgadm'), true);
DO $$
DECLARE _h text;
BEGIN
  PERFORM public.google_calendar_set(current_setting('teste.solo')::uuid, true, false);
  RAISE EXCEPTION 'FALHOU: Start ligou o Google Agenda';
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS _h = PG_EXCEPTION_HINT;
  PERFORM public.assert(_h = 'plano:google_calendar', 'Start nao liga o Google Agenda (' || _h || ')');
END $$;
SELECT public.google_calendar_set(current_setting('teste.solo')::uuid, false, false);
SELECT public.assert(true, 'Start pode deixar tudo desligado');
COMMIT;

-- Desconectar apaga conexao, fila e ocupado.
SELECT public.google_calendar_replace_busy(current_setting('teste.gabi')::uuid, now(), now() + interval '60 days',
  jsonb_build_array(jsonb_build_object('start', now() + interval '1 day', 'end', now() + interval '1 day 1 hour')));
SELECT public.google_calendar_forget(current_setting('teste.gabi')::uuid);
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.google_calendar_connections WHERE teacher_id = current_setting('teste.gabi')::uuid)
                     AND NOT EXISTS (SELECT 1 FROM public.blocks WHERE source = 'google' AND account_id = current_setting('teste.g')::uuid),
  'desconectar apaga a conexao e o ocupado importado');

\echo ''
\echo '--- 47. Google Agenda do cliente: switch da empresa, aulas dele, fila ---'

DO $$
DECLARE _g uuid := current_setting('teste.g')::uuid; _resp uuid := gen_random_uuid(); _outro uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_resp, 'rosa-g@x'), (_outro, 'outro-g@x');
  DELETE FROM public.user_roles WHERE user_id IN (_resp, _outro);
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_resp, 'student', _g), (_outro, 'student', _g);
  INSERT INTO public.students (account_id, student_name, guardian_name, user_id) VALUES
    (_g, 'Lia', 'Rosa', _resp), (_g, 'Teo', 'Outra', _outro);
  INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status) VALUES
    (_g, 'Lia', 'Rosa', 'hugo', now() + interval '5 days', 60, 'agendada'),
    (_g, 'Lia', 'Rosa', 'hugo', now() + interval '6 days', 60, 'solicitada'),
    (_g, 'Teo', 'Outra', 'hugo', now() + interval '7 days', 60, 'agendada');
  PERFORM set_config('teste.resp', _resp::text, false);
  PERFORM set_config('teste.outro', _outro::text, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.resp'), true);
SELECT public.assert((SELECT NOT enabled AND NOT connected FROM public.client_calendar_status()),
  'switch da empresa desligado: o cliente nao ve o Conectar');
COMMIT;
UPDATE public.settings SET client_google_calendar = true WHERE account_id = current_setting('teste.g')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.resp'), true);
SELECT public.assert((SELECT enabled FROM public.client_calendar_status()), 'switch ligado no Max: o cliente pode conectar');
DO $$
BEGIN
  PERFORM 1 FROM public.client_calendar_connections;
  RAISE EXCEPTION 'FALHOU: cliente leu a tabela de conexoes';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - cliente nao le a tabela de conexoes (refresh token)';
END $$;
DO $$
BEGIN
  PERFORM public.client_calendar_lessons(current_setting('teste.resp')::uuid, now(), now() + interval '30 days');
  RAISE EXCEPTION 'FALHOU: cliente chamou a lista de aulas da funcao';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - a lista de aulas para o Google e so da funcao';
END $$;
COMMIT;

UPDATE public.accounts SET business_model = 'aulas' WHERE id = current_setting('teste.g')::uuid;
SELECT public.assert((SELECT count(*) FROM public.client_calendar_lessons(current_setting('teste.resp')::uuid, now(), now() + interval '30 days')) = 1,
  'o cliente recebe so a aula dele confirmada (nem pedido, nem a do outro cliente)');
SELECT public.assert((SELECT word = 'Aula' AND teacher_name = 'Hugo' AND NOT is_online
                        FROM public.client_calendar_lessons(current_setting('teste.resp')::uuid, now(), now() + interval '30 days')),
  'evento: "Aula com Hugo" (palavra do ramo, nome do profissional)');

-- Conectado (o que a funcao grava): aula mexida enfileira so ele.
INSERT INTO public.client_calendar_connections (user_id, account_id, google_email, refresh_token)
VALUES (current_setting('teste.resp')::uuid, current_setting('teste.g')::uuid, 'rosa@gmail.com', 'rt-rosa');
DELETE FROM public.client_calendar_queue;
UPDATE public.lessons SET start_at = start_at + interval '1 hour' WHERE student_name = 'Teo' AND account_id = current_setting('teste.g')::uuid;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.client_calendar_queue), 'aula de outro cliente nao enfileira a Rosa');
UPDATE public.lessons SET start_at = start_at + interval '1 hour' WHERE student_name = 'Lia' AND status = 'agendada' AND account_id = current_setting('teste.g')::uuid;
SELECT public.assert(EXISTS (SELECT 1 FROM public.client_calendar_queue WHERE user_id = current_setting('teste.resp')::uuid),
  'aula da Lia remarcada enfileira a Rosa');

-- Plano sem Google Agenda: o switch nao vale.
UPDATE public.accounts SET plan = 'start' WHERE id = current_setting('teste.g')::uuid;
SELECT public.assert(NOT public.client_calendar_enabled(current_setting('teste.g')::uuid), 'no Start o switch do cliente nao vale');
UPDATE public.accounts SET plan = 'pro' WHERE id = current_setting('teste.g')::uuid;
SELECT public.client_calendar_forget(current_setting('teste.resp')::uuid);
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.client_calendar_connections WHERE user_id = current_setting('teste.resp')::uuid),
  'desconectar o cliente apaga a conexao');


\echo '--- 48. Aula sem serviço entra no serviço de mesmo nome (27/09) ---'
DO $$
DECLARE _g uuid := current_setting('teste.g')::uuid; _svc uuid;
BEGIN
  INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, subject, price)
  VALUES (_g, 'Lia', 'Rosa', 'hugo', now() - interval '3 days', 60, 'realizada', ' xadrez ', 80);
  INSERT INTO public.services (account_id, name, duration_minutes, price) VALUES (_g, 'Xadrez', 45, 90) RETURNING id INTO _svc;
  PERFORM set_config('teste.svc', _svc::text, false);
END $$;
SELECT public.assert((SELECT service_id = current_setting('teste.svc')::uuid AND price = 80 AND duration_minutes = 60
                        FROM public.lessons WHERE subject = ' xadrez '),
  'serviço novo pega a aula solta de mesmo nome, sem mudar preço nem duração');
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions w JOIN public.lessons l ON l.id = w.lesson_id
                       WHERE l.subject = ' xadrez ' AND w.kind = 'lesson' AND w.amount = -80) = 1,
  'ligar ao serviço não mexe na cobrança da aula realizada');
INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, subject)
VALUES (current_setting('teste.g')::uuid, 'Lia', 'Rosa', 'hugo', now() + interval '9 days', 45, 'agendada', 'XADREZ');
SELECT public.assert((SELECT service_id = current_setting('teste.svc')::uuid FROM public.lessons WHERE subject = 'XADREZ'),
  'aula nova com a descrição do serviço já nasce nele');
INSERT INTO public.services (account_id, name, duration_minutes) VALUES (current_setting('teste.g')::uuid, 'xadrez', 30);
INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, subject)
VALUES (current_setting('teste.g')::uuid, 'Lia', 'Rosa', 'hugo', now() + interval '10 days', 45, 'agendada', 'Xadrez ');
SELECT public.assert((SELECT service_id IS NULL FROM public.lessons WHERE subject = 'Xadrez '),
  'dois serviços com o mesmo nome: não adivinha');

\echo '--- 49. Entrar com o Google: sem papel, e cria o negócio na primeira entrada (28/09) ---'
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('49000000-0000-0000-0000-000000000001', 'dona@gmail.x', '{"provider":"google","providers":["google"]}', '{"full_name":"Carla Dias"}');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '49000000-0000-0000-0000-000000000001'),
  'quem chega pelo Google nao vira cliente sem vinculo');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '49000000-0000-0000-0000-000000000001', true);
SELECT public.create_my_business('Studio Carla', 'Carla', 'pt-BR', 'BRL');
COMMIT;
SELECT public.assert((SELECT r.role::text = 'admin' AND a.name = 'Studio Carla' AND a.plan = 'pro_solo' AND a.trial_ends_at > now() + interval '13 days'
                        FROM public.user_roles r JOIN public.accounts a ON a.id = r.account_id
                       WHERE r.user_id = '49000000-0000-0000-0000-000000000001'),
  'cria a empresa, vira admin, com os 14 dias do Pro');
SELECT public.assert((SELECT s.contact_email = 'dona@gmail.x' AND t.name = 'carla' AND t.admin_user_id = '49000000-0000-0000-0000-000000000001'
                        FROM public.user_roles r JOIN public.settings s ON s.account_id = r.account_id
                        JOIN public.teachers t ON t.account_id = r.account_id
                       WHERE r.user_id = '49000000-0000-0000-0000-000000000001'),
  'com o e-mail do Google no contato e ela como profissional');

DO $$
BEGIN
  SET LOCAL SESSION AUTHORIZATION authenticator;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '49000000-0000-0000-0000-000000000001', true);
  PERFORM public.create_my_business('Outra', 'Carla');
  RAISE EXCEPTION 'FALHOU: criou segunda empresa';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - quem ja tem empresa nao cria outra';
END $$;
RESET ROLE;
RESET SESSION AUTHORIZATION;

DO $$
BEGIN
  SET LOCAL SESSION AUTHORIZATION authenticator;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
  PERFORM public.create_my_business('Mais uma', 'Ana');
  RAISE EXCEPTION 'FALHOU: admin criou outra empresa';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - admin de uma empresa nao cria outra por aqui';
END $$;
RESET ROLE;
RESET SESSION AUTHORIZATION;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('49000000-0000-0000-0000-000000000002', 'mail@x', '{"signup_kind":"school","school_name":"Pelo Email","teacher_name":"Rui"}');
SELECT public.assert((SELECT role::text FROM public.user_roles WHERE user_id = '49000000-0000-0000-0000-000000000002') = 'admin',
  'cadastro com e-mail continua criando a empresa');

\echo '--- 50. Conta de teste travada: sem trocar senha, e-mail nem excluir (28/09) ---'
INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data) VALUES
  ('50000000-0000-0000-0000-000000000001', 'demo@aluno.x', 'senha-velha', '{"provider":"email","demo_account":true}');
DO $$
BEGIN
  UPDATE auth.users SET encrypted_password = 'outra' WHERE id = '50000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: trocou a senha da conta de teste';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - senha da conta de teste nao muda';
END $$;
DO $$
BEGIN
  DELETE FROM auth.users WHERE id = '50000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: excluiu a conta de teste';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - conta de teste nao e excluida';
END $$;
UPDATE auth.users SET created_at = created_at WHERE id = '50000000-0000-0000-0000-000000000001';
SELECT public.assert(true, 'entrar (atualizar outros campos) continua funcionando');
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'demo_account' WHERE id = '50000000-0000-0000-0000-000000000001';
UPDATE auth.users SET encrypted_password = 'nova' WHERE id = '50000000-0000-0000-0000-000000000001';
SELECT public.assert((SELECT encrypted_password FROM auth.users WHERE id = '50000000-0000-0000-0000-000000000001') = 'nova',
  'sem a marca, a senha volta a poder mudar');
UPDATE auth.users SET encrypted_password = 'x' WHERE email = 'admin-a@x';
SELECT public.assert(true, 'conta comum troca a senha normalmente');

\echo '--- 51. Configuração guiada: empresa nova começa sem, e o admin conclui (28/09) ---'
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('51000000-0000-0000-0000-000000000001', 'guia@x', '{"signup_kind":"school","school_name":"Studio Guia","teacher_name":"Lia"}');
SELECT public.assert((SELECT setup_done_at IS NULL FROM public.accounts a JOIN public.user_roles r ON r.account_id = a.id
                       WHERE r.user_id = '51000000-0000-0000-0000-000000000001'),
  'empresa nova nasce sem a configuração guiada feita');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT public.assert((public.my_vocabulary() ->> 'setup_done')::boolean = false, 'my_vocabulary avisa que falta o guia');
SELECT public.assert((public.complete_account_setup() ->> 'setup_done')::boolean, 'concluir marca como feita e devolve o vocabulário');
COMMIT;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  PERFORM public.complete_account_setup();
  RAISE EXCEPTION 'FALHOU: cliente concluiu o guia da empresa';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU:%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - cliente nao conclui o guia da empresa';
END $$;
COMMIT;

\echo '--- 52. Logado sem empresa: my_vocabulary avisa que não é membro (29/09) ---'
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('52000000-0000-0000-0000-000000000001', 'novo@gmail.x', '{"provider":"google"}');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '52000000-0000-0000-0000-000000000001', true);
SELECT public.assert((public.my_vocabulary() ->> 'member')::boolean = false, 'sem empresa: member falso (a lingua da empresa publica nao vale)');
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((public.my_vocabulary() ->> 'member')::boolean, 'admin de empresa: member verdadeiro');
COMMIT;

\echo '--- 53. Pagina de horarios por empresa: public_agenda (02/10) ---'
DO $$
DECLARE
  _h uuid;
BEGIN
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Horarios H', 'horarios-h', 'pro') RETURNING id INTO _h;
  INSERT INTO public.settings (account_id) VALUES (_h);
  INSERT INTO public.teachers (account_id, name, subject, active) VALUES (_h, 'Helena', 'Pilates', true), (_h, 'Ivo', null, false);
  INSERT INTO public.services (account_id, name, duration_minutes, price) VALUES (_h, 'Aula H', 50, 90);
  INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status)
  VALUES (_h, 'Cliente Secreto', 'Resp Secreto', 'helena', now() + interval '1 day', 50, 'agendada'),
         (_h, 'Cliente Cancelou', null, 'helena', now() + interval '2 day', 50, 'cancelada');
  PERFORM set_config('teste.h', _h::text, false);
END $$;

BEGIN;
SET LOCAL ROLE anon;
SELECT public.assert(public.public_agenda('horarios-h', now(), now() + interval '5 days') -> 'account' ->> 'name' = 'Horarios H',
  'visitante abre a agenda da empresa pelo codigo');
SELECT public.assert(public.public_agenda('HORARIOS-H ', now(), now() + interval '5 days') IS NOT NULL, 'codigo sem diferenca de maiuscula e espaco');
SELECT public.assert(jsonb_array_length(public.public_agenda('horarios-h', now(), now() + interval '5 days') -> 'lessons') = 1,
  'so o atendimento ativo ocupa (o cancelado nao)');
SELECT public.assert(public.public_agenda('horarios-h', now(), now() + interval '5 days')::text NOT LIKE '%Secreto%',
  'nome de cliente e de responsavel nao sai na agenda publica');
SELECT public.assert((SELECT string_agg(x ->> 'slug', ',') FROM jsonb_array_elements(public.public_agenda('horarios-h', now(), now() + interval '5 days') -> 'teachers') x) = 'helena',
  'so quem esta ativo aparece');
SELECT public.assert((public.public_agenda('horarios-h', now(), now() + interval '5 days') -> 'services' -> 0 -> 'price') = 'null'::jsonb,
  'preco escondido quando a empresa nao mostra valores');
SELECT public.assert(public.public_agenda('nao-existe', now(), now() + interval '5 days') IS NULL, 'codigo desconhecido devolve nulo');
SELECT public.assert(public.public_agenda(NULL, now(), now() + interval '5 days') -> 'account' ->> 'slug' = 'portaldeaulas',
  'sem codigo: a empresa do endereco publico, como /disponibilidade');
SELECT public.assert(public.public_agenda('horarios-h', now(), now() + interval '5 days')::text NOT LIKE '%Reforco publico%',
  'nada de outra empresa na agenda da H');
DO $$
BEGIN
  PERFORM public.public_agenda('horarios-h', now(), now() + interval '60 days');
  RAISE EXCEPTION 'FALHOU: aceitou intervalo de 60 dias';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE '  ok - intervalo longo recusado';
END $$;
COMMIT;

UPDATE public.accounts SET active = false WHERE id = current_setting('teste.h')::uuid;
BEGIN;
SET LOCAL ROLE anon;
SELECT public.assert(public.public_agenda('horarios-h', now(), now() + interval '5 days') IS NULL, 'empresa desativada some da pagina');
COMMIT;
UPDATE public.accounts SET active = true WHERE id = current_setting('teste.h')::uuid;

-- O codigo fica publico com o link. Quem cria conta com ele vira cliente sem
-- cadastro vinculado: nao pode enxergar atendimento nem cliente da empresa.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('53000000-0000-0000-0000-000000000001', 'curioso@x', '{"school_code":"horarios-h"}');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '53000000-0000-0000-0000-000000000001', true);
SELECT public.assert((SELECT count(*) FROM public.lessons) = 0, 'login criado com o codigo nao ve atendimentos');
SELECT public.assert((SELECT count(*) FROM public.students) = 0, 'nem clientes');
COMMIT;

\echo '--- 54. E-mails automaticos: fila e e-mail do profissional (03/10) ---'
DO $$
DECLARE _e uuid; _t uuid; _l uuid;
BEGIN
  INSERT INTO public.accounts (name, slug, plan) VALUES ('Emails E', 'emails-e', 'pro') RETURNING id INTO _e;
  INSERT INTO public.settings (account_id) VALUES (_e);
  INSERT INTO public.teachers (account_id, name, active) VALUES (_e, 'Eva', true) RETURNING id INTO _t;
  PERFORM set_config('teste.e', _e::text, false);
  PERFORM set_config('teste.et', _t::text, false);
END $$;

-- Desligado (padrao): nada entra na fila.
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, status)
VALUES (current_setting('teste.e')::uuid, 'Cliente E1', 'eva', now() + interval '3 day', 60, 'agendada');
SELECT public.assert((SELECT count(*) FROM public.email_outbox WHERE account_id = current_setting('teste.e')::uuid) = 0,
  'empresa sem e-mails ligados nao enfileira nada');

UPDATE public.settings SET email_notifications = '{"enabled": true}' WHERE account_id = current_setting('teste.e')::uuid;
SELECT public.assert(public.email_pref('{"enabled": true}', 'client_booked') AND NOT public.email_pref('{"enabled": true}', 'reminder_day')
  AND NOT public.email_pref('{"enabled": false, "client_booked": true}', 'client_booked'),
  'padrao: tudo ligado menos o lembrete do dia; desligado geral vence');

INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, status)
VALUES (current_setting('teste.e')::uuid, 'Cliente E2', 'eva', now() + interval '4 day', 60, 'agendada');
SELECT public.assert((SELECT kind FROM public.email_outbox WHERE account_id = current_setting('teste.e')::uuid) = 'booked', 'marcado -> booked');

UPDATE public.lessons SET start_at = start_at + interval '2 hour' WHERE student_name = 'Cliente E2';
SELECT public.assert(EXISTS (SELECT 1 FROM public.email_outbox WHERE kind = 'changed' AND old_start IS NOT NULL AND account_id = current_setting('teste.e')::uuid),
  'horario mudou -> changed, com o horario antigo');

UPDATE public.lessons SET notes = 'so uma nota' WHERE student_name = 'Cliente E2';
SELECT public.assert((SELECT count(*) FROM public.email_outbox WHERE account_id = current_setting('teste.e')::uuid) = 2,
  'mudar so a anotacao nao manda e-mail');

UPDATE public.lessons SET status = 'cancelada' WHERE student_name = 'Cliente E2';
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, status)
VALUES (current_setting('teste.e')::uuid, 'Cliente E3', 'eva', now() + interval '5 day', 60, 'solicitada');
UPDATE public.lessons SET status = 'recusada' WHERE student_name = 'Cliente E3';
SELECT public.assert((SELECT string_agg(kind, ',' ORDER BY created_at, kind) FROM public.email_outbox WHERE account_id = current_setting('teste.e')::uuid
  AND kind IN ('cancelled','requested','declined')) IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.email_outbox WHERE kind = 'cancelled' AND account_id = current_setting('teste.e')::uuid)
  AND EXISTS (SELECT 1 FROM public.email_outbox WHERE kind = 'requested' AND account_id = current_setting('teste.e')::uuid)
  AND EXISTS (SELECT 1 FROM public.email_outbox WHERE kind = 'declined' AND account_id = current_setting('teste.e')::uuid),
  'cancelado, pedido e recusado entram na fila');

-- O e-mail do profissional: so admin da propria empresa.
INSERT INTO public.teacher_emails (teacher_id, account_id, email)
VALUES (current_setting('teste.et')::uuid, current_setting('teste.e')::uuid, 'eva@exemplo.com');
DO $$
BEGIN
  INSERT INTO public.students (account_id, student_name, email) VALUES (current_setting('teste.e')::uuid, 'Errado', 'sem-arroba');
  RAISE EXCEPTION 'FALHOU: aceitou e-mail invalido';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - e-mail invalido recusado no cadastro';
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert((SELECT count(*) FROM public.teacher_emails) = 0, 'cliente nao le e-mail de profissional');
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((SELECT count(*) FROM public.teacher_emails) = 0, 'admin de outra empresa nao le e-mail de profissional');
DO $$
BEGIN
  PERFORM 1 FROM public.email_outbox;
  RAISE EXCEPTION 'FALHOU: logado leu a fila de e-mails';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - a fila de e-mails e fechada';
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM 1 FROM public.teacher_emails;
  RAISE EXCEPTION 'FALHOU: visitante leu e-mail de profissional';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - visitante nao le e-mail de profissional';
END $$;
COMMIT;

\echo '--- 55. Cada um poe o proprio e-mail para avisos (03/10) ---'
DO $$
DECLARE _up uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_up, 'eva@aluno.sistema.local');
  DELETE FROM public.user_roles WHERE user_id = _up;
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_up, 'teacher', current_setting('teste.e')::uuid);
  UPDATE public.teachers SET user_id = _up WHERE id = current_setting('teste.et')::uuid;
  PERFORM set_config('teste.uprof', _up::text, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
-- O login da familia (Bia, responsavel Ana): "seu e-mail" e o da Ana; o da Bia e opcional.
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert((public.my_notification_email() ->> 'kind') = 'guardian' AND (public.my_notification_email() ->> 'guardian_name') = 'Ana'
  AND (public.my_notification_email() ->> 'student_name') = 'Bia',
  'login da familia com responsavel: o campo principal e o da responsavel');
SELECT public.assert(NOT (public.my_notification_email() ->> 'emails_on')::boolean, 'empresa sem e-mails ligados: emails_on falso');
SELECT public.save_my_notification_email(' Ana@Gmail.com ', NULL);
SELECT public.assert((public.my_notification_email() ->> 'email') = 'ana@gmail.com' AND (public.my_notification_email() ->> 'student_email') IS NULL,
  'responsavel grava o proprio e-mail sem mexer no do aluno');
SELECT public.save_my_notification_email('ana@gmail.com', 'bia@gmail.com');
SELECT public.assert((public.my_notification_email() ->> 'student_email') = 'bia@gmail.com', 'responsavel tambem pode por o e-mail do aluno');
DO $$
BEGIN
  PERFORM public.save_my_notification_email('sem-arroba', NULL);
  RAISE EXCEPTION 'FALHOU: aceitou e-mail invalido';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE '  ok - e-mail invalido recusado em Minha conta';
END $$;
-- O profissional: grava em teacher_emails pela funcao, sem ler a tabela.
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uprof'), true);
SELECT public.save_my_notification_email('eva@gmail.com', NULL);
SELECT public.assert((public.my_notification_email() ->> 'kind') = 'teacher' AND (public.my_notification_email() ->> 'email') = 'eva@gmail.com',
  'profissional grava o proprio e-mail');
SELECT public.assert((public.my_notification_email() ->> 'emails_on')::boolean, 'a empresa da Eva manda e-mails: emails_on verdadeiro');
SELECT public.assert((SELECT count(*) FROM public.teacher_emails) = 0, 'profissional continua sem ler a tabela de e-mails');
SELECT public.save_my_notification_email('', NULL);
SELECT public.assert((public.my_notification_email() ->> 'email') IS NULL, 'vazio apaga o e-mail do profissional');
-- Admin sem cadastro de profissional: nao tem campo.
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ub'), true);
SELECT public.assert(public.my_notification_email() IS NULL, 'admin sem cadastro nao tem o campo');
COMMIT;
SELECT public.assert((SELECT email FROM public.students WHERE user_id = current_setting('teste.ualuno')::uuid) = 'bia@gmail.com'
  AND (SELECT guardian_email FROM public.students WHERE user_id = current_setting('teste.ualuno')::uuid) = 'ana@gmail.com',
  'os e-mails foram para o cadastro: o do aluno e o da responsavel');

-- O login do aluno (meu-painel): so o e-mail dele, ja com o que a familia pos.
DO $$
DECLARE _uc uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_uc, 'bia-painel@aluno.sistema.local');
  DELETE FROM public.user_roles WHERE user_id = _uc;
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_uc, 'child', current_setting('teste.a')::uuid);
  UPDATE public.students SET child_user_id = _uc WHERE user_id = current_setting('teste.ualuno')::uuid;
  PERFORM set_config('teste.uchild', _uc::text, false);
END $$;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uchild'), true);
SELECT public.assert((public.my_notification_email() ->> 'kind') = 'child' AND (public.my_notification_email() ->> 'email') = 'bia@gmail.com'
  AND NOT (public.my_notification_email() ? 'guardian_name'),
  'login do aluno: so o e-mail dele, ja preenchido com o que a familia pos');
SELECT public.save_my_notification_email('bia.nova@gmail.com', 'outro@x.com');
COMMIT;
SELECT public.assert((SELECT email FROM public.students WHERE child_user_id = current_setting('teste.uchild')::uuid) = 'bia.nova@gmail.com'
  AND (SELECT guardian_email FROM public.students WHERE child_user_id = current_setting('teste.uchild')::uuid) = 'ana@gmail.com',
  'o aluno troca so o proprio e-mail, o da responsavel fica');

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.set_my_notification_email('x@y.com', NULL);
  RAISE EXCEPTION 'FALHOU: visitante gravou e-mail';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - visitante nao grava e-mail';
END $$;
COMMIT;

\echo '--- 56. Cobranca por e-mail: recibo na fila, historico e e-mail que voltou (03/10) ---'
SELECT public.assert(NOT public.email_pref('{"enabled": true}', 'billing_daily') AND NOT public.email_pref('{"enabled": true}', 'billing_weekly')
  AND NOT public.email_pref('{"enabled": true}', 'billing_monthly') AND public.email_pref('{"enabled": true}', 'payment_received'),
  'cobranca automatica nasce desligada; o recibo, ligado');
SELECT public.assert((public.plan_features('essencial') ->> 'email_billing')::boolean = false AND (public.plan_features('start') ->> 'email_billing')::boolean
  AND (public.plan_features('pro_solo') ->> 'email_branding')::boolean AND NOT (public.plan_features('pro_solo') ->> 'email_custom')::boolean
  AND (public.plan_features('pro') ->> 'email_custom')::boolean,
  'planos: cobranca do Start em diante, marca do Pro em diante, texto so no Max');

-- Empresa E (Pro, e-mails ligados no bloco 54): pagamento entra na fila; voucher e cobranca nao.
INSERT INTO public.wallet_transactions (account_id, student_name, amount, kind, description)
VALUES (current_setting('teste.e')::uuid, 'Cliente E1', 150, 'adjustment', 'Pagamento');
INSERT INTO public.wallet_transactions (account_id, student_name, amount, kind, description)
VALUES (current_setting('teste.e')::uuid, 'Cliente E1', 20, 'voucher', 'Voucher');
INSERT INTO public.wallet_transactions (account_id, student_name, amount, kind, description)
VALUES (current_setting('teste.e')::uuid, 'Cliente E1', -100, 'adjustment', 'Ajuste');
SELECT public.assert((SELECT count(*) FROM public.email_payment_outbox WHERE account_id = current_setting('teste.e')::uuid) = 1,
  'so o pagamento de verdade vira e-mail de recibo');

UPDATE public.settings SET email_notifications = '{"enabled": true, "payment_received": false}' WHERE account_id = current_setting('teste.e')::uuid;
INSERT INTO public.wallet_transactions (account_id, student_name, amount, kind, description)
VALUES (current_setting('teste.e')::uuid, 'Cliente E1', 80, 'adjustment', 'Pagamento');
SELECT public.assert((SELECT count(*) FROM public.email_payment_outbox WHERE account_id = current_setting('teste.e')::uuid) = 1,
  'recibo desligado: nada entra na fila');
UPDATE public.settings SET email_notifications = '{"enabled": true}' WHERE account_id = current_setting('teste.e')::uuid;

-- Historico: o admin da empresa le; os outros nao.
INSERT INTO public.email_log (account_id, to_email, kind, subject) VALUES (current_setting('teste.a')::uuid, 'ana@gmail.com', 'charge', 'Pagamento em aberto');
INSERT INTO public.email_bounces (email, reason) VALUES ('ana@gmail.com', 'mailbox does not exist');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((SELECT count(*) FROM public.email_log) = 1, 'admin le o historico da empresa');
SELECT public.assert((SELECT count(*) FROM public.account_email_issues()) = 1, 'admin ve o e-mail que voltou, do proprio cadastro');
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ub'), true);
SELECT public.assert((SELECT count(*) FROM public.email_log) = 0, 'admin de outra empresa nao le o historico');
SELECT public.assert((SELECT count(*) FROM public.account_email_issues()) = 0, 'nem os e-mails que voltaram');
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert((SELECT count(*) FROM public.email_log) = 0, 'cliente nao le o historico');
DO $$
BEGIN
  INSERT INTO public.email_log (account_id, to_email, kind, subject) VALUES (current_setting('teste.a')::uuid, 'x@y.com', 'charge', 'x');
  RAISE EXCEPTION 'FALHOU: logado escreveu no historico';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - ninguem escreve no historico pela API';
END $$;
DO $$
BEGIN
  PERFORM 1 FROM public.email_payment_outbox;
  RAISE EXCEPTION 'FALHOU: logado leu a fila de recibos';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - a fila de recibos e fechada';
END $$;
COMMIT;

\echo '--- 57. E-mails da etapa 2: tarefa nova, resumo e pacote acabando (03/10) ---'
SELECT public.assert(public.email_pref('{"enabled": true}', 'homework_new') AND public.email_pref('{"enabled": true}', 'class_summary')
  AND public.email_pref('{"enabled": true}', 'package_low') AND public.email_pref('{"enabled": true}', 'agenda_tomorrow'),
  'avisos da etapa 2 nascem ligados');
DO $$
DECLARE _s uuid;
BEGIN
  INSERT INTO public.students (account_id, student_name, guardian_name) VALUES (current_setting('teste.e')::uuid, 'Aluno E9', 'Mae E9') RETURNING id INTO _s;
  PERFORM set_config('teste.es', _s::text, false);
END $$;
INSERT INTO public.homework (account_id, student_id, title, deadline) VALUES (current_setting('teste.e')::uuid, current_setting('teste.es')::uuid, 'Lista 1', now() + interval '2 day');
SELECT public.assert((SELECT count(*) FROM public.email_event_outbox WHERE account_id = current_setting('teste.e')::uuid AND kind = 'homework') = 1,
  'tarefa nova entra na fila');

-- Resumo: so a primeira vez que ele aparece.
INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status)
VALUES (current_setting('teste.e')::uuid, 'Aluno E9', 'Mae E9', 'eva', now() - interval '2 hour', 60, 'agendada');
UPDATE public.lessons SET class_summary = '   ' WHERE account_id = current_setting('teste.e')::uuid AND student_name = 'Aluno E9';
SELECT public.assert((SELECT count(*) FROM public.email_event_outbox WHERE kind = 'summary' AND account_id = current_setting('teste.e')::uuid) = 0,
  'resumo em branco nao manda');
UPDATE public.lessons SET class_summary = 'Revisamos fracoes.' WHERE account_id = current_setting('teste.e')::uuid AND student_name = 'Aluno E9';
UPDATE public.lessons SET class_summary = 'Revisamos fracoes e equacoes.' WHERE account_id = current_setting('teste.e')::uuid AND student_name = 'Aluno E9';
SELECT public.assert((SELECT count(*) FROM public.email_event_outbox WHERE kind = 'summary' AND account_id = current_setting('teste.e')::uuid) = 1,
  'resumo escrito entra na fila uma vez; editar depois nao repete');

-- Pacote: so o debito de quem ja comprou pacote.
INSERT INTO public.wallet_transactions (account_id, student_name, amount, kind, description)
VALUES (current_setting('teste.e')::uuid, 'Sem Pacote', -50, 'lesson', 'Aula');
SELECT public.assert((SELECT count(*) FROM public.email_event_outbox WHERE kind = 'package' AND account_id = current_setting('teste.e')::uuid) = 0,
  'debito sem pacote comprado nao vira aviso');
INSERT INTO public.wallet_transactions (account_id, student_name, guardian_name, amount, kind, description)
VALUES (current_setting('teste.e')::uuid, 'Aluno E9', 'Mae E9', 200, 'package', 'Pacote 4 aulas');
INSERT INTO public.wallet_transactions (account_id, student_name, guardian_name, amount, kind, description)
VALUES (current_setting('teste.e')::uuid, 'Outro Filho', ' mae e9 ', -50, 'lesson', 'Aula');
SELECT public.assert((SELECT count(*) FROM public.email_event_outbox WHERE kind = 'package' AND account_id = current_setting('teste.e')::uuid) = 1,
  'debito de quem tem pacote (mesma conta do responsavel) entra na fila');

UPDATE public.settings SET email_notifications = '{"enabled": true, "homework_new": false}' WHERE account_id = current_setting('teste.e')::uuid;
INSERT INTO public.homework (account_id, student_id, title, deadline) VALUES (current_setting('teste.e')::uuid, current_setting('teste.es')::uuid, 'Lista 2', now() + interval '2 day');
SELECT public.assert((SELECT count(*) FROM public.email_event_outbox WHERE account_id = current_setting('teste.e')::uuid AND kind = 'homework') = 1,
  'tarefa nova desligada: nada entra');
UPDATE public.settings SET email_notifications = '{"enabled": true}' WHERE account_id = current_setting('teste.e')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
DO $$
BEGIN
  PERFORM 1 FROM public.email_event_outbox;
  RAISE EXCEPTION 'FALHOU: logado leu a fila de avisos';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - a fila de avisos e fechada';
END $$;
COMMIT;

\echo '--- 58. Logo dos e-mails: so o admin, na pasta da propria empresa (03/10) ---'
SELECT public.assert((SELECT public FROM storage.buckets WHERE id = 'email-logos'), 'bucket do logo e publico (o e-mail abre sem login)');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
INSERT INTO storage.objects (bucket_id, name) VALUES ('email-logos', current_setting('teste.a') || '/logo-1.png');
SELECT public.assert(true, 'admin grava o logo na pasta da propria empresa');
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name) VALUES ('email-logos', current_setting('teste.b') || '/logo-1.png');
  RAISE EXCEPTION 'FALHOU: admin gravou na pasta de outra empresa';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao grava na pasta de outra empresa';
END $$;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name) VALUES ('email-logos', current_setting('teste.a') || '/logo-2.png');
  RAISE EXCEPTION 'FALHOU: cliente gravou logo';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - cliente nao grava logo';
END $$;
COMMIT;

\echo '--- 59. Tarefas por ramo, marcar como feita e entregar (03/10) ---'
SELECT public.assert(public.tasks_default('aulas') AND public.tasks_default('saude') AND public.tasks_default(NULL)
  AND NOT public.tasks_default('beleza') AND NOT public.tasks_default('oficina'), 'tarefas ligadas por padrao so nos ramos certos');
DO $$
DECLARE _s uuid; _h1 uuid; _h2 uuid;
BEGIN
  SELECT id INTO _s FROM public.students WHERE account_id = current_setting('teste.a')::uuid AND student_name = 'Bia';
  INSERT INTO public.homework (account_id, student_id, title, deadline) VALUES (current_setting('teste.a')::uuid, _s, 'Lista A', now() + interval '1 day') RETURNING id INTO _h1;
  INSERT INTO public.homework (account_id, student_id, title, deadline) VALUES (current_setting('teste.a')::uuid, _s, 'Lista B', now() + interval '1 day') RETURNING id INTO _h2;
  PERFORM set_config('teste.h1', _h1::text, false);
  PERFORM set_config('teste.h2', _h2::text, false);
END $$;
INSERT INTO public.homework_submissions (account_id, homework_id, file_path) VALUES (current_setting('teste.a')::uuid, current_setting('teste.h2')::uuid, 'x/y.pdf');
SELECT public.assert((SELECT status FROM public.homework WHERE id = current_setting('teste.h2')::uuid) = 'entregue',
  'mandar o arquivo marca a tarefa como entregue');

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert((public.my_vocabulary() ->> 'tasks')::boolean, 'a familia sabe que as tarefas estao ligadas');
SELECT public.assert(public.mark_homework_done(current_setting('teste.h1')::uuid) = 'entregue', 'a familia marca a propria tarefa como feita');
SELECT public.assert(public.mark_homework_done(current_setting('teste.h1')::uuid, false) = 'pendente', 'e desmarca');
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ub'), true);
DO $$
BEGIN
  PERFORM public.mark_homework_done(current_setting('teste.h1')::uuid);
  RAISE EXCEPTION 'FALHOU: outra empresa marcou a tarefa';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - ninguem de fora marca a tarefa';
END $$;
COMMIT;

UPDATE public.settings SET tasks_enabled = false WHERE account_id = current_setting('teste.a')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert(NOT (public.my_vocabulary() ->> 'tasks')::boolean, 'desligadas na empresa: a familia nao ve');
COMMIT;
UPDATE public.settings SET tasks_enabled = NULL WHERE account_id = current_setting('teste.a')::uuid;

\echo '--- 60. Link de reuniao: fixo, Jitsi, manual e troca de escolha (05/10) ---'
DO $$
DECLARE _t uuid;
BEGIN
  SELECT id INTO _t FROM public.teachers WHERE account_id = current_setting('teste.a')::uuid AND public.teacher_slug(name) = 'thiago';
  IF _t IS NULL THEN
    INSERT INTO public.teachers (name, account_id, active) VALUES ('Thiago', current_setting('teste.a')::uuid, true) RETURNING id INTO _t;
  END IF;
  PERFORM set_config('teste.tm', _t::text, false);
END $$;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, is_online)
VALUES ('Bia', 'Ana', 'thiago', now() + interval '3 days', 60, true);
SELECT public.assert((SELECT meeting_url FROM public.lessons WHERE student_name = 'Bia' AND is_online) IS NULL,
  'sem escolha: aula on-line nasce sem link');
SELECT public.set_meeting_settings(current_setting('teste.tm')::uuid, 'jitsi');
SELECT public.assert((SELECT meeting_url LIKE 'https://meet.jit.si/Cronys-%' AND meeting_source = 'jitsi' FROM public.lessons WHERE student_name = 'Bia' AND is_online),
  'escolheu Jitsi: a proxima aula on-line ganha sala');
SELECT set_config('teste.j1', (SELECT meeting_url FROM public.lessons WHERE student_name = 'Bia' AND is_online), true);
SELECT set_config('teste.lbia', (SELECT id::text FROM public.lessons WHERE student_name = 'Bia' AND is_online), true);
SELECT public.set_meeting_settings(current_setting('teste.tm')::uuid, 'jitsi');
SELECT public.assert((SELECT meeting_url FROM public.lessons WHERE student_name = 'Bia' AND is_online) = current_setting('teste.j1'),
  'salvar a mesma escolha nao troca o link ja enviado');
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, is_online)
VALUES ('Caio', 'Ana', 'thiago', now() + interval '4 days', 60, true);
SELECT public.assert((SELECT meeting_url FROM public.lessons WHERE student_name = 'Caio' AND is_online) <> current_setting('teste.j1'),
  'cada aula tem a propria sala do Jitsi');
SELECT public.set_meeting_settings(current_setting('teste.tm')::uuid, 'fixed', 'zoom.us/j/123');
SELECT public.assert((SELECT meeting_url = 'https://zoom.us/j/123' AND meeting_source = 'fixed' FROM public.lessons WHERE student_name = 'Bia' AND is_online),
  'sala fixa: vira o link das proximas aulas (com https://)');
UPDATE public.lessons SET meeting_url = 'https://meet.google.com/abc-defg-hij' WHERE student_name = 'Caio' AND is_online;
SELECT public.assert((SELECT meeting_source FROM public.lessons WHERE student_name = 'Caio' AND is_online) = 'manual',
  'link colado na aula fica marcado como manual');
SELECT public.set_meeting_settings(current_setting('teste.tm')::uuid, 'jitsi');
SELECT public.assert((SELECT meeting_url FROM public.lessons WHERE student_name = 'Caio' AND is_online) = 'https://meet.google.com/abc-defg-hij',
  'trocar a escolha nao mexe no link colado a mao');
SELECT public.assert(public.regenerate_lesson_meeting((SELECT id FROM public.lessons WHERE student_name = 'Caio' AND is_online)) LIKE 'https://meet.jit.si/%',
  'gerar outro link volta ao automatico');
UPDATE public.lessons SET is_online = false WHERE id = current_setting('teste.lbia')::uuid;
SELECT public.assert((SELECT meeting_url FROM public.lessons WHERE id = current_setting('teste.lbia')::uuid) IS NULL,
  'virou presencial: o link sai');
SELECT public.set_meeting_settings(current_setting('teste.tm')::uuid, 'google_meet');
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, is_online)
VALUES ('Duda', 'Ana', 'thiago', now() + interval '5 days', 60, true);
SELECT public.assert((SELECT meeting_source FROM public.lessons WHERE student_name = 'Duda') = 'jitsi',
  'Meet sem Google conectado cai no Jitsi');
DO $$
BEGIN
  PERFORM public.set_meeting_settings(current_setting('teste.tm')::uuid, 'fixed', 'https://zoom.us/j/1 <script>');
  RAISE EXCEPTION 'FALHOU: aceitou link com espaco';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - link estranho e recusado';
END $$;
DELETE FROM public.lessons WHERE id = current_setting('teste.lbia')::uuid
   OR (student_name IN ('Caio', 'Duda') AND is_online AND start_at > now() + interval '2 days');
COMMIT;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ub'), true);
SELECT public.assert((SELECT count(*) FROM public.meeting_settings()) = (SELECT count(*) FROM public.meeting_settings() WHERE teacher_id <> current_setting('teste.tm')::uuid),
  'outra empresa nao ve a escolha do profissional');
DO $$
BEGIN
  PERFORM public.set_meeting_settings(current_setting('teste.tm')::uuid, 'jitsi');
  RAISE EXCEPTION 'FALHOU: outra empresa mudou a escolha';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - outra empresa nao muda a escolha';
END $$;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  PERFORM 1 FROM public.teacher_meeting;
  RAISE EXCEPTION 'FALHOU: cliente leu a tabela';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - a sala fixa nao fica a vista do cliente';
END $$;
COMMIT;

\echo '--- 61. Notificacoes: aparelho, preferencias e quem recebe (05/10) ---'
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.register_push_device('token-da-familia-0000000001');
SELECT public.assert((public.set_push_prefs('{"hour": false}'::jsonb) ->> 'hour')::boolean = false, 'a familia desliga o lembrete de 1h antes');
DO $$
BEGIN
  PERFORM public.set_push_prefs('{"cobranca": true}'::jsonb);
  RAISE EXCEPTION 'FALHOU: aceitou preferencia desconhecida';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - preferencia desconhecida e recusada';
END $$;
DO $$
BEGIN
  PERFORM 1 FROM public.push_devices;
  RAISE EXCEPTION 'FALHOU: leu os aparelhos';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - ninguem le os aparelhos direto';
END $$;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.register_push_device('token-do-admin-00000000000001');
COMMIT;

-- O pedido da familia avisa o admin (o profissional nao tem login); quem pediu nao recebe.
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), false);
INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status)
VALUES (current_setting('teste.a')::uuid, 'Bia', 'Ana', 'thiago', now() + interval '6 days 7 hours', 60, 'solicitada');
SELECT set_config('teste.pl', (SELECT id::text FROM public.lessons WHERE status = 'solicitada' AND student_name = 'Bia' ORDER BY created_at DESC LIMIT 1), false);
SELECT public.assert((SELECT count(*) FROM public.push_outbox WHERE kind = 'staff_request' AND user_id = current_setting('teste.ua')::uuid) = 1,
  'pedido novo vai para o admin');
SELECT public.assert((SELECT count(*) FROM public.push_outbox WHERE kind = 'staff_request' AND user_id = current_setting('teste.ualuno')::uuid) = 0,
  'quem pediu nao recebe o proprio pedido');
-- O admin aceita: a familia recebe.
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), false);
UPDATE public.lessons SET status = 'agendada' WHERE id = current_setting('teste.pl')::uuid;
SELECT public.assert((SELECT count(*) FROM public.push_outbox WHERE kind = 'client_approved' AND user_id = current_setting('teste.ualuno')::uuid) = 1,
  'pedido aceito vai para a familia');
-- A familia cancela: vai para o admin.
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), false);
UPDATE public.lessons SET status = 'cancelada' WHERE id = current_setting('teste.pl')::uuid;
SELECT public.assert((SELECT count(*) FROM public.push_outbox WHERE kind = 'staff_cancel' AND user_id = current_setting('teste.ua')::uuid) = 1,
  'cancelamento da familia vai para o admin');
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.assert((SELECT count(*) FROM public.push_staff_users(current_setting('teste.a')::uuid, 'thiago', false)) >= 1,
  'profissional sem login: o aviso vai para os admins');
SELECT public.assert((SELECT count(*) FROM public.push_client_users(current_setting('teste.a')::uuid, ' bia ', 'ANA') WHERE NOT child) = 1,
  'acha a familia pelo nome, sem ligar para espaco e maiuscula');
DELETE FROM public.lessons WHERE id = current_setting('teste.pl')::uuid;
DELETE FROM public.push_outbox;
DELETE FROM public.push_devices;

\echo '--- 62. Pacote que abate aulas, nao valor (08/10) ---'
UPDATE public.accounts SET plan = 'pro' WHERE id = current_setting('teste.a')::uuid;
-- Tres aulas realizadas de Gil (sem responsavel), 220 cada; a primeira ja paga em dinheiro.
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, price, status) VALUES
  (current_setting('teste.a')::uuid, 'Gil', 'thiago', '2026-08-01 10:00-03', 60, 220, 'realizada'),
  (current_setting('teste.a')::uuid, 'Gil', 'thiago', '2026-08-08 10:00-03', 60, 220, 'realizada'),
  (current_setting('teste.a')::uuid, 'Gil', 'thiago', '2026-08-15 10:00-03', 120, 220, 'realizada');
INSERT INTO public.wallet_transactions (account_id, student_name, amount, kind, description)
VALUES (current_setting('teste.a')::uuid, 'Gil', 220, 'adjustment', 'Pix');
SELECT public.assert((SELECT payment_status FROM public.lessons WHERE student_name = 'Gil' AND start_at = '2026-08-01 10:00-03') = 'pago',
  'a primeira aula de Gil esta paga em dinheiro');
INSERT INTO public.lesson_packages (account_id, name, lessons, price) VALUES (current_setting('teste.a')::uuid, 'Pacote 4', 4, 800);

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.sell_package('Gil', NULL, (SELECT id FROM public.lesson_packages WHERE name = 'Pacote 4'), 800);
COMMIT;

SELECT public.assert((SELECT count(*) FROM public.package_purchases WHERE student_name = 'Gil') = 1, 'a venda cria a compra');
-- O pacote nao pega a aula ja paga; pega a de 1h (1 bloco) e a de 2h (2 blocos).
SELECT public.assert((SELECT coalesce(sum(u.sessions), 0) FROM public.package_uses u JOIN public.lessons l ON l.id = u.lesson_id
                       WHERE l.student_name = 'Gil') = 3, 'as aulas em aberto gastam 3 blocos (1h + 2h)');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.package_uses u JOIN public.lessons l ON l.id = u.lesson_id
                       WHERE l.student_name = 'Gil' AND l.start_at = '2026-08-01 10:00-03'), 'a aula paga em dinheiro fica fora do pacote');
SELECT public.assert((SELECT amount FROM public.wallet_transactions w JOIN public.lessons l ON l.id = w.lesson_id
                       WHERE l.student_name = 'Gil' AND l.start_at = '2026-08-15 10:00-03' AND w.kind = 'lesson') = 0,
  'aula coberta pelo pacote nao custa nada em dinheiro');
SELECT public.assert((SELECT sum(amount) FROM public.wallet_transactions WHERE student_name = 'Gil') = 0,
  'conta zerada: pacote vendido e pago, aulas cobertas');
SELECT public.assert((SELECT payment_status FROM public.lessons WHERE student_name = 'Gil' AND start_at = '2026-08-15 10:00-03') = 'pago',
  'aula coberta aparece como paga');

-- Mais duas aulas de 1h: a primeira gasta o ultimo bloco, a segunda volta a ser cobrada.
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, price, status) VALUES
  (current_setting('teste.a')::uuid, 'Gil', 'thiago', '2026-08-22 10:00-03', 60, 220, 'realizada'),
  (current_setting('teste.a')::uuid, 'Gil', 'thiago', '2026-08-29 10:00-03', 60, 220, 'realizada');
SELECT public.assert((SELECT sum(u.sessions) FROM public.package_uses u JOIN public.package_purchases p ON p.id = u.purchase_id
                       WHERE p.student_name = 'Gil') = 4, 'o pacote de 4 acabou');
SELECT public.assert((SELECT sum(amount) FROM public.wallet_transactions WHERE student_name = 'Gil') = -220,
  'a quinta aula volta a ser cobrada em dinheiro');

-- Desmarcar uma aula e encurtar outra devolve blocos.
UPDATE public.lessons SET status = 'agendada' WHERE student_name = 'Gil' AND start_at = '2026-08-22 10:00-03';
UPDATE public.lessons SET duration_minutes = 30 WHERE student_name = 'Gil' AND start_at = '2026-08-15 10:00-03';
-- Agora: 1h (1) + 30min (0.5) = 1.5 usados; a de 29/08 pega 1; sobra 1.5.
SELECT public.assert((SELECT sum(u.sessions) FROM public.package_uses u JOIN public.package_purchases p ON p.id = u.purchase_id
                       WHERE p.student_name = 'Gil') = 2.5, 'desmarcar e encurtar aula devolve blocos ao pacote');
SELECT public.assert((SELECT sum(amount) FROM public.wallet_transactions WHERE student_name = 'Gil') = 0,
  'e o que estava cobrado volta a ser coberto');
-- Aula de 2h com 1,5 bloco sobrando: 3/4 cobertos, 1/4 em dinheiro (440 / 4 = 110).
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, price, status) VALUES
  (current_setting('teste.a')::uuid, 'Gil', 'thiago', '2026-09-05 10:00-03', 120, 220, 'realizada');
SELECT public.assert((SELECT amount FROM public.wallet_transactions w JOIN public.lessons l ON l.id = w.lesson_id
                       WHERE l.student_name = 'Gil' AND l.start_at = '2026-09-05 10:00-03' AND w.kind = 'lesson') = -110,
  'pacote que nao cobre a aula inteira: so o resto vira dinheiro');

-- A familia le a propria compra; a outra empresa nao.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ub'), true);
SELECT public.assert((SELECT count(*) FROM public.package_purchases) = 0, 'outra empresa nao ve as compras');
SELECT public.assert((SELECT count(*) FROM public.package_uses) = 0, 'nem os usos');
DO $$
BEGIN
  PERFORM public.sell_package('Gil', NULL, (SELECT id FROM public.lesson_packages LIMIT 1), 0, NULL, current_setting('teste.a')::uuid);
  RAISE EXCEPTION 'FALHOU: vendeu pacote na empresa dos outros';
EXCEPTION WHEN raise_exception THEN
  IF sqlerrm LIKE 'FALHOU%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - nao vende pacote na empresa dos outros';
END $$;
COMMIT;

-- Excluir a compra: as aulas voltam ao valor cheio e a cobranca do pacote sai.
DELETE FROM public.package_purchases WHERE student_name = 'Gil';
SELECT public.assert((SELECT count(*) FROM public.package_uses u JOIN public.lessons l ON l.id = u.lesson_id WHERE l.student_name = 'Gil') = 0,
  'sem compra, sem uso');
SELECT public.assert((SELECT sum(amount) FROM public.wallet_transactions WHERE student_name = 'Gil') = 220 + 800 - 220 - 220 - 110 - 220 - 440,
  'excluir a compra devolve as aulas ao valor cheio (o pagamento recebido fica)');
DELETE FROM public.lessons WHERE student_name = 'Gil';
DELETE FROM public.wallet_transactions WHERE student_name = 'Gil';
DELETE FROM public.lesson_packages WHERE name = 'Pacote 4';

\echo '--- 63. Pagamento on-line (Stripe da empresa, 09/10) ---'
UPDATE public.accounts SET online_payments = false WHERE id = current_setting('teste.a')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((public.online_payments_status() ->> 'allowed')::boolean = false, 'empresa sem a funcao liberada nao ve o pagamento on-line');
DO $$
BEGIN
  PERFORM public.pay_secret('pay_link_secret');
  RAISE EXCEPTION 'FALHOU: admin leu segredo do cofre';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - ninguem de fora le os segredos do pagamento';
END $$;
DO $$
BEGIN
  PERFORM 1 FROM public.online_payments;
  INSERT INTO public.online_payments (account_id, session_id, student_name, amount) VALUES (current_setting('teste.a')::uuid, 'cs_x', 'Bia', 10);
  RAISE EXCEPTION 'FALHOU: admin gravou pagamento on-line na mao';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - pagamento on-line so a funcao grava';
END $$;
COMMIT;
UPDATE public.accounts SET online_payments = true WHERE id = current_setting('teste.a')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((public.online_payments_status() ->> 'allowed')::boolean AND NOT (public.online_payments_status() ->> 'connected')::boolean,
  'liberada e ainda sem a chave: aparece para conectar');
COMMIT;
UPDATE public.accounts SET online_payments = false WHERE id = current_setting('teste.a')::uuid;

\echo '--- 64. Financeiro escondido do cliente, link curto e Stripe/Asaas (09/10) ---'
BEGIN;
INSERT INTO public.wallet_transactions (account_id, student_name, guardian_name, amount, kind, description)
VALUES (current_setting('teste.a')::uuid, 'Bia', 'Ana', -50, 'adjustment', 'teste 64');
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions WHERE description = 'teste 64') = 1,
  'com o financeiro ligado, o cliente le a propria carteira');
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE public.settings SET show_finance_to_clients = false WHERE account_id = current_setting('teste.a')::uuid;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions) = 0,
  'com o financeiro desligado, o banco nao entrega a carteira ao cliente');
SELECT public.assert((SELECT count(*) FROM public.package_purchases) = 0,
  'nem os pacotes');
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions WHERE description = 'teste 64') = 1,
  'o admin continua vendo tudo');
ROLLBACK;

BEGIN;
SELECT public.assert(public.pay_link_code(current_setting('teste.a')::uuid, 'Bia', 'Ana') ~ '^[a-z0-9]{8}$',
  'o link curto tem 8 letras e numeros');
SELECT public.assert(public.pay_link_code(current_setting('teste.a')::uuid, 'Caio', ' ana ') = public.pay_link_code(current_setting('teste.a')::uuid, 'Bia', 'Ana'),
  'a mesma conta (o responsavel) tem sempre o mesmo codigo');
SELECT public.assert(public.pay_link_code(current_setting('teste.a')::uuid, 'Bia', NULL) <> public.pay_link_code(current_setting('teste.a')::uuid, 'Bia', 'Ana'),
  'conta diferente, codigo diferente');
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
DO $$
BEGIN
  PERFORM public.pay_link_code(current_setting('teste.a')::uuid, 'Bia', 'Ana');
  RAISE EXCEPTION 'FALHOU: admin gerou link curto direto';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - so a funcao gera o link curto';
END $$;
DO $$
BEGIN
  PERFORM 1 FROM public.pay_links;
  RAISE EXCEPTION 'FALHOU: admin leu a tabela dos links';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - a tabela dos links e fechada';
END $$;
DO $$
BEGIN
  PERFORM public.set_online_provider('stripe');
  RAISE EXCEPTION 'FALHOU: empresa sem a funcao escolheu o Stripe';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not enabled%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - empresa sem a funcao nao escolhe provedor';
END $$;
SELECT public.assert((public.online_payments_status() ->> 'provider') IS NULL, 'sem a funcao, nenhum provedor');
ROLLBACK;

UPDATE public.accounts SET online_payments = true WHERE id = current_setting('teste.a')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
DO $$
BEGIN
  PERFORM public.set_online_provider('asaas');
  RAISE EXCEPTION 'FALHOU: escolheu o Asaas sem conectar';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not connected%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - so escolhe o provedor depois de conectar';
END $$;
SELECT public.set_online_provider(NULL);
SELECT public.assert((public.online_payments_status() ->> 'allowed')::boolean AND (public.online_payments_status() ->> 'provider') IS NULL,
  'voltar ao padrao (Pix e link das Configuracoes) sempre pode');
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  PERFORM public.set_online_provider(NULL);
  RAISE EXCEPTION 'FALHOU: cliente mexeu no provedor';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - cliente nao mexe no provedor';
END $$;
ROLLBACK;
UPDATE public.accounts SET online_payments = false WHERE id = current_setting('teste.a')::uuid;

\echo '--- 65. Parcelamento no Asaas (09/10) ---'
UPDATE public.accounts SET online_payments = true, online_max_installments = 1 WHERE id = current_setting('teste.a')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((public.online_payments_status() ->> 'installments')::int = 1, 'por padrao, so a vista');
SELECT public.set_online_installments(12);
SELECT public.assert((public.online_payments_status() ->> 'installments')::int = 12, 'o admin libera ate 12x');
DO $$
BEGIN
  PERFORM public.set_online_installments(13);
  RAISE EXCEPTION 'FALHOU: aceitou 13 parcelas';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%invalid installments%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - no maximo 12 parcelas';
END $$;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  PERFORM public.set_online_installments(2);
  RAISE EXCEPTION 'FALHOU: cliente mexeu no parcelamento';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - cliente nao mexe no parcelamento';
END $$;
ROLLBACK;
UPDATE public.accounts SET online_payments = false WHERE id = current_setting('teste.a')::uuid;

\echo '--- 66. Parcelas por faixa de valor (09/10) ---'
SELECT public.assert(public.installments_for('{"tiers":[{"up_to":300,"max":2},{"up_to":500,"max":3},{"up_to":1000,"max":4}],"above":4}'::jsonb, 1, 250) = 2, 'ate 300: 2x');
SELECT public.assert(public.installments_for('{"tiers":[{"up_to":300,"max":2},{"up_to":500,"max":3},{"up_to":1000,"max":4}],"above":4}'::jsonb, 1, 300.01) = 3, 'de 300 a 500: 3x');
SELECT public.assert(public.installments_for('{"tiers":[{"up_to":300,"max":2},{"up_to":500,"max":3},{"up_to":1000,"max":4}],"above":4}'::jsonb, 1, 2500) = 4, 'acima de 1000: o maximo de cima');
SELECT public.assert(public.installments_for(NULL, 6, 2500) = 6, 'sem regra: o maximo de sempre');
UPDATE public.accounts SET online_payments = true WHERE id = current_setting('teste.a')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.set_online_installment_rule('{"tiers":[{"up_to":500,"max":3},{"up_to":300,"max":2}],"above":5}'::jsonb);
SELECT public.assert((public.online_payments_status() -> 'installment_rule' -> 'tiers' -> 0 ->> 'up_to')::numeric = 300
  AND (public.online_payments_status() ->> 'installments')::int = 5, 'a regra grava em ordem e o maximo acompanha');
DO $$
BEGIN
  PERFORM public.set_online_installment_rule('{"tiers":[{"up_to":300,"max":2},{"up_to":300,"max":3}],"above":4}'::jsonb);
  RAISE EXCEPTION 'FALHOU: aceitou duas faixas com o mesmo valor';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%invalid rule%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - faixas repetidas recusadas';
END $$;
DO $$
BEGIN
  PERFORM public.set_online_installment_rule('{"tiers":[],"above":13}'::jsonb);
  RAISE EXCEPTION 'FALHOU: aceitou 13x';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%invalid rule%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - no maximo 12x';
END $$;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  PERFORM public.set_online_installment_rule('{"tiers":[],"above":2}'::jsonb);
  RAISE EXCEPTION 'FALHOU: cliente mexeu nas parcelas';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - cliente nao mexe nas parcelas';
END $$;
ROLLBACK;
UPDATE public.accounts SET online_payments = false WHERE id = current_setting('teste.a')::uuid;

\echo '--- 67. Links curtos de varias contas de uma vez (10/10) ---'
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert(public.admin_pay_links('[{"student":"Bia","guardian":"Ana"}]'::jsonb) = '{}'::jsonb,
  'sem pagamento on-line conectado, nenhum link');
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
DO $$
BEGIN
  PERFORM public.admin_pay_links('[]'::jsonb);
  RAISE EXCEPTION 'FALHOU: cliente pediu os links da empresa';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - so o admin pega os links';
END $$;
ROLLBACK;

\echo '--- 68. O historico acompanha o cadastro (10/10) ---'
-- Rafa foi cadastrado sem responsavel, teve duas aulas e pagou uma; a Tati ja
-- tem outra filha (Lia) cadastrada.
INSERT INTO public.students (account_id, student_name) VALUES (current_setting('teste.a')::uuid, 'Rafa');
INSERT INTO public.students (account_id, student_name, guardian_name) VALUES (current_setting('teste.a')::uuid, 'Lia', 'Tati');
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, price, status) VALUES
  (current_setting('teste.a')::uuid, 'Rafa', 'thiago', '2026-07-01 10:00-03', 60, 100, 'realizada'),
  (current_setting('teste.a')::uuid, 'Rafa', 'thiago', '2026-07-08 10:00-03', 60, 100, 'realizada');
INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, price, status) VALUES
  (current_setting('teste.a')::uuid, 'Lia', 'Tati', 'thiago', '2026-07-02 10:00-03', 60, 100, 'realizada');
INSERT INTO public.wallet_transactions (account_id, student_name, amount, kind, description)
VALUES (current_setting('teste.a')::uuid, 'Rafa', 100, 'adjustment', 'Pix');
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE student_name = 'Rafa' AND payment_status = 'pago') = 1, 'antes: uma aula do Rafa paga');
-- Poe a Tati como responsavel do Rafa: tudo vai para a conta da familia.
UPDATE public.students SET guardian_name = 'Tati' WHERE student_name = 'Rafa' AND account_id = current_setting('teste.a')::uuid;
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.lessons WHERE student_name = 'Rafa' AND guardian_name IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions WHERE student_name = 'Rafa' AND guardian_name IS NULL),
  'nada do Rafa fica na conta sem responsavel');
SELECT public.assert((SELECT sum(amount) FROM public.wallet_transactions WHERE account_id = current_setting('teste.a')::uuid AND guardian_name = 'Tati') = -200,
  'a conta da Tati soma as aulas dos dois e o pagamento');
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE guardian_name = 'Tati' AND payment_status = 'pago') = 1
  AND (SELECT payment_status FROM public.lessons WHERE student_name = 'Rafa' AND start_at = '2026-07-01 10:00-03') = 'pago',
  'o pagamento quita a aula mais antiga da familia');

-- Rafa muda de responsavel (Bruna) com a Lia ainda na familia da Tati: vao as
-- aulas dele; o pagamento fica com a familia.
UPDATE public.students SET guardian_name = 'Bruna' WHERE student_name = 'Rafa' AND account_id = current_setting('teste.a')::uuid;
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE student_name = 'Rafa' AND guardian_name = 'Bruna') = 2
  AND (SELECT count(*) FROM public.wallet_transactions WHERE guardian_name = 'Bruna' AND kind = 'lesson') = 2,
  'com irmaos, vao so as aulas dele');
SELECT public.assert((SELECT guardian_name FROM public.lessons WHERE student_name = 'Lia' AND account_id = current_setting('teste.a')::uuid) = 'Tati'
  AND (SELECT sum(amount) FROM public.wallet_transactions WHERE guardian_name = 'Tati') = 0,
  'a Lia e o pagamento ficam com a Tati');

-- Conta que ja ficou separada (antes desta correcao): aparece no aviso e junta.
INSERT INTO public.students (account_id, student_name, guardian_name) VALUES (current_setting('teste.a')::uuid, 'Davi', 'Rosa');
INSERT INTO public.lesson_packages (account_id, name, lessons, price) VALUES (current_setting('teste.a')::uuid, 'Pacote Davi', 4, 400);
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, price, status) VALUES
  (current_setting('teste.a')::uuid, 'Davi', 'thiago', '2026-07-03 10:00-03', 60, 100, 'realizada');
INSERT INTO public.wallet_transactions (account_id, student_name, guardian_name, amount, kind, description)
VALUES (current_setting('teste.a')::uuid, 'Davi', 'Rosa', 100, 'adjustment', 'Pix');
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ualuno'), true);
SELECT public.assert(public.split_client_histories() = '[]'::jsonb, 'cliente nao ve o aviso');
DO $$
BEGIN
  PERFORM public.merge_client_history((SELECT id FROM public.students WHERE student_name = 'Davi'), NULL);
  RAISE EXCEPTION 'FALHOU: cliente juntou contas';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - so o admin junta contas';
END $$;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert((SELECT count(*) FROM jsonb_array_elements(public.split_client_histories()) e
                       WHERE e ->> 'student_name' = 'Davi' AND e ->> 'from_guardian' IS NULL AND e ->> 'guardian_name' = 'Rosa'
                         AND (e ->> 'lessons')::int = 1) = 1, 'o aviso mostra o Davi separado da Rosa');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.split_client_histories()) e WHERE e ->> 'student_name' IN ('Rafa', 'Lia')),
  'quem ja esta junto nao aparece');
SELECT public.sell_package('Davi', NULL, (SELECT id FROM public.lesson_packages WHERE name = 'Pacote Davi'), 400);
SELECT public.merge_client_history((SELECT id FROM public.students WHERE student_name = 'Davi'), NULL);
SELECT public.assert((SELECT guardian_name FROM public.package_purchases WHERE student_name = 'Davi') = 'Rosa'
  AND EXISTS (SELECT 1 FROM public.package_uses u JOIN public.lessons l ON l.id = u.lesson_id WHERE l.student_name = 'Davi')
  AND (SELECT amount FROM public.wallet_transactions w JOIN public.lessons l ON l.id = w.lesson_id WHERE l.student_name = 'Davi' AND w.kind = 'lesson') = 0,
  'o pacote vai junto e continua abatendo a aula');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.split_client_histories()) e WHERE e ->> 'student_name' = 'Davi'),
  'depois de juntar, o aviso some');
SELECT public.assert((SELECT payment_status FROM public.lessons WHERE student_name = 'Davi') = 'pago',
  'juntando, a aula do Davi aparece paga');
COMMIT;

\echo '--- 69. Aula, lancamento e pacote ligados ao cadastro (student_id, 10/10) ---'
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE student_name = 'Rafa' AND student_id = (SELECT id FROM public.students WHERE student_name = 'Rafa')) = 2,
  'as aulas do Rafa apontam para o cadastro dele');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.wallet_transactions w JOIN public.lessons l ON l.id = w.lesson_id WHERE w.student_id IS DISTINCT FROM l.student_id),
  'o lancamento da aula herda o cadastro da aula');
-- Dois "Pedro" sem responsavel: com o id, cada aula sabe de qual e', e
-- renomear um leva so as dele.
INSERT INTO public.students (account_id, student_name) VALUES (current_setting('teste.a')::uuid, 'Pedro'), (current_setting('teste.a')::uuid, 'Pedro');
SELECT set_config('teste.p1', (SELECT id::text FROM public.students WHERE student_name = 'Pedro' ORDER BY id LIMIT 1), false);
SELECT set_config('teste.p2', (SELECT id::text FROM public.students WHERE student_name = 'Pedro' ORDER BY id DESC LIMIT 1), false);
INSERT INTO public.lessons (account_id, student_name, student_id, teacher, start_at, duration_minutes, price, status) VALUES
  (current_setting('teste.a')::uuid, 'Pedro', current_setting('teste.p1')::uuid, 'thiago', '2026-07-10 10:00-03', 60, 100, 'realizada'),
  (current_setting('teste.a')::uuid, 'Pedro', current_setting('teste.p2')::uuid, 'thiago', '2026-07-11 10:00-03', 60, 100, 'realizada'),
  (current_setting('teste.a')::uuid, 'Pedro', current_setting('teste.p2')::uuid, 'thiago', '2026-07-12 10:00-03', 60, 100, 'realizada');
INSERT INTO public.lessons (account_id, student_name, teacher, start_at, duration_minutes, price, status) VALUES
  (current_setting('teste.a')::uuid, 'Pedro', 'thiago', '2026-07-13 10:00-03', 60, 100, 'agendada');
SELECT public.assert((SELECT student_id FROM public.lessons WHERE student_name = 'Pedro' AND start_at = '2026-07-13 10:00-03') IS NULL,
  'sem id e com dois homonimos, nao chuta');
UPDATE public.students SET student_name = 'Pedro Lima' WHERE id = current_setting('teste.p2')::uuid;
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE student_name = 'Pedro Lima') = 2
  AND (SELECT count(*) FROM public.lessons WHERE student_id = current_setting('teste.p1')::uuid AND student_name = 'Pedro') = 1,
  'renomear um homonimo leva so as aulas dele');
SELECT public.assert((SELECT sum(amount) FROM public.wallet_transactions WHERE student_name = 'Pedro Lima') = -200
  AND (SELECT sum(amount) FROM public.wallet_transactions WHERE student_name = 'Pedro' AND account_id = current_setting('teste.a')::uuid) = -100,
  'e as cobrancas dele, so as dele');
-- Mudar a aula para outro aluno troca o cadastro dela.
UPDATE public.lessons SET student_name = 'Rafa', guardian_name = 'Bruna' WHERE student_name = 'Pedro' AND start_at = '2026-07-13 10:00-03';
SELECT public.assert((SELECT student_id FROM public.lessons WHERE start_at = '2026-07-13 10:00-03' AND account_id = current_setting('teste.a')::uuid) = (SELECT id FROM public.students WHERE student_name = 'Rafa'),
  'aula passada para outro aluno aponta para ele');
-- Excluir o cadastro nao apaga o historico.
DELETE FROM public.students WHERE id = current_setting('teste.p1')::uuid;
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE student_name = 'Pedro' AND student_id IS NULL AND account_id = current_setting('teste.a')::uuid) = 1,
  'cadastro excluido: a aula fica, sem o id');

\echo '--- 70. Plano vitalicio (10/10) ---'
UPDATE public.accounts SET lifetime = true, lifetime_assistant = false WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert((SELECT plan = 'pro' AND tester_until IS NULL FROM public.accounts WHERE id = current_setting('teste.a')::uuid),
  'vitalicia fica no Max');
UPDATE public.accounts SET assistant_override = false WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert((SELECT assistant_override = false AND plan = 'pro' FROM public.accounts WHERE id = current_setting('teste.a')::uuid),
  'na vitalicia, o gestor ainda desliga o assistente');
UPDATE public.accounts SET assistant_override = true WHERE id = current_setting('teste.a')::uuid;
UPDATE public.accounts SET trial_ends_at = now() - interval '1 day' WHERE id = current_setting('teste.a')::uuid;
SELECT public.expire_trials();
SELECT public.billing_apply_subscription(current_setting('teste.a')::uuid, NULL, NULL, 'canceled', NULL, NULL, NULL);
SELECT public.assert((SELECT plan FROM public.accounts WHERE id = current_setting('teste.a')::uuid) = 'pro'
  AND public.account_can('assistant', current_setting('teste.a')::uuid),
  'fim de teste e assinatura cancelada nao rebaixam a vitalicia');
UPDATE public.accounts SET lifetime = false, billing_status = 'none' WHERE id = current_setting('teste.a')::uuid;
UPDATE public.accounts SET plan = 'essencial' WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert((SELECT plan FROM public.accounts WHERE id = current_setting('teste.a')::uuid) = 'essencial',
  'sem a marca, o plano volta a mudar normalmente');
UPDATE public.accounts SET plan = 'pro', assistant_override = NULL WHERE id = current_setting('teste.a')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
DO $$
BEGIN
  PERFORM public.platform_set_lifetime(current_setting('teste.a')::uuid, true);
  RAISE EXCEPTION 'FALHOU: admin da empresa ligou o vitalicio';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - so o gestor liga o vitalicio';
END $$;
ROLLBACK;

\echo '--- 71. Assistente so para quem paga (10/10) ---'
UPDATE public.platform_settings SET assistant_enabled = true WHERE id;
UPDATE public.accounts SET lifetime = false, lifetime_assistant = false, plan = 'pro_solo', billing_status = 'none',
       assistant_override = NULL, trial_ends_at = now() + interval '10 days', tester_until = NULL
 WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.a')::uuid), 'Pro no teste gratis: sem IA');
UPDATE public.accounts SET billing_status = 'active', trial_ends_at = NULL WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert(public.account_can('assistant', current_setting('teste.a')::uuid), 'Pro pago: amostra de IA');
UPDATE public.accounts SET plan = 'pro' WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert(public.account_can('assistant', current_setting('teste.a')::uuid), 'Max pago: IA inclusa');
UPDATE public.accounts SET billing_status = 'none' WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.a')::uuid), 'Max sem pagar (cortesia): sem IA');
UPDATE public.platform_settings SET assistant_enabled = false WHERE id;

\echo '--- 72. Conector de IA: chaves de acesso (11/10) ---'
DO $$
DECLARE _op uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_op, 'gestor72@x');
  DELETE FROM public.user_roles WHERE user_id = _op;
  INSERT INTO public.platform_admins (user_id, note) VALUES (_op, 'teste 72');
  PERFORM set_config('teste.op72', _op::text, false);
END $$;
-- O admin da empresa B sai num teste antigo: a "outra empresa" aqui e a E.
DO $$
DECLARE _u uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_u, 'admin-e72@x');
  DELETE FROM public.user_roles WHERE user_id = _u;
  INSERT INTO public.user_roles (user_id, role, account_id) VALUES (_u, 'admin', current_setting('teste.e')::uuid);
  PERFORM set_config('teste.ue72', _u::text, false);
END $$;
UPDATE public.accounts SET active = true WHERE id IN (current_setting('teste.a')::uuid, current_setting('teste.e')::uuid);

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT set_config('teste.tok_a', public.ai_connector_create('Claude do Thiago') ->> 'token', false);
SELECT set_config('teste.tok_ro', public.ai_connector_create('Só leitura', true) ->> 'token', false);
SELECT public.assert(current_setting('teste.tok_a') ~ '^crn_[0-9a-f]{40}$', 'a chave sai no formato crn_ + 40');
SELECT public.assert((SELECT count(*) FROM public.ai_connectors_list()) = 2, 'a empresa ve as duas conexoes');
SELECT public.assert((SELECT bool_and(mine) FROM public.ai_connectors_list()), 'e sabe que foi ela que criou');
DO $$
BEGIN
  PERFORM 1 FROM public.ai_connectors;
  RAISE EXCEPTION 'FALHOU: leu a tabela de chaves direto';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - ninguem le a tabela de chaves direto';
END $$;
DO $$
BEGIN
  PERFORM public.ai_connector_resolve(current_setting('teste.tok_a'));
  RAISE EXCEPTION 'FALHOU: o app resolveu a chave';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - so a funcao mcp resolve a chave';
END $$;
DO $$
BEGIN
  PERFORM public.ai_connector_create('gestor', false, true);
  RAISE EXCEPTION 'FALHOU: admin da empresa criou chave do gestor';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - so o gestor cria a chave do gestor';
END $$;
COMMIT;

-- A outra empresa nao ve nem desliga a chave da primeira.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ue72'), true);
SELECT public.assert((SELECT count(*) FROM public.ai_connectors_list()) = 0, 'a outra empresa nao ve as chaves da A');
DO $$
BEGIN
  PERFORM public.ai_connector_revoke((SELECT id FROM public.ai_connectors WHERE label = 'Claude do Thiago'));
  RAISE EXCEPTION 'FALHOU: a outra empresa desligou a chave da A';
EXCEPTION WHEN insufficient_privilege OR sqlstate 'P0001' THEN
  RAISE NOTICE '  ok - a outra empresa nao desliga a chave da A';
END $$;
ROLLBACK;

-- O que a funcao mcp ve (chave de servico).
SELECT public.assert((public.ai_connector_resolve(current_setting('teste.tok_a')) ->> 'account_id')::uuid = current_setting('teste.a')::uuid
  AND (public.ai_connector_resolve(current_setting('teste.tok_a')) ->> 'read_only')::boolean = false,
  'a chave aponta para a empresa A, com escrita');
SELECT public.assert((public.ai_connector_resolve(current_setting('teste.tok_ro')) ->> 'read_only')::boolean, 'a chave so de leitura vem marcada');
SELECT public.assert(public.ai_connector_resolve('crn_' || repeat('0', 40)) IS NULL, 'chave inventada nao vale');
SELECT public.assert(public.ai_connector_resolve('qualquer coisa') IS NULL, 'texto qualquer nao vale');
SELECT public.assert((SELECT last_used_at IS NOT NULL FROM public.ai_connectors WHERE label = 'Claude do Thiago'), 'marca o ultimo uso');

-- Empresa desativada pelo gestor: a chave para na hora.
UPDATE public.accounts SET active = false WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert(public.ai_connector_resolve(current_setting('teste.tok_a')) IS NULL, 'empresa desativada: chave nao vale');
UPDATE public.accounts SET active = true WHERE id = current_setting('teste.a')::uuid;
SELECT public.assert(public.ai_connector_resolve(current_setting('teste.tok_a')) IS NOT NULL, 'reativou: volta a valer');

-- Desligar a chave.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.ua'), true);
SELECT public.assert(public.ai_connector_revoke((SELECT id FROM public.ai_connectors_list() WHERE label = 'Só leitura')), 'a empresa desliga a propria chave');
SELECT public.assert((SELECT count(*) FROM public.ai_connectors_list()) = 1, 'a desligada some da lista');
COMMIT;
SELECT public.assert(public.ai_connector_resolve(current_setting('teste.tok_ro')) IS NULL, 'chave desligada nao vale mais');

-- Quem devia: o saldo por conta, do jeito do financeiro.
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.ai_open_balances(current_setting('teste.a')::uuid) WHERE saldo >= 0),
  'quem devia: so contas com saldo negativo');
SELECT public.assert((SELECT count(*) FROM public.ai_open_balances(current_setting('teste.a')::uuid))
  = (SELECT count(*) FROM (SELECT 1 FROM public.wallet_transactions w WHERE w.account_id = current_setting('teste.a')::uuid
                            GROUP BY public.account_key(w.student_name, w.guardian_name) HAVING sum(w.amount) < -0.005) x),
  'quem devia: uma linha por conta devedora, so da empresa da chave');

-- Chave do gestor: so numeros, lidos como o gestor.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op72'), true);
SELECT set_config('teste.tok_op', public.ai_connector_create('Gestor', false, true) ->> 'token', false);
SELECT public.assert((SELECT count(*) FROM public.ai_connectors_list(true)) = 1, 'o gestor ve a chave dele');
COMMIT;
SELECT public.assert((public.ai_connector_resolve(current_setting('teste.tok_op')) ->> 'scope') = 'platform'
  AND (public.ai_connector_resolve(current_setting('teste.tok_op')) ->> 'read_only')::boolean,
  'chave do gestor: escopo plataforma, so leitura');
SELECT public.assert((SELECT count(*) FROM public.ai_platform_overview(current_setting('teste.op72')::uuid)) = (SELECT count(*) FROM public.accounts),
  'o gestor ve uma linha por empresa');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.ai_platform_overview(current_setting('teste.op72')::uuid) j WHERE j ? 'student_name'),
  'nenhum nome de cliente sai para o gestor');
DO $$
BEGIN
  PERFORM public.ai_platform_overview(current_setting('teste.ua')::uuid);
  RAISE EXCEPTION 'FALHOU: admin de empresa leu o painel do gestor';
EXCEPTION WHEN sqlstate 'P0001' THEN
  IF sqlerrm NOT LIKE '%not allowed%' THEN RAISE; END IF;
  RAISE NOTICE '  ok - o painel so sai para quem e gestor';
END $$;
DELETE FROM public.platform_admins WHERE user_id = current_setting('teste.op72')::uuid;
SELECT public.assert(public.ai_connector_resolve(current_setting('teste.tok_op')) IS NULL, 'deixou de ser gestor: chave morre');

-- Perdeu o papel de admin: a chave da empresa morre.
UPDATE public.user_roles SET role = 'user' WHERE user_id = current_setting('teste.ua')::uuid AND role = 'admin';
SELECT public.assert(public.ai_connector_resolve(current_setting('teste.tok_a')) IS NULL, 'deixou de ser admin: chave morre');
UPDATE public.user_roles SET role = 'admin' WHERE user_id = current_setting('teste.ua')::uuid AND role = 'user';
SELECT public.assert(public.ai_connector_resolve(current_setting('teste.tok_a')) IS NOT NULL, 'voltou a ser admin: chave volta');

\echo '--- 73. Materiais: link e pagina escrita (11/10) ---'
INSERT INTO public.student_materials (account_id, student_id, title, kind, url)
SELECT s.account_id, s.id, 'Video da aula', 'link', 'https://youtu.be/abc' FROM public.students s WHERE s.account_id = current_setting('teste.a')::uuid LIMIT 1;
INSERT INTO public.student_materials (account_id, student_id, title, kind, content)
SELECT s.account_id, s.id, 'Lista 1', 'page', '# Lista 1' || chr(10) || '1. Resolva $x^2 = 4$' FROM public.students s WHERE s.account_id = current_setting('teste.a')::uuid LIMIT 1;
SELECT public.assert((SELECT count(*) FROM public.student_materials WHERE kind IN ('link', 'page') AND account_id = current_setting('teste.a')::uuid) = 2,
  'material pode ser link ou pagina, sem arquivo');
DO $$
BEGIN
  INSERT INTO public.student_materials (account_id, student_id, title, kind, url)
  SELECT s.account_id, s.id, 'x', 'link', 'javascript:alert(1)' FROM public.students s WHERE s.account_id = current_setting('teste.a')::uuid LIMIT 1;
  RAISE EXCEPTION 'FALHOU: aceitou link que nao e http';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - link precisa ser http(s)';
END $$;
DO $$
BEGIN
  INSERT INTO public.student_materials (account_id, student_id, title)
  SELECT s.account_id, s.id, 'sem nada' FROM public.students s WHERE s.account_id = current_setting('teste.a')::uuid LIMIT 1;
  RAISE EXCEPTION 'FALHOU: aceitou arquivo sem caminho';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - arquivo continua precisando do caminho';
END $$;

\echo '=== FIM ==='

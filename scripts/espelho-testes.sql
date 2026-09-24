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
\echo '--- 17. Planos: o limite e do banco, nao da tela ---'

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
SELECT public.assert(public.account_limit('students') = 5, 'com limite de 5 alunos');
SELECT public.assert(public.account_limit('teachers') = 1, 'e de 1 professor');
SELECT public.assert(public.account_can('assistant') = false, 'sem assistente');
SELECT public.assert(public.account_can('packages') = false, 'sem pacotes/vouchers');
SELECT public.assert(public.account_can('recurring_blocks') = false, 'sem bloqueio recorrente');

-- 5 alunos passam; o sexto nao.
INSERT INTO public.students (student_name, guardian_name) VALUES
  ('A1','R1'), ('A2','R2'), ('A3','R3'), ('A4','R4'), ('A5','R5');
SELECT public.assert((SELECT count(*) FROM public.students) = 5, 'cinco alunos entram');
DO $$
BEGIN
  INSERT INTO public.students (student_name) VALUES ('A6');
  RAISE EXCEPTION 'FALHOU: cadastrou o sexto aluno no Essencial';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - o sexto aluno e recusado pelo BANCO, nao pela tela';
END $$;

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

\echo ''
\echo '--- 18. Virar Pro solta tudo; rebaixar trava tudo e o professor escolhe o que liberar ---'

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.e')::uuid, 'pro') ->> 'plan') = 'pro',
  'o gestor muda a empresa para Pro');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
SELECT public.assert(public.account_limit('students') IS NULL, 'no Pro o limite de alunos some');
SELECT public.assert(public.account_can('assistant'), 'e o assistente liga');
INSERT INTO public.students (student_name) VALUES ('A6');
SELECT public.assert((SELECT count(*) FROM public.students) = 6, 'o sexto aluno agora entra');
INSERT INTO public.teachers (name, active) VALUES ('Segundo', true);
INSERT INTO public.blocks (title, teacher, block_type, weekday, start_time, end_time)
VALUES ('Toda terca', 'unico', 'recurring', 2, '14:00', '16:00');
SELECT public.assert((public.set_account_discount('A1','R1','percent',10) ->> 'removed') = 'false',
  'e o desconto por familia passa a ser aceito');
-- Uma aula ja marcada para o A6, para ver o que acontece com ela ao rebaixar.
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES ('A6', NULL, 'segundo', '2027-01-04 10:00-03', 60);
COMMIT;

-- Rebaixar: 6 alunos com limite 5 e 2 professores ativos com limite 1 -
-- trava TODOS dos dois tipos. Ninguem e escolhido automaticamente.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert(
  (SELECT r ->> 'alunos_travados' = '6' AND r ->> 'professores_travados' = '2'
     FROM (SELECT public.platform_set_account_plan(current_setting('teste.e')::uuid, 'essencial') AS r) x),
  'rebaixar trava os 6 alunos e os 2 professores ativos');
SELECT public.assert(
  (SELECT alunos_travados = 6 AND professores_travados = 2
     FROM public.platform_accounts_overview() WHERE id = current_setting('teste.e')::uuid),
  'e o painel do gestor mostra quantos estao travados');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
SELECT public.assert((SELECT count(*) FROM public.students) = 6,
  'travar nao apaga: a empresa CONTINUA com os 6 alunos');
SELECT public.assert((SELECT count(*) FROM public.students WHERE plan_locked) = 6, 'todos travados');
SELECT public.assert((SELECT count(*) FROM public.teachers WHERE active) = 0, 'nenhum professor ativo');
SELECT public.assert((SELECT active FROM public.teachers WHERE name = 'Reserva') = false
                     AND (SELECT plan_locked FROM public.teachers WHERE name = 'Reserva') = false,
  'o professor que o dono ja tinha desligado NAO vira travado-pelo-plano');
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE student_name = 'A6' AND status = 'agendada') = 1,
  'a aula ja marcada do aluno travado continua marcada');
-- Pro-only que ja existia fica, de proposito (ver migration 20260923020000).
SELECT public.assert((SELECT count(*) FROM public.blocks WHERE block_type='recurring') = 1,
  'o bloqueio recorrente que ja existia continua');
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 1,
  'e o desconto que ja existia tambem');
UPDATE public.students SET guardian_name = 'R1 editado' WHERE student_name = 'A1';
SELECT public.assert((SELECT count(*) FROM public.students WHERE guardian_name='R1 editado') = 1,
  'editar aluno travado continua funcionando');
SELECT public.assert((public.set_account_discount('A1','R1 editado', NULL, NULL) ->> 'removed') = 'true',
  'e tirar um desconto continua livre, para ela poder desfazer');
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
  VALUES ('A1', 'R1 editado', 'unico', '2027-01-05 10:00-03', 60);
  RAISE EXCEPTION 'FALHOU: marcou aula para aluno travado';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - aluno travado nao recebe aula nova';
END $$;
COMMIT;

-- O professor escolhe: libera 5 alunos e 1 professor. O sexto nao passa.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
UPDATE public.students SET plan_locked = false WHERE student_name IN ('A1','A2','A3','A4','A5');
SELECT public.assert((SELECT count(*) FROM public.students WHERE NOT plan_locked) = 5, 'libera 5 alunos');
DO $$
BEGIN
  UPDATE public.students SET plan_locked = false WHERE student_name = 'A6';
  RAISE EXCEPTION 'FALHOU: liberou o sexto aluno no Essencial';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - o sexto nao e liberado, nem por UPDATE direto na API';
END $$;
DO $$
BEGIN
  INSERT INTO public.students (student_name) VALUES ('A7');
  RAISE EXCEPTION 'FALHOU: criou aluno novo com 5 liberados';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - e criar um novo tambem trava';
END $$;
UPDATE public.teachers SET active = true WHERE name = 'Unico';
SELECT public.assert((SELECT plan_locked FROM public.teachers WHERE name = 'Unico') = false,
  'reativar o professor limpa a marca de travado');
DO $$
BEGIN
  UPDATE public.teachers SET active = true WHERE name = 'Segundo';
  RAISE EXCEPTION 'FALHOU: reativou o segundo professor';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - o segundo professor nao volta';
END $$;
INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
VALUES ('A1', 'R1 editado', 'unico', '2027-01-05 10:00-03', 60);
SELECT public.assert(true, 'aluno liberado com professor liberado recebe aula');
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
  VALUES ('A1', 'R1 editado', 'segundo', '2027-01-06 10:00-03', 60);
  RAISE EXCEPTION 'FALHOU: marcou aula com professor travado';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - professor travado nao recebe aula nova';
END $$;
DO $$
BEGIN
  UPDATE public.lessons SET student_name = 'A6', guardian_name = NULL
   WHERE student_name = 'A1' AND start_at = '2027-01-05 10:00-03';
  RAISE EXCEPTION 'FALHOU: passou uma aula para o aluno travado';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - nem trocando o aluno de uma aula existente';
END $$;
-- Mas desmarcar ou mudar o horario da aula do travado continua livre.
UPDATE public.lessons SET start_at = '2027-01-04 11:00-03' WHERE student_name = 'A6';
UPDATE public.lessons SET status = 'cancelada' WHERE student_name = 'A6';
SELECT public.assert((SELECT status FROM public.lessons WHERE student_name = 'A6') = 'cancelada',
  'mudar horario e desmarcar a aula do travado continua livre');
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
  RAISE NOTICE '  ok - admin nao trava alunos de outra empresa';
END $$;
DO $$
BEGIN
  PERFORM public.release_plan_locks(current_setting('teste.e')::uuid);
  RAISE EXCEPTION 'FALHOU: admin chamou release_plan_locks';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '  ok - nem se destrava sozinho';
END $$;
ROLLBACK;

-- Voltar ao Pro destrava so o que o plano travou.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert(
  (SELECT r ->> 'alunos_liberados' = '1' AND r ->> 'professores_liberados' = '1'
     FROM (SELECT public.platform_set_account_plan(current_setting('teste.e')::uuid, 'pro') AS r) x),
  'voltar ao Pro libera o aluno e o professor que ficaram travados');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
SELECT public.assert((SELECT count(*) FROM public.students WHERE plan_locked) = 0, 'nenhum aluno travado no Pro');
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
SELECT public.assert(public.account_can('assistant'), 'com assistente');
SELECT public.assert((public.my_plan() ->> 'nome') = 'Cronys Pro', 'e my_plan() se apresenta como Cronys Pro');
COMMIT;


\echo ''
\echo '--- 21. Desligar o assistente de uma empresa PRO, a mao ---'

-- A empresa A e Pro. O gestor desliga o assistente dela sem rebaixar o plano.
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
SELECT public.assert((SELECT plan = 'pro' AND trial_ends_at > now() + interval '13 days' AND trial_ends_at < now() + interval '15 days'
                        FROM public.accounts WHERE id = current_setting('teste.a24')::uuid),
  'nasce no Pro com 14 dias de teste');
SELECT public.assert((SELECT count(*) FROM public.settings WHERE account_id = current_setting('teste.a24')::uuid) = 1
                     AND (SELECT name FROM public.teachers WHERE account_id = current_setting('teste.a24')::uuid) = 'ana paula',
  'ja nasce com configuracoes e com o professor');
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

-- Fim do teste: vira Essencial de verdade e trava o que passa do limite.
UPDATE public.accounts SET trial_ends_at = now() - interval '1 minute' WHERE id = current_setting('teste.a24')::uuid;
SELECT public.assert(public.expire_trials() >= 1, 'o teste vencido e encerrado pela rotina diaria');
SELECT public.assert((SELECT plan = 'essencial' AND trial_ends_at IS NULL FROM public.accounts WHERE id = current_setting('teste.a24')::uuid),
  'a escola passa para o Essencial');
SELECT public.assert((SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.a24')::uuid AND plan_locked) = 6,
  'e os 6 alunos ficam pausados para ela escolher quais liberar');

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
\echo '--- 25. Papel professor: so as proprias aulas, nada de financeiro ---'

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
  INSERT INTO public.students (account_id, student_name, guardian_name) VALUES (_t, 'Caio', 'Dora');
  INSERT INTO public.lessons (account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status) VALUES
    (_t, 'Caio', 'Dora', 'ana-julia', '2027-03-01 10:00-03', 60, 'agendada'),
    (_t, 'Caio', 'Dora', 'beto',      '2027-03-02 10:00-03', 60, 'agendada');
  INSERT INTO public.wallet_transactions (account_id, student_name, guardian_name, amount, kind, description)
  VALUES (_t, 'Caio', 'Dora', 500, 'adjustment', 'Pix');
  INSERT INTO public.account_discounts (account_id, student_name, guardian_name, kind, value) VALUES (_t, 'Caio', 'Dora', 'percent', 10);
  PERFORM set_config('teste.t', _t::text, false);
  PERFORM set_config('teste.prof', _prof::text, false);
END $$;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.prof'), true);
SELECT public.assert(public.current_teacher_slug() = 'ana-julia', 'o login sabe qual professor e');
SELECT public.assert((SELECT count(*) FROM public.lessons) = 1 AND (SELECT teacher FROM public.lessons) = 'ana-julia',
  've so as proprias aulas');
SELECT public.assert((SELECT count(*) FROM public.wallet_transactions) = 0, 'nao ve pagamentos');
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 0, 'nao ve descontos');
SELECT public.assert((SELECT count(*) FROM public.audit_log) = 0, 'nao ve o historico');
SELECT public.assert((SELECT count(*) FROM public.students) = 1, 've os alunos da escola');
SELECT public.assert((SELECT count(*) FROM public.teachers) = 2, 've os professores da escola');

INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes, price)
VALUES ('Caio', 'Dora', 'ana-julia', '2027-03-03 10:00-03', 60, 999);
SELECT public.assert((SELECT price FROM public.lessons WHERE start_at = '2027-03-03 10:00-03') = 200.00,
  'marca aula propria, mas o preco e o da escola (mandou 999)');
DO $$
BEGIN
  INSERT INTO public.lessons (student_name, guardian_name, teacher, start_at, duration_minutes)
  VALUES ('Caio', 'Dora', 'beto', '2027-03-04 10:00-03', 60);
  RAISE EXCEPTION 'FALHOU: marcou aula para outro professor';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao marca aula para outro professor';
END $$;
UPDATE public.lessons SET price = 1, notes = 'x' WHERE start_at = '2027-03-01 10:00-03';
SELECT public.assert((SELECT price FROM public.lessons WHERE start_at = '2027-03-01 10:00-03') = 200.00,
  'editar a aula nao muda o preco');
DO $$
BEGIN
  UPDATE public.lessons SET teacher = 'beto' WHERE start_at = '2027-03-01 10:00-03';
  RAISE EXCEPTION 'FALHOU: passou a aula para outro professor';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '  ok - nao passa a aula para outro professor';
END $$;
DELETE FROM public.lessons WHERE start_at = '2027-03-01 10:00-03';
SELECT public.assert((SELECT count(*) FROM public.lessons WHERE start_at = '2027-03-01 10:00-03') = 1, 'nao apaga aula (desmarca)');
UPDATE public.lessons SET status = 'realizada' WHERE start_at = '2027-03-01 10:00-03';
UPDATE public.settings SET default_lesson_price = 1;
UPDATE public.teachers SET name = 'invasor';
INSERT INTO public.students (student_name) VALUES ('Novo aluno');
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

SELECT public.assert((SELECT count(*) FROM public.wallet_transactions WHERE account_id = current_setting('teste.t')::uuid AND kind = 'lesson') = 1,
  'dar a aula como realizada gera a cobranca normalmente');
SELECT public.assert((SELECT default_lesson_price FROM public.settings WHERE account_id = current_setting('teste.t')::uuid) = 200.00,
  'nao mexe nas configuracoes');
SELECT public.assert((SELECT count(*) FROM public.teachers WHERE account_id = current_setting('teste.t')::uuid AND name = 'invasor') = 0,
  'nao mexe nos professores');
SELECT public.assert((SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.t')::uuid) = 2,
  'mas cadastra aluno novo');

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

-- Saindo do Pro: o app volta ao generico; o tipo e as palavras editadas ficam
-- guardados, sem valer.
UPDATE public.accounts SET plan = 'essencial' WHERE id = current_setting('teste.a24')::uuid;
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.u24'), true);
SELECT public.assert(NOT (public.my_vocabulary() ->> 'active')::boolean
                     AND (public.my_vocabulary() -> 'custom') = 'null'::jsonb
                     AND (public.my_vocabulary() ->> 'custom_saved')::boolean
                     AND (public.my_vocabulary() ->> 'business_model') = 'saude',
  'no Essencial fica generico, com o tipo e as palavras editadas guardados');
DO $$
BEGIN
  PERFORM public.set_custom_vocabulary('{"staff":{"s":"X","p":"Xs","g":"m"}}');
  RAISE EXCEPTION 'FALHOU: Essencial editou as palavras';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - Essencial nao edita as palavras';
END $$;

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

\echo '=== FIM ==='

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
\echo '--- 18. Virar Pro solta tudo, e rebaixar nao apaga nada ---'

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
COMMIT;

-- Rebaixar: mantem o que existe, so trava o proximo.
BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.platform_set_account_plan(current_setting('teste.e')::uuid, 'essencial');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.uae'), true);
SELECT public.assert((SELECT count(*) FROM public.students) = 6,
  'rebaixada, a empresa CONTINUA com os 6 alunos que ja tinha');
SELECT public.assert((SELECT count(*) FROM public.blocks WHERE block_type='recurring') = 1,
  'e com o bloqueio recorrente que ja tinha');
SELECT public.assert((SELECT count(*) FROM public.account_discounts) = 1,
  'e com o desconto que ja tinha');
-- Editar o que ja existe continua livre; so criar novo trava.
UPDATE public.students SET guardian_name = 'R1 editado' WHERE student_name = 'A1';
SELECT public.assert((SELECT count(*) FROM public.students WHERE guardian_name='R1 editado') = 1,
  'editar aluno existente continua funcionando');
-- Tirar um desconto continua livre, senao ela nao consegue desfazer.
SELECT public.assert((public.set_account_discount('A1','R1 editado', NULL, NULL) ->> 'removed') = 'true',
  'e tirar um desconto continua livre, para ela poder desfazer');
DO $$
BEGIN
  INSERT INTO public.students (student_name) VALUES ('A7');
  RAISE EXCEPTION 'FALHOU: criou o setimo aluno apos rebaixar';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '  ok - mas criar o proximo trava de novo';
END $$;
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
\echo '=== FIM ==='

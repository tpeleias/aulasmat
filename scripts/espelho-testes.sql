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
-- Desde 20260924070000 o Pro nao traz o assistente: so a liberacao do gestor.
SELECT public.assert(public.account_can('assistant') = false, 'mas o assistente continua bloqueado ate o gestor liberar');
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

\echo ''
\echo '--- 27. Assistente so com liberacao do gestor, em qualquer plano ---'

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('27000000-0000-0000-0000-000000000001', 'nova@x', '{"signup_kind":"school","school_name":"Clinica Nova","teacher_name":"Dra Ana"}');
SELECT set_config('teste.a27', (SELECT account_id::text FROM public.user_roles WHERE user_id = '27000000-0000-0000-0000-000000000001'), false);

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27000000-0000-0000-0000-000000000001', true);
SELECT public.assert(public.account_plan() IN ('pro', 'pro_solo') AND public.account_can('assistant') = false,
  'empresa nova, no teste do Pro, nasce sem assistente');
SELECT public.assert((public.my_plan() ->> 'assistant') = 'false' AND (public.my_plan() ->> 'assistant_override') = 'false',
  'e a tela recebe "nao liberado" (e nao a venda do Pro)');
COMMIT;

BEGIN;
SET LOCAL SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('teste.op'), true);
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.a27')::uuid, NULL, true) ->> 'assistant') = 'true',
  'o gestor libera');
SELECT public.assert((public.platform_set_account_plan(current_setting('teste.a27')::uuid, NULL, false) ->> 'assistant') = 'false',
  'e bloqueia de novo');
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
DO $$
BEGIN
  UPDATE public.teachers SET active = true WHERE name = 'p2';
  RAISE EXCEPTION 'FALHOU: Solo reativou um segundo profissional';
EXCEPTION WHEN check_violation THEN RAISE NOTICE '  ok - no Solo, so 1 profissional ativo';
END $$;
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
SELECT public.assert((SELECT count(*) FROM public.students WHERE account_id = current_setting('teste.a29')::uuid AND plan_locked) = 8,
  'com a trava de rebaixamento (nada apagado, clientes pausados)');
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
  'no teste gratis (Pro) nao tem assistente');
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
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.a33')::uuid),
  'no Pro sem o adicional, sem assistente');
-- Pro com o adicional comprado: tem.
SELECT public.billing_apply_subscription(current_setting('teste.a33')::uuid, 'cus_33', 'sub_33', 'active', 'pro_solo', 'month', now() + interval '1 month', true);
SELECT public.assert(public.account_can('assistant', current_setting('teste.a33')::uuid),
  'Pro com o adicional: tem assistente');
-- Cancelou: nada.
SELECT public.billing_apply_subscription(current_setting('teste.a33')::uuid, 'cus_33', 'sub_33', 'canceled', NULL, NULL, NULL, false);
SELECT public.assert(NOT public.account_can('assistant', current_setting('teste.a33')::uuid),
  'cancelou: sem assistente');


\echo ''
\echo '--- 34. Limite do assistente por plano; um admin por empresa ---'

SELECT public.assert((SELECT messages FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 100
                     AND (SELECT cost_usd FROM public.assistant_limits(current_setting('teste.a33')::uuid)) = 3,
  'Pro (ou sem plano pago): 100 mensagens, teto US$ 3');
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

\echo '=== FIM ==='

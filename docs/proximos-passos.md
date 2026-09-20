# Próximos passos

Notas de planejamento entre Thiago e o Claude. Não é documentação do produto —
é um bloco de notas para retomar trabalho entre conversas sem precisar reler
um chat inteiro. Atualize/apague itens conforme forem resolvidos.

## Fila de itens pequenos (prontos para implementar)

Os 3 itens abaixo foram implementados (typecheck, lint no nível já existente
no projeto, testes e build de produção passando):

1. ~~Ícone "A" ao salvar o site na tela de início do iPhone/iPad~~ — feito.
   Gerado `public/apple-touch-icon.png` (180×180, arte do `ic_launcher.png`
   composta sobre o fundo `#20232B`) e adicionada a tag
   `<link rel="apple-touch-icon">` em `index.html`.

2. ~~Editar aula recorrente: perguntar "só esta" ou "esta e as futuras"~~ — feito.
   Implementada a via de **inferência** em `LessonDialog.tsx`: ao salvar a
   edição de uma aula existente, busca outras aulas do mesmo aluno/professor,
   ainda `agendada`, no mesmo dia da semana e horário, com data futura. Se
   achar alguma, pergunta (via `confirm()`) se aplica a alteração só a esta
   ou a esta e às futuras; ao aplicar a todas, reaplica o novo horário
   (hora:minuto) mantendo a data de cada ocorrência, e não toca em
   `status`/`class_summary`/`payment_status` de cada uma.

3. ~~Aula cancelada aparece em vermelho na agenda~~ — feito.
   `CalendarPage.tsx`: `status === "cancelada"` agora prioriza
   `bg-destructive/15` / `border-l-destructive`, com nome tachado
   (`line-through`).

Pendente (deixado para depois, a pedido do Thiago): um 4º item ainda não
escrito neste arquivo — perguntar a ele qual é antes de seguir.

## Extras feitos na mesma sessão (não estavam na fila original)

- ~~Símbolo do Lovable aparecendo no site~~ — feito. `favicon.ico` era
  literalmente o logo do Lovable (coração gradiente); trocado pela arte do
  app. Também removidos `meta author`/`twitter:site` "Lovable" e a imagem de
  preview hospedada em `lovable.app` (og:image/twitter:image agora apontam
  pro ícone do próprio app).
- ~~Ícone borrado ao instalar o site como atalho pelo navegador~~ — feito.
  Faltava `public/manifest.json` com ícones em resolução adequada (o
  navegador esticava o favicon pequeno). Criados `pwa-192.png`/`pwa-512.png`
  e o manifest, referenciados em `index.html` junto com `theme-color`.

## Dois lugares publicados — Netlify e Lovable

Descoberto nesta sessão: o projeto nasceu no Lovable e continua existindo
lá, sincronizado por GitHub com este mesmo repositório (mesmo `main`).
São publicações **independentes**, cada uma exige sua própria ação:

- **Netlify** (`tpeleias.netlify.app`, site "oficial"/produção): publica
  sozinho a cada push no `main`, sem ação extra.
- **Lovable** (`aulasmat.lovable.app`, projeto "Site - Aulas",
  id `0060e038-c986-4361-94a6-f56077ed8118`): o código sincroniza sozinho
  do GitHub (`latest_commit_sha` do projeto acompanha o `main`), mas **não
  fica visível pra quem acessa o link até chamar `deploy_project`**
  explicitamente. Depois de mesclar um PR, se quiser esse link também
  atualizado, published de novo por lá.
  - O link `id-preview--0060e038-...lovable.app` é o de rascunho/edição,
    não o publicado — evitar divulgar esse, usar `aulasmat.lovable.app`.

Favicon é um recurso com cache próprio do navegador (não é o cache normal
de página) — depois de publicar, pode continuar mostrando o ícone antigo
por um tempo até em aba anônima; testar abrindo `/favicon.ico` direto pela
barra de endereço é o jeito confiável de confirmar se o servidor já está
com o arquivo certo, sem depender do cache do ícone da aba.

## Multi-empresa (SaaS) — EM ANDAMENTO

Contexto: não é "adicionar professores" à escola do Thiago — são **empresas
clientes independentes**, cada uma com o próprio negócio, próprios alunos e
próprios dados. Thiago não deve (nem quer) ver os dados delas.

### A decisão foi revertida, e por quê

A decisão anterior (registrada aqui antes) era **não** fazer a cirurgia
multi-tenant e usar uma instância isolada por empresa: banco Supabase próprio
+ site Netlify próprio para cada uma. O motivo era medo de vazar dados entre
empresas.

O argumento que inverteu isso: **o risco de vazamento é menor agora do que
será depois.** Hoje só existe uma empresa no banco, então um erro de regra de
acesso não expõe nada de ninguém. Fazendo a cirurgia com 3 empresas reais já
rodando, cada erro vira dado de criança real exposto a estranho. Esperar
torna a cirurgia mais perigosa, não mais segura.

Além disso, o modelo de instâncias isoladas tinha um custo que não estava
visível quando foi decidido: o `.aab` da Play Store tem o endereço do banco
gravado dentro dele no momento do build. Cada empresa precisaria do **próprio
app na Play Store** — outro appId, outra ficha, outra revisão do Google e
possivelmente outro ritual de 12 testadores por 14 dias. Ou seja, por cliente:
outro site, outro login sem nenhuma relação com o seu, e outro app na loja.

### O plano: 4 partes

1. **Fundação** — `account_id` nas tabelas + regras de acesso por empresa ✅ FEITO
2. **Rotinas do banco** — as funções `SECURITY DEFINER` ✅ FEITO
   (o endereço próprio por empresa continua pendente: depende de comprar domínio)
3. **Rotinas com chave mestra** — as 6 edge functions com `service_role` ✅ FEITO
4. **Empresa fake + teste de invasão** ✅ FEITO

### O que já está aplicado na produção

- Tabela `accounts` + `current_account_id()` / `public_account_id()`
- `account_id` em 11 tabelas, com `DEFAULT current_account_id()` — é esse
  default que mantém as ~97 chamadas do app funcionando sem alteração
- As 27 políticas RLS reescritas: "admin" virou "admin **desta** empresa"
- `settings` deixou de ser linha única (`check id = 1`); `teachers.name`
  passou a ser único por empresa
- **O assistente de IA escopado por empresa** (antecipado da parte 3): as 11
  ferramentas dele filtram por empresa, e sem empresa ele recusa
- `handle_new_user` coloca o cadastro na empresa dona do endereço
- Uma empresa pode ser marcada como dona do endereço padrão
  (`is_public_default`), para a página pública não fechar quando aparecer a
  segunda empresa
- Front-end: removido o `id = 1` fixo das consultas de `settings` (10 lugares)

### O teste de invasão (feito na produção, com a conta da Empresa X)

Tentativas de LEITURA, todas devolvendo zero: aulas, alunos, carteira,
histórico, bloqueios, exceções, lições, entregas, materiais, outras empresas,
professores alheios, configuração alheia (chave pix), e as rotinas
`get_busy_ranges`, `get_recurring_blocks`, `get_busy_ranges_by_teacher`
(pedindo explicitamente pelo professor da outra empresa),
`get_recurring_blocks_by_teacher` e `get_child_lessons`. 17 de 17 em zero.

Tentativas de ESCRITA, todas bloqueadas: alterar aulas, chave pix, alunos e
carteira da outra empresa (0 linhas alcançadas); criar aula e criar aluno
dentro dela (recusado pelo banco com "new row violates row-level security
policy"); e mover o próprio usuário para a outra empresa (0 linhas).

Ao final, os dados do Portal de Aulas seguiam intactos (94 aulas, 14 alunos,
83 lançamentos) e nenhum resíduo do teste ficou no banco.

### O que foi corrigido nas partes 2 e 3

- 9 funções `SECURITY DEFINER` passaram a filtrar por empresa. A mais grave era
  `student_account_matches`, que decide se um aluno vê uma aula e casava só por
  nome+responsável. Também `get_child_lessons` (liga aula e aluno por nome) e
  `recompute_payment_status` (mexe em dinheiro casando por nome)
- Criada `effective_account_id()`: a empresa de quem está logado, ou a dona do
  endereço quando não há login. É o que permite a página pública funcionar
  sem abrir para todas as empresas
- 4 edge functions escopadas. A pior era `admin-reset-student-password`: o
  admin de uma empresa redefinia a senha do aluno de outra **e recebia a senha
  nova na resposta**. `admin-create-user` não tinha checagem nenhuma - bastava
  estar logado, inclusive como aluno, para criar contas; não é chamada por
  nenhuma tela e o certo seria removê-la
- Tirados os nomes "Thiago" e "Mayara" de ~12 lugares do código (ver commit
  próprio). O pior era a função que decidia o professor do usuário logado:
  qualquer pessoa de qualquer empresa era saudada como Thiago

### Bugs que os testes pegaram antes de virarem problema

Vale registrar porque são o mesmo padrão e vão reaparecer na parte 2 e 3:

- `min(uuid)` não existe no Postgres
- **Três** rotinas gravam em tabelas marcadas por empresa sem dizer qual:
  `log_lesson_audit`, `sync_lesson_wallet` e `register_payment`. Todas
  contavam com o preenchimento automático, que é **vazio** quando quem
  escreve é uma rotina com chave mestra (sem usuário logado). A terceira
  chegou a quebrar o registro de pagamento pelo assistente em produção.
  A varredura que encontra esse padrão:
  `pg_get_functiondef` + regex por `INSERT INTO public.<tabela marcada>`
- Migration não idempotente: duas políticas criadas sem `DROP` do próprio
  nome antes, o que impediria rodar de novo depois de uma interrupção

### Como testar mudança de banco sem tocar na produção

Foi montado um Postgres 16 local que **reproduz a produção coluna por
coluna** (115/115): stubs do que o Supabase fornece pronto (`auth.uid()`,
papéis `anon`/`authenticated`, `storage`, `cron`, publicação de realtime) e
as migrations históricas replayadas por cima. Os testes rodam como o papel
`authenticated` com `request.jwt.claim.sub` — rodar como dono do banco
ignoraria RLS e daria falso "tudo certo".

Vale reconstruir isso na próxima sessão antes de mexer em RLS. Foi o que
pegou os bugs acima.

### Empresa de teste em produção

- **Empresa X** (slug `empresax`), login `testex` / senha `testex`
- É do amigo do Thiago, com dados inventados
- Verificado na produção: esse login enxerga 0 aulas, 0 alunos, 0 lançamentos
  e 0 linhas de histórico do Thiago; e o Thiago não enxerga o professor dela
- Nome é provisório, trocar é uma linha no banco

**A restrição anterior caiu:** login de aluno e de responsável já pode ser
distribuído. As rotinas que casavam aluno por nome+responsável agora exigem a
mesma empresa dos dois lados, e isso foi verificado no teste de invasão.

O que ainda pede cuidado antes de tratar como produção de verdade: a empresa
sem endereço próprio não tem página pública de horários (só o lado logado), e
o WhatsApp e o e-mail da política de privacidade ainda são os do Thiago.

### O que falta

- **Endereço próprio por empresa** (`empresax.dominio.com.br`). É o único item
  das partes 2-4 que não dá para fazer sem comprar um domínio. Sem ele, só a
  empresa marcada como `is_public_default` tem página pública de horários; as
  demais funcionam normalmente no lado logado
- **WhatsApp por professor**: hoje são colunas `whatsapp_thiago` e
  `whatsapp_mayara` em `settings` - o nome está no próprio banco. O lugar certo
  é uma coluna em `teachers`
- **E-mail de contato da política de privacidade**: está cravado em
  `PrivacyPolicy.tsx`. Deveria ser um campo por empresa

### Achados à parte, para resolver em algum momento

- `pix_key`, `payment_link` e os WhatsApps ficam em `settings`, que é legível
  por qualquer visitante não logado. Já era assim antes da multi-empresa.
  Agora está escopado por empresa, mas expor esses campos ao público merece
  decisão à parte
- `settings` tem colunas `whatsapp_thiago` e `whatsapp_mayara`, cravadas nos
  nomes — outra empresa tem outros professores. Generalizar
- A tabela `lessons_payment_status_backup_20260912` é um backup manual de
  setembro com dados reais de alunos e não é escopada por empresa. Avaliar
  se ainda é necessária; se não for, apagar

### O robô do Google Play marcando aulas (19/09) — resolvido

Aulas apareciam sozinhas na agenda, duas vezes: 33 na madrugada de 19/09 e
22 na tarde do mesmo dia. Não era bug de marcação nem ação do professor.

Era o **robô do Relatório de pré-lançamento do Google Play**. A cada `.aab`
enviado, o Google instala o app em aparelhos reais e solta um crawler que toca
em tudo por alguns minutos. As sessões em `auth.sessions` vieram de IPs
`66.249.*` e `74.125.*` (Google) num `Android 11; OnePlus8Pro ... wv`, e cada
leva de aulas começou segundos depois de um login. O robô varreu o domingo
inteiro, 08:00 às 20:00, hora por hora.

Ele conseguiu entrar porque o Play Console guarda **credenciais de conta de
teste** para o robô passar da tela de login — e o `.aab` aponta para o banco de
produção. As fechaduras da multi-empresa seguraram: ele só mexeu nas aulas do
próprio aluno dele, não tocou em configurações, alunos nem em outras empresas.

O que ficou, além de apagar as credenciais no Play Console:

- `lessons_sem_sobreposicao` (migration `20260919120000`): o banco recusa duas
  aulas no mesmo horário do mesmo professor, na mesma empresa. Canceladas não
  contam. Vale para o portal do aluno, a tela de admin e o assistente de IA,
  porque a regra está no banco e não na tela
- A constraint precisa de `public.lesson_span()`, marcada `IMMUTABLE`. Ela
  existe porque `timestamptz + interval` é `STABLE` (intervalos com dias/meses
  dependem do fuso) e índice exige `IMMUTABLE`. Só minutos entram ali, que são
  deslocamento absoluto — conferido em 5 fusos e numa virada de horário de
  verão. **Se a duração um dia passar a ser contada em dias ou meses, essa
  função deixa de poder ser `IMMUTABLE` e o índice apodrece em silêncio**
- Confirmação antes de agendar no portal do aluno: um toque não cria mais aula
- O botão do portal do aluno só volta a funcionar depois que a lista recarrega.
  Era isso que deixava marcar o mesmo horário duas vezes em 3 segundos
- `src/lib/lessonErrors.ts` traduz o erro 23P01 do Postgres, que é ilegível

**Onde ficam as credenciais** (corrigindo um palpite errado): não é em Testes →
Relatório de pré-lançamento → Configurações, que estava vazio e marcado para
não usar credenciais. É em **Conteúdo do app → Acesso ao app**, onde o Google
obriga a informar um login quando o app tem tela de entrada. Essas credenciais
**não podem ser apagadas**: sem elas o revisor não vê o app e a submissão pode
ser recusada. O certo é apontá-las para uma empresa descartável.

Não deu para determinar se o robô pegou a senha do "Acesso ao app" ou se
simplesmente adivinhou (o login era `teste`, no estilo `testex`/`testex`; o
crawler preenche campos com palavras genéricas). Os dois caminhos pedem a mesma
correção, então a causa exata ficou sem resposta de propósito.

**A empresa "Demonstração"** foi criada para isso: slug `demo`, dois professores
fictícios (ana, bruno), um aluno fictício e 4 aulas, para a tela não parecer
quebrada na revisão. Login `demo`, e a senha está no Play Console em Acesso ao
app. Verificado: esse login enxerga 4 aulas fictícias e nada da produção.

Dois cuidados ao criar login novo por SQL, ambos aprendidos errando:

1. O gatilho `handle_new_user` joga todo usuário novo na empresa pública, que é
   a de produção. É preciso realocar o `user_roles` na mesma transação, senão o
   login nasce dentro da empresa real.
2. `auth.users` tem colunas de texto que precisam ser `''`, nunca `NULL`:
   `confirmation_token`, `recovery_token`, `email_change` e
   `email_change_token_new`. O serviço de autenticação lê esses campos como
   texto e quebra em `NULL` — a senha confere e o login falha assim mesmo, sem
   dizer por quê. O jeito de conferir é comparar o usuário novo com um que já
   funciona, coluna por coluna:

   ```sql
   SELECT c.column_name
   FROM information_schema.columns c
   WHERE c.table_schema='auth' AND c.table_name='users'
     AND (SELECT to_jsonb(u)->>c.column_name FROM auth.users u WHERE u.email='<que funciona>') IS NOT NULL
     AND (SELECT to_jsonb(u)->>c.column_name FROM auth.users u WHERE u.email='<o novo>') IS NULL;
   ```

**`allow_student_booking` está DESLIGADO na empresa de produção.** Foi o que
cortou o sangramento: mesmo depois da trava contra sobreposição, o robô criou
mais 23 aulas, porque a trava impede duplicata e não impede varredura. Desligar
não custou nada — o histórico mostra que nenhum aluno de verdade jamais marcou
aula pelo portal (as 118 aulas reais vieram de admin ou do assistente). Para
religar: Configurações → Portal do Aluno → "Permitir que alunos agendem aulas
diretamente".

**Não houve vazamento.** Verificado com as regras de acesso do login do robô:
ele lê só o próprio cadastro e a lista de professores. Zero aulas, zero
financeiro, zero nomes de outros alunos.

**Estado final.** O Play Console aponta para o login `demo`. A senha do login
`teste` foi trocada por uma forte e as sessões dele derrubadas; ele continua
existindo, na empresa de produção, para testar o portal do aluno com dados
reais. As senhas dos dois ficam no Play Console e no gerenciador do professor,
não aqui.

Não dá mais para saber se o robô adivinhou a senha antiga ou a leu do "Acesso
ao app": a senha antiga foi sobrescrita sem ser testada antes. A pergunta ficou
sem resposta, e não é mais respondível por esse caminho.

**Pendente:** religar `allow_student_booking` na empresa de produção depois que
o PR #15 for mesclado e a confirmação estiver publicada (Configurações →
Portal do Aluno). Até lá o portal do aluno fica só para visualização.

### Ainda não decidido

- Ativar/desativar por pagamento: rastrear quem pagou pode ser uma planilha
  por enquanto; não construir infra de cobrança antes de validar se alguém paga
- Domínio próprio (~R$ 40/ano) com subdomínio por empresa
  (`empresax.dominio.com.br`) — vira necessário na parte 2, porque é assim
  que a página pública sem login descobre de qual empresa é
- O nome do produto (a conversa sobre nomes não chegou a uma escolha)

## Como retomar

Numa conversa nova: aponte para este arquivo (`docs/proximos-passos.md`) em
vez de continuar uma conversa antiga e longa — custa bem menos crédito, porque
não precisa reprocessar o histórico inteiro a cada mensagem.

## Solicitação de aula em vez de marcação (20/09) — feito

Pedido do Thiago: quando o aluno marca, não é marcação, é **solicitação**. O
professor aprova e só então a aula existe. E antes de enviar, o app pergunta
"Deseja solicitar este horário?".

A confirmação já existia no código (veio no PR #15), mas o Thiago ainda via o
toque marcando direto — provavelmente porque a versão publicada era anterior.
Agora ela pergunta e o que ela envia é um pedido, não uma aula.

### Dois status novos

- **`solicitada`** — o aluno pediu, o professor não respondeu. **Ocupa** o
  horário. Ocupar é o que evita duas famílias pedindo o mesmo slot e o professor
  tendo que recusar uma por conflito.
- **`recusada`** — o professor disse não. **Não** ocupa. Foi por isso que a
  constraint `lessons_sem_sobreposicao` e as duas funções de horário livre
  passaram de `status <> 'cancelada'` para `NOT IN ('cancelada','recusada')`:
  sem isso, recusar queimaria o horário para sempre — o mesmo bug que a
  migration `20260912010946` consertou para as canceladas.

### A trava de verdade é no banco, não na tela

A política `students insert own lessons` passou a exigir `status = 'solicitada'`
no `WITH CHECK`. Sem isso, a exigência de aprovação viveria só no código da
tela: quem chamasse a API direto com o token do próprio responsável continuaria
criando aula pronta. Vale lembrar quem fez as 55 aulas de 19/09 — um crawler
batendo na API, não uma pessoa clicando.

O aluno também não consegue promover o próprio pedido: ele nunca teve política
de `UPDATE` em `lessons`. Conferido em `pg_policy`, e coberto por teste.

### Um pedido não vira dinheiro

Esse era o jeito mais fácil de a mudança criar cobrança falsa, e por isso está
testado: `sync_lesson_wallet` só lança cobrança em `realizada`, e
`mark_past_lessons_realizada` só varre `agendada`. Então um pedido que o
professor não respondeu e cuja hora passou continua pedido — não vira aula
realizada, e não vira cobrança. **Se algum dia essa função passar a varrer
outros status, pedido esquecido vira dívida de aula que não houve.**

### O que mudou na tela

- Portal do aluno: "Solicitar aula", com a confirmação dizendo que o horário
  fica reservado até a resposta. Card "Seus pedidos" nas telas do aluno — é por
  ali que a família descobre se foi aprovado ou recusado. O selo de valor
  sumiu de pedido e de aula descartada: mostrar preço ali fazia parecer dívida
  por aula que ninguém confirmou.
- Tela Hoje do professor: seção "Solicitações de aula" no topo, com Aprovar e
  Recusar (recusar pede confirmação). Fica acima de tudo porque é a única coisa
  da tela em que alguém está esperando resposta. Pedido com hora já passada
  aparece marcado, em vez de envelhecer em silêncio.
- Agenda: pedido com borda tracejada; recusada risca em vermelho junto das
  canceladas.
- `src/lib/lessonStatus.ts` concentra os rótulos e os dois testes
  (`isRequest`, `isDiscarded`). Com três status dava para espalhar strings por
  quinze telas; com cinco não dá.
- Assistente de IA: conhece os dois status e responde pedidos por
  `update_lesson`.

### Como foi verificado

Espelho local do Postgres reconstruído (vale a pena: pegou a ordem errada do
`handle_new_user` de novo). 37 migrations replayadas sobre stubs do Supabase, e
**15 casos rodando como o papel `authenticated`**, todos passando:

| Caso | Resultado |
|---|---|
| Aluno pede horário livre | aceito como `solicitada` ✅ |
| Aluno tenta inserir `agendada` | barrado pela RLS ✅ |
| Aluno tenta inserir `realizada` | barrado pela RLS ✅ |
| Segundo pedido no mesmo horário | recusado (23P01) ✅ |
| Aluno tenta aprovar o próprio pedido | 0 linhas ✅ |
| Pedido pendente aparece como ocupado | sim ✅ |
| Professor aprova | 1 linha, sem cobrança ✅ |
| Recusada sai dos horários ocupados | sim ✅ |
| Horário recusado pode ser pedido de novo | sim ✅ |
| Pedido vencido continua `solicitada` | sim, sem cobrança ✅ |
| Mesmo horário e professor, outra empresa | aceito ✅ |
| Aula realizada gera 1 cobrança | sim ✅ |

Migration aplicada 3× seguidas (idempotente). `tsc`, `build` e testes limpos.
Aplicada na produção e conferida: trava e política no lugar, 99 aulas e 83
lançamentos intactos, nenhuma linha nos status novos. Edge function
`assistant-chat` republicada (versão 11) — não deu para bater nela por HTTP
daqui, porque o proxy do ambiente bloqueia o host; a conferência foi ler a
fonte de volta do servidor e comparar com o repositório.

### O que ficou de fora, de propósito

- **O aluno não pode retirar o próprio pedido.** Um toque errado prende o
  horário até o professor recusar. Não é regressão (ele também não podia
  cancelar antes), mas com pedido ocupando horário incomoda mais. Seria uma
  política de `UPDATE` bem estreita: só `solicitada` → `cancelada`, e só a
  própria.
- **`price` ainda vem do cliente.** `StudentBooking` manda `price: 220` fixo,
  então um responsável poderia mandar outro valor pela API. Hoje não vira
  dinheiro (cobrança só nasce em `realizada`, e o professor vê o valor ao
  aprovar), mas o certo é o valor vir do servidor.
- **`class_summary` no insert do aluno.** Nada impede o aluno gravar o "resumo
  da aula", que é texto do professor. É anterior a esta mudança e não tem a ver
  com ela, então ficou fora do diff para não misturar as coisas.
- **Nenhuma notificação.** O professor descobre o pedido abrindo o app (a lista
  atualiza sozinha por realtime, mas não há push nem e-mail). Se o pedido ficar
  dias sem resposta, ninguém avisa.
- **Pedido vencido não expira sozinho.** Fica `solicitada` para sempre, só
  marcado na tela como "horário já passou".

### Dívidas da lista anterior que continuam abertas

Foram priorizadas e depois deixadas de lado quando o Thiago redirecionou para o
fluxo de solicitação. As quatro seguem valendo:

1. E-mail da política de privacidade por empresa (`PrivacyPolicy.tsx` ainda tem
   o e-mail cravado).
2. Fechar `pix_key`/`payment_link` ao visitante não logado. O caminho mapeado é
   um **allowlist** de colunas para o papel `anon` em `settings`, não um
   denylist: coluna nova nasce fechada, e quem precisar dela no site público
   diz isso explicitamente. Conferido que todas as consultas anon já pedem
   colunas nomeadas (só `useAppSettings` e `SettingsPage` usam `select("*")`, e
   os dois são `authenticated`).
3. Apagar a edge function `admin-create-user` (nenhuma tela chama — conferido
   por grep).
4. `lessons_payment_status_backup_20260912`: 84 linhas com dados reais, fora do
   escopo por empresa, e **não nasceu de migration** — foi backup manual no
   dashboard. Por isso o replay do espelho precisa de um stub dela.

Achado à parte, do mesmo naipe: o papel `anon` tem `TRUNCATE` em `settings` (e
provavelmente em todas as tabelas — é o padrão do Supabase). RLS não cobre
`TRUNCATE`. Não é alcançável pelo PostgREST, então não é urgente, mas é um grant
que ninguém usa.

## As quatro dívidas da lista (20/09) — três fechadas, uma devolvida

### 1. E-mail da privacidade por empresa ✅

`contact_email` em `settings`, campo na tela de Configurações (card "Contato"),
e `PrivacyPolicy.tsx` lendo do banco. O e-mail do Thiago foi preenchido só na
empresa dona do endereço público; Empresa X e Demonstração ficaram nulas.

Nulo **esconde o parágrafo** em vez de mostrar outro e-mail: a página passa a
pedir que a família fale com o professor. Mostrar o e-mail errado é pior que não
mostrar nenhum — convida a família a escrever para um estranho sobre os dados do
filho.

### 2. `pix_key` e `payment_link` fechados ao visitante ✅

O `anon` perdeu o SELECT na tabela inteira e ganhou uma lista explícita:
`id, account_id, work_start, work_end, slot_minutes, scarcity, contact_email`.

**É allowlist e não denylist de propósito.** Revogar só as duas colunas
sensíveis de hoje deixaria a próxima coluna sensível exposta em silêncio,
porque ninguém lembra de voltar na migration ao adicionar uma. Assim coluna
nova nasce invisível para o visitante, e quem precisar dela no site público diz
isso explicitamente.

**O preço:** `select("*")` como `anon` passa a falhar. Conferido antes de
aplicar que nenhuma das 4 rotas públicas faz isso — as consultas anônimas já
nomeiam colunas, e os dois `select("*")` que existem (`useAppSettings` e
`SettingsPage`) rodam autenticados. Há um teste cobrindo exatamente isso, para
não virar surpresa.

Aproveitando a mesma migration, o `anon` também perdeu INSERT/UPDATE/DELETE/
TRUNCATE em `settings`. RLS já barrava os três primeiros, mas **TRUNCATE não
passa por RLS** — é comando de tabela, não de linha. Não era alcançável pelo
PostgREST, então nunca foi buraco de verdade; era grant que ninguém usava.
**O mesmo vale para as outras tabelas, que seguem com TRUNCATE para `anon`.**

16 casos no espelho local, todos passando (anon não lê as sensíveis, lê as
públicas, não escreve, não trunca, e `select *` falha; admin logado continua
vendo tudo da própria empresa). Migration idempotente em 3 aplicações.

### 3. `admin-create-user` desativada ✅ (falta um clique seu)

Virou **lápide**: responde 410 a tudo e não importa o cliente do Supabase, então
não tem como alcançar a chave mestra nem o banco. Publicada (versão 4) e
conferida lendo a fonte de volta do servidor.

Por que lápide e não apagar: as ferramentas daqui publicam edge function, mas
não removem. Apagar só o arquivo do repositório deixaria a **versão antiga, com
a chave mestra, rodando na produção** e sem fonte para conferir — pior que
antes.

**Para terminar:** Supabase → Edge Functions → `admin-create-user` → Delete, e
remover o diretório do repositório.

### 4. Tabela de backup — NÃO apagada, decisão sua ⚠️

Eu ia apagar se ela fosse redundante. **Não é.**

- 84 linhas, 12 alunos reais, feita em 12/09
- **17 linhas têm `payment_status` diferente do que a tabela viva diz hoje**
- nenhuma aula do backup sumiu da tabela viva

Ou seja: ela guarda o estado de pagamento de antes da migration
`20260912022140` (a que passou a derivar o pagamento da carteira), e esses 17
casos são exatamente onde a derivação mudou a resposta. É o único lugar onde
isso existe. Se a derivação tiver errado com alguém, é aqui que se descobre.

Continua valendo que são dados reais de aluno numa tabela fora do escopo por
empresa. Ela está com RLS ligada e **sem nenhuma política**, então o app não a
alcança — só a chave mestra. Três caminhos:

1. **Deixar como está.** Inacessível pelo app, e o histórico continua existindo.
2. **Exportar e apagar.** Baixar as 84 linhas (ou só as 17 divergentes) pelo
   painel e então apagar a tabela. Tira dado real de aluno do banco sem perder
   o registro.
3. **Apagar direto**, aceitando perder a única cópia do estado anterior.

Me diga qual e eu faço.

### Dívida nova encontrada: `types.ts` está desatualizado

`src/integrations/supabase/types.ts` é gerado do banco e **não é regerado desde
antes do PR #13**. Ele ainda declara `whatsapp_thiago`, `whatsapp_mayara` e
`scarcity_weekday_*` em `settings` — colunas que já não existem — e não conhece
`scarcity`, `account_id` nem `contact_email` (este eu acrescentei à mão).

É por isso que o código está cheio de `as any` em volta de `settings`: os tipos
mentem, e o jeito de continuar trabalhando foi desligá-los. Não é urgente e não
quebra nada em execução, mas qualquer código novo que confie nesses tipos vai
quebrar em produção, não na compilação. Regerar é um comando
(`generate_typescript_types`), e o custo real é conferir os erros de tipo que
aparecerem quando a mentira sumir.

## `.aab` 1.2.0 (código 6) — o app com o fluxo de solicitação

Disparado o workflow `android-release.yml` na branch
`claude/app-implementation-continuation-b3ijx8`, run 6. Artefato
`aulas-play-1.2.0-6`, que baixa como `.zip` e precisa ser descompactado antes de
subir no Play Console. Expira 30 dias depois do build.

**Por que precisa de `.aab` novo:** `capacitor.config.ts` tem `webDir: 'dist'` e
não aponta para o site. O app **embute a tela** no pacote no momento do build, e
o `.env` está versionado, então o endereço do Supabase também entra ali. O site
do Netlify se atualiza sozinho a cada push no `main`; o app da loja, nunca — só
com pacote novo.

`versionCode` sai do número do run do workflow, então sobe sozinho e a loja
sempre aceita. `versionName` é o que você digita ao disparar.

**Atenção:** este `.aab` foi construído da branch, não do `main`. O app passa a
ter o fluxo de solicitação, mas **o site continua com o código antigo até a
branch ser mesclada.** Sem isso, o portal do aluno pelo navegador segue mandando
`status: "agendada"`, que o banco agora recusa.

Isso não é problema hoje porque nenhuma família tem acesso ainda — o Thiago está
só em testes. Mas é a ordem certa quando houver gente usando: mesclar primeiro,
deixar o Netlify publicar, e só então subir o `.aab`.

## O responsável pode retirar o próprio pedido (20/09) — feito

Enquanto nenhum admin respondeu, a família retira o pedido: botão "Retirar" no
card "Seus pedidos" e na lista de próximas aulas. O filho abre a mesma lista
pelo `/meu-painel` e **não** vê o botão — quem pede é o responsável, quem retira
é ele.

**Feito com função, não com política de UPDATE**, e a diferença é o ponto todo:
uma política de UPDATE diz quais LINHAS o aluno altera e como a linha fica
depois, mas **não diz quais COLUNAS ele mexeu**. O mesmo UPDATE que cancela
poderia trocar preço, horário ou o resumo da aula no caminho, desde que
terminasse em `cancelada`. Como a função `cancel_own_lesson_request` é quem
escreve, só o status muda, e só de `solicitada` para `cancelada`.

Segue valendo, e agora com teste: **o aluno não tem política de UPDATE em
`lessons`** (conferido na produção, 0 políticas). Ele tem uma porta estreita.

A função devolve código (`ok` / `ja-respondido` / `nao-encontrado` /
`sem-empresa`) e não mensagem, porque quem decide como falar com a família é a
tela. O caso que justifica isso é `ja-respondido`: um admin aprovou entre a
família abrir a tela e apertar o botão. A resposta certa ali não é "deu erro", é
contar o que aconteceu — e a tela recarrega a lista mesmo quando não deu certo.

Retirar vira `cancelada`, então o horário volta na hora para a vitrine e a
carteira não é tocada (cobrança só nasce em `realizada`). Ficou em `cancelada` em
vez de um sexto status porque `retirada` obrigaria a mexer na constraint, nas
duas funções de horário, nos rótulos e no enum do assistente — muito para o
ganho de distinguir "a família desistiu" de "eu desmarquei". Se essa distinção
passar a importar, é aí que vale o status novo.

13 casos no espelho local, todos passando — inclusive uma família tentando
retirar o pedido de outra da mesma empresa, a homônima de outra empresa tentando
o mesmo, retirar depois de aprovado, e o UPDATE direto do aluno ainda alcançando
zero linhas.

## Para quem o pedido vai: os ADMINS, não o professor da aula

Vale registrar porque é fácil supor errado. A lista de solicitações vive na tela
Hoje, que está sob `/admin` (exige `isAdmin`), e a consulta **não filtra por
professor**. A RLS escopa por empresa. Logo:

- todo admin da empresa vê **todos** os pedidos pendentes dela;
- o primeiro que aprovar faz valer;
- se o professor da aula também é admin, ele vê; se não é, não vê.

Não existe roteamento "pedido da aula da Mayara vai para a Mayara", e não havia
intenção de existir.

## REGRA PERMANENTE: são DOIS sites, e o Lovable não publica sozinho

Vale para qualquer conversa futura, não só para aquela em que foi escrita.

- **`aulasmat.lovable.app`** — é o que o Thiago usa no dia a dia (ele já morava no
  Lovable antes, e tem outros projetos lá). Sincroniza o código do GitHub
  sozinho, mas **só fica visível depois de um `deploy_project` explícito**.
- **`tpeleias.netlify.app`** — publica sozinho a cada push no `main`.

**Nenhum dos dois é mais importante que o outro.** As notas antigas chamavam o
Netlify de "oficial/produção" e isso foi repetido sem questionar; não há
superioridade técnica — os dois servem o mesmo `dist`, do mesmo commit, contra o
mesmo banco. A única diferença é que um publica sozinho e o outro não.

**Portanto: toda vez que mesclar no `main`, publicar no Lovable também**, sem
esperar o Thiago pedir. Projeto `0060e038-c986-4361-94a6-f56077ed8118`, slug
`aulasmat`.

Isso já custou um bug: em 20/09 o banco passou a exigir `status = 'solicitada'`
do aluno, o `main` foi mesclado, o Netlify publicou — e o Lovable não. O Thiago
testou pelo Lovable, caiu na tela antiga (que manda `agendada`) e levou um
`new row violates row-level security policy`. O sinal estava no título da tela:
"Agendar aula" é a versão velha, "Solicitar aula" é a nova.

**Conferir antes de dizer que está publicado:** `get_project` devolve
`latest_commit_sha`, que tem que bater com o `main`.

## O pedido passa a ter disciplina e assunto (20/09)

Ao solicitar um horário, a família agora preenche, dentro da mesma confirmação:

- **Disciplina** — obrigatória. O botão de enviar fica desabilitado sem ela. A
  matéria do professor escolhido aparece só como exemplo no placeholder, não
  preenchida: se viesse pronta ninguém pensaria no que está pedindo.
- **"O que você quer trabalhar?"** — texto livre, opcional. É o campo que muda a
  decisão: *"prova na sexta sobre função quadrática"* é outra conversa que um
  pedido em branco. Vai para `notes`.
- **Presencial ou on-line** — só aparece para aluno com endereço cadastrado.
  Antes o app **adivinhava** (com endereço = presencial, sem = on-line), e
  palpite não é resposta. Numa aula on-line o `address` vai nulo, porque
  endereço de aula que não acontece ali não diz nada.

Os três aparecem para quem aprova, na tela Hoje e no diálogo de recusa — coletar
sem mostrar não serviria de nada.

**Não precisou de migration:** `subject`, `notes` e `is_online` já existiam, e a
política de insert do aluno não restringe nenhuma delas (ela checa empresa,
vínculo do cadastro, `status = 'solicitada'` e o interruptor de agendamento).

## Cronys: nome, marca e ícones (20/09)

O app deixou de se chamar "Portal de Aulas" e passou a se chamar **Cronys**. A
identidade veio de `docs/cronys-brand-spec.md`, que o Thiago subiu no `main` e
que diz "todos os valores são finais; não improvisar variações". Nada de banco,
nada de RLS, nada de dados mudou.

### O que NÃO mudou, de propósito

- **`applicationId` continua `com.aulasmat.app`.** É a identidade da ficha na
  Play Store e não pode mudar num app já publicado: é por ele que o Android
  liga a atualização ao app instalado. Só sai num app novo, com ficha nova.
- **`Preferences.group` continua `AulasMatPrefs`.** É a chave do armazenamento
  no aparelho. Trocá-la não renomeia nada visível, só faz o app perder o que
  já guardou.
- **Páginas públicas (`PublicHome`, `PublicAvailability`) não viraram Cronys.**
  Elas são a vitrine do professor, não do produto — quem chega ali procura o
  professor.

### As três decisões que o spec não decidia

O spec define a marca para **fundo escuro**: todos os seis tokens dele
(navy, navy-2, gold, teal, ink, ink-dim) são de superfície escura, e não há
token nenhum de superfície clara. O app tem modo claro. Então:

1. **O modo claro é derivado**, com neutros quentes tirados do matiz do ink
   (42°), para o claro ser da mesma família e não um cinza azulado avulso.

2. **`--primary` no modo claro é o dourado escurecido** (`41 54% 34%`). O
   dourado do spec, `#c9a24b`, rende **2,4:1** sobre superfície clara, e
   `--primary` neste código não pinta só botão: pinta link, ícone e borda, em
   59 lugares. Como texto ele seria ilegível. O escurecido passa nos dois
   sentidos (4,94:1 como texto no fundo, 4,85:1 do ink sobre ele).

3. **O botão primário usa o dourado cheio mesmo assim**, via
   `bg-brand-gold text-brand-navy` em `ui/button.tsx`. Preenchimento não
   precisa de contraste contra a página — quem precisa é o texto por cima, e
   esse é navy: 7,58:1. Assim "gold: botões" do spec vale ao pé da letra sem
   levar junto os links.

Conferido, token a token: no modo claro e no escuro, todo par de texto/fundo
passa de 4,5:1. O único que estava raspando era o texto no vermelho destrutivo
(4,29:1, porque o texto por cima deixou de ser branco puro, como o spec pede);
o vermelho desceu de 52% para 48% de luminosidade e foi para 4,91:1.

### As fontes são auto-hospedadas

O spec diz "ambas via Google Fonts". São as **mesmas** Fraunces e Work Sans, só
servidas do próprio site (`public/fonts/`, ~117 KB somados): o app Android
embute os arquivos e roda sem internet, e um `<link>` para
fonts.googleapis.com cairia fora de rede — a marca apareceria em Georgia justo
na tela de abertura, que é a mais offline de todas. O byte muda de origem; a
fonte não muda.

### O que o desenho pede e o tamanho de 48px não dá

O ponteiro de segundos tem 3,5 de traço num quadro de 600: 0,58% do lado. Num
ícone de 48px isso dá **0,28 pixel** — ele não fica fino, ele não existe. O de
minuto (9/600) dá 0,72px e vira um fantasma.

**Não é problema para consertar.** Aos 96px, 192px e 512px — que é onde o ícone
é olhado de verdade (Play Store, PWA, aba em tela grande) — os três ponteiros
aparecem e são o desenho todo. A 48px o que sobra é o anel dourado com uma
marca no meio, e isso ainda lê. Fica anotado aqui para quem for mexer não achar
que "sumiu um ponteiro" e sair reescrevendo o spec.

### Os ícones não se editam à mão

São 28 arquivos (favicon em 3 tamanhos, PWA em 2, apple-touch, 5 densidades
Android × 3 variantes, 11 splash, og-image). Editar isso a mão garante que um
dia uma densidade fica com o desenho velho e ninguém descobre — o celular que
usa aquela densidade é que mostra o ícone errado.

O desenho existe **uma vez**, em `scripts/gerar-identidade.py`:

```bash
pip install pillow cairosvg
python3 scripts/gerar-identidade.py
```

A mesma geometria está em `src/components/brand.tsx` (o símbolo inline, que o
wordmark precisa para encostar no "r") e a mesma paleta em `src/index.css`. São
três lugares que precisam andar juntos, e cada um diz isso no comentário.

### Precisa de `.aab` novo

Sim. Ícone, nome e splash são do lado do app, que embute o `dist/`. Sobe pelo
workflow `Build Android release (Play)`, e o nome na ficha da Play (o "Nome do
app") muda no Play Console, à mão — o `.aab` sozinho não renomeia a ficha.

### Também mudou: os widgets da tela de início

Estavam no azul `#4E7FE6` e num magenta `#D946EF` que não são de marca nenhuma,
com texto em branco puro. Viraram navy + dourado + teal, e o branco puro virou
ink, como o spec manda. As bordas e véus de branco a 8-24% viraram ink nas
mesmas opacidades, que é o token `line` do spec.

O magenta era a cor da linha do professor "mayara" — nome **fixo no Java**
(`LessonsWidgetProvider.java`), que numa segunda empresa não quer dizer nada.
Dívida anotada, não resolvida aqui.

### Dívida descoberta no caminho: o `tsc` do projeto não é o da raiz

`npx tsc --noEmit` na raiz **não checa nada**: `tsconfig.json` tem
`"files": []` e só referências. O comando que checa de verdade é

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Rodando o certo, apareceu um erro de tipo em `LessonRequests.tsx` que entrou
nesta mesma sessão: `title` num ícone do lucide. Em runtime a prop caía no
`<svg>`, e `<svg title="">` não vira dica em navegador nenhum — ou seja, a dica
de "Aula on-line" e a do endereço nunca funcionaram. Corrigido: a dica foi para
um `<span title>` em volta.

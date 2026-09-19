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

Cuidado ao criar login novo por SQL: o gatilho `handle_new_user` joga todo
usuário novo na empresa pública, que é a de produção. É preciso realocar o
`user_roles` na mesma transação, senão o login nasce dentro da empresa real.

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

Pendente: trocar a senha do login `teste` (ou desativá-lo) depois que o Play
Console estiver apontando para o `demo`.

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

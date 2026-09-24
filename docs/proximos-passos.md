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

- **Netlify** (`cronys.netlify.app`, site "oficial"/produção): publica
  sozinho a cada push no `main`, sem ação extra.
- **Lovable** (`cronys.lovable.app`, projeto "Site - Aulas",
  id `0060e038-c986-4361-94a6-f56077ed8118`): o código sincroniza sozinho
  do GitHub (`latest_commit_sha` do projeto acompanha o `main`), mas **não
  fica visível pra quem acessa o link até chamar `deploy_project`**
  explicitamente. Depois de mesclar um PR, se quiser esse link também
  atualizado, published de novo por lá.
  - O link `id-preview--0060e038-...lovable.app` é o de rascunho/edição,
    não o publicado — evitar divulgar esse, usar `cronys.lovable.app`.

Favicon é um recurso com cache próprio do navegador (não é o cache normal
de página) — depois de publicar, pode continuar mostrando o ícone antigo
por um tempo até em aba anônima; testar abrindo `/favicon.ico` direto pela
barra de endereço é o jeito confiável de confirmar se o servidor já está
com o arquivo certo, sem depender do cache do ícone da aba.

## PRÓXIMO (combinado em 24/09 para fazer no dia seguinte)

Nada disso foi começado. Decisões do Thiago já tomadas estão marcadas como tal.

### 1. Planos novos (decidido: gostou da proposta)

| Plano | O que tem | Preço |
|---|---|---|
| Essencial | 1 profissional, até 5 clientes, nomes genéricos | grátis |
| Pro Solo | 1 profissional, clientes sem limite, palavras do ramo, pacotes, bloqueio recorrente | R$ 49/mês |
| Pro Equipe | até 5 profissionais, cada um com acesso próprio | R$ 99/mês + R$ 19 por profissional extra |
| Anual | qualquer Pro | 2 meses grátis |
| Assistente | adicional, liberado sob pedido, com limite de uso | R$ 29–39/mês |

- Preço de fundador para os primeiros 10–20 clientes (ex.: R$ 39 para sempre).
- No banco: hoje `accounts.plan` é 'essencial' | 'pro'. Vira 'essencial' | 'pro_solo' |
  'pro_equipe' (ou 'pro' + limite de profissionais). `plan_features` ganha
  `max_teachers` 1 no Solo e 5 no Equipe; o extra acima de 5 é cobrado, não bloqueado.
  As contas Pro de hoje precisam de um destino (Solo ou Equipe) - perguntar.

### 2. Cobrança automática (a decidir: Asaas ou Stripe)

- Asaas: Pix Automático, boleto, cartão, nota fiscal automática; profissional extra via
  atualização do valor da assinatura pela API (sem proporcional nativo).
- Stripe: Thiago já usou; profissional extra nativo (quantidade + proporcional); Pix
  recorrente a confirmar no Brasil; sem nota fiscal.
- Recomendação: Asaas, pelo público (pequeno negócio, Pix/boleto). Decisão é dele.
- O que construir: página /assinar no SITE (nunca no app - regra da Google Play), edge
  function do webhook (pago -> Pro com "pago até"; atraso -> aviso; após X dias de
  tolerância -> Essencial pela trava de rebaixamento que já existe), rotina diária de
  segurança igual à expire_trials, situação de cada empresa no painel do gestor, e
  profissional extra atualizando a cobrança quando muda o número de ativos.
- Começar no sandbox. Precisa do Thiago: CNPJ (ver enquadramento com contador), conta no
  provedor, chave da API nos segredos do Supabase, dias de tolerância.

### 3. Limite de uso do assistente por conta

- Tabela de uso por empresa e mês, gravando os tokens que a API devolve em cada resposta.
- assistant-chat confere o limite ANTES de chamar a API; passou, responde "limite do mês
  atingido" sem gastar nada.
- Limite mostrado ao cliente em conversas; controle interno por custo.
- Configurações mostra o uso do mês; painel do gestor mostra o gasto por empresa e deixa
  aumentar o limite à mão.
- Medir antes o custo real de uma conversa (logs das conversas existentes) para fechar o
  preço do adicional.
- Já está certo hoje: só admin usa o assistente (a edge function recusa quem não é admin
  daquela empresa, e o login de professor nem vê o menu).

### 4. Domínio cronys.com.br (comprado na GoDaddy, já no ar pelo Netlify em 24/09)

- Código: `src/lib/publicUrl.ts` ainda tem `https://cronys.lovable.app` como endereço
  padrão do app Android (convites, disponibilidade, redirect do cadastro). Trocar para
  `https://cronys.com.br` - vale no app só no próximo .aab.
- Thiago, no Supabase: Authentication -> URL Configuration -> Site URL
  `https://cronys.com.br` e Redirect URLs + `https://cronys.com.br/**` (manter os antigos).
- Netlify: conferir cronys.com.br como Primary domain (redireciona o .netlify.app).
- Play Console: política de privacidade -> `https://cronys.com.br/privacidade`,
  exclusão de conta -> `https://cronys.com.br/excluir-conta`.
- Página inicial pública (o que é, planos e preços, contato, termos/privacidade): o
  Stripe olha o site para aprovar a conta, e hoje a raiz é a tela de login.
- Stripe: decidido (Thiago já usou). O conector do Stripe apareceu nesta sessão;
  usar em modo de teste para criar produtos e preços. Descrição do negócio para o
  cadastro do Stripe já foi passada ao Thiago (SaaS por assinatura para negócios com
  hora marcada; fatura "CRONYS").
- Também pendente: SMTP próprio (Resend etc.) com remetente @cronys.com.br, e religar
  "Confirm email" no Supabase antes de abrir para clientes (está DESLIGADO para testes).

## Assistente só com liberação (24/09)

O assistente não vem mais com o Pro: fica bloqueado em qualquer plano, inclusive
no teste de 14 dias, até o gestor liberar a empresa no painel (switch
"Assistente"). Motivo: cada conversa custa dinheiro de verdade.

- Migration `20260924070000`: `account_can('assistant')` = `assistant_override`
  verdadeiro, e nada mais. Quem era Pro com o assistente pelo plano virou
  liberação explícita (na prática, só o Portal de Aulas).
- `my_plan()` devolve `assistant_override` falso quando nulo: é o que faz até o
  app antigo mostrar "fale com quem cuida da sua conta" em vez de vender o Pro.
- O painel do gestor até o app 1.10.1 manda "limpar a exceção" para LIGAR numa
  empresa Pro. `platform_set_account_plan` traduz isso (no Pro, limpar = liberar)
  para o botão antigo continuar funcionando. O painel novo manda sempre
  ligado/desligado explícito.

## Vários ramos de negócio (24/09)

O app deixou de ser só de aula particular. Cada empresa escolhe o ramo e a tela
troca as palavras: Professor/Médico/Mecânico, Aula/Consulta/Revisão,
Aluno/Paciente/Cliente, Responsável/Tutor, Escola/Clínica/Oficina e
Matéria/Especialidade/Serviço.

- **As tabelas NÃO foram renomeadas** (`lessons`, `teachers`, `students`
  continuam). Medido antes de decidir: 20 funções do banco, 67 consultas do app,
  9 edge functions e as colunas (`student_name`, `teacher`, `class_summary`)
  teriam de mudar, sem nada visível para o usuário. Se um dia valer a pena, o
  melhor momento é junto com trocar `lessons.teacher` (apelido em texto) por
  um `teacher_id` de verdade.
- **Banco** (migration `20260924060000`): `accounts.business_model` (nulo = não
  escolheu ainda) e `accounts.vocabulary` (palavras editadas, Pro). Funções
  `my_vocabulary()`, `set_business_model()`, `set_custom_vocabulary()`. Quem já
  existia virou `aulas`.
- **As palavras de cada ramo moram só no front-end** (`src/lib/vocabulary.ts`),
  com singular, plural e gênero. O banco não precisa delas: as mensagens de erro
  dele ficaram neutras e levam uma chave em `HINT`, que `src/lib/dbErrors.ts`
  traduz. Mensagem nova do banco que cite professor/aula/aluno deve seguir esse
  padrão.
- **Plano** (decisão do Thiago): as palavras do ramo, e editá-las, são do Pro
  (`plan_features.vocabulary`). No Essencial a tela fala genérico
  (Profissional, Atendimento, Cliente). O ramo pode ser escolhido em qualquer
  plano e fica guardado: a empresa nova nasce no teste do Pro e já vê as
  palavras dela; se o teste acaba sem contratar, volta ao genérico da noite
  para o dia, de propósito.
- **Primeiro acesso**: empresa nova (cadastro ou painel do gestor) nasce sem
  ramo, e o dono vê a tela de boas-vindas (`BusinessOnboarding`) antes de tudo.
  Depois troca em Configurações → Tipo de negócio.
- **Assistente**: a tela manda as palavras junto com a conversa e o prompt
  ganha uma nota de vocabulário. As regras do prompt continuam em
  professor/aula/aluno, que é como as ferramentas se chamam.
- Endereços (`/admin/alunos`, `/aluno`) e o domínio interno dos logins por
  usuário (`aluno.sistema.local`) **não mudam**: widgets, links salvos e
  logins existentes dependem deles.

Fica para depois:

- `PublicHome` e `PublicAvailability` são a vitrine da escola do Thiago (o texto
  fala de Matemática e Química). Viram página por empresa junto com o endereço
  próprio de cada uma.
- Módulos que só fazem sentido em escola (lição de casa, acesso de criança)
  continuam aparecendo para todos os ramos; o acesso de criança some só no
  ramo pet. Ligar/desligar módulo por ramo é o próximo passo natural.
- **Saúde e psicologia guardam dado sensível pela LGPD** (resumo da consulta,
  observações). A política de privacidade foi generalizada, mas não trata dado
  de saúde - rever com alguém da área antes de vender para clínica.
- O painel do gestor (`PlatformPage`) ainda não mostra o ramo de cada empresa.

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

- **`cronys.lovable.app`** — é o que o Thiago usa no dia a dia (ele já morava no
  Lovable antes, e tem outros projetos lá). Sincroniza o código do GitHub
  sozinho, mas **só fica visível depois de um `deploy_project` explícito**.
- **`cronys.netlify.app`** — publica sozinho a cada push no `main`.

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

## Os dois endereços viraram Cronys (20/09) — e o Netlify está parado

- **Netlify**: `tpeleias.netlify.app` → **`cronys.netlify.app`**. Renomear é só
  metadado, não precisa de build. O nome antigo morreu na hora e o Netlify
  libera ele para qualquer outra pessoa pegar.
- **Lovable**: `aulasmat.lovable.app` → **`cronys.lovable.app`**. Mesma coisa:
  o endereço antigo não responde mais.

O rótulo interno do projeto no Lovable ainda é "Site - Aulas". Não há como
renomear pela API; é um clique no editor.

### ⚠️ A política de privacidade da Play aponta para o endereço velho

O Thiago cadastrou `tpeleias.netlify.app/privacidade` no Play Console. Esse
endereço **não existe mais**. Política de privacidade quebrada é violação e
pode suspender o app, então trocar para `https://cronys.netlify.app/privacidade`
é urgente, não é arrumação.

### O Netlify não publica desde 02:54, e não é o main que está errado

Descobertas ao investigar:

1. O deploy publicado é o commit `8ed1aa7` — o de **antes** do Cronys. O
   `87f0a70` nunca subiu. Ou seja: a frase "o Netlify publica sozinho a cada
   push no main", que estava anotada aqui, **não se confirmou** desta vez.
2. Aquele deploy foi criado **via API, a partir de um zip**
   (`deploy_source: "api"`, `has_source_zip: true`), e não por um build do
   Netlify puxando do GitHub. Não existe `netlify.toml` no repositório nem
   workflow de deploy para o Netlify. Isso aponta para a integração do
   **Lovable** como quem alimenta o Netlify — não o GitHub direto.
3. Tentar publicar pela ferramenta do Netlify devolve **403 Forbidden**,
   enquanto renomear o site (que também é escrita) passou com o mesmo token.
   Escrita autorizada e deploy negado é a assinatura de conta bloqueada por
   limite — bate com o aviso de créditos que o Thiago recebeu.

**Consequência prática:** até os créditos voltarem, `cronys.netlify.app` serve
o build velho. A página `/privacidade` existe nele e abre normalmente (ela é
anterior ao Cronys), só que com o nome antigo. Quem está atualizado é o
`cronys.lovable.app`.

**Se a pressa for a Play:** apontar a política para
`https://cronys.lovable.app/privacidade` resolve na hora e com a marca certa,
sem depender de crédito nenhum.

## Valor da aula e desconto por família (21/09) — feito

Pedido do Thiago: poder mudar o próprio valor da aula sem reprogramar, e poder
dar desconto (em R$ ou em %) para um responsável específico — numa aula só, no
que está em aberto, ou em todas.

### O valor da aula saiu do código

R$ 220/h estava escrito literalmente em seis lugares: o `DEFAULT` da coluna
`lessons.price`, `LessonDialog`, `BillingPage`, o portal da família e o prompt
do assistente de IA. Agora é `settings.default_lesson_price`, uma linha por
empresa, editável em **Configurações → Valor da aula**.

Detalhe que decidiu o desenho: o preenchimento virou **gatilho**
(`lessons_fill_price`), não `DEFAULT` de coluna. Um `DEFAULT` não enxerga as
outras colunas da própria linha, e é `account_id` que decide o preço. Fosse uma
função baseada na empresa "em vigor", o assistente de IA — que grava com chave
mestra, sem usuário logado — cairia na empresa do endereço público e carimbaria
o preço do Thiago dentro da aula de outra empresa. Está coberto por teste.

Quem cria aula agora **omite** o preço (portal da família e assistente) e deixa
o banco preencher. Mudar o valor vale para as próximas aulas; as que já estão na
agenda ficam com o valor que tinham.

### O desconto tem duas formas, de propósito

A regra que não mudou: **toda aula entra pelo valor cheio e todo desconto é
crédito na carteira.** Reescrever `lessons.price` por família foi tentado e
rejeitado em 20260912050000, porque aula reprecificada faz o extrato deixar de
fechar em zero.

- **Desconto fixo da família** (`account_discounts`, um por conta): o banco
  lança o crédito sozinho a cada aula realizada. É sempre **recalculado** a
  partir do desconto vigente — mudar o percentual recalcula as aulas
  realizadas, tirar o desconto apaga esses créditos. Não há estado meio-velho.
- **Abatimento pontual** (uma aula, ou tudo o que está em aberto): entra como
  voucher **sem `lesson_id`** e fica parado onde está. É isso que separa os
  dois: voucher com aula é do gatilho, voucher sem aula é de quem lançou à mão,
  e o gatilho nunca encosta no segundo.

Em reais, o desconto sai de **cada** aula (não do total) e nunca passa do valor
dela — abater mais que a aula custa viraria crédito do nada. `src/lib/discount.ts`
espelha `public.lesson_discount`; os dois têm os mesmos casos de teste, porque
divergir faria a tela prometer um desconto e a carteira lançar outro.

O desconto é da **conta**, não do aluno: havendo responsável, dois irmãos
dividem o mesmo desconto — a mesma regra de `accountKey`.

### Buraco de segurança encontrado no caminho ⚠️

Ao testar a função nova, que nasceu copiando a guarda de `register_payment`:

```sql
IF NOT (has_role(auth.uid(), 'admin')
        OR current_user IN ('postgres', 'service_role', 'supabase_admin')  -- <—
        OR <claim role = service_role>) THEN RAISE EXCEPTION 'not allowed';
```

Dentro de uma função `SECURITY DEFINER`, **`current_user` é o dono da função**
(postgres), nunca quem chamou. A segunda condição era sempre verdadeira e a
guarda inteira passava para qualquer um. Na prática: **qualquer responsável
logado podia chamar `register_payment` pela API e creditar o que quisesse na
própria carteira, zerando a dívida.** Reproduzido no espelho local com o papel
`authenticated` e `session_user` `authenticator`, que é exatamente como o
PostgREST chama.

Corrigido para `session_user`, nas duas funções. O teste de invasão de setembro
não pegou isso porque exercitou escrita **direta em tabela** (barrada por RLS),
e não as rotinas `SECURITY DEFINER` chamadas por RPC. **Vale varrer as outras
funções desse tipo com o mesmo olhar.**

### O espelho local virou script

A nota antiga dizia "vale reconstruir isso na próxima sessão" — foi reconstruído
e agora está versionado, para não se perder de novo:

- `scripts/espelho-local.sh` — levanta o Postgres 16, replaya as 41 migrations
  sobre os stubs e roda os testes. `--keep` deixa o servidor no ar.
- `scripts/espelho-stubs.sql` — o que o Supabase entrega pronto (`auth.uid()`,
  papéis, `storage`, publicação de realtime, e um `pg_cron` de mentira).
- `scripts/espelho-testes.sql` — 12 blocos, 32 asserções, rodando como
  `authenticated` com `session_user` `authenticator`.

O bloco 12 cobre o caminho que mais importa em produção e que é fácil esquecer:
quase nenhuma aula é marcada como realizada à mão — quem marca é
`mark_past_lessons_realizada`, pelo pg_cron, sem ninguém logado. Se o desconto
dependesse de `auth.uid()`, funcionaria na tela e falharia toda noite, em
silêncio.

### O que ficou de fora, e por quê

- **Os botões de pacote continuam com valores fixos** (R$ 2.000 + voucher R$ 200;
  R$ 1.050 + voucher R$ 50). São preço negociado, não conta a partir do valor da
  hora, então derivá-los seria inventar política. Se o Thiago mudar o valor da
  aula, esses dois botões precisam ser revistos à mão — o aviso do diálogo de
  pagamento já mostra quanto sobraria em aberto, e o texto ao lado do campo de
  voucher agora diz que eles assumem R$ 220/h. **Decidir com ele se viram
  configuração também.**
- **A migration precisa ser aplicada na produção.** Enquanto não for, nada disso
  existe lá — inclusive a correção do `register_payment`, que é a parte urgente.


## Gestor da plataforma (21/09) — feito

Um painel acima das empresas: ver quais existem, com quantos alunos e
responsáveis cada uma tem, criar empresa nova já com o login do primeiro admin,
e desativar ou excluir.

### O desenho que manda em tudo: o operador não tem empresa

A conta do gestor é um login **separado**, que não pertence a empresa nenhuma —
nenhuma linha em `user_roles`. Consequência direta, e é ela que importa:
`current_account_id()` dele é nulo, então as políticas de acesso não devolvem
**nenhuma linha de nenhuma empresa**. Aula, aluno, responsável, financeiro: nada
chega até ele.

O que ele vê são `count()`, através de `platform_accounts_overview()`, que é
`SECURITY DEFINER` e guardada por `is_platform_admin()`. Nenhum nome de pessoa
sai dessa função. É o pedido do Thiago ("não devo nem quero ver os dados delas")
virado regra do banco, e não promessa de tela.

Está coberto por teste: o bloco 13 do espelho confirma que o operador lê 0 aulas,
0 alunos, 0 lançamentos, 0 linhas de `platform_admins` e 0 do arquivo de
exclusões — e que um admin de empresa comum não abre o painel nem cria empresa.

### Como entrar

Login separado, pela mesma tela de sempre. O `Auth` manda para `/gestor` **antes**
de olhar os papéis, porque o operador não tem papel nenhum e cairia na tela de
"aguarde o professor te vincular".

**Para criar o operador** (uma vez, no painel do Supabase):

1. Authentication → Users → Add user, com e-mail e senha.
2. No SQL Editor: `INSERT INTO public.platform_admins (user_id, note) VALUES
   ('<id do usuário>', 'Thiago');`
3. Remover o papel que o gatilho deu a ele: `DELETE FROM public.user_roles WHERE
   user_id = '<id>';` — **este passo não é opcional.** `handle_new_user` joga
   todo usuário novo na empresa do endereço público, que é a de produção. Sem
   apagar, o "operador sem empresa" nasce dentro da empresa real e passa a
   enxergar os dados dela.

`platform_admins` tem RLS ligada e **nenhuma política**: entrar nessa lista é ato
deliberado no painel, nunca de dentro do app.

### Excluir sem que "excluir" queira dizer "perder"

Decisão do Thiago: desativar é o normal, excluir existe mas tem que ser
absolutamente seguro. Quatro travas, todas ao mesmo tempo:

1. só operador da plataforma;
2. a empresa precisa estar **desativada** — não dá para apagar uma em
   funcionamento;
3. não dá para apagar a empresa do endereço público;
4. o nome da empresa precisa ser digitado igual.

E, antes de apagar qualquer coisa, tudo é copiado para
`deleted_account_archives` em JSON, linha por linha, das 13 tabelas. É isso que
torna a exclusão **reversível** — recuperação é feita por fora, pelo painel do
Supabase. Os logins são a única coisa que não volta.

O espelho pegou um bug real aqui: apagar as aulas **dispara `log_lesson_audit`**,
que grava linhas novas em `audit_log`. Apagando o histórico antes das aulas, a
tabela se repovoava sozinha e o `DELETE` da empresa batia na chave estrangeira no
fim. A ordem certa é aulas primeiro, histórico depois.

### Criar empresa

`platform_create_account` faz a parte do banco (empresa + linha de `settings`,
senão a primeira tela do dono parece quebrada). O login do primeiro admin é
criado pela edge function `platform-console`, pela API oficial de autenticação —
de novo para não repetir o erro de criar usuário por SQL, com as colunas de texto
que precisam ser `''` e não `NULL`.

Autorização em dois lugares de propósito: na edge function (que roda com chave
mestra) e **de novo** dentro de cada RPC, chamada com o token do próprio usuário.
A segunda é a que vale se a primeira um dia for escrita errado — o inverso do que
aconteceu com `register_payment`.

**Janela conhecida, pequena:** entre criar o login e chamar
`platform_attach_admin`, o gatilho `handle_new_user` deixa o usuário novo na
empresa do endereço público. São milissegundos e a senha acabou de ser escolhida
pelo operador, mas está registrado aqui porque é real.

### O que falta

- **Restaurar do arquivo** não tem botão: hoje é abrir o `payload` no painel do
  Supabase e reinserir na mão. Se a exclusão passar a ser usada de verdade, vale
  uma função `platform_restore_account`.
- **Trocar a empresa do endereço público** não tem tela; `is_public_default` se
  troca por SQL. Enquanto só a produção tiver endereço, não incomoda.

## Pacotes configuráveis — PEDIDO, não começado

Pedido do Thiago em 21/09, sem pressa: criar, editar e excluir pacotes pelo app.

Hoje os dois pacotes são **valores fixos no código** (`quickOptions` em
`BillingPage.tsx`): "Pacote 10 aulas" = R$ 2.000 + voucher R$ 200, e "Pacote 5
aulas" = R$ 1.050 + voucher R$ 50. Os números assumem a aula a R$ 220/h.

**Por que isso ficou pendente e não foi resolvido junto com o valor da aula:**
não dá para derivar o preço do pacote do valor da hora — pacote é preço
negociado, com o desconto que o professor decidiu dar. Derivar seria inventar
política dele.

**O problema que isso cria agora que o valor da aula é configurável:** se o
Thiago mudar a aula para R$ 250, "Pacote 10" continua lançando R$ 2.000 + R$ 200
contra 10 × R$ 250 = R$ 2.500, e sobram R$ 300 em aberto. O aviso do diálogo de
pagamento mostra isso ("ficam R$ 300 em aberto"), e o texto ao lado do campo de
voucher avisa que os botões assumem R$ 220/h — mas é aviso, não conserto.

Desenho provável quando for feito: tabela `lesson_packages` por empresa (nome,
nº de aulas, valor recebido), com o voucher calculado como
`nº × valor_da_aula − valor_recebido`, e uma tela em Configurações. Os dois
pacotes de hoje viram as duas primeiras linhas dela.


## O que foi para a produção em 21/09

Aplicado no Supabase (`dqfzuviwejlobrwebyum`), pelas migrations
`lesson_price_and_discounts` e `platform_console`:

- `settings.default_lesson_price` — as três empresas nasceram com 220,00, que é
  exatamente o que o código cravava antes. **Ninguém sentiu diferença.**
- `account_discounts`, `platform_admins`, `deleted_account_archives` e as
  funções novas.
- **A correção do `register_payment`** — era a parte urgente, e está fechada.

Edge functions republicadas: `assistant-chat` (v12, agora lê o valor da aula e
os descontos da empresa) e `platform-console` (v1, nova).

**Não foi possível testar as edge functions de fora daqui:** a política de rede
do ambiente do Claude bloqueia o host do projeto. A conferência foi ler de volta
o código publicado e comparar com o arquivo do repositório.

### Falta, e depende de você

1. **Mesclar o `main`.** O Lovable sincroniza do `main` e está parado no commit
   `2bc9b3a`. Publicar antes de mesclar republicaria o código velho. O Netlify
   também publica sozinho a partir do `main` (quando os créditos voltarem).
2. ~~Criar o login do gestor~~ — **feito em 21/09.**

### O operador da plataforma existe

Login `thiagopeleias` (guardado em `auth.users` como
`thiagopeleias@aluno.sistema.local`, porque o app converte todo login sem "@"
para esse domínio interno). É uma conta **separada** do
`thiagopeleias@gmail.com`, que continua sendo o admin da empresa Portal de
Aulas — são dois logins diferentes, de propósito.

Criado por SQL, seguindo a checklist desta mesma página: as colunas de texto de
`auth.users` como `''` e nunca `NULL`, `confirmed_at` e `identities.email`
deixadas de fora por serem `GENERATED ALWAYS`, linha em `auth.identities`, e o
`DELETE FROM user_roles` na mesma transação — o gatilho `handle_new_user` tinha
acabado de pôr o login dentro da empresa de produção como `student`.

Conferido na produção, entrando como ele (papel `authenticated`, com o claim
`sub` dele):

| Verificação | Resultado |
|---|---|
| Reconhecido como operador | sim |
| Empresas no painel | 3 |
| Aulas / alunos / financeiro / histórico / professores que ele lê | **0 de cada** |
| Lista de operadores que ele lê | 0 |
| Empresa em vigor para ele | nenhuma |

Também conferido que a senha bate (`crypt`) e que nenhuma coluna de
`auth.users` ficou vazia em relação a um login que já funciona.

**A senha combinada foi dita em conversa e por isso deve ser trocada** assim que
ele entrar pela primeira vez — o app tem "trocar senha", e o Supabase também
permite pelo painel.


## Planos: Cronys Essencial e Cronys Pro (21/09) — publicado (conferido em 23/09: migrations `plans` e `plan_badge_and_rename` estão na produção)

Os nomes foram escolhidos pelo Thiago: **Cronys Essencial** (grátis) e
**Cronys Pro** (pago).

### O cardápio

| | Essencial | Pro |
|---|---|---|
| Professores ativos | 1 | ilimitado |
| Alunos | 5 | ilimitado |
| Agenda, aulas, recorrência | sim | sim |
| Registrar pagamento recebido | sim | sim |
| Bloqueio de horário **pontual** | sim | sim |
| Bloqueio **recorrente** (toda semana) | não | sim |
| Pacotes e vouchers | não | sim |
| Desconto fixo por família | não | sim |
| Assistente de IA | não | sim |

Tudo o que não está na tabela continua igual para os dois planos: portal da
família, vitrine pública, materiais, tarefas, acesso do filho, widgets.
**Não foram criadas travas que o Thiago não pediu.**

### PEDIDO PARA O FUTURO (22/09): rebaixar de verdade, com limite retroativo

Hoje rebaixar uma empresa (Pro → Essencial) só trava a criação de coisa nova —
quem já tinha 15 alunos continua com os 15, só não cadastra o 16º. Isso foi
decisão de desenho, registrada e testada (bloco 18 do espelho).

**O Thiago quer, no futuro, um rebaixamento que corta de verdade**: tirar
funcionalidade e aplicar o limite também sobre o que já existe — não só sobre o
que vem depois. Ele foi explícito que o dado não pode ser perdido (**"deixar
salvo, óbvio"**), então o desenho não é apagar, é **desativar/ocultar mantendo
o histórico** — o mesmo espírito da exclusão de empresa (arquiva em vez de
apagar), aplicado a alunos/professores/recursos individuais dentro de uma
empresa que continua existindo.

Perguntas que vão precisar de resposta dele quando isso for feito (não
decidir agora, só registrar que existem):

- Com 15 alunos e limite de 5, **quais 5 continuam ativos**? Os mais antigos?
  Os que o professor escolher numa tela? Todos ficam inativos até ele escolher?
- Um aluno "desativado por rebaixamento" ainda aparece pro professor em algum
  lugar (para ele escolher reativar se voltar ao Pro), ou some da lista como se
  não existisse?
- Bloqueio recorrente e desconto fixo que já existiam: desligam sozinhos, ou o
  professor precisa confirmar?
- Isso muda o comportamento do teste do bloco 18, que hoje testa exatamente o
  oposto ("rebaixar não apaga nada") — o teste vai precisar virar o novo
  comportamento, não só ganhar casos novos.

Não é grande, mas também não é pequeno: é uma tela nova (escolher quem fica
ativo) mais uma decisão de produto que só o Thiago pode tomar. Fica para
quando ele voltar a isso.

### Decisão (23/09): trava tudo, o professor escolhe o que liberar

Resposta à primeira pergunta em aberto acima: **não** existe seleção automática
de quem continua ativo (nem "os mais antigos", nem qualquer outra regra). Ao
rebaixar, tudo que excede o limite do Essencial fica inativo de uma vez, e é o
professor quem escolhe, numa tela, o que reativar até o limite — mesmo espírito
de "deixar salvo, óbvio": nada é apagado, só oculto/pausado.

Ainda em aberto (perguntas de UX pra resolver durante a implementação, não
antes): se o inativo aparece numa lista separada pro professor escolher (a
resposta óbvia dado "o usuário escolhe o que liberar", mas falta desenhar a
tela), e se bloqueio recorrente/desconto fixo (que não existem no Essencial de
jeito nenhum, não é questão de limite) simplesmente pausam sozinhos e voltam
sozinhos quando a empresa volta pro Pro, sem exigir escolha do professor.

### Três decisões, e o porquê de cada uma

**1. Bloqueio pontual fica no Essencial.** Ele tinha pedido bloqueio inteiro no
Pro. O problema: sem bloqueio, o professor grátis não consegue dizer "dia 14 eu
não dou aula" — e se a vitrine pública dele estiver ligada, ela oferece horário
que ele não tem. Isso não é funcionalidade premium, é agenda correta. O que o
Pro vende é não repetir o trabalho toda semana.

**2. O desconto fixo entrou junto com pacotes e vouchers.** Ele listou só
"pacotes e voucher", mas desconto é a mesma família — abatimento combinado com
a família, lançado como crédito. Separar deixaria a regra estranha de explicar.
**É uma leitura minha, e desfazer é uma linha em `plan_features()`.**

**3. Rebaixar não apaga nada.** Os limites valem para CRIAR. Uma empresa que
tem 8 alunos e cai para o Essencial continua com os 8, continua editando os 8,
e continua podendo TIRAR um desconto que já tinha — ela só não cria o nono nem
põe desconto novo. Está coberto por teste (bloco 18).

### A trava é do banco, não da tela

Gatilhos em `teachers`, `students` e `blocks`, mais checagem dentro de
`register_payment` e `set_account_discount`. Esconder o botão não impede nada:
este projeto já viu um crawler do Google criar 55 aulas pela API, e viu a
guarda de `register_payment` não guardar coisa nenhuma. A tela só evita que a
pessoa esbarre no limite sem entender por quê.

O assistente é recusado **na edge function, antes de falar com a API da
Claude** — é o único item que custa dinheiro de verdade por uso, e não adianta
recusar depois de gastar o token.

### O switch do assistente é uma exceção, não o plano

No painel do gestor há duas coisas por empresa: o **plano** (Essencial/Pro) e um
**switch do Assistente**. O switch grava `accounts.assistant_override`:

- nulo → segue o plano;
- true/false → o gestor forçou.

Existe porque "dar o assistente para essa empresa por um mês" é decisão
comercial que não deveria obrigar a mudar o plano inteiro. No painel, um
override aparece marcado como **"à mão"**, e tocar de novo devolve a decisão ao
plano.

### Nenhum link de pagamento dentro do app, de propósito

O `ProUpsell` informa e manda falar com quem cuida da conta. **Não tem botão de
compra nem link externo**: o app está na Google Play, e vender bem digital
dentro dele obriga a usar a cobrança do Google — um link para pagar por fora é
motivo de recusa na revisão. Quando existir cobrança de verdade, essa decisão
precisa ser tomada de propósito (Google Play Billing, ou venda só pelo site,
fora do app).

A empresa **Demonstração** foi para o Pro junto com a de produção, também por
causa da Play: é a conta que o revisor usa, e mostrar tela de venda para ele
convida exatamente a essa discussão.

### O que falta

- **Publicar.** A migration `20260921160000_plans.sql` e a edge function
  `assistant-chat` estão no código e não na produção. **Atenção ao publicar:** a
  Empresa X cai para o Essencial e perde o assistente, porque só a de produção e
  a Demonstração nascem Pro.
- **Cobrança de verdade** não existe. Hoje o plano é trocado à mão pelo gestor.
  Rastrear quem pagou continua podendo ser planilha até valer a pena.

### Ideias de Pro que ainda não existem

Levantadas na conversa de 21/09, em ordem do que parece vender mais:

1. **Lembrete automático de aula** (WhatsApp/e-mail) — reduz falta; é o item que
   mais se paga sozinho.
2. **Relatório e exportação** — faturamento do mês, CSV para o imposto de renda.
3. **Recibo para a família.**
4. **Marca própria** — logo e cores da empresa no portal e na vitrine.
5. **Endereço próprio** (`empresa.dominio.com.br`) — já está no plano multi-empresa.
6. **Google Agenda.**
7. **Relatório de presença e evolução do aluno.**

Candidatos que já EXISTEM e poderiam virar Pro se o Essencial precisar ficar
mais magro: portal da família, vitrine pública de horários, materiais e tarefas
(esses dois consomem armazenamento), acesso do filho.


## Roteiro do Pro: o que dá para fazer sozinho e o que depende de terceiros (22/09)

Avaliação pedida pelo Thiago. A pergunta dele foi a certa: **"é possível fazer
apenas com você ou teríamos que ter coisas externas?"** — porque a resposta muda
completamente o custo de cada item, e não é a dificuldade do código que decide.

O que trava não é código. É **cadastro em empresa terceira, verificação de
identidade e aprovação de outra gente.** Esses itens têm prazo que não depende
de nós.

### Totalmente nosso (só código, nenhum cadastro, nenhuma espera)

| Item | Tamanho | Observação |
|---|---|---|
| **Exportação e relatório (IR)** | pequeno | Os dados já existem na carteira. CSV é quase de graça; a tela de resumo por mês/ano é o trabalho. **É o mais fácil da lista inteira.** |
| **Recibo para a família** | pequeno | Gerado no próprio app a partir da carteira. Sem serviço externo. |
| **Relatório de evolução do aluno** | médio | Os dados existem: `class_summary`, lições, presença. É juntar e desenhar. |
| **Lembrete por WhatsApp com mensagem pronta** | pequeno | **Não é automático**, mas entrega quase todo o valor: uma lista "quem tem aula amanhã" e um toque por família que abre o WhatsApp com o texto escrito. O app já tem `WhatsAppButton.tsx`. |
| **Assinar a agenda (.ics)** | pequeno | Um endereço que o professor assina no Google Agenda, no iPhone, onde quiser. Só leitura, mas **resolve "quero ver minhas aulas na minha agenda" sem OAuth nenhum.** |
| **Marca própria da empresa** | médio | Logo no Storage (já em uso) e cor de destaque por empresa. Conflito a resolver antes: `docs/cronys-brand-spec.md` diz que a identidade é fixa — provavelmente logo + uma cor de acento, não a paleta inteira. |

### Depende de algo que só o Thiago faz (mas rápido)

| Item | O que ele precisa fazer | Depois disso |
|---|---|---|
| **Notificação no app (push)** | Criar um projeto no Firebase (grátis) e me dar a chave de serviço | O resto é meu: Capacitor + uma rotina agendada. Médio. |
| **Endereço próprio por empresa** | Comprar o domínio (~R$ 40/ano) e apontar o DNS | Já está planejado desde a parte 2 do multi-empresa. Médio. |
| **E-mail automático** | Escolher um provedor (Resend/SendGrid, têm plano grátis) | **Depende do domínio também**: sem domínio próprio, e-mail de lembrete cai em spam. |

### Depende de aprovação de terceiro (prazo fora do nosso controle)

| Item | O obstáculo |
|---|---|
| **WhatsApp automático de verdade** | Exige a **WhatsApp Business Platform** da Meta: conta Business, **verificação da empresa**, número dedicado e **modelos de mensagem aprovados** pela Meta (um lembrete é enviado fora da janela de 24h, então obrigatoriamente é modelo aprovado). Tem custo por mensagem. Não é código difícil — é burocracia com prazo de terceiro. **Confirmar regras e preço atuais quando formos fazer; a Meta muda isso.** |
| **Google Agenda com escrita (OAuth)** | Projeto no Google Cloud, tela de consentimento e **verificação do app pelo Google** quando houver usuários externos. A verificação é a parte lenta. O `.ics` acima entrega a leitura sem nada disso. |

### A ordem que eu recomendaria

1. **Exportação/IR + recibo** — menor esforço, maior retorno imediato, 100% nosso.
2. **Lembrete por WhatsApp com mensagem pronta** — pega a maior dor (falta) hoje, sem Meta nenhuma.
3. **Relatório de evolução** — vende o Pro em conversa com responsável.
4. **Push no app** — primeiro lembrete de verdade automático.
5. **Domínio → endereço próprio → e-mail** — os três destravam juntos.
6. **WhatsApp automático e Google Agenda com escrita** — só quando houver cliente pagando que justifique a burocracia.

**Observação sobre o item 1 x item 2:** o lembrete automático é o que mais se
paga, mas o caminho automático mais barato (push) não é o que ele pediu
(WhatsApp). Vale começar pelo WhatsApp semiautomático e medir se reduz falta
antes de investir na verificação com a Meta.

## Desconto discriminado na aula, não abatido de qualquer uma (23/09) — feito

Pedido do Thiago: o desconto não estava sendo mostrado na aula que ele valia -
`computeStatements` (`src/lib/billing.ts`) jogava TODO crédito (pagamento,
pacote, voucher avulso e o voucher automático do desconto fixo) num pool único
que quita a cobrança **mais antiga em aberto primeiro**. O voucher do desconto
fixo já vinha do banco com `lesson_id` certo (é o que `sync_lesson_wallet`
grava), mas isso era ignorado - o desconto de hoje podia acabar quitando uma
aula de três semanas atrás, e a aula de hoje continuar cheia, sem nenhum
desconto visível nela.

**Corrigido:** um voucher com `lesson_id` agora abate primeiro, direto, a
cobrança da própria aula - só o troco (se sobrar, o que não deveria acontecer
porque o banco já limita o desconto ao valor da aula) volta pro pool geral. A
tela "Em aberto" mostra o valor cheio riscado, o desconto e o líquido, aula por
aula.

**O que continua sem discriminação, de propósito:** o abatimento pontual
(botão "Desconto" com alcance "uma aula" ou "tudo em aberto") lança um voucher
**sem** `lesson_id` - é assim desde a migration 20260921120000, porque
`sync_lesson_wallet` reconhece "o" voucher de uma aula só pelo par
`lesson_id + kind='voucher'`; se o manual também usasse `lesson_id`, o gatilho
do desconto fixo passaria a apagar/sobrescrever esse voucher manual sempre que
a família também tivesse desconto fixo e a aula fosse tocada de novo. Ligar os
dois exigiria uma forma de o gatilho distinguir "meu voucher" de "voucher
alheio" (uma coluna nova, tipo `auto_generated`) - fica pra outra sessão se o
Thiago quiser esse caso também discriminado.

Teste novo: `src/test/billing.test.ts`, 3 casos (abate a própria aula, troco de
desconto maior que a aula não vira crédito do nada, voucher solto continua indo
pro pool geral). `tsc`, lint (no nível já existente) e build limpos.

**Falta:** nada no banco muda, então não há migration a aplicar - é só o
front-end, publica com o próximo merge/deploy normal.

## Exportação IR + Recibo (23/09) — feito no código, falta aplicar a migration

Pedido do Thiago, item 1 do roteiro do Pro ("o mais fácil da lista inteira").
Tela nova, `/admin/relatorios` (nav "Relatórios"), com duas partes.

**Resumo do período:** ano (e opcionalmente mês) → quanto cada família pagou
de verdade, e o total. "De verdade" quer dizer `kind IN ('package',
'adjustment')` com valor positivo - aula é cobrança, nunca entrada, e voucher
é desconto, crédito sem dinheiro trocando de mão; nenhum dos dois é renda pra
declarar nem prova de pagamento recebido. Botão exporta CSV das linhas do período,
separado por `;` e com BOM - é o que o Excel em português abre em colunas e
com acento certo (com `,` sai tudo numa coluna só).

**Recibo:** escolhe família + mês/ano, soma o que ela pagou nesse período, e
monta um recibo (nome da empresa, CPF/CNPJ e e-mail de quem recebe, valor em
número E por extenso, lista do que foi pago, data de emissão, linha de
assinatura). "Imprimir / Salvar PDF" chama `window.print()` — sem lib nova,
`#recibo-print` é a única coisa visível na folha via `@media print` em
`index.css`, o resto do app (nav, cabeçalho) some da impressão.

**Duas coisas pequenas que vieram junto:**
- `settings.issuer_document` (CPF/CNPJ de quem recebe) — campo novo em
  Configurações → Contato, pra aparecer no recibo. Nulo sai em branco pra
  preencher à mão. Não entra na lista que o `anon` lê (allowlist da migration
  20260920120000) — não tem por que ser pública.
- `src/lib/extenso.ts` — valor por extenso em português (obrigatório em
  recibo de verdade). Cobre reais e centavos até 999.999.999, com a regra de
  vírgula/"e" entre os grupos (ex.: "mil, duzentos e trinta e quatro reais",
  mas "mil e cinquenta reais" - "e" só quando o último grupo é redondo ou
  menor que 100).

**Não é Pro-exclusivo.** O roteiro listava isso como ideia de Pro, mas o
Thiago não pediu a trava agora e o plano em si ainda não está em produção
(migration `20260921160000_plans.sql`). Fica registrado: se quiser gated,
é adicionar `reports: boolean` em `usePlan.ts`/`plan_features()` e envolver a
tela com `<ProUpsell>` — mesmo padrão de `packages`/`recurring_blocks`.

Testes novos: `src/test/extenso.test.ts` (8 casos) e `src/test/reports.test.ts`
(8 casos, cobrindo o filtro de renda, o período e o CSV). `tsc`, lint (no
nível já existente) e build limpos.

**O que falta, e depende de você:**
1. **Aplicar a migration `20260923010000_receipt_issuer_document.sql`** na
   produção — só adiciona a coluna, não tem RLS nem trigger novo.
2. **Não foi possível testar a tela num navegador de verdade daqui.** O
   ambiente não tem o pacote `playwright` instalado no projeto (só o Chromium
   do sistema) e a tela exige login contra o Supabase de produção, que este
   ambiente não alcança (mesma limitação já registrada para as edge
   functions). A conferência foi `tsc` + lint + build + os testes de unidade
   acima - vale abrir a tela de verdade depois de publicar antes de confiar
   nela para um recibo real.
3. Preencher CPF/CNPJ em Configurações, senão o recibo sai com a linha em
   branco.

## Relatório de evolução do aluno (23/09) — feito, sem migration

Pedido do Thiago, item 3 do roteiro do Pro ("os dados existem: class_summary,
lições, presença. É juntar e desenhar"). Ele mesmo disse não saber exatamente
o que é o pedido - o desenho abaixo é a leitura mais direta do que já existe
no banco, pra ele reagir e ajustar.

Nova tela, `/admin/evolucao` (nav "Evolução"), e um botão "Evolução" na ficha
do aluno (`StudentSheet`) que já leva pra lá com o aluno escolhido.

- **Presença:** conta aulas `realizada`/`cancelada`/`recusada` (agendada e
  solicitada não contam - ainda não aconteceram) e mostra a taxa.
- **Linha do tempo:** aula realizada (com o resumo que o professor escreveu,
  `class_summary`) e lição (com a devolutiva mais recente, se o aluno já
  entregou), misturadas e ordenadas da mais recente pra mais antiga.

**Detalhe que quase passou batido:** `lessons` não tem `student_id` - é
`student_name`/`guardian_name` em texto, como o resto do app. Usar `accountKey`
(de `balance.ts`) teria juntado a evolução de dois irmãos na mesma linha do
tempo, porque ele agrupa por FAMÍLIA de propósito (é o que a Cobrança precisa).
Evolução é por ALUNO, então `src/lib/evolution.ts` tem sua própria chave,
`studentMatchKey`, por nome do aluno + responsável.

Teste novo: `src/test/evolution.test.ts` (4 casos - só realizada entra na
linha do tempo, aula e lição juntas ordenadas, presença conta certo, taxa não
vira `NaN` sem dado). `tsc`, lint e build limpos; mesma ressalva de antes
sobre não ter testado num navegador de verdade daqui.

**O que ficou de fora, de propósito:** nenhum filtro de período (mostra tudo
desde sempre) e nenhuma trava de plano (mesma decisão do Relatórios - o
Thiago não pediu Pro-exclusivo agora, e o plano ainda não está em produção).
Se a lista ficar longa demais com o tempo, um filtro por ano é a mesma UI que
já existe em Relatórios - fica pra quando incomodar de verdade.

## Rebaixamento trava tudo (23/09) — feito no código, falta aplicar a migration

Decisão do Thiago: "trava tudo e o usuário escolhe o que liberar". Migration
`20260923020000_plan_downgrade_locks.sql`.

### Como ficou

- Ao cair para o Essencial, **se** os alunos passam do limite (5), **todos**
  ficam pausados (`students.plan_locked`), e o professor libera até 5 na tela
  Alunos. O mesmo com professores ativos (limite 1): ficam inativos com
  `teachers.plan_locked`, e o professor reativa 1 pelo interruptor de sempre.
- **Abaixo do limite, nada trava.** Leitura minha de "trava tudo": travar 3
  alunos só para o professor destravar os 3 em seguida seria atrito puro.
- Pausado **não perde nada**: aulas, histórico, carteira, e as aulas já
  marcadas continuam (e seguem sendo marcadas como realizadas e cobradas). O
  que trava é aula NOVA - pelo admin, pelo portal da família, pelo assistente,
  e também aprovar um pedido antigo ou passar uma aula existente para o aluno
  pausado. Desmarcar e mudar horário continuam livres.
- **Tudo isso é regra do banco** (gatilhos), não da tela. Inclusive o
  "Liberar": o admin tem UPDATE em `students`, então sem o gatilho
  `students_plan_unlock` bastaria um UPDATE pela API para liberar os 15.
- Na ficha do aluno aparece **"Pausar"** enquanto houver alguém pausado: é
  como o professor troca quem ocupa as 5 vagas. Sem isso, uma escolha errada
  ficaria sem volta até o Pro.
- **Voltar para o Pro libera tudo sozinho** - e só o que o plano pausou: um
  professor que o dono tinha desligado por conta própria continua desligado.
- O painel do gestor pede confirmação antes de rebaixar uma empresa acima do
  limite, e mostra quantos estão pausados em cada uma.
- A mensagem de erro de aula para aluno pausado **não fala de plano**
  ("o cadastro está pausado, fale com o professor"), porque a família também
  pode recebê-la pelo portal.

### Decidido (23/09): bloqueio recorrente e desconto fixo continuam valendo

O Thiago confirmou: **ficam valendo depois do rebaixamento**, como já estava
no código. O Essencial só impede criar novos.

**Bloqueio recorrente e desconto fixo que já existiam NÃO são pausados.** "Trava
tudo" pediria pausar, mas os dois têm efeito colateral ruim:

- pausar o **bloqueio recorrente** faz a vitrine pública oferecer horário que o
  professor não tem (o mesmo motivo que manteve o bloqueio pontual no
  Essencial);
- pausar o **desconto fixo** faz a conta da família subir sem ninguém avisar -
  o desconto é um combinado entre professor e família, não com a Cronys.

Por isso os dois continuam valendo e o Essencial só impede criar novos. O
teste do bloco 18 do espelho cobre exatamente isso.

### Outras coisas para saber

- **A Empresa X já está acima do limite hoje** (Essencial com 2 professores
  ativos - conferido na produção). A migration **não** trava ninguém sozinha:
  a trava acontece no momento do rebaixamento. Para enquadrar a Empresa X, o
  gestor passa ela para Pro e de volta para Essencial.
- O casamento aula↔aluno é por nome + responsável e aula↔professor pelo
  apelido (sem acento, minúsculo, espaço vira hífen) - o mesmo casamento por
  texto do resto do banco. Um nome com acento fora do português comum (ex.:
  "ñ") não casaria, e a aula passaria. Risco baixo, registrado.
- `lock_over_plan_limits` e `release_plan_locks` **não** são executáveis por
  `authenticated`: são SECURITY DEFINER e recebem a empresa por parâmetro, então
  qualquer admin travaria os alunos de outra empresa. Coberto por teste.

### Como foi verificado

Espelho local (Postgres 16) reconstruído e rodado inteiro: todos os blocos
anteriores seguem verdes, e o **bloco 18 foi reescrito** - ele testava
exatamente o oposto ("rebaixar não apaga nada, os 6 continuam funcionando").
Agora são 32 asserções: trava os 6 e os 2, não apaga, aula nova recusada,
libera 5 e recusa o 6º (inclusive por UPDATE direto), reativar professor limpa
a marca, trocar o aluno de uma aula existente é recusado, desmarcar e mudar
horário continuam livres, admin não chama as funções de trava, voltar ao Pro
libera só o que o plano pausou. Migration reaplicada 2× sobre si mesma sem
erro (idempotente). `tsc`, testes, lint (nível existente) e build limpos.

As telas **não** foram abertas num navegador logado daqui (mesma limitação de
rede de antes).

### Ordem para publicar (importante)

As três telas novas foram escritas para funcionar **antes** das migrations
(sem as colunas novas, simplesmente não mostram nada de novo). Mesmo assim a
ordem certa é:

1. aplicar `20260923010000_receipt_issuer_document.sql` e
   `20260923020000_plan_downgrade_locks.sql` na produção;
2. mesclar o PR no `main` (Netlify publica sozinho);
3. publicar no Lovable (`deploy_project`) e conferir o `latest_commit_sha`;
4. `.aab` novo só se quiser as telas no app da loja.


## Mensagem de cobrança reorganizada (23/09)

Pedido do Thiago: a lista de aulas estava amontoada ("sexta 15/05 às 16:30 —
Luana — Matemática (60 min) — R$ 200,00" numa linha só) e o desconto não
aparecia. A montagem saiu de `OrganizationPage.tsx` para
`src/lib/collectionMessage.ts`, com teste.

- Cada aula virou um bloco de 3 linhas (data em negrito / matéria e duração /
  valor). O WhatsApp não alinha colunas (fonte proporcional), então bloco lê
  melhor que tabela.
- O nome do aluno sai do bloco e vai para a frase de abertura quando a conta
  tem um aluno só; com irmãos, o nome volta para cada aula.
- **Com desconto:** valor cheio riscado → valor com desconto em negrito, linha
  "🎁 Desconto de 10%: você economiza R$ 20,00" em cada aula, e no fim
  "Aulas / Descontos / Total a pagar" mais uma frase dizendo quanto a família
  está economizando. Sem desconto, só o total - nada de linha "Descontos: R$ 0".
- Aula paga em parte mostra quanto já entrou e quanto falta, e o resumo ganha
  "Já pago", para a conta fechar na frente da família.
- "Chave CPF" estava cravado para toda empresa; agora diz CPF, CNPJ ou e-mail
  conforme o formato da chave, ou só "Chave".
- "de *Luana*" e não "da/do": adivinhar gênero pelo nome erra.

## Publicado em 23/09

- **Banco:** `receipt_issuer_document` e `plan_downgrade_locks` aplicadas na
  produção antes do merge. Conferido depois: 0 alunos/professores travados,
  17 alunos, 102 aulas e 101 lançamentos intactos, gatilhos no lugar, e
  `lock_over_plan_limits`/`release_plan_locks` sem EXECUTE para
  `authenticated` e `anon`. Antes de aplicar, as 4 funções substituídas foram
  comparadas com a produção: idênticas ao repositório, nada mexido por fora.
- **PR #17** mesclado no `main` (`73b0bfe`).
- **Lovable:** publicado, `latest_commit_sha` = `73b0bfe`.
- **Netlify: continua parado no build de 20/09** (`8ed1aa7`). Tentar publicar
  pela ferramenta dá **403 Forbidden** de novo - a mesma trava de conta/crédito
  anotada antes. Só se resolve no painel do Netlify. Enquanto isso,
  `cronys.netlify.app` serve a versão velha; o atual é `cronys.lovable.app`.
- **`.aab` 1.6.0** (código 14) disparado do `main`. Artefato
  `aulas-play-1.6.0-14`, baixa como `.zip`, descompactar antes de subir.

## Ajustes pedidos em 23/09 (lote 2) — feito no código

1. **Recibo e CSV no app.** `window.print()` e o download por `<a download>`
   não existem no WebView do Android - no app os botões não faziam nada. Agora
   o recibo é um **PDF de verdade** (jsPDF, carregado só quando alguém gera
   recibo) e `src/lib/saveFile.ts` decide: no site baixa, no app grava no cache
   e abre o menu de compartilhar do Android (dá para mandar direto pelo
   WhatsApp). Isso também acabou com o PDF cinza no tema escuro: o PDF não
   herda o tema da tela. Plugins novos: `@capacitor/filesystem` e
   `@capacitor/share` - **nenhuma permissão nova no Android** (conferido nos
   manifests), usam o FileProvider/cache que já existia. **Precisa de `.aab`
   novo.**
2. **Organização fundida no Financeiro** (a antiga Cobrança, renomeada). O
   "Copiar cobrança" está em cada conta com valor em aberto. A lista "próximos
   7 dias" da Organização já existia na Agenda, então nada se perdeu.
   `/admin/organizacao` redireciona para `/admin/financeiro` (o widget do
   Android de quem ainda está no app antigo abre esse endereço); o widget novo
   já aponta para o Financeiro.
3. **Link com localhost.** No app, `window.location.origin` é
   `https://localhost` (é como o Capacitor serve o `dist/`). Afetava o link de
   disponibilidade, **a mensagem de acesso enviada às famílias** (tela
   Acessos) e o link de confirmação de cadastro. `src/lib/publicUrl.ts`: no
   app usa `VITE_PUBLIC_SITE_URL` (padrão `https://cronys.lovable.app`); no
   site, o próprio endereço.
4. **Editar nome do professor.** Aulas e bloqueios guardam o professor pelo
   apelido do nome (`ana-julia`), então renomear passa pela função
   `rename_teacher` (migration `20260923030000`), que troca nome, aulas e
   bloqueios numa transação só, escopada pela RLS da empresa. O diálogo avisa
   que o link público muda. A trava de plano ganhou uma exceção só para o
   renomear (senão barraria renomear professor pausado) - desligada no fim da
   função; coberto por teste. `audit_log` não é reescrito: é histórico.
   **Efeito colateral a saber:** o professor "padrão" do login é achado
   procurando o apelido dentro do e-mail (`thiago` em `thiagopeleias@...`);
   renomear para algo que não está no e-mail faz o padrão cair no primeiro
   professor da lista.
5. **Agenda - campo Início vazio ao editar:** o banco devolve a data com fuso
   (`...T18:00:00+00:00`) e o campo só aceita hora local sem fuso; ficava em
   branco. **Seletor novo:** dia num calendário + hora + minuto (00/15/30/45)
   em listas curtas, com o resumo por extenso embaixo ("Quinta-feira, 24 de
   setembro às 15:30"); aula antiga em minuto fora da lista mantém o minuto.
   Duração em botões (30/45/1h/1h30/2h) mais o campo livre. **Achado junto:**
   salvar sem início dava erro sem mensagem e deixava o botão travado; agora
   avisa.
6. **Toque na aula (só no app):** 160 ms de espera antes de abrir, cancelados
   se a agenda rolar nesse meio-tempo. O bloco da aula não passava pela
   proteção contra rolagem que as células vazias já tinham. No site continua
   instantâneo.

Verificado: 55 testes (novos: PDF do recibo, campo de data, atraso do toque),
espelho inteiro verde com o bloco 23 novo (9 asserções do renomear), migration
reaplicada 2×, `tsc` e build limpos. Telas não abertas num navegador logado.

## Revisão de vendabilidade (23/09)

O que falta para vender, **sem repetir o roteiro que já estava anotado**.

### Bloqueia a venda (resolver antes)

1. **Excluir a própria conta dentro do app.** Não existe. A Google Play exige
   isso de app que permite criar conta (as famílias criam), com um link web
   também. Risco de a ficha ser suspensa numa revisão.
2. **Termos de uso.** Só existe política de privacidade. Vender assinatura sem
   termos (cancelamento, reembolso, quem responde pelos dados dos alunos -
   pela LGPD a escola é controladora e a Cronys operadora) é risco jurídico. O
   texto é decisão sua/jurídica; a página é trabalho pequeno.
3. **Cadastro de professor sem passar pelo gestor.** Toda empresa nasce na
   mão do Thiago, no painel. Quem baixa o app na loja e não é família não tem
   o que fazer. Pior: **todo cadastro novo pela loja cai dentro da empresa de
   produção** (`handle_new_user` → empresa pública). Os testes mostram que ele
   não enxerga nada, mas é a empresa real acumulando estranhos. Precisa de
   "Sou professor → criar minha escola" com período de teste.
4. **Papel "professor" separado de "admin".** Todo login da equipe é admin e vê
   o financeiro de todo mundo. Escola com 3 professores não compra isso.
5. **Coisas do Thiago cravadas para todas as empresas:** InfinitePay (portal
   da família e mensagem de cobrança, com "12x"), `lessons.teacher` com
   padrão `'thiago'` no banco, a cor da "mayara" no widget do Android. Cada
   empresa precisa escolher o próprio meio de pagamento.

### Alto impacto, 100% nosso

6. **Pix "copia e cola" com o valor já preenchido** na mensagem de cobrança e
   no portal da família. O código Pix com valor (BR Code) é gerado só com a
   chave, sem banco nem API. A família paga com um toque - ataca
   inadimplência, que é o que o professor sente no bolso.
7. **Primeira experiência de uma empresa nova:** hoje é tela vazia. Uma lista
   "valor da aula → professor → primeiro aluno → link público".
8. **Importar alunos de planilha** - quem vem de caderno/Excel desiste no
   cadastro um a um.
9. **Monitoramento de erros** (Sentry tem plano grátis). Hoje erro só aparece
   quando alguém reclama - foi assim com o recibo no app.
10. **CI rodando `tsc`, testes e o espelho em cada PR.** Hoje o GitHub só
    compila o APK.
11. **Abertura mais rápida:** o app inteiro é um JS de 1,25 MB carregado de
    uma vez, inclusive na vitrine pública e no login. Dividir por tela.

### Médio

12. Página de venda do Cronys (o site público hoje é a vitrine do professor,
    não do produto), com preço e botão de teste.
13. "Saúde do negócio" na tela Hoje: receita do mês x anterior, alunos ativos,
    faltas.
14. Família pedir **troca** de horário (hoje só retira o pedido).
15. Política de falta/cancelamento configurável (cobrar se desmarcar com menos
    de X horas).

### O que já estava no roteiro (continua valendo)

Lembrete de aula por WhatsApp com mensagem pronta; push no app; domínio →
endereço próprio por empresa → e-mail automático; assinar a agenda (.ics);
marca própria; pacotes configuráveis; cobrança da assinatura (Play Billing ou
venda fora do app); WhatsApp automático e Google Agenda com escrita;
notificação de pedido novo e pedido vencido que expira. Pendências técnicas:
Netlify travado (403), regenerar `types.ts`, decisão sobre a tabela de backup,
apagar `admin-create-user` no painel do Supabase.

## Ajustes de 23/09 (lote 3) — `.aab` 1.8.0

- Minutos do horário da aula de **5 em 5** (antes 00/15/30/45). Minuto fora
  da lista (aula antiga às 16:42) continua aparecendo, não é arredondado.
- **Seleção de texto na agenda:** segurar o dedo selecionava texto e o
  Android abria a barra "Copiar, Compartilhar..." que não sumia. A agenda
  inteira agora é `select-none` + `-webkit-touch-callout: none`, e o menu de
  toque longo é bloqueado - exceto em campos de texto, porque o diálogo de
  aula abre em portal e o `onContextMenu` do React atravessa portal (sem a
  exceção, o "colar" dos campos do diálogo sumiria).
- Um teste de `yearsWithData` dependia do fuso (`2025-01-01T00:00Z` é 31/12
  em Brasília); corrigido para meio-dia. O código estava certo.

**Próxima sessão (provavelmente semana que vem):** a lista "Revisão de
vendabilidade" acima, começando por excluir a própria conta dentro do app
(exigência da Google Play).

## PEDIDO (23/09) — Resumo da semana / do mês — FEITO em 24/09 (ver abaixo)

Pedido do Thiago: um lugar com o resumo do período - quanto recebeu, quanto
falta receber, o total (inclusive o que já deveria ter entrado), quantas aulas
foram dadas e afins. Absorve o item 13 da revisão ("saúde do negócio").

**Proposta (validar com ele antes de construir):** cartão no topo do
Financeiro e um resumo curto na tela Hoje, com seletor Semana / Mês e setas
para períodos anteriores.

- **Aulas:** dadas (e horas), canceladas, recusadas, e quantas ainda estão
  marcadas até o fim do período.
- **Valor das aulas dadas** no período (cheio), **descontos** concedidos e o
  **líquido** - é o "total que deveria ter recebido".
- **Recebido no período:** dinheiro que entrou (pagamento/pacote, pela data do
  lançamento).
- **Em aberto:** quanto das aulas do período ainda falta pagar, e o total em
  aberto geral.
- **Previsto:** aulas marcadas até o fim do período × valor.
- Comparação com o período anterior; separação por professor quando houver
  mais de um.

**Cuidado de definição que precisa ir escrito na tela:** "recebido" é pela
data do pagamento e "valor das aulas" é pela data da aula. Num mês qualquer
os dois não batem - um pacote pago em agosto cobre aulas de setembro. Sem
explicar isso, o professor acha que a conta está errada.

Dados: tudo já existe (`wallet_transactions` + `lessons`); `computeStatements`
e `summarizeIncome` cobrem boa parte das contas. Sem migration.

## Lote de 24/09 — itens 1 a 7 da revisão de vendabilidade — feito no código

Pedido: "faz até o item 7 e deixe o resto anotado". **Nada disso está na
produção ainda** - falta aplicar as migrations, publicar duas edge functions,
mesclar, publicar o Lovable e gerar o `.aab` (1.9.0, código 17).

### 1. Resumo da semana / do mês

- `src/lib/periodSummary.ts` (contas, com teste) e `PeriodSummary.tsx`.
- **Financeiro:** cartão no topo com Semana/Mês, setas para voltar períodos,
  Recebido · Valor das aulas (cheio, descontos, líquido) · Falta receber (do
  período e geral) · Previsto; aulas dadas/horas/canceladas/recusadas/ainda
  marcadas; comparação com o período anterior; por professor quando há mais
  de um. A nota "recebido é pela data do pagamento, valor das aulas pela data
  da aula" está escrita no cartão.
- **Hoje:** versão curta do mesmo resumo, com link para o Financeiro.
- Sem migration.

### 2. Excluir a própria conta

- **Minha conta** (`/minha-conta`), no menu dos três perfis: mostra o login,
  troca a senha e tem "Excluir minha conta" (digitar EXCLUIR).
- Edge function **`delete-my-account`**: o usuário vem do token; desfaz os
  vínculos (aluno, filho, professor) e apaga o login. Recusa o **único admin**
  de uma escola (a escola ficaria sem dono - encerrar escola é com o gestor)
  e o operador da plataforma. Aulas e pagamentos ficam com a escola.
- Página pública **`/excluir-conta`** com as instruções. **Cadastrar na Play
  Console → Conteúdo do app → Segurança dos dados → "Exclusão de conta":
  `https://cronys.lovable.app/excluir-conta`.**

### 3. Termos de uso

- `/termos` (link no rodapé do cadastro, com caixa "li e aceito").
- ⚠️ **É rascunho escrito a partir do que o app faz, não texto de advogado.**
  Antes de vender: alguém da área jurídica revisa, completa a identificação do
  fornecedor (nome/razão social, CPF/CNPJ, endereço) e ajusta
  cancelamento/reembolso à política comercial real.
- A política de privacidade deixou de citar a InfinitePay (agora "o provedor
  de pagamento escolhido pela escola") e aponta para a exclusão de conta.

### 4. Escola se cadastrando sozinha, com 14 dias de Pro

Migration `20260924020000_school_signup_and_trial.sql`.

- O cadastro agora diz o que é (metadados do signUp, lidos por
  `handle_new_user`):
  - **"Professor ou escola? Criar minha escola"** → cria a escola (apelido
    único, que vira o código), as configurações, o professor e o login como
    admin, com **Pro até +14 dias** (`accounts.trial_ends_at`).
  - **Família com código da escola** → papel de família naquela escola. No
    app (Android) o código é **obrigatório**: acabou o cadastro pela loja
    caindo na empresa de produção. Código errado = cadastro sem escola (não
    enxerga nada), nunca a escola errada, nunca admin.
  - Sem metadados (vitrine web, logins criados pelas edge functions) → igual
    a antes.
- `expire_trials()` roda todo dia às 03:15 (pg_cron): fim do teste vira
  Essencial **com a trava de rebaixamento** (nada apagado, o excedente fica
  pausado e a escola escolhe o que liberar).
- O gestor definir o plano encerra o teste.
- Telas: aviso "Teste grátis do Pro até dd/mm" na Hoje e em Configurações;
  **código da escola** em Configurações → Portal do Aluno (botão copia) e no
  texto do convite em Acessos; selo "Teste até ..." no painel do gestor.

### 5. Papel "professor" separado de "admin"

Migrations `20260924030000_teacher_role_enum.sql` (**sozinha**, antes - o
Postgres não usa um valor novo de enum na mesma transação em que foi criado)
e `20260924040000_teacher_role.sql`.

- `teachers.user_id` liga um login a um professor. Em **Professores**, o
  ícone de chave cria o acesso (usuário + senha; copia a mensagem para
  enviar), troca a senha ou remove. Edge function **`create-teacher-login`**
  (só admin da própria escola; nunca reaproveita login existente).
- O professor **vê e marca só as próprias aulas** (edita, dá como realizada,
  aprova pedido; não apaga - desmarca), vê os alunos e cadastra novos, vê os
  bloqueios e mexe só nos dele, lê lições/entregas/materiais (Evolução).
- **Não vê:** pagamentos, descontos, histórico, aulas dos outros, Financeiro,
  Relatórios, Acessos, Professores, Configurações, Assistente. O preço da aula
  é o da escola (gatilho: ele não escolhe nem altera).
- O banco é quem garante (RLS + gatilho, 18 testes no espelho, bloco 25); a
  tela só esconde o que ele não pode usar.
- Limitação conhecida: na agenda dele os horários dos **outros** professores
  aparecem livres (ele não enxerga essas aulas). Não há choque real - cada
  professor tem a própria agenda -, mas se um dia a escola quiser "sala" ou
  recurso compartilhado, precisa de uma consulta de horários ocupados.

### 6. Meio de pagamento por empresa

Migration `20260924010000_payment_per_account_and_pix.sql`.

- Configurações → Pagamento: nome do link ("InfinitePay", "Mercado Pago"...),
  texto que acompanha, nome e cidade do recebedor do Pix. A empresa do
  endereço público recebe "InfinitePay" + o texto dos 12x de hoje, então para
  o Thiago nada muda.
- Saiu o `DEFAULT 'thiago'` de `lessons.teacher` e o "mayara" cravado no
  widget Android (agora a cor alterna pela ordem dos professores).

### 7. Pix copia e cola com o valor

- `src/lib/pix.ts` gera o BR Code (EMV + CRC16) só com a chave - sem banco,
  sem API. Conferido contra o exemplo do manual do Banco Central.
- Aparece na mensagem de cobrança (com o total), no portal da família ("Copiar
  Pix de R$ X") e no Financeiro ("Copiar Pix" por família).
- **Só funciona com nome e cidade do recebedor preenchidos** em
  Configurações (o padrão do Pix exige). Sem eles, fica só a chave, como antes.

### Publicado em 24/09

- **Banco:** as 5 migrations aplicadas na produção (`payment_per_account_and_pix`,
  `school_signup_and_trial`, `teacher_role_enum`, `teacher_role` e
  `teacher_role_lint`, esta última só para dois avisos do linter). Antes, as 4
  funções substituídas foram comparadas com a produção: idênticas ao
  repositório. Depois: 22 alunos, 101 aulas e 102 lançamentos intactos;
  `expire-trials` agendado; `expire_trials` e `unique_account_slug` sem
  EXECUTE para `anon`/`authenticated`; empresa do endereço público com
  "InfinitePay" + texto dos 12x. (Os 6 alunos pausados que aparecem são da
  Escola X, a empresa de teste no Essencial - não é deste lote.)
- **Edge functions:** `delete-my-account` e `create-teacher-login` publicadas
  (JWT obrigatório).

### Ordem para publicar (como foi feito)

1. Migrations, nesta ordem: `20260924010000`, `20260924020000`,
   `20260924030000` (sozinha), `20260924040000`.
2. Edge functions: `delete-my-account` e `create-teacher-login`.
3. Mesclar, publicar o Lovable, `.aab` 1.9.0 (17).
4. Play Console: link de exclusão de conta (acima).
5. Configurações da empresa do Thiago: preencher nome e cidade do recebedor
   do Pix.

O front aguenta rodar antes das migrations (colunas novas são lidas com
`select("*")` e conferidas antes de usar), mas o cadastro de escola e o
papel de professor só funcionam depois delas.

## Lote de 24/09 (tarde) — itens da lista "PARA DEPOIS"

Pedido: "desenvolve os próximos passos; pode aceitar as mudanças de SQL sem
me perguntar". Ramo `claude/sql-development-next-steps-vsn464`.

**Situação:** a migration já está **aplicada na produção**; o código está no
ramo, **falta mesclar** (o Netlify publica sozinho), publicar o Lovable e
gerar `.aab` novo (as telas novas do portal e a divisão do JS só chegam ao
Android com ele).

### 1. Telas em arquivos separados (abertura mais rápida)

- `App.tsx` carrega cada tela com `React.lazy`; o login fica no pacote
  principal. JS principal: **1,31 MB → 585 kB** (gzip 388 → 176 kB).
- `AnimatedOutlet` tem o `Suspense`: o menu fica e só o miolo espera.
- Quem estiver com a página aberta durante uma publicação pede um arquivo que
  o Netlify já apagou; `main.tsx` recarrega uma vez (`vite:preloadError`, no
  máximo uma vez por minuto).
- Dá para cortar mais (framer-motion e Radix ainda estão no principal), mas o
  ganho grande já veio.

### 2. CI em todo PR

- Workflow **Checagens** (`.github/workflows/checks.yml`): `tsc -p`, testes,
  build e o **espelho do banco** (replay das migrations + testes de RLS, via
  `sudo ./scripts/espelho-local.sh` no Postgres 16 que o runner já traz).
  Roda em PR, no `main` e nos ramos `claude/**`. Primeira execução verde.
- O lint ficou de fora: já tem 131 erros antigos. Limpar e ligar é um item.
- Para o PR não mesclar vermelho, marcar "Checagens" como obrigatório em
  Settings → Branches (só o Thiago faz).

### 3. Primeiros passos da empresa nova

- Cartão na Hoje (só admin), `FirstSteps.tsx` + `lib/firstSteps.ts`:
  valor e forma de pagamento (Pix/link preenchido) → primeiro cliente →
  primeiro atendimento → convite para o portal (algum login ligado).
- Cada passo se marca pelo que existe no banco; o cartão some quando tudo está
  feito (quem já usa o app nunca vê) e o x esconde no aparelho.
- O "link público" da ideia original ficou de fora: só a empresa padrão tem
  página pública até existir endereço por empresa. O passo virou o convite
  para o portal, que é o que a escola nova consegue usar.

### 4. Importar clientes de planilha

- Alunos → **Importar** (só admin; também no estado vazio). Cola-se o que se
  copia da planilha (TAB) ou abre-se um CSV (`,` ou `;`, UTF-8 ou
  Windows-1252, que é como o Excel em português salva).
- Colunas nome, responsável, endereço — na ordem, ou com cabeçalho
  reconhecido pelo nome (aluno, paciente, cliente, tutor, endereço...).
- Mostra a lista antes de gravar; repetido (mesmo nome + responsável, sem
  acento/maiúscula) do cadastro ou da própria planilha fica de fora; o que
  passa do limite do plano também, e o banco confere de novo.
- `.xlsx` direto não: exigiria uma biblioteca de ~400 kB. A tela explica
  "salve como CSV ou copie e cole".

### 5. Família pede troca de horário — **no banco da produção**

Migration `20260924080000_reschedule_requests.sql` (aplicada em 24/09 como
`reschedule_requests`; antes conferido que a política substituída era igual
à do repositório).

- Em Minhas aulas, aula marcada ganha **Trocar** → a tela de pedido abre em
  modo troca (mesmo profissional e assunto já preenchidos).
- O pedido é um pedido comum com `lessons.reschedule_of` = aula que sai.
  **Aprovar** confirma a nova e desmarca a antiga na mesma transação (gatilho
  `lessons_apply_reschedule`, que só mexe nela se ainda estiver `agendada` —
  nunca desfaz aula realizada, nem cobrança). **Recusar** ou **retirar**
  deixa a antiga como estava. Um pedido de troca aberto por aula (índice).
- Na Hoje do professor o pedido mostra "Troca da aula de ter 12/10 às 14:00 -
  aprovar desmarca essa".
- A política de inserção da família exige que a aula que sai seja dela, da
  mesma empresa e ainda marcada (`can_request_reschedule`). Sem isso, um
  pedido apontando a aula de outra família a cancelaria na aprovação.
- Limitação: trocar para um horário que encosta na própria aula (mesmo
  professor, meia hora depois) dá "horário ocupado" — a trava de sobreposição
  vale entre o pedido e a aula antiga. Afrouxar não valia o risco.

### 6. Antecedência mínima dos pedidos — **no banco da produção**

- Configurações → Portal: "Antecedência mínima dos pedidos (horas)", 0 a 168,
  **padrão 0** (nada muda para ninguém até alguém preencher).
- Vale para pedir horário e para pedir troca; a tela esconde os horários
  dentro do prazo e o banco recusa de novo.
- Mudança de comportamento, pequena: mesmo com 0, a família não consegue mais
  pedir horário que **já passou** (antes o banco aceitava; a tela nunca
  oferecia).

Espelho: bloco 28, 9 testes novos. Todos os anteriores seguem passando.

### Política de falta/cancelamento: só metade — DECISÃO SUA

A antecedência (acima) é a parte que não mexe em dinheiro. **Cobrar quem
desmarca em cima da hora não foi feito**, porque muda a conta de tudo
(carteira, desconto, recibo, IR, resumo do mês) e tem perguntas que são suas:

1. Cobra o valor cheio ou uma porcentagem?
2. O desconto da família vale sobre a multa?
3. Aparece no recibo/IR como aula ou como "taxa de cancelamento"?
4. Quem decide é o professor na hora ("desmarcar e cobrar") ou é automático?

Minha sugestão: botão "Desmarcar com cobrança" no diálogo da aula, que marca
a aula como `realizada` com um aviso "falta" no resumo — reaproveita toda a
conta que já existe e não cria status novo. Mas é você quem diz.

## PARA DEPOIS (anotado em 24/09, atualizado à tarde)

Feitos na tarde de 24/09 (ver acima): primeira experiência, importar
planilha, CI, abertura mais rápida, troca de horário, antecedência mínima.

Ainda da revisão de vendabilidade:

- **Monitoramento de erros** (Sentry, plano grátis) — precisa que você crie
  a conta e me passe o DSN (é público, pode ir no `.env`).
- **Página de venda do Cronys**, com preço e botão de teste — precisa do
  preço dos planos e de onde vende (ver cobrança da assinatura).
- **Política de falta com cobrança** — as 4 perguntas acima.
- Lint limpo e ligado no CI.
- Painel do gestor mostrar o ramo de cada empresa.

Do roteiro antigo: lembrete de aula por WhatsApp; push no app; domínio →
endereço por empresa → e-mail automático; assinar a agenda (.ics); marca
própria; pacotes configuráveis; **cobrança da assinatura** (Play Billing ou
venda fora do app - necessária para o fim do teste virar receita);
WhatsApp automático e Google Agenda com escrita; notificação de pedido novo e
expiração de pedido vencido.

Pendências do Thiago (não é código): Netlify travado no painel; decidir a
tabela de backup; apagar `admin-create-user` no painel do Supabase; conferir a
URL da privacidade na Play; revisão jurídica dos termos.

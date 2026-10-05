# Teste fechado da Play - registro para o pedido de produção

Começo considerado: **26/09/2026**. Serve para responder, no fim do período, o
questionário que a Google Play faz ao liberar o app para produção. Atualizar a
cada mudança publicada (site ou `.aab`), com a **origem real** de cada uma.

## O que acontece no fim do período

Conta pessoal criada depois de nov/2023: para pedir produção, o app precisa de
um teste fechado com **pelo menos 12 testadores inscritos (opt-in) durante 14
dias seguidos**. Só contam os dias com 12 ou mais inscritos ao mesmo tempo.
Cumprido isso, aparece no Painel do Play Console o botão **"Solicitar acesso
à produção"**, com um questionário em três partes:

1. **Sobre o teste fechado**: como recrutou os testadores, quão engajados eles
   foram, **resumo do feedback recebido** e como ele foi coletado.
2. **Sobre o app**: público, o que ele oferece, expectativa de instalações.
3. **Preparação para produção**: **o que mudou por causa do teste** e como
   decidiu que o app está pronto.

A revisão costuma levar até 7 dias. Se negar, dá para testar mais e pedir de
novo.

As respostas precisam ser verdadeiras. Não é exigido que toda mudança tenha
vindo de testadores: o teste do próprio dono conta como teste interno, e o
feedback dos testadores entra à parte. Por isso cada linha abaixo diz de onde
a mudança veio de fato.

## Testadores

- Grupo: `teste-cronys@googlegroups.com` (criado em 26/09), ligado à trilha
  fechada pelo Play Console.
- Testadores internacionais pelo **Hive** (plataforma de troca de testes),
  com o login de teste `HiveApp` na empresa "Hive Demo" (inglês, dólar).
- Empresas reais usando o app no período: Kika Sport (esportes).

## Feedback recebido de testadores

Registrar aqui cada retorno, com data, quem (sem dados pessoais além do
necessário), canal e o que foi feito.

| Data | Testador / canal | O que relatou | O que foi feito |
|---|---|---|---|
| 27/09 | Kika Sport (empresa em uso), relatado ao Thiago | Criou a conta pelo cadastro de cliente, duas vezes, e ficou "sem vínculo" em vez de admin | Tela de entrar só com "criar conta" da empresa; todo cadastro novo vira admin; gestor ganhou "redefinir senha" (1.12.4) |
| 27-28/09 | Testadores do Hive (internacionais) | Precisavam do app em inglês | Ficha da loja em inglês, páginas legais em inglês, moeda e hora no formato americano, empresa de teste em inglês e dólar |
| 29/09 | Testador internacional, relatado ao Thiago | Ao entrar pela primeira vez, a tela "Bem-vindo ao Cronys" veio em português | Causa: sem empresa ainda, o app usava a língua da empresa pública (português). Agora fica na língua do aparelho; as duas empresas criadas assim foram passadas para inglês e dólar |
| 29/09 | Usuário, relatado ao Thiago | Não encontrou onde mudar a moeda (estava travada pela assinatura ativa) | "Mudar a moeda" ao lado do valor por hora; "moeda" nas descrições das seções; aviso de moeda travada com cadeado e o caminho para trocar |
| 29/09 | Testador (mensagem traduzida), relatado ao Thiago | "fiz login with gmail many functions calling same time" | Em investigação. Nos registros, o login pelo Google no app caiu no navegador em vez da janela nativa do Android, e dois testadores saíram e entraram de novo logo depois (a tela estava em português, erro já corrigido) |
| 02/10 | Testador, relatado ao Thiago; confirmado pelo Thiago no aparelho | Os avisos que aparecem embaixo a cada mudança (marcar, editar...) ficam por cima do menu | Avisos sobem acima do menu de baixo, somem em 2,5 s (os com botão, como "Avisar no WhatsApp", seguem mais tempo) e o botão ganhou a cor da marca. Chega no próximo `.aab`; no site, na próxima publicação |
| 04/10 | Testador, relatado ao Thiago | Ao entrar na escolha de língua, o app travou numa tela preta e não carregou nada | A rodinha do celular salvava a cada linha que passava, e a língua recarregava o app no meio da rolagem; agora só vale no "Pronto" (site em 04/10, app na próxima versão) |

## Mudanças no período

Origem: **T** = o Thiago testando como dono; **K** = relato da Kika Sport;
**H** = preparação para os testadores do Hive; **R** = revisão técnica;
**U** = relato de um testador ao Thiago.

### 26/09 - versões 1.12.0 a 1.12.2

| Mudança | Origem |
|---|---|
| Google Agenda por profissional (ocupado de lá bloqueia aqui; agendamentos vão para lá) e do cliente | T |
| Correção: o diálogo de atendimento abria vazio para o admin | T |
| Correção: login que não respondia a tempo virava "aguardando liberação" | T |
| Mensagens do Google Agenda na língua da empresa | T |

### 27/09 - versões 1.12.3 a 1.12.6

| Mudança | Origem |
|---|---|
| Tela de entrar só com "criar conta" da empresa; todo cadastro novo vira admin | K |
| Gestor: redefinir a senha de um login | K |
| Repetição de atendimento por dias da semana; campo numérico que não deixava apagar; serviço apagado volta a duração e o valor ao padrão; Configurações salvando sozinhas | T (lista de melhorias do Thiago - confirmar se alguma veio de testador) |
| Rota no Waze ou no Google Maps, à escolha | T |
| Configurações em seções; Minha conta dentro delas; "Como foi?" recolhível; cor pelo serviço | T |
| Links de disponibilidade juntos numa janela, com busca | T |
| Ficha da Play em inglês; moeda com símbolo livre; hora em inglês no formato 3 PM; páginas legais em inglês | H |
| Duração com rodinha, nos detalhes adicionais | T |

### 28/09 - versões 1.13.0 a 1.13.2

| Mudança | Origem |
|---|---|
| Rodinhas no lugar das listas (hora, duração, caixas de seleção); sugestões de cliente enquanto digita | T |
| Entrar com o Google (site e app, janela nativa no Android) | T |
| Responsável só em "Menor de 18 anos" fora de aulas e pet | T |
| Conta de teste protegida contra troca de senha e exclusão | H |
| Quem acessa e paga é o próprio cliente fora de aulas e pet (sem "Guardians") | T |
| Configuração guiada no primeiro acesso da empresa nova | T |
| Aviso no login: "É cliente? Entre com o usuário que a empresa te passou" | K |
| Palavras dos ramos revisadas em português e inglês | T |

### 29/09 - versão 1.13.3

| Mudança | Origem |
|---|---|
| Primeira entrada sem empresa fica na língua do aparelho | Testador (feedback de 29/09) |
| Moeda mais fácil de achar e aviso claro quando travada pela assinatura | Usuário (feedback de 29/09) |

### 01/10 - versão 1.13.4

| Mudança | Origem |
|---|---|
| Aviso de versão nova do app na tela inicial (Play In-App Updates) | T |
| Repetir atendimento "até uma data", além de por quantidade | T |

### 02/10 - versão 1.14.0

| Mudança | Origem |
|---|---|
| Rodapé "Agenda gerenciada pelo Cronys" na página pública de horários livres | T |
| Sete páginas por ramo em `/para/<ramo>` (professores, clínicas, psicólogos, salões, pet shops, personal trainers, oficinas), com sitemap | T |
| Avisos de ação (marcado, salvo...) acima do menu de baixo e mais curtos | Testador (feedback de 02/10) |
| Precaução: faixa na cor do fundo sob a barra de status, para o conteúdo nunca passar por baixo dela ao rolar (o que parecia isso no print era da captura de tela rolada, não do app) | R |
| Aviso de versão nova só na tela Hoje e no início do portal, não mais em cima do menu (no próximo `.aab`) | R |
| Correção: o botão "Links de disponibilidade" só aparece na empresa do endereço público (nas outras, o link abria a agenda errada); páginas por ramo sem prometer esse link | R |
| Página de horários por empresa: `cronys.com.br/horarios/<código>/<profissional>`, criada sozinha para toda empresa; o botão de links volta para todas, com o endereço novo | R |

### 02/10 - versão 1.15.0

| Mudança | Origem |
|---|---|
| "Horários que o cliente vê": escolha clara entre todos os horários livres e só alguns por dia (a escassez), na empresa e por profissional, com "Como funciona" explicando onde vale e como os horários são escolhidos. Saiu do "Mais opções" escondido | T |

### 03/10 - versão 1.15.1

| Mudança | Origem |
|---|---|
| Sair da conta recarrega a página do zero, e a tela "Não deu para carregar sua conta" tenta de novo sozinha uma vez: sair e entrar na mesma aba às vezes deixava o login sem resposta | T |

### 03/10 - versão 1.16.0

| Mudança | Origem |
|---|---|
| Nome de quem atende com acento e como foi cadastrado ("Bom dia, João", e não "Joao") na tela Hoje, nas aulas, pedidos, cobrança, evolução, resumo e nos portais | T |
| "Horários que o cliente vê": 0 vale no mínimo e no máximo (máximo 0 = o dia aparece sem horários) | T |
| E-mails automáticos, que cada empresa liga em Configurações (nascem desligados): ao cliente e ao responsável (marcado, horário alterado, cancelado, pedido recebido/aprovado/recusado, lembrete na véspera às 18h e/ou no dia às 7h), ao profissional (mudanças na própria agenda) e aos admins (pedido novo). Saem de lembretes@cronys.com.br com o nome da empresa, "Responder" vai para o contato dela, e todo e-mail tem o link para não receber mais. Campos de e-mail no cadastro do cliente, do responsável e do profissional | T |
| "Esqueci a senha" na tela de entrar: link por e-mail e a página para criar a senha nova | T |
| Entrar com a digital (ou o rosto) no app Android: oferecido depois de entrar com senha; dá para desligar em Minha conta (só funciona no app) | T |

### 03/10 - versão 1.16.1

| Mudança | Origem |
|---|---|
| "Mandar um e-mail de teste": quando o envio falha, o aviso diz que falhou (antes dizia, errado, que o login precisava de um e-mail de verdade) | T |
| "E-mail para avisos" em Minha conta: o profissional, o cliente e o responsável põem o próprio e-mail (antes só o admin preenchia, e quem entra com usuário não tinha onde dizer) | T |
| Aviso na tela inicial "Quer receber os avisos por e-mail?" para o profissional e o cliente que entram com usuário e ainda não deram e-mail, quando a empresa liga os e-mails; "Agora não" esconde para aquele login | T |
| E-mails com visual novo: nome da empresa no topo, o tipo em destaque (marcada, horário alterado, cancelada, lembrete), data, horário de início e fim, quem atende, assunto e local em linhas separadas, o local abre no mapa, e fundo claro fixo | T |
| Nome de quem atende com maiúscula no e-mail ("Thiago", e não "thiago", quando o cadastro está em minúsculas) | T |
| "Cancelar o recebimento" numa linha só, longe do texto; abrir o link só pergunta, e quem saiu tem o botão "Foi sem querer: voltar a receber" (o Thiago tocou sem querer no link antigo, que tirava da lista na hora) | T |
| "E-mail para avisos" do cliente com responsável: cada campo diz de quem é ("E-mail de Testinho Jr" e "E-mail de Teste, responsável") e dá para preencher só um (antes "Seu e-mail" confundia quem usa o login da família) | T |
| "E-mail para avisos" conforme quem entra: no login da família, "Seu e-mail" é o do responsável e o do aluno fica recolhido ("Adicionar o e-mail de ..."); no login do aluno, só o dele, já com o que a família tiver posto; o aviso de primeira entrada aparece também no painel do aluno | T |

### 03/10 - versão 1.17.0

| Mudança | Origem |
|---|---|
| Cobrança por e-mail: automática (no fim do dia em que houve atendimento, toda segunda e/ou todo mês num dia escolhido; a empresa liga as que quiser, nos planos Start, Pro e Max) só para quem tem valor em aberto, com os itens, o total, o Pix copia e cola já com o valor e o link de pagamento; e na mão, no Financeiro ("Cobrar por e-mail", "Cobrar todos por e-mail", "Enviar extrato por e-mail") | T |
| "Pagamento recebido" por e-mail, com o recibo em PDF anexo (Start, Pro e Max) | T |
| "Lembrar por e-mail" no atendimento marcado, em todos os planos | T |
| Histórico dos e-mails enviados (em Configurações e por conta no Financeiro), com o que o Resend disse depois: entregue, voltou ou marcado como spam; e-mail que voltou aparece no cadastro do cliente e do profissional | T |
| Descadastro por tipo: a pessoa escolhe quais e-mails quer continuar recebendo (marcações, lembretes, cobranças...) ou para de receber todos | T |
| O "Responder" dos e-mails vai para o admin quando a empresa não preencheu o e-mail de contato (antes ia para um endereço sem caixa) | T |
| E-mails novos, cada um liga e desliga em Configurações: tarefa nova; tarefas pendentes junto do lembrete da véspera; resumo do atendimento para a família quando o profissional escreve; pacote acabando e pacote encerrado (Start, Pro e Max); agenda de amanhã às 18h para cada profissional e para os admins | T |
| Personalização dos e-mails: logo, cor e assinatura (Pro e Max); assunto e mensagem de cada e-mail com campos como {nome} e {valor}, e a hora dos lembretes (Max). O e-mail de teste já sai com essa cara | T |
| E-mails de login (confirmar cadastro, senha nova, troca de e-mail...) pelo remetente do Cronys, em português ou inglês conforme a pessoa; passa a valer quando o hook for ligado no painel do Supabase | T |
| Tarefas por ramo: o nome muda (Tarefas nas aulas, Orientações na saúde, Atividades na psicologia, Treinos para casa nos esportes, Cuidados em beleza e pet) e só vêm ligadas em aulas, saúde, psicologia e esportes; interruptor "Usar ..." em Configurações → Portal; desligadas somem do menu, do painel, do cadastro, da Evolução e dos e-mails (o que já existe fica guardado) | T |
| Fora das aulas, a tarefa se marca como feita (o arquivo fica opcional); e mandar o arquivo agora marca a tarefa como entregue (antes ficava "pendente") | T |

### 04/10 - versão 1.18.0

| Mudança | Origem |
|---|---|
| Erros do site e do app vão para o Sentry (só nas versões publicadas), sem dado pessoal: sem IP nem cookies, e e-mail, telefone, CPF, CNPJ e tokens saem trocados por [removido]; o erro leva só o id de quem está logado e a versão | T |
| Um erro que derrubava a tela inteira deixava a página em branco; agora aparece "Algo deu errado" com o botão "Recarregar" | T |

### 04 e 05/10 - site (o app recebe no próximo `.aab`)

| Mudança | Origem |
|---|---|
| No celular, escolher a língua (e qualquer outra caixa com a rodinha) travava em tela preta: cada linha que passava já salvava, e a língua recarregava o app inteiro no meio da rolagem. Agora a escolha só vale ao tocar em "Pronto" ou fechar a gaveta | U |
| Link de reunião nos atendimentos on-line: cada profissional escolhe (em Configurações → Integrações, ou em Minha conta no login de profissional) entre nenhum automático, a própria sala fixa (Zoom, Meet, Teams...), uma sala do Jitsi Meet por atendimento (grátis, com instruções de uso na tela) ou um Google Meet por atendimento (Pro e Max, com o Google Agenda conectado; sem ele, cai no Jitsi). Dá para colar outro link no próprio atendimento | T |
| O link vai junto: botão "Entrar" na agenda, no início e no portal do cliente (e no login do filho), "Entrar na aula" no lembrete do dia e da véspera por e-mail, no lembrete do WhatsApp (campo novo {link}) e no evento do Google Agenda | T |

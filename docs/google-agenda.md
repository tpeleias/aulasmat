# Google Agenda - como ligar (passo a passo do Thiago)

O código já está pronto e publicado no Supabase (migration
`20260926140000_google_calendar.sql`, função `google-calendar`). Falta só o
lado do Google, que precisa ser feito por você com a sua conta. São ~15
minutos. Depois disso o botão "Conectar Google" funciona.

## O que o recurso faz (para conferir se é isso mesmo)

- Pro e Max. Cada profissional conecta a própria conta Google. A conexão fica
  em **Bloqueios** (o profissional com login vê só a dele) e em
  **Configurações** (o admin vê todos).
- **Importar ocupado** (switch): o que está ocupado na agenda principal do
  Google vira bloqueio "Ocupado (Google)" no Cronys - na agenda, na vitrine
  pública e no portal do cliente. Só o horário; título e convidados nunca são
  lidos. Evento marcado como "Disponível" no Google não bloqueia.
- **Exportar agendamentos** (switch): os agendamentos confirmados vão para uma
  agenda separada chamada **"Cronys"** dentro do Google da pessoa, com o nome
  do cliente e o serviço. Pedido ainda não aceito, cancelado e recusado não vão.
  Mudou no Cronys, muda lá (em até 1 minuto); mexer no evento lá é desfeito.
- Atualização: exportação em até 1 minuto depois de mexer na aula; ocupado do
  Google a cada 10 minutos e sempre que alguém abre a agenda.
- Desconectar apaga a agenda "Cronys" do Google, tira o ocupado importado e
  revoga o acesso.

## 1. Criar o projeto no Google Cloud

1. Entre em <https://console.cloud.google.com> com a conta que vai ser "dona"
   do Cronys no Google.
2. No seletor de projetos (topo da página) → **Novo projeto** → nome
   **Cronys** → Criar. Confira que ele ficou selecionado.
3. Menu → **APIs e serviços → Biblioteca** → procure **Google Calendar API**
   → **Ativar**.

## 2. Tela de consentimento (Google Auth Platform)

Menu → **APIs e serviços → Tela de permissão OAuth** (o Google leva para
"Google Auth Platform") → **Começar**:

- Nome do app: **Cronys**
- E-mail de suporte: o seu
- Público: **Externo**
- E-mail de contato: o seu → aceitar a política → Criar.

Depois, nas abas da esquerda:

**Branding (Marca)**
- Página inicial: `https://cronys.com.br`
- Política de privacidade: `https://cronys.com.br/privacidade`
- Termos de serviço: `https://cronys.com.br/termos`
- Domínios autorizados: `cronys.com.br`
- Logo: **deixe sem por enquanto** (logo obriga a verificação da marca antes
  de funcionar).

**Acesso a dados (Data access)** → **Adicionar ou remover escopos** → no fim da
lista, em "Adicionar escopos manualmente", cole as quatro linhas e clique em
Adicionar à tabela → Atualizar → Salvar:

```
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/calendar.freebusy
https://www.googleapis.com/auth/calendar.app.created
```

São as permissões mais estreitas que resolvem: ver só se está ocupado, e mexer
só na agenda que o próprio Cronys criou. Nada de ler ou editar as outras.

**Público (Audience)**
- Em **Usuários de teste**, adicione o seu e-mail e o de quem for testar.
- **Importante:** enquanto o app estiver em "Teste", o Google derruba a
  conexão a cada 7 dias. Para uso de verdade, clique em **Publicar app**
  (status "Em produção"). Sem a verificação (passo 5), quem conectar vê um
  aviso "o Google não verificou este app" (dá para seguir em "Avançado") e o
  limite é de 100 pessoas. Para os testadores isso basta.

## 3. Criar a chave (cliente OAuth)

**Clientes (Clients)** → **Criar cliente**:

- Tipo: **Aplicativo da Web**
- Nome: `Cronys web`
- URIs de redirecionamento autorizados → Adicionar URI:
  `https://cronys.com.br/google-agenda/callback`
- Criar. Aparecem o **ID do cliente** e a **Chave secreta do cliente**.

(Não precisa de "Origens JavaScript autorizadas".)

## 4. Colocar a chave no Supabase

Não mande a chave secreta pelo chat. Cole direto no Supabase:

1. <https://supabase.com/dashboard/project/dqfzuviwejlobrwebyum/functions/secrets>
2. **Add new secret** duas vezes:
   - `GOOGLE_CLIENT_ID` = o ID do cliente
   - `GOOGLE_CLIENT_SECRET` = a chave secreta
3. Salvar. Não precisa republicar a função.

Por último, **mesclar o PR** desta mudança: é o `main` que publica no Netlify a
regra `public/_redirects` que leva `cronys.com.br/google-agenda/callback` até a
função, e as telas novas.

Teste: entre como admin de uma empresa Pro/Max → Bloqueios → **Conectar
Google** → escolher a conta → marcar as duas caixas → volta para "Google
Agenda conectado". Crie um compromisso no Google e abra a agenda do Cronys; crie
uma aula no Cronys e veja a agenda "Cronys" no Google.

## 5. Verificação do Google (depois, sem pressa)

Necessária para tirar o aviso de "app não verificado" e passar de 100 pessoas.
É a parte lenta (dias a semanas), e só você pode fazer:

1. Provar que o domínio é seu: <https://search.google.com/search-console> →
   adicionar a propriedade `cronys.com.br` (Domínio) → o Google dá um registro
   TXT → colar no DNS (onde o domínio está) → Verificar.
2. Google Auth Platform → **Central de verificação** → Enviar para
   verificação. Eles pedem:
   - um **vídeo** (YouTube, pode ser não listado) mostrando: a tela de
     consentimento com o endereço do navegador visível, o botão "Conectar
     Google" no Cronys, o ocupado aparecendo como bloqueio e o agendamento
     aparecendo na agenda "Cronys";
   - a justificativa de cada permissão. Texto sugerido:
     - *calendar.freebusy*: "Lemos apenas os intervalos ocupados da agenda
       principal para impedir que clientes marquem atendimento nesses
       horários. Não lemos títulos, descrições nem participantes."
     - *calendar.app.created*: "Criamos uma agenda secundária chamada 'Cronys'
       e mantemos nela os atendimentos do profissional. Não acessamos nenhuma
       outra agenda ou evento."
3. A política de privacidade já tem a seção "Google Agenda (opcional)" com a
   frase de Uso Limitado que o Google exige.

## Se algo der errado

- A tela mostra "Com erro" e a mensagem embaixo do profissional.
- Logs: Supabase → Edge Functions → `google-calendar` → Logs.
- "Sem acesso": a pessoa tirou a permissão no Google (ou 7 dias em modo
  Teste). Basta **Reconectar**.

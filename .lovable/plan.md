# Plano: Trocar Lovable Cloud pelo Supabase externo

## Estado confirmado

O app aponta atualmente para o projeto gerenciado pelo Lovable Cloud nas três configurações de conexão do frontend. O projeto externo informado tem outro identificador, URL e chave pública.

## Troca de conexão

1. Desconectar o Lovable Cloud atual em **Cloud → Advanced → Disconnect**.
2. Autorizar a conexão com sua conta Supabase pela interface do editor e selecionar exatamente o projeto `dqfzuviwejlobrwebyum`.
3. Confirmar que a integração atualizou a URL, a chave pública e o identificador usados pelo app.
4. Não executar migrations, comandos SQL, cópias de dados ou deploys de funções.
5. Validar somente leitura e autenticação: abrir o app, entrar com uma conta existente e conferir uma consulta simples já suportada pelo schema externo.

## Credenciais

- A chave pública fornecida é suficiente para o frontend.
- Não será solicitada nem usada a `service_role` nesta troca, pois não haverá operação administrativa direta no banco nem deploy de função.
- A autorização da sua conta Supabase será feita pela interface do editor; nenhuma credencial privada será colocada no código.

## Limite de escopo

- Nenhum schema, dado, trigger, função, cron job, política ou Edge Function será criado, alterado ou sobrescrito.
- A implementação das integrações MCP fica pausada até a nova conexão estar validada.

## Aviso obrigatório

Desconectar o Lovable Cloud é irreversível e apaga permanentemente os dados, arquivos e funções hospedados na instância gerenciada atual. O processo só deve avançar após confirmar que o projeto externo contém a cópia completa e operacional.
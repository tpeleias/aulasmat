// DESATIVADA. Esta função não existe mais como funcionalidade - o que sobrou
// aqui é uma lápide, que recusa tudo.
//
// O que ela fazia: criava contas de autenticação com a chave mestra. Nasceu sem
// checagem nenhuma (bastava estar logado, inclusive como aluno, para criar
// contas à vontade); depois ganhou uma exigência de ser admin. Nenhuma tela do
// app jamais a chamou - conferido por grep em src/ e em .github/. Quem cria
// acesso de aluno é `create-child-account` e `link-student-account`.
//
// Por que uma lápide em vez de simplesmente apagar o arquivo: as ferramentas
// disponíveis aqui publicam edge functions, mas não removem. Apagar só o
// arquivo do repositório deixaria a versão ANTIGA, com a chave mestra, rodando
// na produção, e sem fonte no repositório para alguém conferir. Isso é pior do
// que hoje. Assim a porta fecha de verdade agora, e o repositório continua
// dizendo a verdade sobre o que está publicado.
//
// Para terminar o serviço: apagar a função no painel do Supabase (Edge
// Functions -> admin-create-user -> Delete) e remover este diretório.
//
// Nada aqui importa o cliente do Supabase de propósito: sem import, a função
// não tem como alcançar a chave mestra nem o banco, aconteça o que acontecer.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // 410 Gone, e não 404: quem chamar isso descobre que a função existiu e foi
  // removida de propósito, em vez de achar que errou o endereço.
  return new Response(
    JSON.stringify({
      error: "gone",
      message:
        "admin-create-user foi desativada. Para criar acesso de aluno use o app " +
        "(Acessos), que passa por create-child-account ou link-student-account.",
    }),
    { status: 410, headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});

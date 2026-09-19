import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Esta função não tinha checagem nenhuma: bastava estar logado para criar
    // contas de autenticação à vontade. Nenhuma tela do app a chama - o certo
    // seria removê-la, mas enquanto isso ela exige ser admin de uma empresa, e
    // o usuário criado entra nessa empresa.
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "content-type": "application/json" } });

    const { data: roleRow } = await admin.from("user_roles").select("role, account_id").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow?.account_id) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "content-type": "application/json" } });
    const accountId = roleRow.account_id as string;

    const { email, password } = await req.json();
    if (!email || !password) return new Response(JSON.stringify({ error: "missing" }), { status: 400, headers: corsHeaders });
    const { data: existing } = await admin.auth.admin.listUsers();
    if (existing.users.find(u => u.email === email)) {
      return new Response(JSON.stringify({ ok: true, message: "already exists" }), { headers: { ...corsHeaders, "content-type": "application/json" } });
    }
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });
    if (data.user) {
      await admin.from("user_roles").update({ account_id: accountId }).eq("user_id", data.user.id);
    }
    return new Response(JSON.stringify({ ok: true, user: data.user?.id }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});

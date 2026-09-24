// Excluir a PRÓPRIA conta (exigência da Google Play para apps com cadastro).
//
// Apaga o login de quem chama - e só dele: o usuário vem do token, nunca do
// corpo da requisição. Os dados da escola (aulas, pagamentos, cadastro do
// aluno) ficam: são da escola, que pode precisar deles para o controle
// financeiro. O que some é o acesso e o vínculo desse login com o cadastro.
//
// Duas contas não se apagam por aqui, de propósito:
//   - o único admin de uma escola: a escola ficaria sem ninguém para
//     administrá-la. Encerrar a escola é com a Cronys (gestor);
//   - o operador da plataforma.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "EXCLUIR") return json({ error: "Confirmação ausente." }, 400);

    const admin = createClient(url, serviceKey);

    const { data: operador } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (operador) return json({ error: "A conta do gestor da plataforma não é excluída por aqui." }, 403);

    const { data: roles } = await admin.from("user_roles").select("role, account_id").eq("user_id", user.id);
    for (const r of (roles ?? []) as { role: string; account_id: string | null }[]) {
      if (r.role !== "admin" || !r.account_id) continue;
      const { count } = await admin.from("user_roles").select("user_id", { count: "exact", head: true })
        .eq("account_id", r.account_id).eq("role", "admin");
      if ((count ?? 0) <= 1) {
        return json({
          error: "Você é o único administrador desta empresa. Para encerrar a empresa e apagar os dados dela, fale com o suporte do Cronys.",
          code: "unico-admin",
        }, 409);
      }
    }

    // Desfaz os vínculos antes de apagar, para nenhum cadastro ficar
    // apontando para um login que não existe mais.
    await admin.from("students").update({ user_id: null, guardian_username: null }).eq("user_id", user.id);
    await admin.from("students").update({ child_user_id: null, child_username: null }).eq("child_user_id", user.id);
    // teachers.user_id só existe depois da migration do papel de professor.
    await admin.from("teachers").update({ user_id: null }).eq("user_id", user.id).then(() => {}, () => {});

    const { error: dErr } = await admin.auth.admin.deleteUser(user.id);
    if (dErr) return json({ error: dErr.message }, 400);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});

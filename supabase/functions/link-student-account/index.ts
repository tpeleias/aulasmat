import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate caller is admin
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "unauthorized" }, 401);
    const admin = createClient(url, serviceKey);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "forbidden" }, 403);

    const { student_id, email, password } = await req.json();
    if (!student_id || !email) return json({ error: "student_id e email obrigatórios" }, 400);

    // Find or create auth user
    const { data: existing } = await admin.auth.admin.listUsers();
    let targetUser = existing.users.find(u => u.email?.toLowerCase() === String(email).toLowerCase());
    if (!targetUser) {
      if (!password) return json({ error: "Usuário não existe. Informe uma senha temporária para criar a conta." }, 400);
      const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (cErr || !created.user) return json({ error: cErr?.message || "erro ao criar usuário" }, 400);
      targetUser = created.user;
    }

    // Ensure student role
    await admin.from("user_roles").upsert({ user_id: targetUser.id, role: "student" }, { onConflict: "user_id,role" });

    // Link student row
    const { error: linkErr } = await admin.from("students").update({ user_id: targetUser.id }).eq("id", student_id);
    if (linkErr) return json({ error: linkErr.message }, 400);

    return json({ ok: true, user_id: targetUser.id, email });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USERNAME_DOMAIN = "aluno.sistema.local";
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, serviceKey);

    const body = await req.json();
    const student_id = String(body?.student_id ?? "");
    const usernameRaw = String(body?.username ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const action = String(body?.action ?? "create"); // create | reset

    if (!student_id) return json({ error: "student_id obrigatório" }, 400);
    if (!password || password.length < 6) return json({ error: "Senha deve ter ao menos 6 caracteres" }, 400);

    // Authorization: admin OR the guardian linked to this student
    const { data: adminRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    const isAdmin = !!adminRow;

    const { data: studentRow, error: sErr } = await admin.from("students").select("*").eq("id", student_id).maybeSingle();
    if (sErr || !studentRow) return json({ error: "Aluno não encontrado" }, 404);

    const isGuardian = studentRow.user_id === user.id;
    if (!isAdmin && !isGuardian) return json({ error: "forbidden" }, 403);

    // CREATE flow
    if (action === "create") {
      if (!USERNAME_RE.test(usernameRaw)) {
        return json({ error: "Username inválido. Use 3-30 caracteres: letras minúsculas, números, ponto, traço ou underline." }, 400);
      }
      if (studentRow.child_user_id) return json({ error: "Este aluno já possui acesso. Use redefinir senha." }, 400);

      const email = `${usernameRaw}@${USERNAME_DOMAIN}`;

      // Check uniqueness
      const { data: dupe } = await admin.from("students").select("id").eq("child_username", usernameRaw).maybeSingle();
      if (dupe) return json({ error: "Este username já está em uso." }, 400);

      // Find or create auth user
      const { data: existing } = await admin.auth.admin.listUsers();
      let target = existing.users.find(u => u.email?.toLowerCase() === email);
      if (!target) {
        const { data: c, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (cErr || !c.user) return json({ error: cErr?.message || "erro ao criar usuário" }, 400);
        target = c.user;
      } else {
        // Update its password
        await admin.auth.admin.updateUserById(target.id, { password });
      }

      await admin.from("user_roles").upsert({ user_id: target.id, role: "child" }, { onConflict: "user_id,role" });
      // Ensure the child account doesn't also carry the auto-assigned 'student' role.
      await admin.from("user_roles").delete().eq("user_id", target.id).eq("role", "student");

      const { error: upErr } = await admin.from("students")
        .update({ child_user_id: target.id, child_username: usernameRaw, child_must_change_password: true })
        .eq("id", student_id);
      if (upErr) return json({ error: upErr.message }, 400);

      return json({ ok: true, username: usernameRaw });
    }

    // RESET flow
    if (action === "reset") {
      if (!studentRow.child_user_id) return json({ error: "Aluno não possui acesso cadastrado." }, 400);
      const { error: pErr } = await admin.auth.admin.updateUserById(studentRow.child_user_id, { password });
      if (pErr) return json({ error: pErr.message }, 400);
      await admin.from("students").update({ child_must_change_password: true }).eq("id", student_id);
      return json({ ok: true, username: studentRow.child_username });
    }

    return json({ error: "ação inválida" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

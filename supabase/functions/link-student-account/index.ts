import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Not every family has an e-mail they check, so a guardian can also get a username.
// Auth still needs an address, so the username becomes one on an internal domain.
const USERNAME_DOMAIN = "aluno.sistema.local";
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

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

    const { student_id, email, username, password } = await req.json();
    if (!student_id) return json({ error: "student_id obrigatório" }, 400);
    if (!email && !username) return json({ error: "Informe o e-mail ou o nome de usuário" }, 400);

    let loginEmail: string = email;
    let guardianUsername: string | null = null;

    if (username) {
      const uname = String(username).trim().toLowerCase();
      if (!USERNAME_RE.test(uname)) {
        return json({ error: "Usuário inválido. Use 3-30 caracteres: letras minúsculas, números, ponto, traço ou underline." }, 400);
      }
      if (!password || String(password).length < 6) {
        return json({ error: "Defina uma senha de ao menos 6 caracteres para o acesso por usuário." }, 400);
      }
      // The same name must never serve two logins: a guardian taking a student's username
      // would inherit a portal that shows money.
      const [{ data: asChild }, { data: asGuardian }] = await Promise.all([
        admin.from("students").select("id").ilike("child_username", uname).maybeSingle(),
        admin.from("students").select("id").ilike("guardian_username", uname).maybeSingle(),
      ]);
      if (asChild || asGuardian) return json({ error: "Esse nome de usuário já está em uso." }, 400);

      loginEmail = `${uname}@${USERNAME_DOMAIN}`;
      guardianUsername = uname;
    }

    // Find or create auth user
    const { data: existing } = await admin.auth.admin.listUsers();
    let targetUser = existing.users.find(u => u.email?.toLowerCase() === String(loginEmail).toLowerCase());
    let created = false;
    if (targetUser && guardianUsername) {
      return json({ error: "Já existe uma conta com esse nome de usuário." }, 400);
    }
    if (!targetUser) {
      if (!password) return json({ error: "Usuário não existe. Informe uma senha temporária para criar a conta." }, 400);
      const { data: c, error: cErr } = await admin.auth.admin.createUser({ email: loginEmail, password, email_confirm: true });
      if (cErr || !c.user) return json({ error: cErr?.message || "erro ao criar usuário" }, 400);
      targetUser = c.user;
      created = true;
    }

    // Ensure student role
    await admin.from("user_roles").upsert({ user_id: targetUser.id, role: "student" }, { onConflict: "user_id,role" });

    // Link student row + force password change on first login when we just set the password
    const { error: linkErr } = await admin.from("students")
      .update({ user_id: targetUser.id, must_change_password: created, guardian_username: guardianUsername })
      .eq("id", student_id);
    if (linkErr) return json({ error: linkErr.message }, 400);

    return json({ ok: true, user_id: targetUser.id, email: loginEmail, username: guardianUsername });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

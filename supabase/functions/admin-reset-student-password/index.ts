import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function genPassword(len = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, serviceKey);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "forbidden" }, 403);

    const { student_id, new_password } = await req.json();
    if (!student_id) return json({ error: "student_id obrigatório" }, 400);

    const { data: student, error: sErr } = await admin.from("students").select("id,user_id,student_name").eq("id", student_id).maybeSingle();
    if (sErr || !student) return json({ error: "aluno não encontrado" }, 404);
    if (!student.user_id) return json({ error: "Este aluno ainda não tem conta vinculada." }, 400);

    const password = (typeof new_password === "string" && new_password.length >= 6) ? new_password : genPassword(10);

    const { error: pErr } = await admin.auth.admin.updateUserById(student.user_id, { password });
    if (pErr) return json({ error: pErr.message }, 400);

    await admin.from("students").update({ must_change_password: true }).eq("id", student.id);

    return json({ ok: true, password });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

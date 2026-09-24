// Login próprio de um professor da equipe (papel 'teacher').
//
// Só o admin da escola chama. O login é um usuário (sem e-mail), como o do
// aluno: `usuario@aluno.sistema.local` por baixo. Ações:
//   create - cria o login e liga ao professor (teachers.user_id);
//   reset  - troca a senha;
//   remove - apaga o login (o professor e as aulas dele ficam).
//
// A chave mestra ignora as regras do banco, então tudo aqui é conferido
// contra a empresa de quem chama.
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
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, serviceKey);

    const { data: adminRole } = await admin.from("user_roles").select("account_id")
      .eq("user_id", user.id).eq("role", "admin").not("account_id", "is", null).limit(1).maybeSingle();
    const accountId = (adminRole?.account_id ?? null) as string | null;
    if (!accountId) return json({ error: "Só o administrador da empresa cria acesso para a equipe." }, 403);

    const body = await req.json().catch(() => ({}));
    const teacherId = String(body?.teacher_id ?? "");
    const action = String(body?.action ?? "create");
    const username = String(body?.username ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    const { data: teacher } = await admin.from("teachers").select("id, name, user_id")
      .eq("id", teacherId).eq("account_id", accountId).maybeSingle();
    if (!teacher) return json({ error: "Cadastro não encontrado." }, 404);

    if (action === "create") {
      if (teacher.user_id) return json({ error: "Este cadastro já tem acesso. Use trocar senha." }, 400);
      if (!USERNAME_RE.test(username)) {
        return json({ error: "Usuário inválido. Use 3-30 caracteres: letras minúsculas, números, ponto, traço ou underline." }, 400);
      }
      if (password.length < 6) return json({ error: "A senha precisa ter ao menos 6 caracteres." }, 400);

      // Nunca reaproveita um login existente: poderia ser de outra pessoa.
      const { data: c, error: cErr } = await admin.auth.admin.createUser({
        email: `${username}@${USERNAME_DOMAIN}`, password, email_confirm: true,
      });
      if (cErr || !c.user) {
        const taken = /already|registered|exists/i.test(cErr?.message ?? "");
        return json({ error: taken ? "Este usuário já está em uso." : (cErr?.message || "Erro ao criar o acesso.") }, 400);
      }
      const newId = c.user.id;

      // handle_new_user deu a esse login um papel na empresa do endereço
      // público. Sai tudo, fica só o de professor nesta escola.
      await admin.from("user_roles").delete().eq("user_id", newId);
      const { error: rErr } = await admin.from("user_roles").insert({ user_id: newId, role: "teacher", account_id: accountId });
      const { error: tErr } = rErr ? { error: rErr } : await admin.from("teachers").update({ user_id: newId }).eq("id", teacher.id).eq("account_id", accountId);
      if (rErr || tErr) {
        await admin.auth.admin.deleteUser(newId);
        return json({ error: (rErr ?? tErr)!.message }, 400);
      }
      return json({ ok: true, username });
    }

    if (action === "reset") {
      if (!teacher.user_id) return json({ error: "Este cadastro ainda não tem acesso." }, 400);
      if (password.length < 6) return json({ error: "A senha precisa ter ao menos 6 caracteres." }, 400);
      const { error } = await admin.auth.admin.updateUserById(teacher.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "remove") {
      if (!teacher.user_id) return json({ ok: true });
      // Só apaga se o login for mesmo só de professor - um admin que também
      // estivesse ligado ao professor perderia o acesso à escola.
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", teacher.user_id);
      if ((roles ?? []).some((r: { role: string }) => r.role !== "teacher")) {
        await admin.from("teachers").update({ user_id: null }).eq("id", teacher.id).eq("account_id", accountId);
        return json({ ok: true, unlinked: true });
      }
      const { error } = await admin.auth.admin.deleteUser(teacher.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "ação inválida" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

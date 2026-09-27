// O gestor da plataforma: criar e excluir empresas, e redefinir a senha de um login.
//
// Só existem aqui as operações que precisam da API de autenticação, que o
// SQL não alcança: criar o login do primeiro admin, apagar os logins de uma
// empresa excluída e trocar a senha de um login. Ler o painel e ligar/desligar empresa são RPCs chamadas
// direto pelo app.
//
// A autorização acontece DUAS vezes, de propósito:
//
//   1. aqui, antes de qualquer coisa, porque daqui para baixo roda com a chave
//      mestra e as regras do banco não valem;
//   2. de novo dentro de cada RPC, que é chamada com o token do próprio
//      usuário (userClient) e não com a chave mestra - então is_platform_admin()
//      é avaliado para quem chamou de verdade.
//
// A segunda é a que vale se a primeira um dia for escrita errado. É o inverso
// do que aconteceu com register_payment, onde a única guarda existente não
// guardava nada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mesma regra do app (src/lib/username.ts): o que não tem "@" é um apelido de
// login, guardado como endereço num domínio interno.
const USERNAME_DOMAIN = "aluno.sistema.local";
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/** Senha provisória legível: sem 0/O, 1/l/I. */
function genPassword(len = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, n => chars[n % chars.length]).join("");
}

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

    // Guarda 1.
    const { data: operator } = await admin
      .from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!operator) return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const action = String(body?.action ?? "");

    // -----------------------------------------------------------------------
    if (action === "create_account") {
      const name = String(body?.name ?? "").trim();
      const slug = String(body?.slug ?? "").trim().toLowerCase();
      const loginRaw = String(body?.login ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");

      if (!password || password.length < 8) {
        return json({ error: "A senha do admin deve ter ao menos 8 caracteres." }, 400);
      }
      const isUsername = !loginRaw.includes("@");
      if (isUsername && !USERNAME_RE.test(loginRaw)) {
        return json({ error: "Login inválido. Use um e-mail, ou um apelido de 3 a 30 caracteres (letras minúsculas, números, ponto, traço ou underline)." }, 400);
      }
      const email = isUsername ? `${loginRaw}@${USERNAME_DOMAIN}` : loginRaw;

      // A empresa primeiro: se o nome ou o apelido forem recusados, nenhum
      // login foi criado e não sobra lixo em auth.users.
      const { data: created, error: cErr } = await userClient.rpc("platform_create_account", {
        _name: name, _slug: slug,
      });
      if (cErr) return json({ error: cErr.message }, 400);
      const accountId = (created as { id: string }).id;

      const { data: newUser, error: nErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (nErr || !newUser?.user) {
        // Desfaz a empresa recém-criada. Ela está vazia e nunca esteve no ar,
        // então some sem passar pelo ritual de exclusão.
        await admin.from("settings").delete().eq("account_id", accountId);
        await admin.from("accounts").delete().eq("id", accountId);
        return json({ error: nErr?.message ?? "Não foi possível criar o login do admin." }, 400);
      }

      // Imediatamente depois de criar, e não mais tarde: o gatilho
      // handle_new_user joga todo usuário novo na empresa do endereço público
      // enquanto ela for a única ativa. É esta chamada que tira o login de lá e
      // o põe na empresa certa.
      const { error: aErr } = await userClient.rpc("platform_attach_admin", {
        _account: accountId, _user: newUser.user.id,
      });
      if (aErr) {
        await admin.auth.admin.deleteUser(newUser.user.id);
        await admin.from("settings").delete().eq("account_id", accountId);
        await admin.from("accounts").delete().eq("id", accountId);
        return json({ error: aErr.message }, 400);
      }

      return json({ ok: true, account: created, login: email });
    }

    // -----------------------------------------------------------------------
    if (action === "delete_account") {
      const accountId = String(body?.account_id ?? "");
      const confirmName = String(body?.confirm_name ?? "");
      if (!accountId) return json({ error: "account_id obrigatório" }, 400);

      // Todas as travas (operador, empresa desativada, não ser a do endereço
      // público, nome conferido) estão dentro desta RPC, e o arquivo com tudo
      // o que será apagado é escrito antes de apagar qualquer coisa.
      const { data: result, error: dErr } = await userClient.rpc("platform_delete_account", {
        _account: accountId, _confirm_name: confirmName,
      });
      if (dErr) return json({ error: dErr.message }, 400);

      // Os logins saem por último e por fora do SQL: auth.users é do serviço de
      // autenticação, e mexer nele à mão é a origem do login que "aceita a
      // senha e falha assim mesmo" registrado em docs/proximos-passos.md.
      const ids = ((result as { user_ids?: string[] })?.user_ids ?? []);
      const failed: string[] = [];
      for (const id of ids) {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) failed.push(id);
      }

      return json({ ok: true, ...(result as object), logins_removidos: ids.length - failed.length, logins_com_falha: failed });
    }

    // -----------------------------------------------------------------------
    // Redefinir a senha de um login, para quem não consegue entrar. A senha
    // nova volta na resposta: o gestor a repassa à pessoa.
    if (action === "reset_password") {
      const loginRaw = String(body?.login ?? "").trim().toLowerCase();
      const typed = String(body?.password ?? "");
      if (!loginRaw) return json({ error: "Informe o login." }, 400);
      const email = loginRaw.includes("@") ? loginRaw : `${loginRaw}@${USERNAME_DOMAIN}`;
      if (typed && typed.length < 8) return json({ error: "A senha nova deve ter ao menos 8 caracteres." }, 400);

      const { data: found, error: fErr } = await userClient.rpc("platform_login_lookup", { _email: email });
      if (fErr) return json({ error: fErr.message }, 400);
      const target = (Array.isArray(found) ? found[0] : found) as
        { user_id: string; account_name: string | null; role: string | null; is_operator: boolean } | undefined;
      if (!target) return json({ error: "Nenhum login com esse e-mail ou usuário." }, 404);
      // Senha de operador não se troca por aqui: quem roubasse uma sessão de
      // gestor tomaria as outras.
      if (target.is_operator) return json({ error: "Senha de gestor não se redefine por aqui." }, 403);

      const password = typed || genPassword(10);
      const { error: pErr } = await admin.auth.admin.updateUserById(target.user_id, { password });
      if (pErr) return json({ error: pErr.message }, 400);
      return json({ ok: true, login: email, password, account_name: target.account_name, role: target.role });
    }

    return json({ error: `ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

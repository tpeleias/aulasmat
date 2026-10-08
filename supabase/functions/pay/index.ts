// Pagamento on-line pelo Stripe da própria empresa (09/10). Ver a migration
// 20261009010000_online_payments.sql.
//
//   POST {action: "connect", key}               <- admin: conecta a conta Stripe da empresa
//   POST {action: "link", student, guardian}    <- admin: o link assinado para mandar à família
//   POST {action: "checkout"}                   <- família logada: abre o pagamento do que deve
//   GET  /go?c&k&t                              <- link do e-mail/WhatsApp: abre o pagamento e redireciona
//   POST /webhook?c=<empresa>                   <- o Stripe: pagamento confirmado
//   GET  /done                                  <- volta do Stripe ("obrigado")
//
// O valor é sempre o em aberto NA HORA (o mesmo cálculo do Financeiro,
// _shared/statements.ts): o link do WhatsApp de semana passada cobra o valor
// de hoje, não o de quando foi mandado.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeStatementsCore, type AccountStatement, type LedgerLesson, type LedgerTx } from "../_shared/statements.ts";

type Admin = SupabaseClient;
const SITE = "https://cronys.com.br";
const API = "https://api.stripe.com/v1";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });
const html = (title: string, text: string, status = 200) => new Response(
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#f4f1ea;color:#13141b;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:420px;margin:24px;background:#fff;border:1px solid #e6e1d4;border-radius:16px;padding:28px 24px;text-align:center">
<h1 style="font-size:22px;margin:0 0 10px">${title}</h1><p style="font-size:15px;line-height:1.5;color:#3a3c46;margin:0">${text}</p></div></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8" } });

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const keyOf = (student: string, guardian: string | null) =>
  (guardian ?? "").trim() ? `g:${guardian!.trim().toLowerCase()}` : `s:${student.trim().toLowerCase()}`;

// ---------------------------------------------------------------------------
// Cofre e assinatura dos links
// ---------------------------------------------------------------------------
async function secret(admin: Admin, name: string): Promise<string | null> {
  const { data } = await admin.rpc("pay_secret", { _name: name });
  return typeof data === "string" && data ? data : null;
}
async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

/** O link assinado de uma conta: não expira e sempre cobra o valor de agora. */
export async function signedLink(admin: Admin, account: string, student: string, guardian: string | null) {
  const s = await secret(admin, "pay_link_secret");
  if (!s) return null;
  const k = b64(JSON.stringify([student, guardian ?? ""]));
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/pay/go?c=${account}&k=${k}&t=${await hmac(s, `${account}|${k}`)}`;
}

// ---------------------------------------------------------------------------
// Stripe (REST direto, sem biblioteca)
// ---------------------------------------------------------------------------
function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(key: string, method: string, path: string, body?: Record<string, unknown>) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: body ? form(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `stripe ${res.status}`);
  return data;
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function verifySignature(payload: string, header: string | null, whsec: string) {
  if (!header) return false;
  const t = Number(header.split(",").find(p => p.startsWith("t="))?.slice(2));
  const sigs = header.split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(whsec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${payload}`))))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  return sigs.some(s => safeEqual(s, mac));
}

// ---------------------------------------------------------------------------
// O valor em aberto (o mesmo do Financeiro)
// ---------------------------------------------------------------------------
async function statementOf(admin: Admin, account: string, student: string, guardian: string | null): Promise<AccountStatement | null> {
  const key = keyOf(student, guardian);
  const { data: all } = await admin.from("wallet_transactions").select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at")
    .eq("account_id", account).order("created_at").limit(20000);
  const txs = (all ?? []).filter(t => keyOf(t.student_name, t.guardian_name) === key);
  const ids = [...new Set(txs.map(t => t.lesson_id).filter(Boolean))] as string[];
  const lessons: LedgerLesson[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("lessons").select("id, student_name, start_at, duration_minutes, subject, teacher").in("id", ids.slice(i, i + 200));
    lessons.push(...((data ?? []) as LedgerLesson[]));
  }
  const statements = computeStatementsCore(txs as LedgerTx[], lessons, {
    appointment: "Aula", entry: "Lançamento", accountLabel: t => (t.guardian_name ?? "").trim() || t.student_name,
  });
  return statements.find(s => s.key === key) ?? null;
}

async function allowed(admin: Admin, account: string) {
  const { data } = await admin.from("accounts").select("name, online_payments, active").eq("id", account).maybeSingle();
  return data && data.online_payments && data.active !== false ? data as { name: string } : null;
}

/** Abre uma sessão de pagamento no Stripe da empresa, pelo valor em aberto agora. */
async function openCheckout(admin: Admin, account: string, student: string, guardian: string | null, back: string) {
  const acct = await allowed(admin, account);
  if (!acct) return { error: "not_enabled" as const };
  const key = await secret(admin, `stripe_key:${account}`);
  if (!key) return { error: "not_connected" as const };
  const st = await statementOf(admin, account, student, guardian);
  if (!st || st.owed <= 0) return { error: "nothing_owed" as const };
  const cents = Math.round(st.owed * 100);
  const who = st.guardian ?? st.student;
  const base = {
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "brl", unit_amount: cents, product_data: { name: `${acct.name} · ${who}`, description: `${st.items.length} item(ns) em aberto` } } }],
    success_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/pay/done?back=${encodeURIComponent(back)}`,
    cancel_url: back,
    locale: "pt-BR",
    metadata: { account_id: account, student: st.student, guardian: st.guardian ?? "", owed: st.owed.toFixed(2) },
    payment_intent_data: { description: `${acct.name} · ${who}` },
  };
  let session;
  try {
    session = await stripe(key, "POST", "/checkout/sessions", { ...base, payment_method_types: ["card", "pix"] });
  } catch (e) {
    // Conta Stripe sem Pix ativado: segue só com cartão.
    if (!/pix/i.test(String(e))) throw e;
    session = await stripe(key, "POST", "/checkout/sessions", { ...base, payment_method_types: ["card"] });
  }
  await admin.from("online_payments").insert({
    account_id: account, session_id: session.id, student_name: st.student, guardian_name: st.guardian, amount: st.owed,
  });
  return { url: session.url as string, amount: st.owed };
}

/** O Stripe confirmou: lança o pagamento uma vez só. */
async function settle(admin: Admin, account: string, session: Record<string, any>) {
  if (session.payment_status !== "paid") return "not_paid";
  const { data: row } = await admin.from("online_payments").select("id, status, student_name, guardian_name").eq("session_id", session.id).maybeSingle();
  if (!row || row.status === "paid") return "already";
  // Marca primeiro (só quem mudar de 'open' para 'paid' lança): dois avisos do
  // Stripe ao mesmo tempo não viram dois pagamentos.
  const { data: claimed } = await admin.from("online_payments").update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", row.id).neq("status", "paid").select("id");
  if (!claimed?.length) return "already";
  const amount = Number(session.amount_total ?? 0) / 100;
  const method = (session.payment_method_types ?? []).length === 1 ? session.payment_method_types[0] : null;
  const label = method === "pix" ? "Pix" : method === "card" ? "cartão" : "cartão/Pix";
  const { data, error } = await admin.rpc("register_payment", {
    _account: account, _student: row.student_name, _guardian: row.guardian_name, _amount: amount,
    _kind: "adjustment", _description: `Pagamento on-line (${label})`, _voucher: 0, _voucher_description: null,
  });
  if (error) {
    await admin.from("online_payments").update({ status: "open", paid_at: null }).eq("id", row.id);
    throw new Error(error.message);
  }
  await admin.from("online_payments").update({ wallet_tx_id: (data as { payment_id?: string } | null)?.payment_id ?? null, method }).eq("id", row.id);
  return "paid";
}

// ---------------------------------------------------------------------------
// Quem chama (ações com login)
// ---------------------------------------------------------------------------
async function caller(req: Request) {
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } }, auth: { persistSession: false },
  });
  const { data } = await user.auth.getUser();
  return data?.user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const url = new URL(req.url);
  const raw = await req.text().catch(() => "");

  try {
    // --- Volta do Stripe ---
    if (url.pathname.endsWith("/done")) {
      return html("Pagamento recebido", "Obrigado! O pagamento foi registrado e você vai receber o recibo por e-mail. Já pode fechar esta página.");
    }

    // --- Webhook do Stripe da empresa ---
    if (url.pathname.endsWith("/webhook")) {
      const account = url.searchParams.get("c") ?? "";
      if (!/^[0-9a-f-]{36}$/.test(account)) return json({ error: "bad account" }, 400);
      const whsec = await secret(admin, `stripe_whsec:${account}`);
      if (!whsec || !(await verifySignature(raw, req.headers.get("stripe-signature"), whsec))) return json({ error: "assinatura inválida" }, 400);
      const ev = JSON.parse(raw);
      const s = ev.data?.object ?? {};
      if (s.metadata?.account_id !== account) return json({ ignored: "outra empresa" });
      if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
        return json({ ok: true, result: await settle(admin, account, s) });
      }
      if (ev.type === "checkout.session.expired" || ev.type === "checkout.session.async_payment_failed") {
        await admin.from("online_payments").update({ status: "expired" }).eq("session_id", s.id).eq("status", "open");
        return json({ ok: true });
      }
      return json({ ignored: ev.type });
    }

    // --- Link do e-mail / WhatsApp (sem login) ---
    if (url.pathname.endsWith("/go")) {
      const account = url.searchParams.get("c") ?? "", k = url.searchParams.get("k") ?? "", t = url.searchParams.get("t") ?? "";
      const s = await secret(admin, "pay_link_secret");
      if (!s || !account || !k || (await hmac(s, `${account}|${k}`)) !== t) return html("Link inválido", "Este link de pagamento não é válido. Peça um novo a quem enviou.", 400);
      let student = "", guardian: string | null = null;
      try { const [a, b] = JSON.parse(unb64(k)); student = String(a); guardian = String(b) || null; } catch { return html("Link inválido", "Este link de pagamento não é válido.", 400); }
      const r = await openCheckout(admin, account, student, guardian, SITE);
      if ("url" in r && r.url) return new Response(null, { status: 303, headers: { Location: r.url } });
      if (r.error === "nothing_owed") return html("Tudo em dia", "Não há nada em aberto agora. Obrigado!");
      return html("Pagamento indisponível", "O pagamento on-line não está disponível no momento. Fale com quem enviou o link.", 503);
    }

    // --- Ações com login ---
    let body: Record<string, any> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* vazio */ }
    const user = await caller(req);
    if (!user) return json({ error: "no_auth" }, 401);
    const { data: roles } = await admin.from("user_roles").select("account_id, role").eq("user_id", user.id);
    const adminRole = (roles ?? []).find(r => r.role === "admin" && r.account_id);
    const studentRole = (roles ?? []).find(r => r.role === "student" && r.account_id);

    if (body.action === "checkout") {
      // A família paga o que a conta DELA deve (o cadastro ligado ao login).
      if (!studentRole) return json({ error: "forbidden" }, 403);
      const { data: st } = await admin.from("students").select("student_name, guardian_name").eq("account_id", studentRole.account_id).eq("user_id", user.id).limit(1).maybeSingle();
      if (!st) return json({ error: "no_account" }, 404);
      const r = await openCheckout(admin, studentRole.account_id, st.student_name, st.guardian_name, `${SITE}/aluno/financeiro`);
      return "url" in r ? json({ ok: true, ...r }) : json({ ok: false, error: r.error }, 400);
    }

    if (!adminRole) return json({ error: "forbidden" }, 403);
    const account = adminRole.account_id as string;
    if (!(await allowed(admin, account))) return json({ error: "not_enabled" }, 403);

    if (body.action === "link") {
      if (!(await secret(admin, `stripe_key:${account}`))) return json({ error: "not_connected" }, 400);
      const link = await signedLink(admin, account, String(body.student ?? ""), (body.guardian ?? null) as string | null);
      return link ? json({ ok: true, url: link }) : json({ error: "no_secret" }, 500);
    }

    if (body.action === "connect") {
      const key = String(body.key ?? "").trim();
      if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(key)) return json({ error: "invalid_key" }, 400);
      // A chave funciona? (e de quem é a conta)
      const acct = await stripe(key, "GET", "/account").catch(e => ({ error: String(e) }));
      if ((acct as { error?: string }).error) return json({ error: "stripe_refused", detail: (acct as { error: string }).error }, 400);
      // O endereço que o Stripe avisa quando a família paga (trocando a chave,
      // o aviso antigo sai para não ficarem dois).
      const hookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pay/webhook?c=${account}`;
      const old = await stripe(key, "GET", "/webhook_endpoints?limit=100").catch(() => ({ data: [] }));
      for (const w of (old.data ?? []) as { id: string; url: string }[]) {
        if (w.url === hookUrl) await stripe(key, "DELETE", `/webhook_endpoints/${w.id}`).catch(() => null);
      }
      const hook = await stripe(key, "POST", "/webhook_endpoints", {
        url: hookUrl,
        enabled_events: ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"],
        description: "Cronys - pagamentos das famílias",
      });
      await admin.rpc("pay_store_secret", { _name: `stripe_key:${account}`, _value: key }).throwOnError();
      await admin.rpc("pay_store_secret", { _name: `stripe_whsec:${account}`, _value: hook.secret }).throwOnError();
      const a = acct as { settings?: { dashboard?: { display_name?: string } }; business_profile?: { name?: string }; email?: string };
      return json({ ok: true, test: key.includes("_test_"), name: a.settings?.dashboard?.display_name ?? a.business_profile?.name ?? a.email ?? null });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("pay", String(e));
    return json({ error: "failed", detail: String(e).slice(0, 300) }, 500);
  }
});

// Pagamento on-line pela conta da própria empresa no Stripe ou no Asaas (09/10).
// Ver as migrations 20261009010000_online_payments.sql e
// 20261009020000_client_finance_and_pay_providers.sql.
//
//   POST {action: "connect", provider?, key}      <- admin: conecta o Stripe (padrão) ou o Asaas
//   POST {action: "link", student, guardian}      <- admin: o link curto (cronys.com.br/pagar/<código>)
//   POST {action: "checkout"}                     <- família logada: abre o pagamento do que deve
//   POST {action: "info" | "open", code}          <- a página /pagar/<código> (sem login)
//   GET  /go?c&k&t                                <- link comprido antigo (ainda funciona)
//   POST /webhook?c=<empresa>                     <- o Stripe: pagamento confirmado
//   POST /webhook-asaas?c=<empresa>               <- o Asaas: pagamento confirmado
//   GET  /done                                    <- volta do Stripe ("obrigado")
//
// O valor é sempre o em aberto NA HORA (o mesmo cálculo do Financeiro,
// _shared/statements.ts): o link do WhatsApp de semana passada cobra o valor
// de hoje, não o de quando foi mandado. Qual dos dois cobra é a escolha da
// empresa (accounts.online_provider); sem escolha, não há pagamento on-line.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { computeStatementsCore, type AccountStatement, type LedgerLesson, type LedgerTx } from "../_shared/statements.ts";

type Admin = SupabaseClient;
type Provider = "stripe" | "asaas";
const SITE = "https://cronys.com.br";
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

const keyOf = (student: string, guardian: string | null) =>
  (guardian ?? "").trim() ? `g:${guardian!.trim().toLowerCase()}` : `s:${student.trim().toLowerCase()}`;
const CODE = /^[a-z0-9]{8}$/;

// ---------------------------------------------------------------------------
// Cofre e links
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
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

/** O link curto de uma conta: não expira e sempre cobra o valor de agora. */
async function shortLink(admin: Admin, account: string, student: string, guardian: string | null) {
  const { data, error } = await admin.rpc("pay_link_code", { _account: account, _student: student, _guardian: guardian });
  if (error || typeof data !== "string") throw new Error(error?.message ?? "sem código");
  return { code: data, url: `${SITE}/pagar/${data}` };
}
async function linkOf(admin: Admin, code: string) {
  if (!CODE.test(code)) return null;
  const { data } = await admin.from("pay_links").select("code, account_id, student_name, guardian_name").eq("code", code).maybeSingle();
  return data as { code: string; account_id: string; student_name: string; guardian_name: string | null } | null;
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
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
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
async function verifyStripe(payload: string, header: string | null, whsec: string) {
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
// Asaas (REST direto). Chave "$aact_hmlg_..." é do ambiente de testes
// (sandbox); a gravada com "sandbox|" na frente também (chave antiga, sem a
// marca, que só o sandbox aceitou ao conectar).
// ---------------------------------------------------------------------------
function asaasEnv(stored: string) {
  const sandbox = stored.startsWith("sandbox|") || stored.includes("_hmlg_");
  return { key: stored.replace(/^sandbox\|/, ""), base: sandbox ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3", sandbox };
}
async function asaas(stored: string, method: string, path: string, body?: Record<string, unknown>) {
  const { key, base } = asaasEnv(stored);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { access_token: key, "content-type": "application/json", "User-Agent": "Cronys" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.errors?.[0]?.description ?? `asaas ${res.status}`);
  return data;
}
/** Segredo do aviso do Asaas: 48 letras e números, sem três iguais seguidos. */
function asaasToken() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(48));
    const t = Array.from(bytes).map(b => alpha[b % alpha.length]).join("");
    if (!/(.)\1\1/.test(t)) return t;
  }
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

type Rule = { tiers?: { up_to: number; max: number }[]; above?: number } | null;
type Acct = { name: string; provider: Provider | null; installments: (amount: number) => number };
const clamp = (n: unknown) => Math.min(12, Math.max(1, Math.floor(Number(n)) || 1));
/**
 * Até quantas parcelas para um valor (a mesma conta de installments_for no
 * banco): a primeira faixa "até R$ X" que cobre o valor; acima de todas, o
 * "acima disso"; sem regra, o máximo de sempre.
 */
function installmentsFor(rule: Rule, fallback: number, amount: number) {
  if (!rule || typeof rule !== "object") return clamp(fallback);
  const tier = [...(rule.tiers ?? [])].sort((a, b) => Number(a.up_to) - Number(b.up_to)).find(t => amount <= Number(t.up_to));
  return clamp(tier ? tier.max : rule.above ?? fallback);
}
async function allowed(admin: Admin, account: string): Promise<Acct | null> {
  const { data } = await admin.from("accounts").select("name, online_payments, online_provider, online_max_installments, online_installment_rule, active").eq("id", account).maybeSingle();
  return data && data.online_payments && data.active !== false
    ? { name: data.name, provider: data.online_provider ?? null, installments: (amount: number) => installmentsFor(data.online_installment_rule as Rule, data.online_max_installments, amount) }
    : null;
}

type Opened = { url: string; amount: number } | { error: "not_enabled" | "not_connected" | "nothing_owed" };

/** Abre o pagamento do valor em aberto agora, no Stripe ou no Asaas da empresa. */
async function openCheckout(admin: Admin, account: string, student: string, guardian: string | null, back: string, done: string): Promise<Opened> {
  const acct = await allowed(admin, account);
  if (!acct) return { error: "not_enabled" };
  if (!acct.provider) return { error: "not_connected" };
  const key = await secret(admin, `${acct.provider}_key:${account}`);
  if (!key) return { error: "not_connected" };
  const st = await statementOf(admin, account, student, guardian);
  if (!st || st.owed <= 0) return { error: "nothing_owed" };
  const who = st.guardian ?? st.student;
  const title = `${acct.name} · ${who}`;
  const what = `${st.items.length} item(ns) em aberto`;

  let id: string, url: string;
  if (acct.provider === "stripe") {
    const base = {
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "brl", unit_amount: Math.round(st.owed * 100), product_data: { name: title, description: what } } }],
      success_url: done,
      cancel_url: back,
      locale: "pt-BR",
      metadata: { account_id: account, student: st.student, guardian: st.guardian ?? "", owed: st.owed.toFixed(2) },
      payment_intent_data: { description: title },
    };
    let session;
    try {
      session = await stripe(key, "POST", "/checkout/sessions", { ...base, payment_method_types: ["card", "pix"] });
    } catch (e) {
      // Conta Stripe sem Pix ativado: segue só com cartão.
      if (!/pix/i.test(String(e))) throw e;
      session = await stripe(key, "POST", "/checkout/sessions", { ...base, payment_method_types: ["card"] });
    }
    id = session.id; url = session.url;
  } else {
    // O link do Asaas pode ser pago mais de uma vez: o anterior da mesma
    // conta, ainda em aberto, sai do ar antes de abrir o novo.
    const { data: old } = await admin.from("online_payments").select("id, session_id").eq("account_id", account).eq("provider", "asaas")
      .eq("status", "open").eq("student_name", st.student);
    for (const o of old ?? []) {
      await asaas(key, "DELETE", `/paymentLinks/${o.session_id}`).catch(() => null);
      await admin.from("online_payments").update({ status: "expired" }).eq("id", o.id).eq("status", "open");
    }
    const linkBody = (n: number) => ({
      name: title.slice(0, 255), description: what, value: st.owed,
      // Parcelado quando a regra da empresa dá mais de 1x para este valor
      // (accounts.online_installment_rule); o Pix é sempre à vista.
      billingType: "UNDEFINED", chargeType: n > 1 ? "INSTALLMENT" : "DETACHED", dueDateLimitDays: 3,
      maxInstallmentCount: n, notificationEnabled: false,
    });
    const n = acct.installments(st.owed);
    let link;
    try {
      link = await asaas(key, "POST", "/paymentLinks", linkBody(n));
    } catch (e) {
      // O Asaas recusou o parcelado (valor baixo para parcelar, conta sem
      // cartão...): segue à vista, para a família conseguir pagar.
      if (n <= 1) throw e;
      console.error("asaas parcelado recusado", String(e));
      link = await asaas(key, "POST", "/paymentLinks", linkBody(1));
    }
    id = link.id; url = link.url;
  }
  await admin.from("online_payments").insert({
    account_id: account, provider: acct.provider, session_id: id, student_name: st.student, guardian_name: st.guardian, amount: st.owed,
  });
  return { url, amount: st.owed };
}

const methodLabel = (m: string | null) => (m === "pix" ? "Pix" : m === "card" ? "cartão" : m === "boleto" ? "boleto" : "cartão/Pix");

/**
 * O Asaas confirmou um pagamento feito por um link nosso. Cada pagamento do
 * Asaas é lançado uma vez só (a marca é o id dele): no parcelado, cada parcela
 * é um pagamento, com o valor dela (no cartão chegam todas de uma vez; no
 * boleto, mês a mês). O primeiro pagamento tira o link do ar.
 */
async function settleAsaas(admin: Admin, account: string, p: Record<string, any>, method: string | null) {
  const { data: link } = await admin.from("online_payments").select("id, status, student_name, guardian_name")
    .eq("session_id", String(p.paymentLink)).eq("account_id", account).eq("provider", "asaas").maybeSingle();
  if (!link) return { result: "unknown", first: false };
  const amount = Number(p.value ?? 0);
  if (!(amount > 0)) return { result: "no_value", first: false };
  const part = p.installmentNumber ? ` - parcela ${p.installmentNumber}` : "";
  const { data: claim, error: dup } = await admin.from("online_payments").insert({
    account_id: account, provider: "asaas", session_id: `asaas_payment:${p.id}`, student_name: link.student_name,
    guardian_name: link.guardian_name, amount, status: "paid", paid_at: new Date().toISOString(), method,
  }).select("id").maybeSingle();
  if (dup || !claim) return { result: "already", first: false };
  const { data, error } = await admin.rpc("register_payment", {
    _account: account, _student: link.student_name, _guardian: link.guardian_name, _amount: amount,
    _kind: "adjustment", _description: `Pagamento on-line (${methodLabel(method)})${part}`, _voucher: 0, _voucher_description: null,
  });
  if (error) {
    await admin.from("online_payments").delete().eq("id", claim.id);
    throw new Error(error.message);
  }
  await admin.from("online_payments").update({ wallet_tx_id: (data as { payment_id?: string } | null)?.payment_id ?? null }).eq("id", claim.id);
  const { data: first } = await admin.from("online_payments").update({ status: "paid", paid_at: new Date().toISOString(), method })
    .eq("id", link.id).eq("status", "open").select("id");
  return { result: "paid", first: !!first?.length };
}

/** O Stripe confirmou: lança o pagamento uma vez só. */
async function settle(admin: Admin, account: string, sessionId: string, amount: number, method: string | null) {
  const { data: row } = await admin.from("online_payments").select("id, status, student_name, guardian_name, provider")
    .eq("session_id", sessionId).eq("account_id", account).maybeSingle();
  if (!row || row.status === "paid") return "already";
  // Marca primeiro (só quem mudar de 'open' para 'paid' lança): dois avisos ao
  // mesmo tempo não viram dois pagamentos.
  const { data: claimed } = await admin.from("online_payments").update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", row.id).neq("status", "paid").select("id");
  if (!claimed?.length) return "already";
  const label = methodLabel(method);
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
// Conectar
// ---------------------------------------------------------------------------
async function connectStripe(admin: Admin, account: string, key: string) {
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(key)) return json({ error: "invalid_key" }, 400);
  const acct = await stripe(key, "GET", "/account").catch(e => ({ error: String(e) }));
  if ((acct as { error?: string }).error) return json({ error: "stripe_refused", detail: (acct as { error: string }).error }, 400);
  // O endereço que o Stripe avisa quando a família paga (trocando a chave, o
  // aviso antigo sai para não ficarem dois).
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

async function connectAsaas(admin: Admin, account: string, raw: string, email: string | null) {
  if (!/^\$aact_\S{20,}$/.test(raw)) return json({ error: "invalid_key" }, 400);
  // Chave sem a marca do ambiente: tenta a de verdade e, se não der, o sandbox.
  let stored = raw;
  let probe = await asaas(stored, "GET", "/customers?limit=1").then(() => null, e => String(e));
  if (probe && !/_(prod|hmlg)_/.test(raw)) {
    stored = `sandbox|${raw}`;
    probe = await asaas(stored, "GET", "/customers?limit=1").then(() => null, e => String(e));
  }
  if (probe) return json({ error: "asaas_refused", detail: probe }, 400);
  const hookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pay/webhook-asaas?c=${account}`;
  const old = await asaas(stored, "GET", "/webhooks?limit=100").catch(() => ({ data: [] }));
  for (const w of (old.data ?? []) as { id: string; url: string }[]) {
    if (w.url === hookUrl) await asaas(stored, "DELETE", `/webhooks/${w.id}`).catch(() => null);
  }
  const token = asaasToken();
  await asaas(stored, "POST", "/webhooks", {
    name: "Cronys - pagamentos das famílias", url: hookUrl, email: email ?? undefined, enabled: true, interrupted: false,
    apiVersion: 3, authToken: token, sendType: "SEQUENTIALLY", events: ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"],
  });
  await admin.rpc("pay_store_secret", { _name: `asaas_key:${account}`, _value: stored }).throwOnError();
  await admin.rpc("pay_store_secret", { _name: `asaas_whsec:${account}`, _value: token }).throwOnError();
  const info = await asaas(stored, "GET", "/myAccount/commercialInfo/").catch(() => null) as { name?: string; companyName?: string } | null;
  return json({ ok: true, test: asaasEnv(stored).sandbox, name: info?.companyName ?? info?.name ?? null });
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
    // --- Volta do Stripe (link antigo) ---
    if (url.pathname.endsWith("/done")) {
      return html("Pagamento recebido", "Obrigado! O pagamento foi registrado e você vai receber o recibo por e-mail. Já pode fechar esta página.");
    }

    // --- Aviso do Stripe da empresa ---
    if (url.pathname.endsWith("/webhook")) {
      const account = url.searchParams.get("c") ?? "";
      if (!/^[0-9a-f-]{36}$/.test(account)) return json({ error: "bad account" }, 400);
      const whsec = await secret(admin, `stripe_whsec:${account}`);
      if (!whsec || !(await verifyStripe(raw, req.headers.get("stripe-signature"), whsec))) return json({ error: "assinatura inválida" }, 400);
      const ev = JSON.parse(raw);
      const s = ev.data?.object ?? {};
      if (s.metadata?.account_id !== account) return json({ ignored: "outra empresa" });
      if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
        if (s.payment_status !== "paid") return json({ ok: true, result: "not_paid" });
        const types = (s.payment_method_types ?? []) as string[];
        return json({ ok: true, result: await settle(admin, account, s.id, Number(s.amount_total ?? 0) / 100, types.length === 1 ? types[0] : null) });
      }
      if (ev.type === "checkout.session.expired" || ev.type === "checkout.session.async_payment_failed") {
        await admin.from("online_payments").update({ status: "expired" }).eq("session_id", s.id).eq("status", "open");
        return json({ ok: true });
      }
      return json({ ignored: ev.type });
    }

    // --- Aviso do Asaas da empresa ---
    if (url.pathname.endsWith("/webhook-asaas")) {
      const account = url.searchParams.get("c") ?? "";
      if (!/^[0-9a-f-]{36}$/.test(account)) return json({ error: "bad account" }, 400);
      const token = await secret(admin, `asaas_whsec:${account}`);
      if (!token || !safeEqual(req.headers.get("asaas-access-token") ?? "", token)) return json({ error: "token inválido" }, 401);
      const ev = JSON.parse(raw || "{}");
      const p = ev.payment ?? {};
      // O Asaas para a fila se a resposta não for 200: o que não é nosso
      // responde 200 e segue.
      if (!["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(ev.event) || !p.paymentLink) return json({ ignored: ev.event ?? null });
      const method = p.billingType === "PIX" ? "pix" : p.billingType === "CREDIT_CARD" ? "card" : p.billingType === "BOLETO" ? "boleto" : null;
      const { result, first } = await settleAsaas(admin, account, p, method);
      if (first) {
        // Pago: o link sai do ar para ninguém pagar de novo.
        const key = await secret(admin, `asaas_key:${account}`);
        if (key) await asaas(key, "DELETE", `/paymentLinks/${p.paymentLink}`).catch(() => null);
      }
      return json({ ok: true, result });
    }

    // --- Link comprido antigo do e-mail / WhatsApp (sem login) ---
    if (url.pathname.endsWith("/go")) {
      const account = url.searchParams.get("c") ?? "", k = url.searchParams.get("k") ?? "", t = url.searchParams.get("t") ?? "";
      const s = await secret(admin, "pay_link_secret");
      if (!s || !account || !k || (await hmac(s, `${account}|${k}`)) !== t) return html("Link inválido", "Este link de pagamento não é válido. Peça um novo a quem enviou.", 400);
      let student = "", guardian: string | null = null;
      try { const [a, b] = JSON.parse(unb64(k)); student = String(a); guardian = String(b) || null; } catch { return html("Link inválido", "Este link de pagamento não é válido.", 400); }
      const { code } = await shortLink(admin, account, student, guardian);
      return new Response(null, { status: 303, headers: { Location: `${SITE}/pagar/${code}` } });
    }

    let body: Record<string, any> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* vazio */ }

    // --- A página /pagar/<código> (sem login) ---
    if (body.action === "info" || body.action === "open") {
      const link = await linkOf(admin, String(body.code ?? ""));
      if (!link) return json({ ok: false, error: "invalid" }, 404);
      const acct = await allowed(admin, link.account_id);
      if (body.action === "info") {
        if (!acct) return json({ ok: false, error: "not_enabled" });
        const st = await statementOf(admin, link.account_id, link.student_name, link.guardian_name);
        const first = ((st?.guardian ?? st?.student ?? link.guardian_name ?? link.student_name) || "").trim().split(/\s+/)[0];
        return json({
          ok: true, company: acct.name, name: first,
          owed: st?.owed ?? 0, items: st?.items.length ?? 0,
          installments: acct.provider === "asaas" ? acct.installments(st?.owed ?? 0) : 1,
          available: !!acct.provider && !!(await secret(admin, `${acct.provider}_key:${link.account_id}`)),
        });
      }
      const page = `${SITE}/pagar/${link.code}`;
      const r = await openCheckout(admin, link.account_id, link.student_name, link.guardian_name, page, `${page}?pago=1`);
      return "url" in r ? json({ ok: true, url: r.url, amount: r.amount }) : json({ ok: false, error: r.error });
    }

    // --- Ações com login ---
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
      const back = `${SITE}/aluno/financeiro`;
      const r = await openCheckout(admin, studentRole.account_id, st.student_name, st.guardian_name, back, `${back}?pago=1`);
      return "url" in r ? json({ ok: true, ...r }) : json({ ok: false, error: r.error }, 400);
    }

    if (!adminRole) return json({ error: "forbidden" }, 403);
    const account = adminRole.account_id as string;
    const acct = await allowed(admin, account);
    if (!acct) return json({ error: "not_enabled" }, 403);

    if (body.action === "link") {
      if (!acct.provider || !(await secret(admin, `${acct.provider}_key:${account}`))) return json({ error: "not_connected" }, 400);
      const { url: link } = await shortLink(admin, account, String(body.student ?? ""), (body.guardian ?? null) as string | null);
      return json({ ok: true, url: link });
    }

    if (body.action === "connect") {
      const key = String(body.key ?? "").trim();
      return body.provider === "asaas" ? await connectAsaas(admin, account, key, user.email ?? null) : await connectStripe(admin, account, key);
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("pay", String(e));
    return json({ error: "failed", detail: String(e).slice(0, 300) }, 500);
  }
});

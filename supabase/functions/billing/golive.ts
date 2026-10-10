// "Ligar o modo real" do Stripe do Cronys (10/10), pelo painel da plataforma.
//
// O gestor cola a chave real (sk_live_...) e esta parte deixa a conta real do
// Stripe igual à de teste: preços (plans.ts), cupons e códigos, portal do
// cliente e o webhook. A chave e o segredo do webhook vão para o cofre do banco
// (cronys_stripe_key / cronys_stripe_whsec), nunca para a tela nem para o log.
// Pode rodar de novo: o que já existe fica como está.
//
// Também solta das empresas o cliente e a assinatura do modo de teste: no modo
// real eles não existem, e "Gerenciar assinatura" daria erro. O plano delas
// não muda (as de cortesia continuam onde estão).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { LOOKUP, allPricePairs, ensurePrices, isLiveKey, stripe, stripeKey, useStripeKey } from "../_shared/stripe.ts";

const SITE = "https://cronys.com.br";

// Os mesmos cupons do modo de teste (docs/proximos-passos.md, 25/09). Só o
// LANCAMENTO nasce ativo; os outros se ligam no painel do Stripe na data.
type Coupon = { id: string; name: string; percent: number; duration: "forever" | "once" | "repeating"; months?: number; max?: number; codes: { code: string; active: boolean; firstTime?: boolean }[] };
export const COUPONS: Coupon[] = [
  { id: "lancamento", name: "Preço de lançamento", percent: 15, duration: "forever", max: 20, codes: [{ code: "LANCAMENTO", active: true }] },
  { id: "primeiro-mes", name: "Primeiro mês com 30% off", percent: 30, duration: "once", codes: [{ code: "PRIMEIROMES", active: false, firstTime: true }] },
  { id: "datas-comemorativas", name: "Datas comemorativas", percent: 10, duration: "repeating", months: 2,
    codes: ["CONSUMIDOR", "DIADOCLIENTE", "ANONOVO", "VOLTAASAULAS"].map(code => ({ code, active: false })) },
  { id: "dia-da-profissao", name: "Dia da profissão", percent: 15, duration: "repeating", months: 2,
    codes: ["PROFESSOR", "MEDICO", "PSICOLOGO", "VETERINARIO", "FISIOTERAPEUTA", "NUTRICIONISTA", "EDUCADORFISICO"].map(code => ({ code, active: false })) },
  { id: "black-friday", name: "Black Friday", percent: 25, duration: "repeating", months: 3, codes: ["BLACKFRIDAY", "CYBERMONDAY"].map(code => ({ code, active: false })) },
  { id: "volte", name: "Volte para o Cronys", percent: 20, duration: "repeating", months: 2, codes: [{ code: "VOLTA", active: false }] },
];

export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "invoice.paid", "invoice.payment_failed",
];

const PLAN_ITEMS = ["start", "pro_solo", "pro"] as const;

async function planPrices() {
  const keys = PLAN_ITEMS.flatMap(i => [LOOKUP[i].month, LOOKUP[i].year]);
  const list = await stripe<{ data: { id: string; lookup_key: string; product: string }[] }>("GET", "/prices", { lookup_keys: keys, active: true, limit: 20 });
  return PLAN_ITEMS.map(i => {
    const m = list.data.find(p => p.lookup_key === LOOKUP[i].month), y = list.data.find(p => p.lookup_key === LOOKUP[i].year);
    if (!m || !y) throw new Error(`Preço do plano ${i} não ficou pronto no Stripe.`);
    return { product: m.product, prices: [m.id, y.id] };
  });
}

async function exists(path: string) {
  try { await stripe("GET", path); return true; } catch (e) { if (String((e as Error).message).includes("404")) return false; throw e; }
}

async function coupons(products: string[]) {
  const made: string[] = [];
  for (const c of COUPONS) {
    if (!(await exists(`/coupons/${c.id}`))) {
      await stripe("POST", "/coupons", {
        id: c.id, name: c.name, percent_off: c.percent, duration: c.duration,
        ...(c.months ? { duration_in_months: c.months } : {}), ...(c.max ? { max_redemptions: c.max } : {}),
        applies_to: { products },
      });
      made.push(c.id);
    }
    for (const k of c.codes) {
      const found = await stripe<{ data: unknown[] }>("GET", "/promotion_codes", { code: k.code, limit: 1 });
      if (found.data.length) continue;
      await stripe("POST", "/promotion_codes", {
        coupon: c.id, code: k.code, active: k.active,
        ...(k.firstTime ? { restrictions: { first_time_transaction: true } } : {}),
      });
      made.push(k.code);
    }
  }
  return made;
}

async function portal(products: { product: string; prices: string[] }[]) {
  const params = {
    business_profile: { headline: "Cronys - sua assinatura", privacy_policy_url: `${SITE}/privacidade`, terms_of_service_url: `${SITE}/termos` },
    default_return_url: `${SITE}/assinar`,
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", products },
    },
    metadata: { cronys: "1" },
  };
  const configs = await stripe<{ data: { id: string; metadata?: Record<string, string> }[] }>("GET", "/billing_portal/configurations", { active: true, limit: 20 });
  const cur = configs.data.find(c => c.metadata?.cronys === "1");
  if (cur) await stripe("POST", `/billing_portal/configurations/${cur.id}`, params);
  else await stripe("POST", "/billing_portal/configurations", params);
}

async function webhook(admin: SupabaseClient) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-webhook`;
  const old = await stripe<{ data: { id: string; url: string }[] }>("GET", "/webhook_endpoints", { limit: 100 });
  for (const w of old.data) if (w.url === url) await stripe("DELETE", `/webhook_endpoints/${w.id}`);
  const hook = await stripe<{ secret: string }>("POST", "/webhook_endpoints", {
    url, enabled_events: WEBHOOK_EVENTS, description: "Cronys - assinaturas", api_version: "2025-03-31.basil",
  });
  const { error } = await admin.rpc("pay_store_secret", { _name: "cronys_stripe_whsec", _value: hook.secret });
  if (error) throw new Error("Não deu para guardar o segredo do webhook.");
}

/** Solta das empresas o cliente/assinatura que só existem no modo de teste. */
async function dropTestIds(admin: SupabaseClient) {
  const { data } = await admin.from("accounts").select("id, slug, stripe_customer_id").not("stripe_customer_id", "is", null);
  const dropped: string[] = [];
  for (const a of data ?? []) {
    if (await exists(`/customers/${a.stripe_customer_id}`)) continue;
    await admin.from("accounts").update({
      stripe_customer_id: null, stripe_subscription_id: null, billing_status: "none", billing_interval: null,
      paid_until: null, past_due_since: null,
    }).eq("id", a.id);
    dropped.push(a.slug as string);
  }
  return dropped;
}

export async function stripeStatus(admin: SupabaseClient) {
  const key = await stripeKey();
  const mode = !key ? "none" : isLiveKey(key) ? "live" : "test";
  let account: Record<string, unknown> | null = null;
  try {
    const a = await stripe<any>("GET", "/account");
    account = { name: a.business_profile?.name ?? a.settings?.dashboard?.display_name ?? null, charges_enabled: !!a.charges_enabled, details_submitted: !!a.details_submitted };
  } catch { account = null; }
  const { data: whsec } = await admin.rpc("pay_secret", { _name: "cronys_stripe_whsec" });
  return { mode, account, webhook: mode === "live" ? !!whsec : null };
}

export async function goLive(admin: SupabaseClient, newKey: string) {
  const key = newKey.trim();
  if (!isLiveKey(key)) return { ok: false, error: "not_live" };
  const previous = await stripeKey();
  useStripeKey(key);
  let acct: any;
  try {
    acct = await stripe("GET", "/account");
  } catch {
    useStripeKey(previous);
    return { ok: false, error: "invalid_key" };
  }
  const { error } = await admin.rpc("pay_store_secret", { _name: "cronys_stripe_key", _value: key });
  if (error) { useStripeKey(previous); return { ok: false, error: "store_failed" }; }

  const prices = await ensurePrices(allPricePairs(), { force: true });
  const plans = await planPrices();
  const made = await coupons(plans.map(p => p.product));
  await portal(plans);
  await webhook(admin);
  const dropped = await dropTestIds(admin);
  return {
    ok: true,
    charges_enabled: !!acct.charges_enabled, details_submitted: !!acct.details_submitted,
    prices, coupons: made, dropped,
  };
}

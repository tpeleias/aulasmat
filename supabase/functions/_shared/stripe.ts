// O pouco do Stripe que o Cronys usa, falando direto com a API REST.
//
// Sem a biblioteca oficial de propósito: são meia dúzia de chamadas, e assim a
// função não depende de um pacote npm que o Deno do Supabase precise baixar
// e compatibilizar a cada deploy.
//
// Os preços são achados pelo lookup_key (cronys_pro_solo_mensal etc.), e não
// pelo id: os mesmos nomes existem no modo de teste e no real, então trocar
// de modo é só trocar a chave STRIPE_SECRET_KEY.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import {
  CURRENCIES, LOOKUP as PLAN_LOOKUP, PLANS, STRIPE_PRODUCT_NAME, itemOfLookup, priceCents,
  type Currency as PlanCurrency, type Interval, type Item,
} from "./plans.ts";

export type { Interval, Item };
export type Tier = "start" | "pro_solo" | "pro";

const API = "https://api.stripe.com/v1";

// Os nomes dos preços no Stripe vêm do arquivo de planos (plans.ts).
export const LOOKUP: Record<Tier | "extra", Record<Interval, string>> = {
  start: PLAN_LOOKUP.start,
  pro_solo: PLAN_LOOKUP.pro_solo,
  pro: PLAN_LOOKUP.pro,
  extra: PLAN_LOOKUP.extra,
};
export const ASSISTANT_LOOKUP: Record<Interval, string> = PLAN_LOOKUP.assistant;

export type Currency = "brl" | "usd" | "eur" | "gbp";

export function toCurrency(raw: unknown): Currency {
  const c = String(raw ?? "").toLowerCase();
  return c === "usd" || c === "eur" || c === "gbp" ? c : "brl";
}

export function isAssistantLookup(key: string | null | undefined) {
  return itemOfLookup(key)?.item === "assistant";
}

/** De lookup_key para a faixa do Cronys; nulo para o que não é plano (extra, IA). */
export function tierOfLookup(key: string | null | undefined): Tier | null {
  const it = itemOfLookup(key)?.item;
  return it === "start" || it === "pro_solo" || it === "pro" ? it : null;
}

export function isExtraLookup(key: string | null | undefined) {
  return itemOfLookup(key)?.item === "extra";
}

/** Plano que aceita profissional extra (Pro e Max). */
export function allowsExtraTeachers(plan: string | null | undefined) {
  return plan === "start" || plan === "pro_solo" || plan === "pro" ? PLANS[plan].extraTeachers : false;
}

/** A chave do Stripe é de teste? Só aí os preços se criam sozinhos. */
export function stripeTestMode() {
  const k = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  return k.startsWith("sk_test_") || k.startsWith("rk_test_");
}

type StripePrice = {
  id: string; lookup_key: string; product: string; unit_amount: number; currency: string;
  recurring?: { interval: string };
  currency_options?: Record<string, { unit_amount: number }>;
};

/** O que o preço deveria ser, segundo plans.ts: real como base e as outras moedas como opção. */
function wanted(item: Item, interval: Interval) {
  const opts: Record<string, { unit_amount: number }> = {};
  for (const c of CURRENCIES) if (c !== "BRL") opts[c.toLowerCase()] = { unit_amount: priceCents(item, c as PlanCurrency, interval) };
  return { base: priceCents(item, "BRL", interval), opts };
}

function matches(p: StripePrice, item: Item, interval: Interval) {
  const w = wanted(item, interval);
  if (p.currency !== "brl" || p.unit_amount !== w.base || p.recurring?.interval !== interval) return false;
  return Object.entries(w.opts).every(([c, v]) => p.currency_options?.[c]?.unit_amount === v.unit_amount);
}

async function productFor(item: Item, existing?: StripePrice): Promise<string> {
  if (existing?.product) return existing.product;
  const list = await stripe<{ data: { id: string; name: string; active: boolean; metadata?: Record<string, string> }[] }>(
    "GET", "/products", { active: true, limit: 100 });
  const found = list.data.find(p => p.metadata?.cronys_item === item) ?? list.data.find(p => p.name === STRIPE_PRODUCT_NAME[item]);
  if (found) return found.id;
  const created = await stripe("POST", "/products", { name: STRIPE_PRODUCT_NAME[item], metadata: { cronys_item: item } });
  return created.id as string;
}

/**
 * Deixa no Stripe os preços que plans.ts define. Preço no Stripe não muda de
 * valor: quando o valor muda, nasce um preço novo que herda o lookup_key, e o
 * velho é desativado (quem já assina continua nele).
 *
 * Só roda sozinho com chave de TESTE. Com a chave real, só quando o gestor
 * pede (ação sync_prices), para nunca criar preço de produção sem querer.
 */
export async function ensurePrices(pairs: { item: Item; interval: Interval }[], opts: { force?: boolean } = {}) {
  if (!opts.force && !stripeTestMode()) return [];
  const keys = pairs.map(p => PLAN_LOOKUP[p.item][p.interval]);
  const list = await stripe<{ data: StripePrice[] }>("GET", "/prices", {
    lookup_keys: keys, active: true, limit: 20, expand: ["data.currency_options"],
  });
  const done: string[] = [];
  for (const { item, interval } of pairs) {
    const key = PLAN_LOOKUP[item][interval];
    const cur = list.data.find(p => p.lookup_key === key);
    if (cur && matches(cur, item, interval)) continue;
    const w = wanted(item, interval);
    const product = await productFor(item, cur);
    await stripe("POST", "/prices", {
      product, currency: "brl", unit_amount: w.base, recurring: { interval },
      currency_options: w.opts, lookup_key: key, transfer_lookup_key: true,
      nickname: `${STRIPE_PRODUCT_NAME[item]} ${interval === "year" ? "anual" : "mensal"}`,
    });
    if (cur) await stripe("POST", `/prices/${cur.id}`, { active: false });
    done.push(key);
  }
  return done;
}

/** Todos os preços do arquivo de planos. */
export function allPricePairs(): { item: Item; interval: Interval }[] {
  const out: { item: Item; interval: Interval }[] = [];
  for (const item of Object.keys(PLAN_LOOKUP) as Item[]) for (const interval of ["month", "year"] as Interval[]) out.push({ item, interval });
  return out;
}

// Form-encoding no formato do Stripe: a[b][0][c]=x.
function encode(params: Record<string, unknown>, prefix = "", out: string[] = []): string[] {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") encode(item as Record<string, unknown>, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      encode(v as Record<string, unknown>, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

export async function stripe<T = any>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown> = {}): Promise<T> {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY não configurada nas secrets das funções.");
  const body = encode(params).join("&");
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2025-03-31.basil",
    },
    body: method === "GET" ? undefined : body,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Stripe ${resp.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  return data as T;
}

export async function priceIds(keys: string[]): Promise<Record<string, string>> {
  const list = await stripe<{ data: { id: string; lookup_key: string }[] }>("GET", "/prices", {
    lookup_keys: keys, active: true, limit: 20,
  });
  const map: Record<string, string> = {};
  for (const p of list.data) map[p.lookup_key] = p.id;
  for (const k of keys) if (!map[k]) throw new Error(`Preço ${k} não existe no Stripe.`);
  return map;
}

/**
 * Acerta a quantidade de "profissional extra" na assinatura com o número de
 * profissionais ativos acima dos incluídos. Cobra proporcional ao que falta do
 * período (padrão do Stripe). Sem assinatura ativa, não faz nada.
 */
export async function syncExtraSeats(admin: SupabaseClient, accountId: string) {
  const { data: acc } = await admin.from("accounts")
    .select("stripe_subscription_id, billing_status, plan, billed_extra_teachers").eq("id", accountId).maybeSingle();
  if (!acc?.stripe_subscription_id || acc.billing_status === "canceled") return { skipped: true };

  const { data: extraRaw } = await admin.rpc("account_extra_teachers", { _account: accountId });
  const wanted = allowsExtraTeachers(acc.plan) ? Number(extraRaw ?? 0) : 0;

  const sub = await stripe("GET", `/subscriptions/${acc.stripe_subscription_id}`);
  const items: any[] = sub.items?.data ?? [];
  const extraItem = items.find((i) => isExtraLookup(i.price?.lookup_key));
  const base = items.find((i) => tierOfLookup(i.price?.lookup_key));
  const interval: Interval = base?.price?.recurring?.interval === "year" ? "year" : "month";

  if (wanted === 0 && extraItem) {
    await stripe("DELETE", `/subscription_items/${extraItem.id}`, { proration_behavior: "create_prorations" });
  } else if (wanted > 0 && extraItem && extraItem.quantity !== wanted) {
    await stripe("POST", `/subscription_items/${extraItem.id}`, { quantity: wanted, proration_behavior: "create_prorations" });
  } else if (wanted > 0 && !extraItem) {
    await ensurePrices([{ item: "extra", interval }]);
    const ids = await priceIds([LOOKUP.extra[interval]]);
    await stripe("POST", "/subscription_items", {
      subscription: acc.stripe_subscription_id, price: ids[LOOKUP.extra[interval]], quantity: wanted,
      proration_behavior: "create_prorations",
    });
  }
  if (acc.billed_extra_teachers !== wanted) {
    await admin.from("accounts").update({ billed_extra_teachers: wanted }).eq("id", accountId);
  }
  return { extra: wanted };
}

// ---- Webhook: confere que o evento veio mesmo do Stripe ----

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Cabeçalho Stripe-Signature: t=...,v1=...; tolerância de 5 minutos. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return sigs.some((s) => safeEqual(s, mac));
}

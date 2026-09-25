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

export type Tier = "pro_solo" | "pro";
export type Interval = "month" | "year";

const API = "https://api.stripe.com/v1";

export const LOOKUP: Record<Tier | "extra", Record<Interval, string>> = {
  pro_solo: { month: "cronys_pro_solo_mensal", year: "cronys_pro_solo_anual" },
  pro: { month: "cronys_pro_equipe_mensal", year: "cronys_pro_equipe_anual" },
  extra: { month: "cronys_extra_mensal", year: "cronys_extra_anual" },
};

// O adicional do assistente. Só entra na assinatura quando o banco diz que
// está à venda (assistant_on_sale).
export const ASSISTANT_LOOKUP: Record<Interval, string> = {
  month: "cronys_assistente_mensal", year: "cronys_assistente_anual",
};

// Fora do real: mensal e anual (10% de desconto, arredondado para inteiro),
// sem cupom. Os valores ficam como currency_options nos mesmos preços (mesmo
// lookup_key), em centavos. Não são conversão do real: são preço de mercado
// de cada moeda. Têm de bater com src/lib/subscription.ts.
export type Currency = "brl" | "usd" | "eur" | "gbp";
export const FOREIGN_PRICES: Record<Exclude<Currency, "brl">, Record<string, number>> = {
  usd: {
    cronys_pro_solo_mensal: 1500, cronys_pro_equipe_mensal: 3900, cronys_extra_mensal: 700, cronys_assistente_mensal: 900,
    cronys_pro_solo_anual: 16200, cronys_pro_equipe_anual: 42100, cronys_extra_anual: 7600, cronys_assistente_anual: 9700,
  },
  eur: {
    cronys_pro_solo_mensal: 1500, cronys_pro_equipe_mensal: 3900, cronys_extra_mensal: 700, cronys_assistente_mensal: 900,
    cronys_pro_solo_anual: 16200, cronys_pro_equipe_anual: 42100, cronys_extra_anual: 7600, cronys_assistente_anual: 9700,
  },
  gbp: {
    cronys_pro_solo_mensal: 1300, cronys_pro_equipe_mensal: 3300, cronys_extra_mensal: 600, cronys_assistente_mensal: 800,
    cronys_pro_solo_anual: 14000, cronys_pro_equipe_anual: 35600, cronys_extra_anual: 6500, cronys_assistente_anual: 8600,
  },
};

export function toCurrency(raw: unknown): Currency {
  const c = String(raw ?? "").toLowerCase();
  return c === "usd" || c === "eur" || c === "gbp" ? c : "brl";
}

/**
 * Garante que os preços têm a moeda estrangeira (currency_options). Assim o
 * modo real do Stripe se acerta sozinho na primeira venda, sem configurar
 * nada à mão lá - o valor que vale é o de FOREIGN_PRICES.
 */
export async function ensureCurrency(keys: string[], currency: Currency) {
  if (currency === "brl") return;
  const table = FOREIGN_PRICES[currency];
  const list = await stripe<{ data: { id: string; lookup_key: string; currency_options?: Record<string, { unit_amount: number }> }[] }>(
    "GET", "/prices", { lookup_keys: keys, active: true, limit: 20, expand: ["data.currency_options"] });
  for (const p of list.data) {
    const want = table[p.lookup_key];
    if (want == null) throw new Error(`Sem preço em ${currency.toUpperCase()} para ${p.lookup_key}.`);
    if (p.currency_options?.[currency]?.unit_amount === want) continue;
    // Manda as três moedas juntas: a atualização pode trocar a lista inteira.
    const all: Record<string, { unit_amount: number }> = {};
    for (const [c, t] of Object.entries(FOREIGN_PRICES)) if (t[p.lookup_key] != null) all[c] = { unit_amount: t[p.lookup_key] };
    await stripe("POST", `/prices/${p.id}`, { currency_options: all });
  }
}

export function isAssistantLookup(key: string | null | undefined) {
  return !!key && key.startsWith("cronys_assistente_");
}

/** De lookup_key para a faixa do Cronys; nulo para o que não é plano (o extra). */
export function tierOfLookup(key: string | null | undefined): Tier | null {
  if (!key) return null;
  if (key.startsWith("cronys_pro_solo_")) return "pro_solo";
  if (key.startsWith("cronys_pro_equipe_")) return "pro";
  return null;
}

export function isExtraLookup(key: string | null | undefined) {
  return !!key && key.startsWith("cronys_extra_");
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
  const wanted = acc.plan === "pro" ? Number(extraRaw ?? 0) : 0;

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
    await ensureCurrency([LOOKUP.extra[interval]], toCurrency(sub.currency));
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

// Cupons e códigos de desconto do Cronys (10/10), pelo painel da plataforma.
// O gestor cria, liga e desliga sem abrir o Stripe; a chave fica no cofre.
//
// O desconto vale só nos planos (Start, Pro e Max), nunca no profissional
// extra nem no assistente, como os cupons de 25/09. Quem usa o código é o
// Checkout, que só aceita código no plano mensal em real (billing/index.ts).
import { LOOKUP, stripe } from "../_shared/stripe.ts";

type Promo = {
  id: string; code: string; active: boolean; times_redeemed: number;
  max_redemptions: number | null; expires_at: number | null;
  restrictions?: { first_time_transaction?: boolean };
  coupon: { id: string; name: string | null; percent_off: number | null; amount_off: number | null; currency: string | null;
    duration: string; duration_in_months: number | null; valid: boolean; max_redemptions: number | null; times_redeemed: number };
};

export async function listCoupons() {
  const promos = await stripe<{ data: Promo[] }>("GET", "/promotion_codes", { limit: 100 });
  return {
    ok: true,
    codes: promos.data.map(p => ({
      id: p.id, code: p.code, active: p.active, used: p.times_redeemed, max: p.max_redemptions,
      expires_at: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null,
      first_time: !!p.restrictions?.first_time_transaction,
      coupon: {
        id: p.coupon.id, name: p.coupon.name, percent: p.coupon.percent_off,
        amount: p.coupon.amount_off != null ? p.coupon.amount_off / 100 : null,
        duration: p.coupon.duration, months: p.coupon.duration_in_months,
        valid: p.coupon.valid, used: p.coupon.times_redeemed, max: p.coupon.max_redemptions,
      },
    })).sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code)),
  };
}

async function planProducts() {
  const keys = (["start", "pro_solo", "pro"] as const).flatMap(i => [LOOKUP[i].month, LOOKUP[i].year]);
  const list = await stripe<{ data: { product: string }[] }>("GET", "/prices", { lookup_keys: keys, active: true, limit: 20 });
  return [...new Set(list.data.map(p => p.product))];
}

const normCode = (v: unknown) => String(v ?? "").trim().toUpperCase();
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,29}$/;

/** Cria o desconto e o primeiro código dele (ou só um código novo num desconto que já existe). */
export async function createCoupon(b: Record<string, unknown>) {
  const code = normCode(b.code);
  if (!CODE_RE.test(code)) return { ok: false, error: "invalid_code" };
  const found = await stripe<{ data: unknown[] }>("GET", "/promotion_codes", { code, limit: 1 });
  if (found.data.length) return { ok: false, error: "code_exists" };

  let couponId = typeof b.coupon_id === "string" && b.coupon_id ? b.coupon_id : null;
  if (!couponId) {
    const kind = b.kind === "amount" ? "amount" : "percent";
    const value = Number(b.value);
    if (!(value > 0) || (kind === "percent" && value > 100)) return { ok: false, error: "invalid_value" };
    const duration = b.duration === "forever" ? "forever" : b.duration === "repeating" ? "repeating" : "once";
    const months = Math.round(Number(b.months));
    if (duration === "repeating" && !(months >= 1 && months <= 36)) return { ok: false, error: "invalid_months" };
    const max = b.max ? Math.round(Number(b.max)) : null;
    if (max !== null && !(max >= 1)) return { ok: false, error: "invalid_max" };
    const name = String(b.name ?? "").trim().slice(0, 40) || code;
    const coupon = await stripe<{ id: string }>("POST", "/coupons", {
      name, duration,
      ...(kind === "percent" ? { percent_off: value } : { amount_off: Math.round(value * 100), currency: "brl" }),
      ...(duration === "repeating" ? { duration_in_months: months } : {}),
      ...(max ? { max_redemptions: max } : {}),
      applies_to: { products: await planProducts() },
    });
    couponId = coupon.id;
  }

  const expires = typeof b.expires_at === "string" && b.expires_at ? Math.floor(new Date(`${b.expires_at}T23:59:59-03:00`).getTime() / 1000) : null;
  if (expires !== null && !(expires > Date.now() / 1000)) return { ok: false, error: "invalid_expiry" };
  await stripe("POST", "/promotion_codes", {
    coupon: couponId, code, active: true,
    ...(expires ? { expires_at: expires } : {}),
    ...(b.first_time ? { restrictions: { first_time_transaction: true } } : {}),
  });
  return { ok: true };
}

export async function setCodeActive(id: unknown, active: unknown) {
  if (typeof id !== "string" || !id.startsWith("promo_")) return { ok: false, error: "invalid_id" };
  await stripe("POST", `/promotion_codes/${id}`, { active: active === true });
  return { ok: true };
}

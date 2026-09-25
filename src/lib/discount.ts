import { isEnglish } from "@/lib/i18n";
import { fmtMoney } from "@/lib/balance";

export type DiscountKind = "percent" | "amount";
export type Discount = { kind: DiscountKind; value: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

// Espelha public.lesson_discount no banco (migration 20260921120000). Os dois
// precisam dar o mesmo número: o desconto fixo é calculado pelo banco quando a
// aula vira realizada, e é calculado aqui para mostrar o valor antes de
// confirmar. Divergir faria a tela prometer um desconto e a carteira lançar
// outro.
//
// Em reais o desconto sai de CADA cobrança, não do total, e nunca passa do
// valor dela - abater mais do que a aula custa viraria crédito do nada.
export function discountOn(charge: number, d: Discount): number {
  if (!(charge > 0)) return 0;
  const raw = d.kind === "percent" ? (charge * d.value) / 100 : d.value;
  return round2(Math.min(Math.max(raw, 0), charge));
}

export function discountOnItems(items: { amount: number }[], d: Discount): number {
  return round2(items.reduce((total, i) => total + discountOn(i.amount, d), 0));
}

export function isValidDiscount(kind: DiscountKind, value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  return kind === "percent" ? value <= 100 : true;
}

// "10%" e não "10.00%"; "R$ 30,00" no formato do resto do app.
export function describeDiscount(d: Discount): string {
  if (d.kind === "amount") return fmtMoney(d.value);
  const n = round2(d.value);
  return `${Number.isInteger(n) ? n : isEnglish() ? n.toString() : n.toString().replace(".", ",")}%`;
}

export function parseDiscountValue(raw: string): number {
  return Number(String(raw).replace(",", "."));
}

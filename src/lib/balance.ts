import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";
// Helpers for the new financial labels.
import { fmtCurrency, L } from "@/lib/i18n";
// Na moeda e no formato da empresa (src/lib/i18n.ts).
export const fmtMoney = (v: number) => fmtCurrency(v);

export type BalanceDisplay = {
  label: string;
  amount: number;          // always positive (display)
  tone: "positive" | "negative" | "neutral";
  formatted: string;
};

export function describeBalance(raw: number): BalanceDisplay {
  if (raw > 0) return { label: L("Crédito Disponível", "Available credit"), amount: raw, tone: "positive", formatted: fmtMoney(raw) };
  if (raw < 0) return { label: L("A pagar", "Due"), amount: -raw, tone: "negative", formatted: fmtMoney(-raw) };
  return { label: L("Sem movimentação", "No activity"), amount: 0, tone: "neutral", formatted: fmtMoney(0) };
}

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function accountKey(t: { guardian_name: string | null; student_name: string }) {
  const g = (t.guardian_name ?? "").trim();
  return g ? `g:${g.toLowerCase()}` : `s:${t.student_name.toLowerCase()}`;
}

export function accountLabel(t: { guardian_name: string | null; student_name: string }, v: Vocabulary = DEFAULT_VOCABULARY) {
  const g = (t.guardian_name ?? "").trim();
  return g || `${v.client.s}: ${t.student_name}`;
}

// Narrows a lessons/wallet_transactions query to a single account. Matching on
// student_name alone lets two students who share a first name read each other's rows.
export function scopeToAccount<T>(query: T, account: { student_name: string; guardian_name: string | null }): T {
  const q = query as any;
  const guardian = (account.guardian_name ?? "").trim();
  const scoped = q.eq("student_name", account.student_name);
  return (guardian ? scoped.eq("guardian_name", guardian) : scoped.is("guardian_name", null)) as T;
}

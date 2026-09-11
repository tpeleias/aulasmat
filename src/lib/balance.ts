// Helpers for the new financial labels.
export const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type BalanceDisplay = {
  label: "Crédito Disponível" | "A pagar" | "Sem movimentação";
  amount: number;          // always positive (display)
  tone: "positive" | "negative" | "neutral";
  formatted: string;
};

export function describeBalance(raw: number): BalanceDisplay {
  if (raw > 0) return { label: "Crédito Disponível", amount: raw, tone: "positive", formatted: fmtMoney(raw) };
  if (raw < 0) return { label: "A pagar", amount: -raw, tone: "negative", formatted: fmtMoney(-raw) };
  return { label: "Sem movimentação", amount: 0, tone: "neutral", formatted: fmtMoney(0) };
}

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function accountKey(t: { guardian_name: string | null; student_name: string }) {
  const g = (t.guardian_name ?? "").trim();
  return g ? `g:${g.toLowerCase()}` : `s:${t.student_name.toLowerCase()}`;
}

export function accountLabel(t: { guardian_name: string | null; student_name: string }) {
  const g = (t.guardian_name ?? "").trim();
  return g || `Aluno: ${t.student_name}`;
}

export function lessonAmount(price: number, durationMinutes: number) {
  return Math.round(price * durationMinutes / 60 * 100) / 100;
}

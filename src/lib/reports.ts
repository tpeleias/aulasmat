import { accountKey, accountLabel } from "@/lib/balance";
import type { LedgerTx } from "@/lib/billing";

// Dinheiro que entrou de verdade: pacote e pagamento/ajuste positivo. Aula é
// sempre cobrança (nunca entrada), e voucher é desconto - crédito sem dinheiro
// trocando de mão. Nem um nem outro é renda pra declarar nem prova de
// pagamento recebido.
export function isIncome(t: Pick<LedgerTx, "kind" | "amount">): boolean {
  return (t.kind === "package" || t.kind === "adjustment") && Number(t.amount) > 0;
}

export function inPeriod(isoDate: string, year: number, month: number | null): boolean {
  const d = new Date(isoDate);
  if (d.getFullYear() !== year) return false;
  return month === null || d.getMonth() === month;
}

export type IncomeRow = {
  date: string;
  accountKey: string;
  accountLabel: string;
  description: string;
  amount: number;
};

export type IncomeSummary = {
  rows: IncomeRow[];
  byAccount: { label: string; total: number }[];
  total: number;
};

// Resumo pro período (ano inteiro, ou um mês dele) — o dado bruto pra
// declarar imposto de renda ou fechar quanto entrou no mês.
export function summarizeIncome(txs: LedgerTx[], year: number, month: number | null): IncomeSummary {
  const rows: IncomeRow[] = [];
  const totals = new Map<string, { label: string; total: number }>();

  for (const t of txs) {
    if (!isIncome(t) || !inPeriod(t.created_at, year, month)) continue;
    const amount = Number(t.amount);
    const label = accountLabel(t);
    const k = accountKey(t);
    rows.push({ date: t.created_at, accountKey: k, accountLabel: label, description: t.description ?? "Pagamento", amount });
    const cur = totals.get(k) ?? { label, total: 0 };
    cur.total = Math.round((cur.total + amount) * 100) / 100;
    totals.set(k, cur);
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  const byAccount = [...totals.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "pt-BR"));
  const total = Math.round(byAccount.reduce((s, a) => s + a.total, 0) * 100) / 100;
  return { rows, byAccount, total };
}

// CSV simples, sem lib: escapa aspas e envolve em aspas quem tem vírgula,
// aspas ou quebra de linha - o resto é passado direto, mais legível pra
// abrir e conferir.
export function toCsv(columns: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(cell).join(","), ...rows.map(r => r.map(cell).join(","))];
  return lines.join("\n");
}

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Anos com pelo menos um lançamento - é a lista que o seletor oferece, pra não
// mostrar 10 anos vazios pra escolher.
export function yearsWithData(txs: LedgerTx[]): number[] {
  const years = new Set<number>();
  for (const t of txs) years.add(new Date(t.created_at).getFullYear());
  years.add(new Date().getFullYear());
  return [...years].sort((a, b) => b - a);
}

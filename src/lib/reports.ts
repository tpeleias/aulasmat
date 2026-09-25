import { accountKey, accountLabel } from "@/lib/balance";
import type { LedgerTx } from "@/lib/billing";

import { L } from "@/lib/i18n";
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
    rows.push({ date: t.created_at, accountKey: k, accountLabel: label, description: t.description ?? L("Pagamento", "Payment"), amount });
    const cur = totals.get(k) ?? { label, total: 0 };
    cur.total = Math.round((cur.total + amount) * 100) / 100;
    totals.set(k, cur);
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  const byAccount = [...totals.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "pt-BR"));
  const total = Math.round(byAccount.reduce((s, a) => s + a.total, 0) * 100) / 100;
  return { rows, byAccount, total };
}

// CSV simples, sem lib. Separador ";" e não ",": é o que o Excel em
// português espera (lá a vírgula é o decimal), e com "," o arquivo abre com
// tudo numa coluna só. Célula com separador, aspas ou quebra de linha vai
// entre aspas.
export function toCsv(columns: string[], rows: (string | number)[][], sep = ";"): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return s.includes(sep) || /["\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(cell).join(sep), ...rows.map(r => r.map(cell).join(sep))];
  return lines.join("\n");
}

export const MESES = L([
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
], [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

// Anos com pelo menos um lançamento - é a lista que o seletor oferece, pra não
// mostrar 10 anos vazios pra escolher.
export function yearsWithData(txs: LedgerTx[]): number[] {
  const years = new Set<number>();
  for (const t of txs) years.add(new Date(t.created_at).getFullYear());
  years.add(new Date().getFullYear());
  return [...years].sort((a, b) => b - a);
}

export type ServiceLesson = {
  start_at: string; status: string; price: number | string; duration_minutes: number;
  service_id?: string | null; subject?: string | null;
};
export type ServiceRow = { key: string; name: string; color: string | null; count: number; minutes: number; total: number };

/**
 * Atendimentos realizados no período, por serviço: quantos, quantas horas e
 * quanto valeram pelo preço cheio (price é o valor da hora). Sem serviço
 * cadastrado, agrupa pelo assunto digitado. Desconto por família não entra -
 * isto mede o que cada serviço rende, não o que entrou no caixa.
 */
export function summarizeByService(
  lessons: ServiceLesson[],
  services: { id: string; name: string; color?: string | null }[],
  year: number,
  month: number | null,
  noServiceLabel = "Sem serviço",
): { rows: ServiceRow[]; count: number; total: number } {
  const map = new Map<string, ServiceRow>();
  for (const l of lessons) {
    if (l.status !== "realizada" || !inPeriod(l.start_at, year, month)) continue;
    const svc = l.service_id ? services.find(s => s.id === l.service_id) : undefined;
    const subject = (l.subject ?? "").trim();
    const key = svc ? `s:${svc.id}` : `t:${subject.toLowerCase()}`;
    const row = map.get(key) ?? {
      key, name: svc?.name ?? (subject || noServiceLabel), color: svc?.color ?? null, count: 0, minutes: 0, total: 0,
    };
    row.count += 1;
    row.minutes += Number(l.duration_minutes) || 0;
    row.total = Math.round((row.total + Number(l.price) * (Number(l.duration_minutes) || 0) / 60) * 100) / 100;
    map.set(key, row);
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
  return {
    rows,
    count: rows.reduce((s, r) => s + r.count, 0),
    total: Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100,
  };
}

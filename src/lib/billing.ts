import { accountLabel } from "@/lib/balance";
import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
// Os tipos e a conta moram em supabase/functions/_shared/statements.ts, que a
// cobrança por e-mail também usa: o valor do e-mail é o mesmo da tela.
import { computeStatementsCore, type AccountStatement, type LedgerLesson, type LedgerTx } from "@shared/statements";
export type { AccountStatement, LedgerLesson, LedgerTx, OpenItem } from "@shared/statements";

export function computeStatements(txs: LedgerTx[], lessons: LedgerLesson[], v: Vocabulary = DEFAULT_VOCABULARY): AccountStatement[] {
  return computeStatementsCore(txs, lessons, {
    appointment: v.appointment.s,
    entry: L("Lançamento", "Entry"),
    accountLabel: t => accountLabel(t, v),
  });
}

export const OVERDUE_AFTER_DAYS = 30;

export function daysOpen(oldestOpenDate: string | null, now = new Date()): number {
  if (!oldestOpenDate) return 0;
  return Math.floor((now.getTime() - new Date(oldestOpenDate).getTime()) / 86_400_000);
}

export const isOverdue = (s: AccountStatement) => s.owed > 0 && daysOpen(s.oldestOpenDate) > OVERDUE_AFTER_DAYS;

// ---- Ordering (shared by Financeiro and Home) ----

export type AccountSort = "owed" | "overdue" | "name" | "credit";

export const ACCOUNT_SORTS: { key: AccountSort; label: string }[] = [
  { key: "owed", label: L("Maior dívida", "Largest balance due") },
  { key: "overdue", label: L("Atraso mais antigo", "Longest overdue") },
  { key: "name", label: L("Nome (A–Z)", "Name (A–Z)") },
  { key: "credit", label: L("Maior crédito", "Largest credit") },
];

const byName = (a: AccountStatement, b: AccountStatement) => a.label.localeCompare(b.label, "pt-BR");

export function sortAccounts<T extends AccountStatement>(accounts: T[], sort: AccountSort): T[] {
  const list = [...accounts];
  switch (sort) {
    case "overdue":
      // Whoever has been waiting longest comes first; accounts with nothing open go last.
      return list.sort((a, b) => {
        if (!a.oldestOpenDate && !b.oldestOpenDate) return byName(a, b);
        if (!a.oldestOpenDate) return 1;
        if (!b.oldestOpenDate) return -1;
        return a.oldestOpenDate.localeCompare(b.oldestOpenDate) || b.owed - a.owed;
      });
    case "name":
      return list.sort(byName);
    case "credit":
      // Balance is positive when the family is ahead and negative when behind.
      return list.sort((a, b) => b.balance - a.balance || byName(a, b));
    default:
      return list.sort((a, b) => b.owed - a.owed || byName(a, b));
  }
}

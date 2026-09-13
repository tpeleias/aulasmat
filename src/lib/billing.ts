import { accountKey, accountLabel } from "@/lib/balance";

export type LedgerTx = {
  id: string;
  guardian_name: string | null;
  student_name: string;
  amount: number;
  kind: string;
  lesson_id: string | null;
  description: string | null;
  created_at: string;
};

export type LedgerLesson = {
  id: string;
  student_name: string;
  start_at: string;
  duration_minutes: number;
  subject: string | null;
  teacher: string;
};

// One outstanding charge: a lesson (or a manual debit) with the part still unpaid.
export type OpenItem = {
  id: string;
  date: string;
  student: string;
  detail: string;
  amount: number;
  partial: boolean;
};

export type AccountStatement = {
  key: string;
  label: string;
  student: string;
  guardian: string | null;
  balance: number;
  credits: number;
  owed: number;
  items: OpenItem[];
  oldestOpenDate: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// The wallet ledger is the single source of truth. Credits pay off the oldest charges
// first, so what's listed always adds up to exactly what the balance says is owed —
// lessons.payment_status is a separate flag that can disagree and is deliberately ignored.
export function computeStatements(txs: LedgerTx[], lessons: LedgerLesson[]): AccountStatement[] {
  const lessonById = new Map(lessons.map(l => [l.id, l]));
  const accounts = new Map<string, {
    key: string; label: string; student: string; guardian: string | null;
    balance: number; credits: number; charges: OpenItem[];
  }>();

  for (const t of txs) {
    const k = accountKey(t);
    const acc = accounts.get(k) ?? {
      key: k, label: accountLabel(t), student: t.student_name,
      guardian: (t.guardian_name ?? "").trim() || null,
      balance: 0, credits: 0, charges: [],
    };
    const amount = Number(t.amount);
    acc.balance += amount;
    if (amount >= 0) {
      acc.credits += amount;
    } else {
      const lesson = t.lesson_id ? lessonById.get(t.lesson_id) : undefined;
      acc.charges.push({
        id: t.id,
        date: lesson?.start_at ?? t.created_at,
        student: lesson?.student_name ?? t.student_name,
        detail: lesson ? `${lesson.subject ?? "Aula"} (${lesson.duration_minutes} min)` : (t.description ?? "Lançamento"),
        amount: -amount,
        partial: false,
      });
    }
    accounts.set(k, acc);
  }

  const result: AccountStatement[] = [];
  for (const acc of accounts.values()) {
    let pool = acc.credits;
    const items: OpenItem[] = [];
    for (const charge of acc.charges.sort((a, b) => a.date.localeCompare(b.date))) {
      const covered = Math.min(pool, charge.amount);
      pool -= covered;
      const remaining = round2(charge.amount - covered);
      if (remaining > 0) items.push({ ...charge, amount: remaining, partial: covered > 0 });
    }
    result.push({
      key: acc.key, label: acc.label, student: acc.student, guardian: acc.guardian,
      balance: round2(acc.balance), credits: round2(acc.credits),
      owed: round2(items.reduce((s, i) => s + i.amount, 0)),
      items,
      oldestOpenDate: items[0]?.date ?? null,
    });
  }
  return result.sort((a, b) => b.owed - a.owed || a.label.localeCompare(b.label));
}

export const OVERDUE_AFTER_DAYS = 30;

export function daysOpen(oldestOpenDate: string | null, now = new Date()): number {
  if (!oldestOpenDate) return 0;
  return Math.floor((now.getTime() - new Date(oldestOpenDate).getTime()) / 86_400_000);
}

export const isOverdue = (s: AccountStatement) => s.owed > 0 && daysOpen(s.oldestOpenDate) > OVERDUE_AFTER_DAYS;

// ---- Ordering (shared by Cobrança and Organização) ----

export type AccountSort = "owed" | "overdue" | "name" | "credit";

export const ACCOUNT_SORTS: { key: AccountSort; label: string }[] = [
  { key: "owed", label: "Maior dívida" },
  { key: "overdue", label: "Atraso mais antigo" },
  { key: "name", label: "Nome (A–Z)" },
  { key: "credit", label: "Maior crédito" },
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

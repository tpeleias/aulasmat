import { accountKey, accountLabel } from "@/lib/balance";
import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";

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
  // Set when a voucher tied to THIS lesson (account_discounts, via
  // sync_lesson_wallet) already abated part of it. `amount` above is the net,
  // after this discount - the discount is broken out so the tela can show it
  // instead of just a smaller number nobody can explain.
  discount?: { amount: number; gross: number; label: string };
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
export function computeStatements(txs: LedgerTx[], lessons: LedgerLesson[], v: Vocabulary = DEFAULT_VOCABULARY): AccountStatement[] {
  const lessonById = new Map(lessons.map(l => [l.id, l]));
  type Charge = OpenItem & { lessonId: string | null };
  const accounts = new Map<string, {
    key: string; label: string; student: string; guardian: string | null;
    balance: number; credits: number; charges: Charge[];
    // Vouchers tied to a specific lesson (kind='voucher' with lesson_id): the
    // fixed family discount in account_discounts lands here, via
    // sync_lesson_wallet. Grouped by lesson_id so each abates ITS OWN aula
    // directly below, instead of joining acc.credits and paying off whichever
    // open charge happens to be oldest - a discount for today's lesson has no
    // business quitting one from three weeks ago.
    lessonVouchers: Map<string, { amount: number; description: string | null }[]>;
  }>();

  for (const t of txs) {
    const k = accountKey(t);
    const acc = accounts.get(k) ?? {
      key: k, label: accountLabel(t, v), student: t.student_name,
      guardian: (t.guardian_name ?? "").trim() || null,
      balance: 0, credits: 0, charges: [], lessonVouchers: new Map(),
    };
    const amount = Number(t.amount);
    acc.balance += amount;
    if (amount >= 0) {
      if (t.kind === "voucher" && t.lesson_id) {
        const list = acc.lessonVouchers.get(t.lesson_id) ?? [];
        list.push({ amount, description: t.description });
        acc.lessonVouchers.set(t.lesson_id, list);
      } else {
        acc.credits += amount;
      }
    } else {
      const lesson = t.lesson_id ? lessonById.get(t.lesson_id) : undefined;
      acc.charges.push({
        id: t.id,
        lessonId: t.lesson_id,
        date: lesson?.start_at ?? t.created_at,
        student: lesson?.student_name ?? t.student_name,
        detail: lesson ? `${lesson.subject ?? v.appointment.s} (${lesson.duration_minutes} min)` : (t.description ?? "Lançamento"),
        amount: -amount,
        partial: false,
      });
    }
    accounts.set(k, acc);
  }

  const result: AccountStatement[] = [];
  for (const acc of accounts.values()) {
    // Cada cobrança abate primeiro o(s) voucher(s) da PRÓPRIA aula. Todo o
    // resto - troco de voucher maior que a aula, ou voucher cuja cobrança não
    // está na lista - volta pro pool geral: sumir com ele faria "em aberto"
    // passar a somar mais do que o saldo diz.
    let pool = acc.credits;
    for (const charge of acc.charges) {
      const vouchers = charge.lessonId ? acc.lessonVouchers.get(charge.lessonId) : undefined;
      if (!vouchers?.length) continue;
      acc.lessonVouchers.delete(charge.lessonId!);
      const total = round2(vouchers.reduce((s, v) => s + v.amount, 0));
      const applied = Math.min(total, charge.amount);
      if (applied > 0) {
        charge.discount = {
          amount: applied,
          gross: charge.amount,
          label: vouchers.map(v => v.description).filter((d): d is string => !!d).join("; ") || "Desconto",
        };
        charge.amount = round2(charge.amount - applied);
      }
      pool = round2(pool + total - applied);
    }
    for (const orphans of acc.lessonVouchers.values()) {
      pool = round2(pool + orphans.reduce((s, v) => s + v.amount, 0));
    }
    const credits = round2(pool + acc.charges.reduce((s, c) => s + (c.discount?.amount ?? 0), 0));

    const items: OpenItem[] = [];
    for (const charge of acc.charges.sort((a, b) => a.date.localeCompare(b.date))) {
      const covered = Math.min(pool, charge.amount);
      pool -= covered;
      const remaining = round2(charge.amount - covered);
      if (remaining > 0) items.push({ ...charge, amount: remaining, partial: covered > 0 });
    }
    result.push({
      key: acc.key, label: acc.label, student: acc.student, guardian: acc.guardian,
      balance: round2(acc.balance), credits,
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

// ---- Ordering (shared by Financeiro and Home) ----

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

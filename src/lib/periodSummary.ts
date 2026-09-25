import { addMonths, addWeeks, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import type { AccountStatement, LedgerTx } from "@/lib/billing";
import { isIncome } from "@/lib/reports";

import { dateLocale, L } from "@/lib/i18n";
export type PeriodKind = "week" | "month";

export type SummaryLesson = {
  id: string;
  start_at: string;
  duration_minutes: number;
  price: number | null;
  status: string;
  teacher: string;
};

export type PeriodRange = { start: Date; end: Date; label: string };

// Semana de segunda a domingo; `offset` -1 é a anterior, e assim por diante.
export function periodRange(kind: PeriodKind, anchor: Date, offset = 0): PeriodRange {
  if (kind === "week") {
    const start = addWeeks(startOfWeek(anchor, { weekStartsOn: 1 }), offset);
    const end = addWeeks(start, 1);
    const last = new Date(end.getTime() - 1);
    return { start, end, label: L(`${format(start, L("dd/MM", "MMM d"))} a ${format(last, L("dd/MM", "MMM d"))}`, `${format(start, "MMM d")} - ${format(last, "MMM d")}`) };
  }
  const start = addMonths(startOfMonth(anchor), offset);
  const end = addMonths(start, 1);
  return { start, end, label: format(start, L("MMMM 'de' yyyy", "MMMM yyyy"), { locale: dateLocale() }) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
// A mesma conta de sync_lesson_wallet: preço da hora × duração.
const lessonValue = (l: SummaryLesson) => round2((Number(l.price) || 0) * l.duration_minutes / 60);
const inRange = (iso: string, r: { start: Date; end: Date }) => {
  const t = new Date(iso).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
};

export type PeriodSummary = {
  aulasDadas: number;
  horas: number;
  canceladas: number;
  recusadas: number;
  aindaMarcadas: number;
  // Competência: pela data da AULA.
  valorCheio: number;
  descontos: number;
  liquido: number;
  // Caixa: pela data do PAGAMENTO.
  recebido: number;
  emAbertoDoPeriodo: number;
  emAbertoGeral: number;
  previsto: number;
  porProfessor: { teacher: string; aulas: number; valor: number }[];
};

export function summarizePeriod(
  { lessons, txs, statements, range, now = new Date() }:
  { lessons: SummaryLesson[]; txs: LedgerTx[]; statements: AccountStatement[]; range: { start: Date; end: Date }; now?: Date },
): PeriodSummary {
  const doneInRange = lessons.filter(l => l.status === "realizada" && inRange(l.start_at, range));
  const doneIds = new Set(doneInRange.map(l => l.id));

  // O valor da aula sai da cobrança lançada na carteira quando existe; a
  // conta local só cobre uma aula que ainda não tem cobrança.
  const chargeByLesson = new Map<string, number>();
  let descontos = 0;
  for (const t of txs) {
    if (!t.lesson_id || !doneIds.has(t.lesson_id)) continue;
    const amount = Number(t.amount);
    if (t.kind === "lesson" && amount < 0) chargeByLesson.set(t.lesson_id, (chargeByLesson.get(t.lesson_id) ?? 0) - amount);
    if (t.kind === "voucher" && amount > 0) descontos += amount;
  }

  const teachers = new Map<string, { teacher: string; aulas: number; valor: number }>();
  let valorCheio = 0;
  let minutos = 0;
  for (const l of doneInRange) {
    const v = chargeByLesson.get(l.id) ?? lessonValue(l);
    valorCheio += v;
    minutos += l.duration_minutes;
    const cur = teachers.get(l.teacher) ?? { teacher: l.teacher, aulas: 0, valor: 0 };
    cur.aulas += 1;
    cur.valor = round2(cur.valor + v);
    teachers.set(l.teacher, cur);
  }

  const futureStart = Math.max(now.getTime(), range.start.getTime());
  const aindaMarcadasList = lessons.filter(l =>
    l.status === "agendada" && new Date(l.start_at).getTime() >= futureStart && new Date(l.start_at).getTime() < range.end.getTime());

  const recebido = txs.filter(t => isIncome(t) && inRange(t.created_at, range)).reduce((s, t) => s + Number(t.amount), 0);
  const emAbertoDoPeriodo = statements.flatMap(s => s.items).filter(i => inRange(i.date, range)).reduce((s, i) => s + i.amount, 0);
  const emAbertoGeral = statements.reduce((s, a) => s + a.owed, 0);

  return {
    aulasDadas: doneInRange.length,
    horas: round2(minutos / 60),
    canceladas: lessons.filter(l => l.status === "cancelada" && inRange(l.start_at, range)).length,
    recusadas: lessons.filter(l => l.status === "recusada" && inRange(l.start_at, range)).length,
    aindaMarcadas: aindaMarcadasList.length,
    valorCheio: round2(valorCheio),
    descontos: round2(descontos),
    liquido: round2(valorCheio - descontos),
    recebido: round2(recebido),
    emAbertoDoPeriodo: round2(emAbertoDoPeriodo),
    emAbertoGeral: round2(emAbertoGeral),
    previsto: round2(aindaMarcadasList.reduce((s, l) => s + lessonValue(l), 0)),
    porProfessor: [...teachers.values()].sort((a, b) => b.valor - a.valor),
  };
}

// Variação percentual contra o período anterior; nula quando não há base.
export function change(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

import { addDays } from "date-fns";

/** O máximo de atendimentos que uma repetição cria de uma vez. */
export const MAX_OCCURRENCES = 104;

/**
 * As datas de uma repetição semanal: `count` atendimentos, no mesmo horário de
 * `base`, só nos dias da semana escolhidos (0 = domingo), a partir de `base`.
 * Sem dia escolhido, vale o dia de `base` (o "toda semana" de antes).
 *
 * Ex.: base numa quarta 18h, dias [3, 5], count 4 -> qua, sex, qua, sex.
 */
export function buildOccurrences(base: Date, count: number, weekdays: number[] = []): Date[] {
  const days = new Set(weekdays.length ? weekdays : [base.getDay()]);
  const n = Math.max(1, Math.min(MAX_OCCURRENCES, Math.floor(count)));
  const out: Date[] = [];
  // addDays preserva a hora local mesmo quando o horário de verão muda no meio.
  for (let i = 0; out.length < n && i < n * 7 + 7; i++) {
    const d = addDays(base, i);
    if (days.has(d.getDay())) out.push(d);
  }
  return out;
}

/**
 * Quantos atendimentos a repetição tem de `base` até o dia `until` (inclusive,
 * pela data local), nos dias da semana escolhidos. Para o "repetir até tal
 * data" (Thiago, 01/10): a conta vira o `count` de buildOccurrences. Pode
 * passar de MAX_OCCURRENCES - quem chama avisa e corta.
 */
export function countUntil(base: Date, until: Date, weekdays: number[] = []): number {
  const days = new Set(weekdays.length ? weekdays : [base.getDay()]);
  const last = new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59);
  let n = 0;
  for (let i = 0; i < 3 * 366; i++) {
    const d = addDays(base, i);
    if (d > last) break;
    if (days.has(d.getDay())) n++;
  }
  return n;
}

const SHORT_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "seg, qua e sex" / "Mon, Wed and Fri", na ordem da semana começando na segunda. */
export function weekdaysLabel(weekdays: number[], en: boolean): string {
  const names = en ? SHORT_EN : SHORT_PT;
  const sorted = [...new Set(weekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => names[d]);
  if (sorted.length <= 1) return sorted.join("");
  return `${sorted.slice(0, -1).join(", ")} ${en ? "and" : "e"} ${sorted[sorted.length - 1]}`;
}

export const WEEKDAY_SHORT = { pt: SHORT_PT, en: SHORT_EN };

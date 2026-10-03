import { addMinutes, isBefore, isEqual, format, startOfDay, addDays, getDay } from "date-fns";

import { L, timeFmt } from "@/lib/i18n";
export type Range = { start: Date; end: Date };
export type RecurringBlock = { weekday: number; start_time: string; end_time: string };

function timeOnDate(date: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h, m ?? 0, 0, 0);
  return d;
}

export function computeFreeSlots(
  fromDate: Date,
  days: number,
  workStart: string,
  workEnd: string,
  slotMinutes: number,
  busy: Range[],
  recurring: RecurringBlock[]
): Range[] {
  const slots: Range[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const day = startOfDay(addDays(fromDate, i));
    const dayStart = timeOnDate(day, workStart);
    const dayEnd = timeOnDate(day, workEnd);
    const weekday = getDay(day);
    const recForDay = recurring
      .filter(r => r.weekday === weekday)
      .map(r => ({ start: timeOnDate(day, r.start_time), end: timeOnDate(day, r.end_time) }));

    let cursor = new Date(dayStart);
    while (isBefore(addMinutes(cursor, slotMinutes - 1), dayEnd) || isEqual(addMinutes(cursor, slotMinutes), dayEnd)) {
      const slotEnd = addMinutes(cursor, slotMinutes);
      if (slotEnd > dayEnd) break;
      const overlapsBusy = [...busy, ...recForDay].some(
        r => cursor < r.end && slotEnd > r.start
      );
      const inPast = slotEnd <= now;
      if (!overlapsBusy && !inPast) slots.push({ start: new Date(cursor), end: slotEnd });
      cursor = slotEnd;
    }
  }
  return slots;
}

export function fmtTime(d: Date) { return format(d, timeFmt()); }
export function fmtDate(d: Date) { return format(d, L("dd/MM", "MMM d")); }
export function fmtFull(d: Date) { return format(d, L("EEEE, dd 'de' MMMM", "EEEE, MMMM d")); }

// Deterministic seeded pseudo-random so the public/student "shop window" is stable per day/teacher
export function seedRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6D2B79F5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickScarcityCandidates(
  day: Date,
  candidateStarts: Date[],
  teacherKey: string,
  minN: number,
  maxN: number,
): Date[] {
  if (candidateStarts.length === 0 || maxN <= 0) return [];
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  const rand = seedRandom(`${teacherKey}|${dayKey}|${minN}-${maxN}`);
  // 0 vale (03/10): máximo 0 = o dia aparece sem horários; mínimo 0 = há dias
  // em que nenhum aparece.
  const lo = Math.max(0, Math.min(minN, maxN));
  const hi = Math.max(lo, maxN);
  const target = lo + Math.floor(rand() * (hi - lo + 1));
  const count = Math.min(candidateStarts.length, target);
  const indices = candidateStarts.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, count).map(i => candidateStarts[i]).sort((a, b) => a.getTime() - b.getTime());
}


// Escassez por dia da semana (0 = domingo). Antes eram dois pares de números,
// um para dia de semana e outro para fim de semana, repetidos em quatro telas.
export type ScarcityDay = { min: number; max: number };

export const SCARCITY_DEFAULT: Record<string, ScarcityDay> = {
  "0": { min: 3, max: 7 }, "1": { min: 1, max: 3 }, "2": { min: 1, max: 3 },
  "3": { min: 1, max: 3 }, "4": { min: 1, max: 3 }, "5": { min: 1, max: 3 },
  "6": { min: 3, max: 7 },
};

/**
 * A escassez guardada (settings.scarcity e teachers.scarcity, jsonb): os
 * números de cada dia da semana e, desde 02/10, `off: true` para "mostrar
 * todos os horários livres". No profissional, nulo = segue a empresa.
 */
export type ScarcitySetting = { off?: boolean } & Record<string, ScarcityDay | boolean | undefined>;

/** Desligada = mostrar todos os horários livres. */
export function scarcityOff(x: unknown): boolean {
  return !!x && typeof x === "object" && (x as ScarcitySetting).off === true;
}

/**
 * Quantos horários mostrar no dia, ou nulo para mostrar todos.
 *
 * O profissional com escolha própria ganha da empresa (números próprios ou
 * "todos"), e a empresa ganha do padrão. Profissional sem escolha própria (o
 * caso normal) simplesmente herda a da empresa.
 */
export function scarcityFor(day: Date, accountScarcity: unknown, teacherScarcity?: unknown): ScarcityDay | null {
  const chave = String(day.getDay());
  if (teacherScarcity) {
    if (scarcityOff(teacherScarcity)) return null;
    const d = (teacherScarcity as ScarcitySetting)[chave];
    if (d && typeof d === "object") return d;
  }
  if (scarcityOff(accountScarcity)) return null;
  const d = ((accountScarcity ?? {}) as ScarcitySetting)[chave];
  return d && typeof d === "object" ? d : SCARCITY_DEFAULT[chave];
}

/** Os horários que aparecem no dia: todos, ou os sorteados pela escassez. */
export function visibleStarts(day: Date, candidateStarts: Date[], key: string, scarcity: ScarcityDay | null): Date[] {
  if (!scarcity) return [...candidateStarts].sort((a, b) => a.getTime() - b.getTime());
  return pickScarcityCandidates(day, candidateStarts, key, scarcity.min, scarcity.max);
}

/**
 * Intervalo entre atendimentos (settings.buffer_minutes): cada período ocupado
 * cresce `minutes` para os dois lados, e o horário oferecido não encosta nele.
 */
export function padRanges(ranges: Range[], minutes: number): Range[] {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (!m) return ranges;
  return ranges.map(r => ({ start: addMinutes(r.start, -m), end: addMinutes(r.end, m) }));
}

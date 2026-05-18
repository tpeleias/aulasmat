import { addMinutes, isBefore, isEqual, format, startOfDay, addDays, getDay } from "date-fns";

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

export function fmtTime(d: Date) { return format(d, "HH:mm"); }
export function fmtDate(d: Date) { return format(d, "dd/MM"); }
export function fmtFull(d: Date) { return format(d, "EEEE, dd 'de' MMMM"); }

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
  if (candidateStarts.length === 0) return [];
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  const rand = seedRandom(`${teacherKey}|${dayKey}|${minN}-${maxN}`);
  const lo = Math.max(1, Math.min(minN, maxN));
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


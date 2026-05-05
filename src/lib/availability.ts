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

import { describe, expect, it } from "vitest";
import { computeFreeSlots, padRanges } from "@/lib/availability";

describe("intervalo entre atendimentos (padRanges)", () => {
  const day = new Date(2030, 0, 7); // segunda
  const at = (h: number, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d; };
  const lesson = [{ start: at(10), end: at(11) }];
  const starts = (busy: typeof lesson) =>
    computeFreeSlots(day, 1, "08:00", "13:00", 60, busy, []).map(s => s.start.getHours());

  it("sem intervalo, o horário encosta no atendimento", () => {
    expect(starts(padRanges(lesson, 0))).toEqual([8, 9, 11, 12]);
  });

  it("com 15 min, os horários colados somem", () => {
    expect(starts(padRanges(lesson, 15))).toEqual([8, 12]);
  });

  it("valor inválido vale 0", () => {
    expect(padRanges(lesson, Number.NaN)).toBe(lesson);
  });
});

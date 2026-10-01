import { describe, it, expect } from "vitest";
import { buildOccurrences, countUntil, weekdaysLabel } from "@/lib/recurrence";

const d = (s: string) => new Date(s);
const fmt = (xs: Date[]) => xs.map(x => `${x.getDay()} ${x.getDate()} ${x.getHours()}:${String(x.getMinutes()).padStart(2, "0")}`);

describe("buildOccurrences", () => {
  it("sem dias escolhidos repete o dia do início, uma vez por semana", () => {
    // 2026-09-30 é quarta.
    expect(fmt(buildOccurrences(d("2026-09-30T18:00"), 3))).toEqual(["3 30 18:00", "3 7 18:00", "3 14 18:00"]);
  });

  it("quarta e sexta, a partir de uma quarta", () => {
    expect(fmt(buildOccurrences(d("2026-09-30T18:00"), 4, [3, 5]))).toEqual(["3 30 18:00", "5 2 18:00", "3 7 18:00", "5 9 18:00"]);
  });

  it("início fora dos dias: começa no próximo dia escolhido", () => {
    expect(fmt(buildOccurrences(d("2026-09-30T09:30"), 2, [1]))).toEqual(["1 5 9:30", "1 12 9:30"]);
  });

  it("respeita o máximo", () => {
    expect(buildOccurrences(d("2026-09-30T18:00"), 500, [1, 2, 3, 4, 5])).toHaveLength(104);
  });
});

describe("weekdaysLabel", () => {
  it("ordena a partir da segunda e junta com e/and", () => {
    expect(weekdaysLabel([5, 1, 3], false)).toBe("seg, qua e sex");
    expect(weekdaysLabel([0, 6], true)).toBe("Sat and Sun");
    expect(weekdaysLabel([2], false)).toBe("ter");
  });
});

// "Repetir até tal data" (Thiago, 01/10).
describe("countUntil", () => {
  it("conta os dias escolhidos do início até a data, inclusive", () => {
    // qua 30/09 até qua 14/10: qua e sex -> 30/09, 02/10, 07/10, 09/10, 14/10.
    expect(countUntil(d("2026-09-30T18:00"), d("2026-10-14T12:00"), [3, 5])).toBe(5);
  });
  it("sem dias escolhidos vale o dia do início", () => {
    expect(countUntil(d("2026-09-30T18:00"), d("2026-10-28T12:00"))).toBe(5);
  });
  it("data antes do início dá zero", () => {
    expect(countUntil(d("2026-09-30T18:00"), d("2026-09-29T12:00"))).toBe(0);
  });
  it("a quantidade vira as datas de buildOccurrences", () => {
    const base = d("2026-09-30T18:00");
    const n = countUntil(base, d("2026-10-14T12:00"), [3, 5]);
    expect(fmt(buildOccurrences(base, n, [3, 5])).at(-1)).toBe("3 14 18:00");
  });
});

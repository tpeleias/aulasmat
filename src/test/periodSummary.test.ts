import { describe, it, expect } from "vitest";
import { periodRange, summarizePeriod, change, type SummaryLesson } from "@/lib/periodSummary";
import { computeStatements, type LedgerTx } from "@/lib/billing";

const L = (o: Partial<SummaryLesson> & { id: string; start_at: string; status: string }): SummaryLesson =>
  ({ duration_minutes: 60, price: 200, teacher: "thiago", ...o });
const T = (o: Partial<LedgerTx> & { id: string; amount: number; kind: string }): LedgerTx =>
  ({ guardian_name: "Ana", student_name: "Bia", lesson_id: null, description: null, created_at: "2026-09-10T15:00:00Z", ...o });

describe("periodRange", () => {
  it("mês e semana (segunda a domingo), com deslocamento", () => {
    const anchor = new Date(2026, 8, 23, 12); // qua 23/09/2026
    const m = periodRange("month", anchor);
    expect(m.start).toEqual(new Date(2026, 8, 1));
    expect(m.end).toEqual(new Date(2026, 9, 1));
    expect(m.label).toBe("setembro de 2026");
    const w = periodRange("week", anchor);
    expect(w.start).toEqual(new Date(2026, 8, 21));
    expect(w.label).toBe("21/09 a 27/09");
    expect(periodRange("month", anchor, -1).label).toBe("agosto de 2026");
  });
});

describe("summarizePeriod", () => {
  const range = { start: new Date("2026-09-01T03:00:00Z"), end: new Date("2026-10-01T03:00:00Z") };
  const lessons = [
    L({ id: "a", start_at: "2026-09-05T15:00:00Z", status: "realizada" }),
    L({ id: "b", start_at: "2026-09-12T15:00:00Z", status: "realizada", duration_minutes: 90, teacher: "mayara" }),
    L({ id: "c", start_at: "2026-09-13T15:00:00Z", status: "cancelada" }),
    L({ id: "d", start_at: "2026-09-28T15:00:00Z", status: "agendada" }),
    L({ id: "z", start_at: "2026-08-28T15:00:00Z", status: "realizada" }), // fora do mês
  ];
  const txs = [
    T({ id: "1", kind: "lesson", lesson_id: "a", amount: -200 }),
    T({ id: "2", kind: "voucher", lesson_id: "a", amount: 20 }),
    T({ id: "3", kind: "lesson", lesson_id: "b", amount: -300 }),
    T({ id: "4", kind: "lesson", lesson_id: "z", amount: -200 }),
    T({ id: "5", kind: "adjustment", amount: 250, created_at: "2026-09-15T15:00:00Z" }),
    T({ id: "6", kind: "package", amount: 1000, created_at: "2026-08-20T15:00:00Z" }), // pago em agosto
  ];
  const s = summarizePeriod({
    lessons, txs, statements: computeStatements(txs, lessons.map(l => ({ ...l, student_name: "Bia", subject: null }))),
    range, now: new Date("2026-09-23T15:00:00Z"),
  });

  it("conta aulas e horas pela data da aula", () => {
    expect(s.aulasDadas).toBe(2);
    expect(s.horas).toBe(2.5);
    expect(s.canceladas).toBe(1);
    expect(s.aindaMarcadas).toBe(1);
  });

  it("valor das aulas: cheio, desconto e líquido", () => {
    expect(s.valorCheio).toBe(500);
    expect(s.descontos).toBe(20);
    expect(s.liquido).toBe(480);
  });

  it("recebido é pela data do pagamento - o pacote de agosto não entra em setembro", () => {
    expect(s.recebido).toBe(250);
  });

  it("em aberto do período e geral fecham com a carteira", () => {
    // Créditos 1250 (1000+250) + voucher 20 contra cobranças 700: nada em aberto.
    expect(s.emAbertoGeral).toBe(0);
    expect(s.emAbertoDoPeriodo).toBe(0);
  });

  it("previsto e separação por professor", () => {
    expect(s.previsto).toBe(200);
    expect(s.porProfessor).toEqual([
      { teacher: "mayara", aulas: 1, valor: 300 },
      { teacher: "thiago", aulas: 1, valor: 200 },
    ]);
  });
});

describe("change", () => {
  it("percentual, e nulo sem base", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(50, 100)).toBe(-50);
    expect(change(10, 0)).toBeNull();
  });
});

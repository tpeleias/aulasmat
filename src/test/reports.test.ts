import { describe, it, expect } from "vitest";
import { isIncome, inPeriod, summarizeIncome, toCsv, yearsWithData } from "@/lib/reports";
import type { LedgerTx } from "@/lib/billing";

const tx = (over: Partial<LedgerTx> & { id: string; amount: number; kind: string }): LedgerTx => ({
  guardian_name: null,
  student_name: "Ana",
  lesson_id: null,
  description: null,
  created_at: "2026-03-10T00:00:00Z",
  ...over,
});

describe("isIncome", () => {
  it("pacote e pagamento positivo contam como renda", () => {
    expect(isIncome({ kind: "package", amount: 2000 })).toBe(true);
    expect(isIncome({ kind: "adjustment", amount: 220 })).toBe(true);
  });

  it("aula, voucher e ajuste negativo não contam", () => {
    expect(isIncome({ kind: "lesson", amount: -220 })).toBe(false);
    expect(isIncome({ kind: "voucher", amount: 22 })).toBe(false);
    expect(isIncome({ kind: "adjustment", amount: -50 })).toBe(false);
  });
});

describe("inPeriod", () => {
  it("filtra por ano, e por mês quando informado", () => {
    expect(inPeriod("2026-03-10T00:00:00Z", 2026, null)).toBe(true);
    expect(inPeriod("2026-03-10T00:00:00Z", 2025, null)).toBe(false);
    expect(inPeriod("2026-03-10T00:00:00Z", 2026, 2)).toBe(true); // março = mês 2 (0-index)
    expect(inPeriod("2026-03-10T00:00:00Z", 2026, 5)).toBe(false);
  });
});

describe("summarizeIncome", () => {
  it("soma só o que é renda, agrupado por conta, no período certo", () => {
    const txs: LedgerTx[] = [
      tx({ id: "1", kind: "package", amount: 2000, created_at: "2026-03-05T00:00:00Z" }),
      tx({ id: "2", kind: "lesson", amount: -220, created_at: "2026-03-06T00:00:00Z" }),
      tx({ id: "3", kind: "voucher", amount: 200, created_at: "2026-03-06T00:00:00Z" }),
      tx({ id: "4", kind: "adjustment", amount: 220, created_at: "2026-03-07T00:00:00Z", guardian_name: "Bia", student_name: "Bia" }),
      tx({ id: "5", kind: "package", amount: 500, created_at: "2025-12-01T00:00:00Z" }), // fora do ano
    ];
    const { rows, byAccount, total } = summarizeIncome(txs, 2026, null);
    expect(rows).toHaveLength(2);
    expect(total).toBe(2220);
    expect(byAccount).toEqual([
      { label: "Aluno: Ana", total: 2000 },
      { label: "Bia", total: 220 },
    ]);
  });

  it("filtra por mês quando informado", () => {
    const txs: LedgerTx[] = [
      tx({ id: "1", kind: "package", amount: 2000, created_at: "2026-03-05T00:00:00Z" }),
      tx({ id: "2", kind: "package", amount: 500, created_at: "2026-04-05T00:00:00Z" }),
    ];
    expect(summarizeIncome(txs, 2026, 2).total).toBe(2000); // março = índice 2
    expect(summarizeIncome(txs, 2026, 3).total).toBe(500);
  });
});

describe("toCsv", () => {
  it("usa ponto e vírgula, que é o que o Excel em português abre em colunas", () => {
    expect(toCsv(["a", "b"], [[1, "x"], [2, "y"]])).toBe("a;b\n1;x\n2;y");
  });

  it("vírgula decimal não precisa de aspas", () => {
    expect(toCsv(["valor"], [["220,00"]])).toBe("valor\n220,00");
  });

  it("põe em aspas quem tem separador, aspas ou quebra de linha", () => {
    expect(toCsv(["nome"], [["Ana; Bia"]])).toBe('nome\n"Ana; Bia"');
    expect(toCsv(["nome"], [['diz "oi"']])).toBe('nome\n"diz ""oi"""');
    expect(toCsv(["nome"], [["a\nb"]])).toBe('nome\n"a\nb"');
  });
});

describe("yearsWithData", () => {
  it("lista os anos com lançamento, mais o ano atual, sem repetir", () => {
    const txs: LedgerTx[] = [
      tx({ id: "1", kind: "package", amount: 100, created_at: "2025-01-01T15:00:00Z" }),
      tx({ id: "2", kind: "package", amount: 100, created_at: "2024-01-01T15:00:00Z" }),
    ];
    const years = yearsWithData(txs);
    expect(years).toContain(2025);
    expect(years).toContain(2024);
    expect(years).toContain(new Date().getFullYear());
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });
});

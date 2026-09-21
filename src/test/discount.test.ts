import { describe, it, expect } from "vitest";
import { discountOn, discountOnItems, isValidDiscount, describeDiscount, parseDiscountValue } from "@/lib/discount";

// Estes números são os mesmos conferidos no banco por scripts/espelho-testes.sql.
// Se um lado mudar sem o outro, a tela promete um desconto e a carteira lança
// outro - por isso os casos são deliberadamente iguais nos dois.
describe("discountOn", () => {
  it("abate a porcentagem da cobrança", () => {
    expect(discountOn(220, { kind: "percent", value: 10 })).toBe(22);
    expect(discountOn(150, { kind: "percent", value: 10 })).toBe(15);
    expect(discountOn(220, { kind: "percent", value: 50 })).toBe(110);
  });

  it("abate o valor fixo em reais", () => {
    expect(discountOn(220, { kind: "amount", value: 30 })).toBe(30);
  });

  it("nunca abate mais do que a aula custa", () => {
    expect(discountOn(220, { kind: "amount", value: 500 })).toBe(220);
    expect(discountOn(220, { kind: "percent", value: 100 })).toBe(220);
  });

  it("arredonda em centavos", () => {
    expect(discountOn(150, { kind: "percent", value: 33 })).toBe(49.5);
    expect(discountOn(99.99, { kind: "percent", value: 10 })).toBe(10);
  });

  it("ignora cobrança zerada ou negativa", () => {
    expect(discountOn(0, { kind: "percent", value: 10 })).toBe(0);
    expect(discountOn(-50, { kind: "amount", value: 10 })).toBe(0);
  });
});

describe("discountOnItems", () => {
  const abertas = [{ amount: 220 }, { amount: 150 }];

  it("aplica em cada aula e soma", () => {
    expect(discountOnItems(abertas, { kind: "percent", value: 10 })).toBe(37);
  });

  it("em reais, o valor sai de cada aula e não do total", () => {
    expect(discountOnItems(abertas, { kind: "amount", value: 30 })).toBe(60);
  });

  it("o teto vale aula a aula", () => {
    expect(discountOnItems([{ amount: 220 }, { amount: 20 }], { kind: "amount", value: 100 })).toBe(120);
  });

  it("sem aulas em aberto, não há o que abater", () => {
    expect(discountOnItems([], { kind: "percent", value: 10 })).toBe(0);
  });
});

describe("isValidDiscount", () => {
  it("recusa o que o banco também recusa", () => {
    expect(isValidDiscount("percent", 150)).toBe(false);
    expect(isValidDiscount("percent", 0)).toBe(false);
    expect(isValidDiscount("amount", -5)).toBe(false);
    expect(isValidDiscount("amount", NaN)).toBe(false);
  });

  it("aceita os limites", () => {
    expect(isValidDiscount("percent", 100)).toBe(true);
    expect(isValidDiscount("percent", 0.5)).toBe(true);
    expect(isValidDiscount("amount", 5000)).toBe(true);
  });
});

describe("describeDiscount", () => {
  it("escreve porcentagem sem casas sobrando", () => {
    expect(describeDiscount({ kind: "percent", value: 10 })).toBe("10%");
    expect(describeDiscount({ kind: "percent", value: 12.5 })).toBe("12,5%");
  });

  it("escreve reais no formato do app", () => {
    expect(describeDiscount({ kind: "amount", value: 30 })).toContain("30,00");
  });
});

describe("parseDiscountValue", () => {
  it("aceita vírgula, que é como se digita em português", () => {
    expect(parseDiscountValue("12,5")).toBe(12.5);
    expect(parseDiscountValue("12.5")).toBe(12.5);
  });
});

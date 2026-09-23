import { describe, it, expect } from "vitest";
import { valorPorExtenso } from "@/lib/extenso";

describe("valorPorExtenso", () => {
  it("valores redondos comuns de aula e pacote", () => {
    expect(valorPorExtenso(220)).toBe("Duzentos e vinte reais");
    expect(valorPorExtenso(100)).toBe("Cem reais");
    expect(valorPorExtenso(1050)).toBe("Mil e cinquenta reais");
    expect(valorPorExtenso(2000)).toBe("Dois mil reais");
  });

  it("singular de real e centavo", () => {
    expect(valorPorExtenso(1)).toBe("Um real");
    expect(valorPorExtenso(0.01)).toBe("Um centavo");
  });

  it("centavos sozinhos, sem parte inteira", () => {
    expect(valorPorExtenso(0.5)).toBe("Cinquenta centavos");
  });

  it("reais e centavos juntos", () => {
    expect(valorPorExtenso(220.5)).toBe("Duzentos e vinte reais e cinquenta centavos");
  });

  it("zero", () => {
    expect(valorPorExtenso(0)).toBe("Zero reais");
  });

  it("cento (101-199) usa 'cento e', cem (100) não", () => {
    expect(valorPorExtenso(101)).toBe("Cento e um reais");
    expect(valorPorExtenso(199)).toBe("Cento e noventa e nove reais");
  });

  it("milhar com resto usa vírgula antes do último grupo", () => {
    expect(valorPorExtenso(1234)).toBe("Mil, duzentos e trinta e quatro reais");
  });

  it("recusa negativo e não-finito", () => {
    expect(valorPorExtenso(-10)).toBe("");
    expect(valorPorExtenso(NaN)).toBe("");
  });
});

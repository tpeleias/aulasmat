import { describe, expect, it } from "vitest";
import { packageVoucher } from "@/lib/packages";

describe("packageVoucher", () => {
  it("é a diferença para o valor cheio das N aulas", () => {
    // Os dois pacotes que estavam cravados no código, a R$ 220/h.
    expect(packageVoucher(10, 2000, 220)).toBe(200);
    expect(packageVoucher(5, 1050, 220)).toBe(50);
  });
  it("acompanha o valor da hora da empresa", () => {
    expect(packageVoucher(10, 2000, 250)).toBe(500);
  });
  it("pacote mais caro que o cheio não gera voucher negativo", () => {
    expect(packageVoucher(4, 1000, 200)).toBe(0);
  });
  it("entrada inválida dá zero", () => {
    expect(packageVoucher(0, 100, 200)).toBe(0);
    expect(packageVoucher(5, 0, 200)).toBe(0);
  });
});

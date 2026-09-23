import { describe, it, expect } from "vitest";
import { crc16, buildPixPayload, normalizePixKey } from "@/lib/pix";

describe("crc16", () => {
  it("bate com o valor de referência do CRC16-CCITT", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("buildPixPayload", () => {
  it("reproduz o exemplo do manual do BR Code (Banco Central)", () => {
    expect(buildPixPayload({
      key: "123e4567-e12b-12d1-a456-426655440000", name: "Fulano de Tal", city: "BRASILIA",
    })).toBe("00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D");
  });

  it("inclui o valor com duas casas e fecha com CRC válido", () => {
    const p = buildPixPayload({ key: "375.547.138-84", name: "Thiago Peleias", city: "São Paulo", amount: 836 })!;
    expect(p).toContain("0111375547138845204");
    expect(p).toContain("5406836.00");
    expect(p).toContain("6009Sao Paulo");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it("sem nome ou cidade não gera código (o banco recusaria)", () => {
    expect(buildPixPayload({ key: "a@b.com", name: "", city: "X" })).toBeNull();
    expect(buildPixPayload({ key: "a@b.com", name: "X", city: "" })).toBeNull();
  });

  it("corta nome em 25 e cidade em 15 caracteres", () => {
    const p = buildPixPayload({ key: "a@b.com", name: "Nome Muito Comprido Demais Para Caber", city: "Cidade Com Nome Longo" })!;
    expect(p).toContain("5925Nome Muito Comprido Demai");
    expect(p).toContain("6015Cidade Com Nome");
  });
});

describe("normalizePixKey", () => {
  it("CPF, CNPJ, e-mail, celular e chave aleatória", () => {
    expect(normalizePixKey("375.547.138-84")).toBe("37554713884");
    expect(normalizePixKey("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizePixKey(" Fulano@Email.com ")).toBe("fulano@email.com");
    expect(normalizePixKey("+55 (11) 99999-8888")).toBe("+5511999998888");
    expect(normalizePixKey("123E4567-E12B-12D1-A456-426655440000")).toBe("123e4567-e12b-12d1-a456-426655440000");
  });
});

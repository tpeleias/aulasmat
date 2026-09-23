import { describe, it, expect } from "vitest";
import { buildReceiptPdf } from "@/lib/receiptPdf";

const text = (b: Blob) => new Promise<string>((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.readAsBinaryString(b);
});

describe("buildReceiptPdf", () => {
  it("gera um PDF com quem pagou, o total e o valor por extenso", async () => {
    const blob = await buildReceiptPdf({
      issuer: "Portal de Aulas", issuerDocument: "375.547.138-84", issuerEmail: null,
      payer: "Maria Souza", period: "setembro de 2026",
      rows: [{ date: "05/09/2026", description: "Pix", amount: 440 }],
      total: 440, issuedAt: "23/09/2026",
    });
    const pdf = await text(blob);
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("Maria Souza");
    expect(pdf).toContain("quatrocentos e quarenta reais");
    expect(pdf).toContain("375.547.138-84");
  });

  it("sem CPF/CNPJ, deixa a linha para preencher à mão", async () => {
    const pdf = await text(await buildReceiptPdf({
      issuer: "X", issuerDocument: null, issuerEmail: null, payer: "Y", period: "maio de 2026",
      rows: [], total: 0, issuedAt: "01/06/2026",
    }));
    expect(pdf).toContain("CPF/CNPJ: ____");
  });
});

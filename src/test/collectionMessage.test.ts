import { describe, it, expect } from "vitest";
import { buildCollectionMessage as build } from "@/lib/collectionMessage";

// fmtMoney usa espaço não-quebrável depois do "R$".
const buildCollectionMessage = (...a: Parameters<typeof build>) => build(...a).replace(/\u00a0/g, " ");
import type { OpenItem } from "@/lib/billing";

const item = (over: Partial<OpenItem> & { id: string; date: string; amount: number }): OpenItem => ({
  student: "Luana", detail: "Matemática (60 min)", partial: false, ...over,
});
const pay = { pixKey: "375.547.138-84", paymentLink: "https://loja.infinitepay.io/x" };

describe("buildCollectionMessage", () => {
  it("sem desconto: um bloco por aula e só o total", () => {
    const msg = buildCollectionMessage([
      item({ id: "1", date: "2026-05-15T19:30:00Z", amount: 200 }),
      item({ id: "2", date: "2026-06-23T18:00:00Z", amount: 200 }),
    ], pay);
    expect(msg).toContain("aulas de *Luana*");
    expect(msg).toContain("Matemática · 60 min");
    expect(msg).not.toContain("— Luana —");
    expect(msg).toContain("*Total a pagar: R$ 400,00*");
    expect(msg).not.toContain("Descontos");
    expect(msg).not.toContain("economizando");
    expect(msg).toContain("Chave (CPF): 375.547.138-84");
  });

  it("com desconto: valor cheio riscado, economia por aula e no total", () => {
    const msg = buildCollectionMessage([
      item({ id: "1", date: "2026-08-20T18:00:00Z", amount: 198, discount: { amount: 22, gross: 220, label: "Desconto de 10% - Aula em 20/08 15:00 (60 min)" } }),
      item({ id: "2", date: "2026-08-26T18:00:00Z", amount: 198, discount: { amount: 22, gross: 220, label: "Desconto de 10% - Aula em 26/08 15:00 (60 min)" } }),
    ], pay);
    expect(msg).toContain("~R$ 220,00~ → *R$ 198,00*");
    expect(msg).toContain("_Desconto de 10%: você economiza R$ 22,00_");
    expect(msg).toContain("Aulas: R$ 440,00");
    expect(msg).toContain("Descontos: − R$ 44,00");
    expect(msg).toContain("*Total a pagar: R$ 396,00*");
    expect(msg).toContain("economizando *R$ 44,00*");
  });

  it("aula paga em parte: mostra o que já entrou e o total fecha", () => {
    const msg = buildCollectionMessage([
      item({ id: "1", date: "2026-08-20T18:00:00Z", amount: 98, partial: true, discount: { amount: 22, gross: 220, label: "Desconto de 10%" } }),
    ], pay);
    expect(msg).toContain("Já recebemos R$ 100,00 desta aula; falta *R$ 98,00*");
    expect(msg).toContain("Já pago: − R$ 100,00");
    expect(msg).toContain("*Total a pagar: R$ 98,00*");
  });

  it("irmãos na mesma conta: nome em cada aula", () => {
    const msg = buildCollectionMessage([
      item({ id: "1", date: "2026-08-20T18:00:00Z", amount: 200 }),
      item({ id: "2", date: "2026-08-21T18:00:00Z", amount: 200, student: "Pedro" }),
    ], pay);
    expect(msg).toContain("Matemática · 60 min · Pedro");
    expect(msg).not.toContain("aulas de *");
  });

  it("chave que não é CPF não é chamada de CPF", () => {
    expect(buildCollectionMessage([item({ id: "1", date: "2026-08-20T18:00:00Z", amount: 200 })], { pixKey: "a@b.com", paymentLink: null }))
      .toContain("Chave (e-mail): a@b.com");
  });

  it("o link de pagamento usa o nome e o texto da empresa, não InfinitePay fixo", () => {
    const msg = buildCollectionMessage([item({ id: "1", date: "2026-08-20T18:00:00Z", amount: 200 })],
      { pixKey: null, paymentLink: "https://mp.com/x", linkLabel: "Mercado Pago", linkNote: "Cartão em até 3x" });
    expect(msg).toContain("🔗 *Mercado Pago*\nhttps://mp.com/x\nCartão em até 3x");
    expect(msg).not.toContain("InfinitePay");
    expect(msg).not.toContain("12x");
  });

  it("sem nome configurado, chama de link de pagamento", () => {
    expect(buildCollectionMessage([item({ id: "1", date: "2026-08-20T18:00:00Z", amount: 200 })], { pixKey: null, paymentLink: "https://x" }))
      .toContain("🔗 *Link de pagamento*");
  });

  it("com nome e cidade do Pix, manda o copia e cola com o total", () => {
    const msg = buildCollectionMessage([item({ id: "1", date: "2026-08-20T18:00:00Z", amount: 200 })],
      { pixKey: "375.547.138-84", paymentLink: null, pixName: "Thiago", pixCity: "Sao Paulo" });
    expect(msg).toContain("Pix copia e cola");
    expect(msg).toMatch(/000201.*5406200\.00.*6304[0-9A-F]{4}/);
  });

  it("sem nome/cidade, fica só a chave (sem código que o banco recusaria)", () => {
    const msg = buildCollectionMessage([item({ id: "1", date: "2026-08-20T18:00:00Z", amount: 200 })], pay);
    expect(msg).not.toContain("copia e cola");
  });
});

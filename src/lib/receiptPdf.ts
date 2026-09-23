import { fmtMoney } from "@/lib/balance";
import { valorPorExtenso } from "@/lib/extenso";

export type ReceiptData = {
  issuer: string;
  issuerDocument: string | null;
  issuerEmail: string | null;
  payer: string;
  period: string;
  rows: { date: string; description: string; amount: number }[];
  total: number;
  issuedAt: string;
};

// PDF de verdade, e não impressão da tela: a tela herda o tema (no escuro o
// PDF saía cinza) e o app Android nem tem impressão. Preto no branco sempre.
// jsPDF entra por import dinâmico - ~350 KB que só quem gera recibo baixa.
export async function buildReceiptPdf(d: ReceiptData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  // fmtMoney usa espaço não-quebrável; a fonte padrão do jsPDF o desenha torto.
  const money = (v: number) => fmtMoney(v).replace(/\u00a0/g, " ");
  const W = 210;
  const M = 20;
  let y = 28;

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(d.issuer || "Recibo", W / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const line of [d.issuerDocument, d.issuerEmail].filter(Boolean) as string[]) {
    y += 6;
    doc.text(line, W / 2, y, { align: "center" });
  }

  y += 14;
  doc.setDrawColor(0);
  doc.line(M, y, W - M, y);
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("RECIBO DE PAGAMENTO", W / 2, y, { align: "center" });
  doc.setFontSize(12);
  doc.text(money(d.total), W - M, y, { align: "right" });

  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const body = `Recebi de ${d.payer} a quantia de ${money(d.total)} (${valorPorExtenso(d.total).toLowerCase()}), referente a aulas de ${d.period}, conforme discriminado abaixo:`;
  const wrapped = doc.splitTextToSize(body, W - 2 * M);
  doc.text(wrapped, M, y);
  y += wrapped.length * 6 + 6;

  doc.setFontSize(10);
  for (const r of d.rows) {
    if (y > 250) { doc.addPage(); y = 25; }
    const desc = doc.splitTextToSize(`${r.date} - ${r.description}`, W - 2 * M - 35);
    doc.text(desc, M, y);
    doc.text(money(r.amount), W - M, y, { align: "right" });
    y += desc.length * 5 + 2;
  }
  y += 2;
  doc.line(M, y, W - M, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.text("Total", M, y);
  doc.text(money(d.total), W - M, y, { align: "right" });

  y = Math.max(y + 30, 230);
  if (y > 270) { doc.addPage(); y = 60; }
  doc.setFont("helvetica", "normal");
  doc.text(`Emitido em ${d.issuedAt}`, W - M, y - 18, { align: "right" });
  doc.line(W / 2 - 40, y, W / 2 + 40, y);
  doc.text(d.issuer || "Assinatura", W / 2, y + 6, { align: "center" });
  if (!d.issuerDocument) doc.text("CPF/CNPJ: ______________________", W / 2, y + 12, { align: "center" });

  return doc.output("blob");
}

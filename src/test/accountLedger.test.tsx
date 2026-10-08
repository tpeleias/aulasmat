import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import AccountLedger from "@/components/AccountLedger";
import { buildLedger } from "@/lib/ledger";
import type { LedgerLesson, LedgerTx } from "@/lib/billing";

vi.mock("@/lib/haptics", () => ({ haptics: { tap: () => {} } }));
vi.mock("@/hooks/useVocabulary", async () => {
  const { buildVocabulary } = await import("@/lib/vocabulary");
  return { useWords: () => buildVocabulary("aulas") };
});

const labels = { appointment: "Aula", entry: "Lançamento", payment: "Pagamento", package: "Pacote", voucher: "Voucher", leftover: "Sobra", adjustment: "Ajuste" };
const lesson = (id: string, start_at: string): LedgerLesson => ({ id, student_name: "Bia", start_at, duration_minutes: 60, subject: "Matemática", teacher: "t" });
const tx = (id: string, amount: number, kind: string, created_at: string, extra: Partial<LedgerTx> = {}): LedgerTx =>
  ({ id, guardian_name: "Ana", student_name: "Bia", amount, kind, lesson_id: null, description: null, created_at, ...extra });

const ledger = buildLedger([
  tx("p", 400, "package", "2026-09-01T10:00:00Z", { description: "Pacote 3 aulas" }),
  tx("v", 200, "voucher", "2026-09-01T10:00:00Z", { description: "Voucher pacote 3 aulas" }),
  // Lançadas fora de ordem: a de 10/09 entrou antes da de 03/09.
  tx("b", -200, "lesson", "2026-09-11T00:00:00Z", { lesson_id: "B" }),
  tx("a", -200, "lesson", "2026-09-30T00:00:00Z", { lesson_id: "A" }),
  tx("c", -200, "lesson", "2026-09-30T00:00:00Z", { lesson_id: "C" }),
  tx("d", -200, "lesson", "2026-10-02T00:00:00Z", { lesson_id: "D" }),
], [lesson("A", "2026-09-03T15:00:00Z"), lesson("B", "2026-09-10T15:00:00Z"), lesson("C", "2026-09-17T15:00:00Z"), lesson("D", "2026-10-01T15:00:00Z")], labels);

describe("Contas no Financeiro (08/10)", () => {
  it("lista as aulas na ordem da data e diz com o que cada uma foi paga", () => {
    try { localStorage.setItem("cronys.ledger.order", "old"); } catch { /* ok */ }
    render(<AccountLedger ledger={ledger} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map(li => li.textContent?.match(/\d{2}\/\d{2}/)?.[0])).toEqual(["03/09", "10/09", "17/09", "01/10"]);
    expect(within(items[0]).getByText("Pago")).toBeTruthy();
    expect(within(items[0]).getByText(/Pago com Pacote 3 aulas/)).toBeTruthy();
    // 600 de crédito: três aulas de 200 pagas, a quarta em aberto.
    expect(within(items[2]).getByText("Pago")).toBeTruthy();
    expect(within(items[3]).getByText("Em aberto")).toBeTruthy();
  });

  it("mostra o pacote uma vez só e onde ele foi abatido", () => {
    render(<AccountLedger ledger={ledger} defaultTab="payments" />);
    expect(screen.getAllByText("Pacote 3 aulas")).toHaveLength(1);
    expect(screen.getByText(/R\$\s?400,00 pagos \+ R\$\s?200,00 de desconto/)).toBeTruthy();
    expect(screen.getByText("Abateu 3 de 3 aulas")).toBeTruthy();
    expect(screen.getByText("Usado por completo")).toBeTruthy();
    fireEvent.click(screen.getByText("Ver onde foi abatido"));
    expect(screen.getAllByText(/Matemática \(60 min\)/)).toHaveLength(3);
  });

  it("no portal (sem ações) não mostra botões de editar", () => {
    render(<AccountLedger ledger={ledger} />);
    expect(screen.queryByTitle(/Editar/)).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// O Financeiro refeito (08/10): busca, filtros, pacote em uso no cartão e a
// prévia do que um pagamento quita.

const rows: Record<string, unknown[]> = {
  wallet_transactions: [
    // Da mais nova para a mais antiga, como a tela pede ao banco.
    { id: "c2", guardian_name: "Ana", student_name: "Bia", amount: -200, kind: "lesson", lesson_id: "L2", description: null, created_at: "2026-10-02T00:00:00Z" },
    { id: "c1", guardian_name: "Ana", student_name: "Bia", amount: -200, kind: "lesson", lesson_id: "L1", description: null, created_at: "2026-10-01T00:00:00Z" },
    { id: "d1", guardian_name: null, student_name: "Caio", amount: -200, kind: "lesson", lesson_id: "L3", description: null, created_at: "2026-10-01T00:00:00Z" },
    { id: "v", guardian_name: "Ana", student_name: "Bia", amount: 200, kind: "voucher", lesson_id: null, description: "Voucher pacote 5 aulas", created_at: "2026-09-01T00:00:00Z" },
    { id: "p", guardian_name: "Ana", student_name: "Bia", amount: 800, kind: "package", lesson_id: null, description: "Pacote 5 aulas", created_at: "2026-09-01T00:00:00Z" },
  ],
  students: [
    { id: "s1", student_name: "Bia", guardian_name: "Ana" },
    { id: "s2", student_name: "Caio", guardian_name: null },
  ],
  lessons: [
    { id: "L1", student_name: "Bia", guardian_name: "Ana", start_at: "2026-09-20T15:00:00Z", duration_minutes: 60, subject: "Matemática", teacher: "t", status: "realizada", price: 200 },
    { id: "L2", student_name: "Bia", guardian_name: "Ana", start_at: "2026-09-10T15:00:00Z", duration_minutes: 60, subject: "Matemática", teacher: "t", status: "realizada", price: 200 },
    { id: "L3", student_name: "Caio", guardian_name: null, start_at: "2026-09-12T15:00:00Z", duration_minutes: 60, subject: "Física", teacher: "t", status: "realizada", price: 200 },
  ],
  lesson_packages: [{ id: "k", name: "Pacote 5 aulas", lessons: 5, price: 800, active: true, sort_order: 0 }],
};
const makeChain = (data: () => unknown): unknown => {
  const c: unknown = new Proxy(() => {}, {
    get: (_t, prop) => (prop === "then" ? (ok: (v: unknown) => void) => ok({ data: data(), error: null }) : c),
    apply: () => c,
  });
  return c;
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => makeChain(() => rows[t] ?? (t === "settings" ? null : [])), rpc: () => makeChain(() => null) },
}));
vi.mock("@/hooks/useVocabulary", async () => {
  const { buildVocabulary } = await import("@/lib/vocabulary");
  const v = buildVocabulary("aulas");
  return { useWords: () => v };
});
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({ plan: { packages: true } }) }));
vi.mock("@/hooks/useLessonPrice", () => ({ useLessonPrice: () => ({ price: 200 }) }));
vi.mock("@/hooks/useMessageTemplates", () => ({ useMessageTemplates: () => ({ templates: {} }) }));
vi.mock("@/hooks/useServices", () => ({ useServices: () => ({ services: [] }) }));
vi.mock("@/hooks/useTeacherName", () => ({ useTeacherName: () => () => "Thiago" }));
vi.mock("@/lib/widgetSync", () => ({ syncBillingWidget: () => {} }));
vi.mock("@/lib/haptics", () => ({ haptics: { tap: () => {}, success: () => {}, warning: () => {} } }));
vi.mock("@/components/LessonDialog", () => ({ LessonDialog: () => null }));
vi.mock("@/components/PeriodSummary", () => ({ default: () => null }));
vi.mock("@/components/EmailHistoryDialog", () => ({ EmailHistoryDialog: () => null }));

import BillingPage from "@/pages/admin/BillingPage";

describe("Financeiro (08/10)", () => {
  it("mostra o pacote em uso no cartão e filtra por busca e por situação", async () => {
    render(<BillingPage />);
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    // 1000 de crédito - 400 das duas aulas: sobram 600, três aulas de 200.
    expect(screen.getByText(/Pacote 5 aulas: sobra R\$\s?600,00/)).toBeTruthy();
    expect(screen.getByText(/\(3 aulas\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /A receber/ }));
    expect(screen.queryByText("Ana")).toBeNull();
    expect(screen.getByText("Aluno: Caio")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Todas/ }));
    fireEvent.change(screen.getByLabelText("Buscar conta"), { target: { value: "bia" } });
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("Aluno: Caio")).toBeNull();
  });

  it("abre a conta com as aulas em ordem de data", async () => {
    try { localStorage.setItem("cronys.ledger.order", "old"); } catch { /* ok */ }
    render(<BillingPage />);
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    fireEvent.click(screen.getByText("Ana"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Aulas/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Aulas/ }));
    const card = screen.getByText("Ana").closest(".rounded-2xl") as HTMLElement;
    const dates = within(card).getAllByRole("listitem").map(li => li.textContent?.match(/\d{2}\/\d{2}/)?.[0]);
    expect(dates).toEqual(["10/09", "20/09"]);
  });

  it("os detalhes abertos têm onde recolher (em cima e no fim)", async () => {
    render(<BillingPage />);
    await waitFor(() => expect(screen.getByText("Ana")).toBeTruthy());
    const card = () => screen.getByText("Ana").closest("[data-account]") as HTMLElement;
    fireEvent.click(within(card()).getByRole("button", { name: /Ver detalhes/ }));
    expect(within(card()).getByRole("tab", { name: /Aulas/ })).toBeTruthy();
    fireEvent.click(within(card()).getByRole("button", { name: /Recolher detalhes/ }));
    expect(within(card()).queryByRole("tab", { name: /Aulas/ })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: /Ver detalhes/ }));
    fireEvent.click(within(card()).getByRole("button", { name: /^Recolher$/ }));
    expect(within(card()).queryByRole("tab", { name: /Aulas/ })).toBeNull();
  });

  it("vender pacote mostra quantas aulas e quais em aberto ele ja cobre", async () => {
    render(<BillingPage />);
    await waitFor(() => expect(screen.getByText("Aluno: Caio")).toBeTruthy());
    const card = screen.getByText("Aluno: Caio").closest(".rounded-2xl") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /Pagamento/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Pacote 5 aulas"));
    expect(within(dialog).getByText(/5 aulas de 60 min/)).toBeTruthy();
    expect(within(dialog).getByText(/Já cobre 1 aula em aberto/)).toBeTruthy();
    expect(within(dialog).getByText(/Recebido agora/)).toBeTruthy();
  });

  it("antes de registrar, mostra o que o pagamento vai quitar", async () => {
    render(<BillingPage />);
    await waitFor(() => expect(screen.getByText("Aluno: Caio")).toBeTruthy());
    const card = screen.getByText("Aluno: Caio").closest(".rounded-2xl") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /Pagamento/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Vai quitar")).toBeTruthy();
    expect(within(dialog).getByText(/Física/)).toBeTruthy();
  });
});

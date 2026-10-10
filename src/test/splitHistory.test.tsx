import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Conta separada (10/10): o Rafael ganhou responsável depois das aulas e o
// histórico antigo ficou à parte. O aviso mostra e junta com um toque.
let splits: unknown[] = [];
const rpc = vi.fn(async (name: string) => {
  if (name === "split_client_histories") return { data: splits, error: null };
  if (name === "merge_client_history") { splits = []; return { data: { lessons: 4 }, error: null }; }
  return { data: null, error: null };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...(a as [string])) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useVocabulary", async () => {
  const { buildVocabulary } = await import("@/lib/vocabulary");
  const v = buildVocabulary("aulas");
  return { useWords: () => v };
});

import SplitHistoryNotice from "@/components/SplitHistoryNotice";

describe("Histórico separado do cadastro", () => {
  beforeEach(() => rpc.mockClear());

  it("sem nada separado, não mostra nada", async () => {
    splits = [];
    const { container } = render(<SplitHistoryNotice />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("split_client_histories"));
    expect(container.textContent).toBe("");
  });

  it("mostra o Rafael separado da Thaciana e junta ao tocar", async () => {
    splits = [{ student_id: "s1", student_name: "Rafael", guardian_name: "Thaciana", from_guardian: null, lessons: 4, transactions: 8, balance: -150 }];
    const onMerged = vi.fn();
    render(<SplitHistoryNotice onMerged={onMerged} />);
    expect(await screen.findByText("O histórico de Rafael ficou separado")).toBeTruthy();
    expect(screen.getByText(/4 aulas e 8 lançamentos na conta de Rafael \(sem responsável\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Juntar na conta de Thaciana" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("merge_client_history", { _student_id: "s1", _from_guardian: null }));
    await waitFor(() => expect(onMerged).toHaveBeenCalled());
    expect(screen.queryByText("O histórico de Rafael ficou separado")).toBeNull();
  });
});

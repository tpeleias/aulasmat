import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const ids: Record<string, string> = {};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string) => Promise.resolve({ data: ids[fn] ?? null, error: null }) },
}));

import { useHasPublicPage } from "@/hooks/usePublicPage";

// Só a empresa do endereço público tem página de horários: para as outras, o
// link copiado abriria a agenda errada (Thiago, 02/10).
describe("useHasPublicPage", () => {
  beforeEach(() => { ids.public_account_id = "pub"; });

  it("é verdadeiro na empresa do endereço público", async () => {
    ids.effective_account_id = "pub";
    const { result } = renderHook(() => useHasPublicPage(true));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("é falso em qualquer outra empresa", async () => {
    ids.effective_account_id = "outra";
    const { result } = renderHook(() => useHasPublicPage(true));
    await new Promise(r => setTimeout(r, 10));
    expect(result.current).toBe(false);
  });
});

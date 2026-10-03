import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: [{ name: "João" }, { name: "Ana Paula" }, { name: "joão pedro" }] }) }) },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { useTeacherName } from "@/hooks/useTeacherName";

// "Bom dia, Joao" sem acento (Thiago, 03/10): a tela mostrava o apelido
// técnico gravado na aula, não o nome cadastrado.
describe("useTeacherName", () => {
  it("troca o apelido pelo nome cadastrado, com acento", async () => {
    const { result } = renderHook(() => useTeacherName());
    await waitFor(() => expect(result.current("joao")).toBe("João"));
    expect(result.current("ana-paula")).toBe("Ana Paula");
    expect(result.current("joao-pedro")).toBe("João pedro");
  });
  it("sem o profissional na lista, o apelido com a primeira maiúscula", async () => {
    const { result } = renderHook(() => useTeacherName());
    await waitFor(() => expect(result.current("joao")).toBe("João"));
    expect(result.current("maria")).toBe("Maria");
    expect(result.current(null)).toBe("");
  });
});

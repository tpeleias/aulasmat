import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Pagamento on-line pelo Stripe da empresa (09/10): a tela só aparece para a
// empresa com a função liberada, e a chave vai para a função "pay".
let status: { allowed: boolean; connected: boolean } = { allowed: false, connected: false };
const invoke = vi.fn(async () => ({ data: { ok: true, test: true, name: "Portal de Aulas" }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: status, error: null }),
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import OnlinePaymentsSettings from "@/components/OnlinePaymentsSettings";

describe("Pagamento on-line (Stripe da empresa)", () => {
  beforeEach(() => invoke.mockClear());

  it("não aparece para empresa sem a função liberada", async () => {
    status = { allowed: false, connected: false };
    const { container } = render(<OnlinePaymentsSettings />);
    await new Promise(r => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it("a empresa liberada cola a chave e conecta", async () => {
    status = { allowed: true, connected: false };
    render(<OnlinePaymentsSettings />);
    const input = await screen.findByLabelText("Chave secreta do Stripe");
    fireEvent.change(input, { target: { value: "sk_test_abcdefghijklmnop" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pay", { body: { action: "connect", key: "sk_test_abcdefghijklmnop" } }));
  });

  it("conectado, mostra o estado e não pede a chave", async () => {
    status = { allowed: true, connected: true };
    render(<OnlinePaymentsSettings />);
    expect(await screen.findByText("Stripe conectado")).toBeTruthy();
    expect(screen.queryByLabelText("Chave secreta do Stripe")).toBeNull();
  });
});

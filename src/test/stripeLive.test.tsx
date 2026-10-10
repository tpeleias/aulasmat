import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// "Ligar o modo real" do Stripe do Cronys (10/10), no painel do gestor.
let reply: (b: Record<string, unknown>) => unknown = () => ({});
const invoke = vi.fn(async (_fn: string, o?: { body: Record<string, unknown> }) => ({ data: reply(o?.body ?? {}), error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...(a as [string])) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import StripeLiveCard from "@/components/StripeLiveCard";

describe("Stripe do Cronys: modo real", () => {
  beforeEach(() => invoke.mockClear());

  it("no modo de teste, pede a chave real e manda para a função", async () => {
    let live = false;
    reply = b => b.action === "stripe_status"
      ? { mode: live ? "live" : "test", account: { name: "Cronys", charges_enabled: true, details_submitted: true }, webhook: live ? true : null }
      : (live = true, { ok: true, charges_enabled: true, prices: ["a"], coupons: ["lancamento"], dropped: ["portaldeaulas"] });
    render(<StripeLiveCard />);
    expect(await screen.findByText(/^Modo de teste: cartões/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Ligar o modo real" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Chave secreta real do Stripe"), { target: { value: "sk_live_1234567890abcdefghij" } });
    fireEvent.click(button);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("billing", { body: { action: "go_live", key: "sk_live_1234567890abcdefghij" } }));
    expect(await screen.findByText(/Assinatura de teste solta de: portaldeaulas/)).toBeTruthy();
    expect(await screen.findByText(/^Modo real · Cronys/)).toBeTruthy();
  });
});

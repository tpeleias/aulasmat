import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Cupons pelo painel do gestor (10/10).
const codes = [
  { id: "promo_1", code: "LANCAMENTO", active: true, used: 3, max: null, expires_at: null, first_time: false,
    coupon: { id: "lancamento", name: "Preço de lançamento", percent: 15, amount: null, duration: "forever", months: null, valid: true, used: 3, max: 20 } },
  { id: "promo_2", code: "BLACKFRIDAY", active: false, used: 0, max: null, expires_at: null, first_time: false,
    coupon: { id: "bf", name: "Black Friday", percent: 25, amount: null, duration: "repeating", months: 3, valid: true, used: 0, max: null } },
];
const invoke = vi.fn(async (_f: string, o?: { body: Record<string, unknown> }) =>
  ({ data: o?.body?.action === "coupons_list" ? { ok: true, codes } : { ok: true }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...(a as [string, { body: Record<string, unknown> }])) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import CouponsCard, { describeCoupon } from "@/components/CouponsCard";

describe("Cupons no painel do gestor", () => {
  beforeEach(() => invoke.mockClear());

  it("lista os códigos com o desconto e o uso, e liga/desliga", async () => {
    render(<CouponsCard />);
    expect(await screen.findByText("LANCAMENTO")).toBeTruthy();
    expect(screen.getByText(/15% para sempre · usado 3 \(desconto: 3 de 20\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Ligar BLACKFRIDAY" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("billing", { body: { action: "code_active", id: "promo_2", active: true } }));
  });

  it("cria um código novo", async () => {
    render(<CouponsCard />);
    await screen.findByText("LANCAMENTO");
    fireEvent.click(screen.getByRole("button", { name: /Novo/ }));
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "professor10" } });
    fireEvent.change(screen.getByLabelText("Desconto"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar código" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("billing", { body: expect.objectContaining({ action: "coupon_create", code: "PROFESSOR10", value: "10", kind: "percent", duration: "repeating", months: "2" }) }));
  });

  it("descreve o desconto", () => {
    expect(describeCoupon({ id: "x", name: null, percent: null, amount: 10, duration: "once", months: null, valid: true, used: 0, max: null })).toBe("R$ 10,00 no 1º pagamento");
  });
});

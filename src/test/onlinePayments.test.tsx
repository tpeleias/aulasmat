import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Pagamento on-line pelo Stripe ou Asaas da empresa (09/10): a tela só aparece
// para a empresa com a função liberada, o interruptor escolhe entre o padrão e
// o on-line, e a chave vai para a função "pay".
type Status = { allowed: boolean; connected: boolean; provider: "stripe" | "asaas" | null; stripe: boolean; asaas: boolean; installments?: number };
let status: Status = { allowed: false, connected: false, provider: null, stripe: false, asaas: false };
let payReply: (body: Record<string, unknown>) => unknown = () => ({ ok: true, test: true, name: "Portal de Aulas" });
const rpc = vi.fn(async (name: string) => (name === "online_payments_status" ? { data: status, error: null } : { data: null, error: null }));
const invoke = vi.fn(async (_fn: string, o?: { body: Record<string, unknown> }) => ({ data: payReply(o?.body ?? {}), error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...(a as [string])),
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [string, { body: Record<string, unknown> }])) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import OnlinePaymentsSettings from "@/components/OnlinePaymentsSettings";
import PayLink from "@/pages/PayLink";
import { financeHidden } from "@/hooks/useStudent";

const none: Status = { allowed: true, connected: false, provider: null, stripe: false, asaas: false };

describe("Pagamento on-line (Stripe ou Asaas da empresa)", () => {
  beforeEach(() => { invoke.mockClear(); rpc.mockClear(); });

  it("não aparece para empresa sem a função liberada", async () => {
    status = { ...none, allowed: false };
    const { container } = render(<OnlinePaymentsSettings />);
    await new Promise(r => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it("desligado fica no padrão; ligando, cola a chave do Stripe e conecta", async () => {
    status = none;
    render(<OnlinePaymentsSettings />);
    expect(await screen.findByText(/usam o padrão da empresa/)).toBeTruthy();
    expect(screen.queryByLabelText("Chave secreta do Stripe")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Usar pagamento on-line" }));
    const input = await screen.findByLabelText("Chave secreta do Stripe");
    fireEvent.change(input, { target: { value: "sk_test_abcdefghijklmnop" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pay", { body: { action: "connect", provider: "stripe", key: "sk_test_abcdefghijklmnop" } }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_online_provider", { _provider: "stripe" }));
  });

  it("escolhendo o Asaas, pede a chave do Asaas", async () => {
    status = none;
    render(<OnlinePaymentsSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "Usar pagamento on-line" }));
    fireEvent.click(screen.getByRole("radio", { name: /Asaas/ }));
    const input = await screen.findByLabelText("Chave de API do Asaas");
    fireEvent.change(input, { target: { value: "$aact_hmlg_000abcdefghijklmnopqrstuvwxyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pay", { body: { action: "connect", provider: "asaas", key: "$aact_hmlg_000abcdefghijklmnopqrstuvwxyz" } }));
  });

  it("Stripe em uso: mostra conectado e, desligando, volta ao padrão", async () => {
    status = { ...none, connected: true, provider: "stripe", stripe: true };
    render(<OnlinePaymentsSettings />);
    expect(await screen.findByText("Stripe conectado")).toBeTruthy();
    expect(screen.queryByLabelText("Chave secreta do Stripe")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Usar pagamento on-line" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_online_provider", { _provider: null }));
  });
});

describe("Parcelamento no Asaas (até 12x)", () => {
  beforeEach(() => rpc.mockClear());
  it("Asaas em uso: escolhe até quantas vezes parcelar no cartão", async () => {
    status = { ...none, connected: true, provider: "asaas", asaas: true, installments: 12 };
    render(<OnlinePaymentsSettings />);
    const sel = await screen.findByLabelText("Parcelar no cartão em até") as HTMLSelectElement;
    expect(sel.value).toBe("12");
    fireEvent.change(sel, { target: { value: "6" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_online_installments", { _n: 6 }));
  });
  it("no Stripe não aparece o parcelamento", async () => {
    status = { ...none, connected: true, provider: "stripe", stripe: true };
    render(<OnlinePaymentsSettings />);
    expect(await screen.findByText("Stripe conectado")).toBeTruthy();
    expect(screen.queryByLabelText("Parcelar no cartão em até")).toBeNull();
  });
});

describe("Link curto /pagar/<código>", () => {
  beforeEach(() => invoke.mockClear());
  const at = (path: string) => render(
    <MemoryRouter initialEntries={[path]}><Routes><Route path="/pagar/:code" element={<PayLink />} /></Routes></MemoryRouter>,
  );

  it("mostra a empresa e o valor, e só abre o pagamento ao tocar", async () => {
    payReply = b => (b.action === "info" ? { ok: true, company: "Portal de Aulas", name: "Ana", owed: 220, items: 2, available: true } : { ok: false, error: "failed" });
    at("/pagar/abcd2345");
    expect(await screen.findByText("Portal de Aulas")).toBeTruthy();
    expect(screen.getByText(/220,00/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/em até/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Pagar com cartão ou Pix/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pay", { body: { action: "open", code: "abcd2345" } }));
  });

  it("no Asaas parcelado, avisa que dá para parcelar", async () => {
    payReply = () => ({ ok: true, company: "Portal de Aulas", name: "Ana", owed: 600, items: 3, available: true, installments: 12 });
    at("/pagar/abcd2345");
    expect(await screen.findByText("No cartão, em até 12x.")).toBeTruthy();
  });

  it("sem nada em aberto, diz que está tudo em dia", async () => {
    payReply = () => ({ ok: true, company: "Portal de Aulas", name: "Ana", owed: 0, items: 0, available: true });
    at("/pagar/abcd2345");
    expect(await screen.findByText("Tudo em dia")).toBeTruthy();
  });

  it("código que não existe", async () => {
    payReply = () => ({ ok: false, error: "invalid" });
    at("/pagar/zzzzzzzz");
    expect(await screen.findByText("Link inválido")).toBeTruthy();
  });
});

describe("Financeiro escondido do cliente", () => {
  it("só esconde quando a empresa desligou", () => {
    expect(financeHidden(null)).toBe(false);
    expect(financeHidden({ show_finance_to_clients: true })).toBe(false);
    expect(financeHidden({})).toBe(false);
    expect(financeHidden({ show_finance_to_clients: false })).toBe(true);
  });
});

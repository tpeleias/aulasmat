import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildVocabulary } from "@/lib/vocabulary";

// Configuração guiada do primeiro acesso (Thiago, 28/09).
const settingsRow = { id: 1, work_start: "08:00:00", work_end: "22:00:00", slot_minutes: 60, buffer_minutes: 0, default_lesson_price: 220,
  pix_key: null, pix_receiver_name: null, pix_city: null, payment_link: null };
const rpc = vi.fn(async (_n: string, _a?: unknown) => ({ data: { business_model: "beleza", setup_done: true }, error: null }));
const updates: unknown[] = [];
const inserts: unknown[] = [];
const chain = (table: string): unknown => {
  const c: Record<string, unknown> = {};
  const self = () => c;
  Object.assign(c, {
    select: self, order: self, eq: self,
    maybeSingle: async () => ({ data: table === "settings" ? settingsRow : null, error: null }),
    single: async () => ({ data: { id: "s1", name: "Corte", duration_minutes: 45, price: 60 }, error: null }),
    update: (p: unknown) => { updates.push(p); return { eq: async () => ({ error: null }) }; },
    insert: (p: unknown) => { inserts.push({ table, p }); return Object.assign(Promise.resolve({ error: null }), { select: () => ({ single: c.single }) }); },
    then: (ok: (v: unknown) => void) => ok({ data: [], error: null }),
  });
  return c;
};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => chain(t), rpc: (n: string, a?: unknown) => rpc(n, a) } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
const apply = vi.fn();
vi.mock("@/hooks/useVocabulary", () => ({ useVocabulary: () => ({ model: "beleza", apply, v: buildVocabulary("beleza", null, "pt-BR") }) }));

import SetupWizard from "@/components/SetupWizard";

describe("configuração guiada", () => {
  beforeEach(() => { updates.length = 0; inserts.length = 0; rpc.mockClear(); apply.mockClear(); });

  it("serviços: só segue com pelo menos um; o valor por hora padrão acompanha o primeiro", async () => {
    localStorage.setItem("cronys.setup.step", "3");
    render(<SetupWizard />);
    const seguir = await screen.findByRole("button", { name: /Continuar/ });
    expect(seguir).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nome do serviço"), { target: { value: "Corte" } });
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar serviço/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Continuar/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    await waitFor(() => expect(updates).toContainEqual({ default_lesson_price: 80 }));
    expect(await screen.findByText("Como você recebe")).toBeInTheDocument();
  });

  it("pagamento e primeiro cliente dá para pular; no fim marca a configuração como feita", async () => {
    localStorage.setItem("cronys.setup.step", "4");
    render(<SetupWizard />);
    fireEvent.click(await screen.findByRole("button", { name: "Pular" }));
    expect(await screen.findByText("Seu primeiro cliente")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pular" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("complete_account_setup", undefined));
    expect(apply).toHaveBeenCalled();
    expect(localStorage.getItem("cronys.setup.step")).toBeNull();
  });

  it("agenda: o fim tem de ser depois do começo", async () => {
    localStorage.setItem("cronys.setup.step", "2");
    render(<SetupWizard />);
    expect(await screen.findByText("Sua agenda")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Continuar/ }));
    await waitFor(() => expect(updates).toContainEqual({ work_start: "08:00", work_end: "22:00", slot_minutes: 60, buffer_minutes: 0 }));
  });
});

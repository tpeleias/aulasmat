import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Conta de teste do Hive: sem trocar senha nem excluir (Thiago, 28/09).
let user: Record<string, unknown> = {};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { updateUser: vi.fn() }, functions: { invoke: vi.fn() } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user, role: "admin", signOut: vi.fn() }) }));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));

import AccountPanel from "@/components/AccountPanel";

describe("conta de teste", () => {
  it("no lugar da troca de senha, o aviso; excluir fica desligado", () => {
    user = { email: "hiveapp@aluno.sistema.local", app_metadata: { demo_account: true }, user_metadata: {} };
    render(<MemoryRouter><AccountPanel /></MemoryRouter>);
    expect(screen.queryByPlaceholderText(/Nova senha/)).toBeNull();
    expect(screen.getAllByText(/Conta de teste: não é permitido mudar a senha/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Excluir minha conta/ })).toBeDisabled();
  });

  it("conta comum troca a senha normalmente", () => {
    user = { email: "ana@x.com", app_metadata: { provider: "email" }, user_metadata: {} };
    render(<MemoryRouter><AccountPanel /></MemoryRouter>);
    expect(screen.getByPlaceholderText(/Nova senha/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excluir minha conta/ })).toBeEnabled();
  });
});

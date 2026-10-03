import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Aviso de primeira entrada (03/10): "Quer receber os avisos por e-mail?".

let info: unknown = null;
let login = "bia@aluno.sistema.local";
const calls: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (fn: string) => { calls.push(fn); return { data: info, error: null }; } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", email: login } }) }));

import { NotificationEmailCard } from "@/components/NotificationEmailCard";

const client = { kind: "client", emails_on: true, email: null, guardian_name: null, guardian_email: null };
const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { localStorage.clear(); calls.length = 0; login = "bia@aluno.sistema.local"; });

describe("aviso de primeira entrada", () => {
  it("aparece para quem entra com usuário, sem e-mail, com a empresa mandando e-mails", async () => {
    info = client;
    render(<NotificationEmailCard prompt />);
    await waitFor(() => screen.getByText("Quer receber os avisos por e-mail?"));
  });

  it("'Agora não' some e não volta para o mesmo login", async () => {
    info = client;
    const { unmount } = render(<NotificationEmailCard prompt />);
    await waitFor(() => screen.getByText("Agora não"));
    fireEvent.click(screen.getByText("Agora não"));
    expect(screen.queryByText("Quer receber os avisos por e-mail?")).toBeNull();
    unmount();
    render(<NotificationEmailCard prompt />);
    await tick(); await tick();
    expect(screen.queryByText("Quer receber os avisos por e-mail?")).toBeNull();
  });

  it("não aparece se a empresa não liga os e-mails, se já tem e-mail ou se o login é um e-mail", async () => {
    for (const [i, l] of [[{ ...client, emails_on: false }, "bia@aluno.sistema.local"], [{ ...client, email: "b@x.com" }, "bia@aluno.sistema.local"], [client, "bia@gmail.com"]] as const) {
      info = i; login = l;
      const { container, unmount } = render(<NotificationEmailCard prompt />);
      await tick(); await tick();
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});

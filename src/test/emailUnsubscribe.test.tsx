import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Descadastro (03/10): abrir o link só pergunta; sair e voltar são botões.

const actions: string[] = [];
let out = false;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async (_n: string, o: { body: { action: string } }) => {
    actions.push(o.body.action);
    if (o.body.action === "unsubscribe") out = true;
    if (o.body.action === "resubscribe") out = false;
    return { data: { ok: true, account: "Portal de Aulas", email: "t@x.com", out }, error: null };
  } } },
}));

import EmailUnsubscribe from "@/pages/EmailUnsubscribe";

describe("EmailUnsubscribe", () => {
  it("pergunta antes de tirar da lista e deixa voltar", async () => {
    render(<MemoryRouter initialEntries={["/email/sair?c=a&e=b&t=c"]}><EmailUnsubscribe /></MemoryRouter>);
    await waitFor(() => screen.getByText("Parar de receber os e-mails de Portal de Aulas?"));
    expect(actions).toEqual(["unsubscribe_check"]);
    fireEvent.click(screen.getByRole("button", { name: "Sim, parar de receber" }));
    await waitFor(() => screen.getByText("Você saiu da lista"));
    fireEvent.click(screen.getByRole("button", { name: "Foi sem querer: voltar a receber" }));
    await waitFor(() => screen.getByText("Parar de receber os e-mails de Portal de Aulas?"));
    expect(actions).toEqual(["unsubscribe_check", "unsubscribe", "resubscribe"]);
  });
});

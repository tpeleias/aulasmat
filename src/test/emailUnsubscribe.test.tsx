import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Descadastro (03/10): abrir o link só pergunta; dá para sair de um tipo só,
// de tudo, e voltar.

const calls: { action: string; category?: string }[] = [];
let out = false;
let cats: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async (_n: string, o: { body: { action: string; category?: string } }) => {
    const { action, category } = o.body;
    calls.push({ action, category });
    if (action === "unsubscribe") { if (category) cats = [...cats, category]; else out = true; }
    if (action === "resubscribe") { if (category) cats = cats.filter(c => c !== category); else { out = false; cats = []; } }
    return { data: { ok: true, account: "Portal de Aulas", email: "t@x.com", out, categories: cats }, error: null };
  } } },
}));

import EmailUnsubscribe from "@/pages/EmailUnsubscribe";

const page = () => render(<MemoryRouter initialEntries={["/email/sair?c=a&e=b&t=c"]}><EmailUnsubscribe /></MemoryRouter>);

describe("EmailUnsubscribe", () => {
  it("abrir só pergunta; sair só das cobranças mantém o resto", async () => {
    calls.length = 0; out = false; cats = [];
    page();
    await waitFor(() => screen.getByText("Quais e-mails de Portal de Aulas você quer receber?"));
    expect(calls).toEqual([{ action: "unsubscribe_check", category: undefined }]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Cobranças e recibos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar minha escolha" }));
    await waitFor(() => expect(calls.some(c => c.action === "unsubscribe" && c.category === "financeiro")).toBe(true));
    expect(calls.filter(c => c.action === "unsubscribe")).toHaveLength(1);
  });

  it("parar de receber tudo e voltar", async () => {
    calls.length = 0; out = false; cats = [];
    page();
    await waitFor(() => screen.getByRole("button", { name: "Parar de receber todos" }));
    fireEvent.click(screen.getByRole("button", { name: "Parar de receber todos" }));
    await waitFor(() => screen.getByText("Você saiu da lista"));
    fireEvent.click(screen.getByRole("button", { name: "Foi sem querer: voltar a receber" }));
    await waitFor(() => screen.getByText("Quais e-mails de Portal de Aulas você quer receber?"));
  });
});

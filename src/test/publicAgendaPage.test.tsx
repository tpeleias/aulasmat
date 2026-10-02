import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const calls: unknown[] = [];
let reply: unknown = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: unknown) => { calls.push({ fn, args }); return Promise.resolve({ data: reply, error: null }); } },
}));

import PublicAvailability from "@/pages/PublicAvailability";

const agenda = {
  account: { slug: "kika-sport", name: "Kika Sport", locale: "pt-BR", currency: "BRL", currency_symbol: null },
  settings: { work_start: "00:00", work_end: "23:59", slot_minutes: 60, scarcity: null, buffer_minutes: 0 },
  services: [], per_teacher: false,
  teachers: [{ slug: "kiki", name: "Kiki", subject: "Tênis", scarcity: null, all_services: true, services: [] }],
  lessons: [], blocks: [], recurring: [],
};

const open = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/horarios/:empresa" element={<PublicAvailability />} />
      <Route path="/horarios/:empresa/:teacher" element={<PublicAvailability />} />
      <Route path="/disponibilidade" element={<PublicAvailability />} />
    </Routes>
  </MemoryRouter>,
);

// Cada empresa com a própria página (02/10): antes, sem login, todo link
// abria a empresa do endereço público.
describe("página de horários por empresa", () => {
  beforeEach(() => { calls.length = 0; reply = agenda; });

  it("pede a agenda da empresa do endereço e mostra o nome dela", async () => {
    open("/horarios/kika-sport");
    expect(await screen.findByRole("heading", { level: 1, name: "Kika Sport" })).toBeTruthy();
    expect((calls[0] as { args: { _account: string } }).args._account).toBe("kika-sport");
  });

  it("na página do profissional, o nome e a matéria dele", async () => {
    open("/horarios/kika-sport/kiki");
    expect(await screen.findByRole("heading", { level: 1, name: /Tênis — Kiki/ })).toBeTruthy();
  });

  it("o endereço antigo continua pedindo sem empresa", async () => {
    open("/disponibilidade");
    await waitFor(() => expect(calls.length).toBe(1));
    expect((calls[0] as { args: { _account: null } }).args._account).toBeNull();
  });

  it("código que não existe: página não encontrada, sem mostrar outra empresa", async () => {
    reply = null;
    open("/horarios/nao-existe");
    expect(await screen.findByText("Página não encontrada")).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_VOCABULARY } from "@/lib/vocabulary";

// Configurações salvam sozinhas (Thiago, 27/09): sem botão no fim da tela.
const row = {
  id: 1, work_start: "08:00", work_end: "22:00", slot_minutes: 60, default_lesson_price: 100,
  scarcity: null, pix_key: "", payment_link: "", contact_email: "", show_payment_info_to_students: false,
  allow_student_booking: true, show_availability_to_students: false,
};
const update = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
      update: (payload: unknown) => { update(payload); return { eq: () => Promise.resolve({ error: null }) }; },
    }),
  },
}));
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({ plan: {}, loading: true }) }));
vi.mock("@/hooks/useVocabulary", () => ({ useWords: () => DEFAULT_VOCABULARY, useTasksEnabled: () => true, useVocabulary: () => ({ v: DEFAULT_VOCABULARY, model: "aulas", tasks: true, reload: async () => {} }) }));
vi.mock("@/hooks/useLessonPrice", () => ({ FALLBACK_LESSON_PRICE: 100, primeLessonPrice: () => {} }));
let mobile = false;
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { email: "ana@x.com", user_metadata: {} }, role: "admin", signOut: async () => {} }) }));
vi.mock("@/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light", setTheme: () => {}, toggleTheme: () => {} }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));
vi.mock("@/components/VocabularySettings", () => ({ default: () => null }));
vi.mock("@/components/LanguageSettings", () => ({ default: () => null }));
vi.mock("@/components/PackagesSettings", () => ({ default: () => null }));
vi.mock("@/components/ServicesSettings", () => ({ default: () => null }));
vi.mock("@/components/GoogleCalendarSettings", () => ({ default: () => null }));

import SettingsPage from "@/pages/admin/SettingsPage";

describe("SettingsPage", () => {
  beforeEach(() => { vi.useFakeTimers(); update.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it("grava sozinho depois de uma pausa, sem botão Salvar", async () => {
    render(<MemoryRouter initialEntries={["/admin/configuracoes?secao=agenda"]}><SettingsPage /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
    // Carregar não grava nada.
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(update).not.toHaveBeenCalled();

    const slot = screen.getByDisplayValue("60") as HTMLInputElement;
    fireEvent.focus(slot);
    fireEvent.change(slot, { target: { value: "45" } });
    expect(update).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ slot_minutes: 45 });
  });

  it("no celular, sem seção, mostra a lista das 6 seções", async () => {
    mobile = true;
    render(<MemoryRouter initialEntries={["/admin/configuracoes"]}><SettingsPage /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    for (const nome of ["Minha conta", "Negócio", "Agenda", "Cobrança", "Clientes", "Integrações"]) {
      expect(screen.getByRole("button", { name: new RegExp("^" + nome) })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: /^Cobrança/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Cobrança" })).toBeTruthy();
    expect(screen.getByText("Valor por hora", { exact: false })).toBeTruthy();
    mobile = false;
  });

  it("Minha conta mora nas Configurações: rota e aparência", async () => {
    render(<MemoryRouter initialEntries={["/admin/configuracoes?secao=conta"]}><SettingsPage /></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("App de rota")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Escuro/ })).toBeTruthy();
    expect(screen.getByText("ana@x.com")).toBeTruthy();
  });
});

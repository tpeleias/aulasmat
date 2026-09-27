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
vi.mock("@/hooks/useVocabulary", () => ({ useWords: () => DEFAULT_VOCABULARY }));
vi.mock("@/hooks/useLessonPrice", () => ({ FALLBACK_LESSON_PRICE: 100, primeLessonPrice: () => {} }));
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
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
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
});

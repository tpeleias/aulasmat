import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Cada um conecta só o próprio Google (26/09): o admin tem o botão só no
// cadastro "sou eu"; quem tem login aparece só com a situação; cadastro sem
// login e sem dono pede acesso próprio.

let rows: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: rows, error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({ plan: { google_calendar: true } }) }));

import GoogleCalendarSettings from "@/components/GoogleCalendarSettings";

const base = {
  import_enabled: true, export_enabled: true, status: "ok", last_error: null,
  last_import_at: null, last_export_at: null, google_email: null, connected: false,
  can_manage: false, has_login: false, is_self: false, claimable: false,
};

describe("GoogleCalendarSettings (admin)", () => {
  it("botão só no próprio cadastro; os outros só com a situação", async () => {
    rows = [
      { ...base, teacher_id: "1", teacher_name: "thiago", can_manage: true, is_self: true },
      { ...base, teacher_id: "2", teacher_name: "joão", has_login: true, connected: true, google_email: "joao@gmail.com" },
      { ...base, teacher_id: "3", teacher_name: "bia", claimable: true },
    ];
    render(<GoogleCalendarSettings />);
    await waitFor(() => screen.getByText("Thiago"));
    expect(screen.getAllByRole("button", { name: "Conectar Google" })).toHaveLength(1);
    expect(screen.getByText("Sincronizado")).toBeTruthy();
    expect(screen.getByText(/Quem conecta é João/)).toBeTruthy();
    expect(screen.getByText(/Bia precisa de um acesso próprio/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sou eu" })).toBeNull();
  });

  it("sem cadastro 'sou eu' ainda: oferece marcar, sem Conectar em ninguém", async () => {
    rows = [
      { ...base, teacher_id: "1", teacher_name: "thiago", claimable: true },
      { ...base, teacher_id: "2", teacher_name: "joão", has_login: true },
    ];
    render(<GoogleCalendarSettings />);
    await waitFor(() => screen.getByText("Thiago"));
    expect(screen.getByRole("button", { name: "Sou eu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Conectar Google" })).toBeNull();
  });
});

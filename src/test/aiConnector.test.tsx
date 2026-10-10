import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Conectar IA (11/10): cria o link, mostra uma vez, lista e desliga.
const active = [{ id: "c1", label: "Claude antigo", read_only: true, token_hint: "ab12", created_at: "2026-10-01T12:00:00Z", last_used_at: null, mine: true }];
const rpc = vi.fn(async (fn: string) => {
  if (fn === "ai_connectors_list") return { data: active, error: null };
  if (fn === "ai_connector_create") return { data: { id: "c2", token: "crn_" + "a".repeat(40) }, error: null };
  return { data: true, error: null };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...(a as [string])) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AiConnectorSettings, { connectorUrl } from "@/components/AiConnectorSettings";

describe("Conectar IA", () => {
  beforeEach(() => rpc.mockClear());

  it("o link aponta para a função mcp com a chave", () => {
    expect(connectorUrl("crn_x")).toMatch(/\/functions\/v1\/mcp\/crn_x$/);
  });

  it("cria o link só de leitura e mostra para copiar", async () => {
    render(<AiConnectorSettings />);
    expect(await screen.findByText("Claude antigo")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Só leitura" }));
    fireEvent.click(screen.getByRole("button", { name: /Criar link/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("ai_connector_create", { _label: "Claude", _read_only: true, _platform: false }));
    const box = await screen.findByLabelText("Link de conexão") as HTMLInputElement;
    expect(box.value).toMatch(/\/functions\/v1\/mcp\/crn_a{40}$/);
  });

  it("desliga uma conexão depois de confirmar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AiConnectorSettings />);
    await screen.findByText("Claude antigo");
    fireEvent.click(screen.getByRole("button", { name: "Desligar" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("ai_connector_revoke", { _id: "c1" }));
  });

  it("no gestor, pede a chave da plataforma e não oferece escrita", async () => {
    render(<AiConnectorSettings platform />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("ai_connectors_list", { _platform: true }));
    expect(screen.queryByRole("switch", { name: "Só leitura" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Criar link/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("ai_connector_create", { _label: "Claude - gestor", _read_only: false, _platform: true }));
  });
});

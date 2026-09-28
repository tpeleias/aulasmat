import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Entrar com o Google (Thiago, 27/09).
const setSession = vi.fn(async () => ({ error: null }));
const rpc = vi.fn(async () => ({ data: "acc", error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { setSession: (...a: unknown[]) => setSession(...(a as [])), signInWithOAuth: vi.fn() }, rpc: (...a: unknown[]) => rpc(...(a as [])) },
}));

let auth: Record<string, unknown> = {};
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

import { finishNativeLogin, isExternalLogin, makeNonce, NATIVE_LOGIN_RETURN } from "@/lib/googleLogin";
import Auth from "@/pages/Auth";

describe("volta do Google no app", () => {
  beforeEach(() => setSession.mockClear());

  it("guarda a sessão que veio no endereço", async () => {
    const r = await finishNativeLogin(`${NATIVE_LOGIN_RETURN}#access_token=aaa&refresh_token=rrr&expires_in=3600`);
    expect(r).toEqual({});
    expect(setSession).toHaveBeenCalledWith({ access_token: "aaa", refresh_token: "rrr" });
  });

  it("desistiu ou deu erro: avisa e não guarda nada", async () => {
    const r = await finishNativeLogin(`${NATIVE_LOGIN_RETURN}?error=access_denied&error_description=Cancelado+pela+pessoa`);
    expect(r).toEqual({ error: "Cancelado pela pessoa" });
    expect(setSession).not.toHaveBeenCalled();
  });

  it("outro endereço não é com ele", async () => {
    expect(await finishNativeLogin("https://cronys.com.br/admin")).toBeNull();
  });

  it("nonce: o Google recebe o sha-256 do que vai para o Supabase", async () => {
    const { raw, hashed } = await makeNonce();
    expect(raw).toMatch(/^[0-9a-f]{48}$/);
    const { createHash } = await import("node:crypto");
    expect(hashed).toBe(createHash("sha256").update(raw).digest("hex"));
  });

  it("sabe quem veio de fora", () => {
    expect(isExternalLogin({ app_metadata: { provider: "google" } })).toBe(true);
    expect(isExternalLogin({ app_metadata: { provider: "email" } })).toBe(false);
    expect(isExternalLogin(null)).toBe(false);
  });
});

describe("primeira entrada pelo Google", () => {
  const base = { session: {}, role: null, roleFailed: false, isPlatformAdmin: false, loading: false, signOut: vi.fn() };

  it("pergunta o nome do negócio, com o primeiro nome já preenchido, e cria a empresa", async () => {
    auth = { ...base, user: { email: "carla@gmail.com", app_metadata: { provider: "google" }, user_metadata: { full_name: "Carla Dias" } } };
    const replace = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, replace }, writable: true });
    render(<MemoryRouter><Auth /></MemoryRouter>);
    expect(screen.getByText("Bem-vindo ao Cronys!")).toBeInTheDocument();
    expect(screen.queryByText(/código/i)).toBeNull();
    expect((screen.getByLabelText("Como você quer ser chamado?") as HTMLInputElement).value).toBe("Carla");
    fireEvent.change(screen.getByLabelText("Qual o nome do seu negócio?"), { target: { value: "Studio Carla" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Começar/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
    expect(rpc).toHaveBeenCalledWith("create_my_business", expect.objectContaining({ _school: "Studio Carla", _teacher: "Carla" }));
  });

  it("conta de e-mail sem papel continua na tela de aguardar liberação", () => {
    auth = { ...base, user: { email: "x@y.z", app_metadata: { provider: "email" }, user_metadata: {} } };
    render(<MemoryRouter><Auth /></MemoryRouter>);
    expect(screen.getByText("Conta aguardando liberação")).toBeInTheDocument();
  });
});

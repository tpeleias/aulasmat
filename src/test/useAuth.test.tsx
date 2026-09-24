import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";

// Cada teste diz como o supabase responde (ou não responde).
const never = <T,>() => new Promise<T>(() => {});
let getSession: () => Promise<unknown>;
let rolesQuery: () => Promise<unknown>;
let platformRpc: () => Promise<unknown>;
let authCallback: ((e: string, s: unknown) => void) | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: () => ({ select: () => ({ eq: () => rolesQuery() }) }),
    rpc: () => platformRpc(),
  },
}));

import { AuthProvider, useAuth } from "@/hooks/useAuth";

function Probe() {
  const { loading, role, isPlatformAdmin, session } = useAuth();
  // O que a tela de login decide: carregando, gestor, papel, ou "aguardando".
  const tela = loading ? "carregando" : !session ? "login" : isPlatformAdmin ? "gestor" : role ?? "aguardando";
  return <div data-testid="tela">{tela}</div>;
}

const sessao = (id: string) => ({ user: { id } });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    authCallback = null;
    getSession = async () => ({ data: { session: null } });
    rolesQuery = async () => ({ data: [] });
    platformRpc = async () => ({ data: false });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("gestor que acabou de entrar não passa pela tela de aguardando", async () => {
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush();
    expect(getByTestId("tela").textContent).toBe("login");

    platformRpc = async () => ({ data: true });
    const vistas: string[] = [];
    await act(async () => { authCallback!("SIGNED_IN", sessao("gestor")); });
    vistas.push(getByTestId("tela").textContent!);
    await flush();
    vistas.push(getByTestId("tela").textContent!);
    expect(vistas).not.toContain("aguardando");
    expect(getByTestId("tela").textContent).toBe("gestor");
  });

  it("sessão guardada que nunca carrega não deixa a tela vazia para sempre", async () => {
    getSession = () => never();
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush(100);
    expect(getByTestId("tela").textContent).toBe("carregando");
    await flush(9000);
    expect(getByTestId("tela").textContent).toBe("login");
  });

  it("consulta de papel que nunca volta cai em 'aguardando' (que tem botão de sair)", async () => {
    getSession = async () => ({ data: { session: sessao("u1") } });
    rolesQuery = () => never();
    platformRpc = () => never();
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush(100);
    expect(getByTestId("tela").textContent).toBe("carregando");
    await flush(9000);
    expect(getByTestId("tela").textContent).toBe("aguardando");
  });

  it("erro ao ler a sessão também termina o carregamento", async () => {
    getSession = async () => { throw new Error("armazenamento corrompido"); };
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush(10);
    expect(getByTestId("tela").textContent).toBe("login");
  });

  it("renovar o token da mesma conta não apaga a tela", async () => {
    getSession = async () => ({ data: { session: sessao("u1") } });
    rolesQuery = async () => ({ data: [{ role: "admin" }] });
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush(10);
    expect(getByTestId("tela").textContent).toBe("admin");
    rolesQuery = () => never();
    await act(async () => { authCallback!("TOKEN_REFRESHED", sessao("u1")); });
    await flush(10);
    expect(getByTestId("tela").textContent).toBe("admin");
  });
});

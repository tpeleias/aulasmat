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
  const { loading, role, roleFailed, isPlatformAdmin, session } = useAuth();
  // O que a tela de login decide: carregando, gestor, papel, "não carregou" ou "aguardando".
  const tela = loading ? "carregando" : !session ? "login" : isPlatformAdmin ? "gestor" : role ?? (roleFailed ? "falhou" : "aguardando");
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

  it("consulta de papel que nunca volta tenta de novo e cai em 'não carregou' (não em 'aguardando')", async () => {
    getSession = async () => ({ data: { session: sessao("u1") } });
    let pedidos = 0;
    rolesQuery = () => { pedidos++; return never(); };
    platformRpc = () => never();
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush(100);
    expect(getByTestId("tela").textContent).toBe("carregando");
    await flush(7000);
    expect(getByTestId("tela").textContent).toBe("carregando");
    await flush(7000);
    expect(pedidos).toBe(2);
    expect(getByTestId("tela").textContent).toBe("falhou");
  });

  it("a segunda tentativa que responde entra normalmente", async () => {
    getSession = async () => ({ data: { session: sessao("u1") } });
    let pedidos = 0;
    rolesQuery = () => (++pedidos === 1 ? never() : Promise.resolve({ data: [{ role: "teacher" }] }));
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush(7000);
    await flush(10);
    expect(getByTestId("tela").textContent).toBe("teacher");
  });

  it("erro do banco na consulta do papel não vira 'aguardando'", async () => {
    getSession = async () => ({ data: { session: sessao("u1") } });
    rolesQuery = async () => ({ data: null, error: { message: "falhou" } });
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush(10);
    expect(getByTestId("tela").textContent).toBe("falhou");
  });

  it("sem papel de verdade continua em 'aguardando'", async () => {
    getSession = async () => ({ data: { session: sessao("u1") } });
    rolesQuery = async () => ({ data: [] });
    const { getByTestId } = render(<AuthProvider><Probe /></AuthProvider>);
    await flush(10);
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

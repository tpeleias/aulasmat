import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// O que my_vocabulary() devolve em cada teste.
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => rpcResult) },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false }),
}));

import { VocabularyProvider, useVocabulary } from "@/hooks/useVocabulary";

function Probe() {
  const { v, needsOnboarding, loading } = useVocabulary();
  return <div data-testid="out">{loading ? "carregando" : `${needsOnboarding ? "boas-vindas" : "app"}|${v.appointment.s}`}</div>;
}

const renderProbe = () => render(<VocabularyProvider><Probe /></VocabularyProvider>);

describe("VocabularyProvider", () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* sem armazenamento */ } });

  it("empresa que ainda não escolheu o ramo vai para a tela de boas-vindas", async () => {
    rpcResult = { data: { business_model: null, custom: null, custom_saved: false }, error: null };
    const { getByTestId } = renderProbe();
    await waitFor(() => expect(getByTestId("out").textContent).toBe("boas-vindas|Atendimento"));
  });

  it("empresa com ramo usa as palavras dele", async () => {
    rpcResult = { data: { business_model: "saude", active: true, custom: null, custom_saved: false }, error: null };
    const { getByTestId } = renderProbe();
    await waitFor(() => expect(getByTestId("out").textContent).toBe("app|Consulta"));
  });

  it("no Essencial fala genérico, mesmo com ramo escolhido", async () => {
    rpcResult = { data: { business_model: "saude", active: false, custom: null, custom_saved: true }, error: null };
    const { getByTestId } = renderProbe();
    await waitFor(() => expect(getByTestId("out").textContent).toBe("app|Atendimento"));
  });

  it("sem resposta do banco (ex.: migration ainda não aplicada) não pede o ramo e fala de aula", async () => {
    rpcResult = { data: null, error: { message: "function my_vocabulary() does not exist" } };
    const { getByTestId } = renderProbe();
    await waitFor(() => expect(getByTestId("out").textContent).toBe("app|Aula"));
  });

  it("empresa com ramo mas sem terminar a configuração guiada volta para o guia", async () => {
    rpcResult = { data: { business_model: "saude", active: true, custom: null, custom_saved: false, setup_done: false }, error: null };
    const { getByTestId } = renderProbe();
    await waitFor(() => expect(getByTestId("out").textContent).toBe("boas-vindas|Consulta"));
  });

  it("logado sem empresa não pega a língua da empresa do endereço público", async () => {
    const { getLocale } = await import("@/lib/i18n");
    const antes = getLocale();
    rpcResult = { data: { business_model: "aulas", active: true, custom: null, locale: antes === "en" ? "pt-BR" : "en", currency: "USD", member: false, setup_done: true }, error: null };
    const { getByTestId } = renderProbe();
    await waitFor(() => expect(getByTestId("out").textContent).toMatch(/^app\|/));
    expect(getLocale()).toBe(antes);
  });
});

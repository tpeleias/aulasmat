import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ role: "admin", user: { id: "u1" } }) }));
vi.mock("@/hooks/useVocabulary", async () => {
  const { buildVocabulary } = await import("@/lib/vocabulary");
  return { useWords: () => buildVocabulary("aulas"), useTasksEnabled: () => true };
});

describe("Avisos no celular (05/10)", () => {
  it("no site (fora do app Android) nada aparece: nem convite nem opções", async () => {
    const { default: PushSettings, PushPrompt } = await import("@/components/PushSettings");
    const { container } = render(<><PushPrompt /><PushSettings /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it("fora do app, a permissão é 'unsupported' e ativar não faz nada", async () => {
    const { enablePush, pushPermission, pushSupported } = await import("@/lib/push");
    expect(pushSupported()).toBe(false);
    expect(await pushPermission()).toBe("unsupported");
    expect(await enablePush()).toBe("unsupported");
  });
});

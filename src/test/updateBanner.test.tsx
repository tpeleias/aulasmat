import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Aviso de versão nova na tela inicial (Thiago, 01/10).
let native = true;
let availability = 2;
const performImmediateUpdate = vi.fn(async () => ({}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native } }));
vi.mock("@capawesome/capacitor-app-update", () => ({
  AppUpdateAvailability: { UNKNOWN: 0, UPDATE_NOT_AVAILABLE: 1, UPDATE_AVAILABLE: 2, UPDATE_IN_PROGRESS: 3 },
  AppUpdate: {
    getAppUpdateInfo: async () => ({ updateAvailability: availability, availableVersionCode: "53", currentVersionCode: "52" }),
    performImmediateUpdate: () => performImmediateUpdate(),
    openAppStore: vi.fn(async () => {}),
  },
}));

import UpdateBanner from "@/components/UpdateBanner";

describe("UpdateBanner", () => {
  beforeEach(() => { native = true; availability = 2; localStorage.clear(); performImmediateUpdate.mockClear(); });

  it("com versão nova na Play, mostra o aviso e atualiza pelo botão", async () => {
    render(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(performImmediateUpdate).toHaveBeenCalled());
  });

  it("Depois esconde até sair outra versão", async () => {
    const { unmount } = render(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Depois" }));
    expect(screen.queryByText("Nova versão do Cronys")).toBeNull();
    unmount();
    render(<UpdateBanner />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText("Nova versão do Cronys")).toBeNull();
  });

  it("sem versão nova, ou no site, não aparece nada", async () => {
    availability = 1;
    render(<UpdateBanner />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText("Nova versão do Cronys")).toBeNull();
    native = false; availability = 2;
    render(<UpdateBanner />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText("Nova versão do Cronys")).toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/publicUrl", () => ({ publicSiteUrl: () => "https://cronys.com.br" }));
vi.mock("@/lib/haptics", () => ({ haptics: { success: () => {} } }));
vi.mock("sonner", () => ({ toast: { success: () => {} } }));

import AvailabilityLinksDialog from "@/components/AvailabilityLinksDialog";

// Uma empresa com muitos profissionais: os links ficam numa janela com busca,
// não um botão por pessoa no menu (Thiago, 27/09).
const teachers = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: i === 3 ? "João Silva" : `Prof ${i}`, active: true }));

describe("AvailabilityLinksDialog", () => {
  it("lista todos e filtra pelo nome, sem acento", () => {
    render(<AvailabilityLinksDialog open onOpenChange={() => {}} teachers={teachers} />);
    expect(screen.getAllByRole("button", { name: /Copiar/ })).toHaveLength(8);
    fireEvent.change(screen.getByLabelText("Buscar pelo nome"), { target: { value: "joao" } });
    expect(screen.getAllByRole("button", { name: /Copiar/ })).toHaveLength(1);
    expect(screen.getByText("/disponibilidade/joao-silva")).toBeTruthy();
  });
});

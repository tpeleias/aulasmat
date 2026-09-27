import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) },
}));

import TermsOfUse from "@/pages/TermsOfUse";

// Páginas legais com o botão de língua (Thiago, 27/09): ?lang=en mostra em
// inglês sem mexer na língua do app.
describe("páginas legais", () => {
  it("em português por padrão, com o botão para o inglês", () => {
    render(<MemoryRouter initialEntries={["/termos"]}><TermsOfUse /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Termos de uso" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /English/ }).getAttribute("href")).toBe("/termos?lang=en");
  });

  it("?lang=en mostra em inglês, com o botão de volta", () => {
    render(<MemoryRouter initialEntries={["/termos?lang=en"]}><TermsOfUse /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: /Terms of use/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Português/ }).getAttribute("href")).toBe("/termos?lang=pt");
  });
});

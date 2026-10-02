import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RamoPage from "@/pages/RamoPage";
import { ramoPages, RAMO_SLUGS } from "@/lib/ramoPages";

describe("páginas por ramo", () => {
  it("tem uma página para cada slug listado, com 3 pontos e 3 passos do dia", () => {
    expect(ramoPages().map(r => r.slug)).toEqual([...RAMO_SLUGS]);
    for (const r of ramoPages()) { expect(r.dores).toHaveLength(3); expect(r.dia).toHaveLength(3); }
  });

  it("mostra o título do ramo em /para/psicologos", () => {
    render(
      <MemoryRouter initialEntries={["/para/psicologos"]}>
        <Routes><Route path="/para/:ramo" element={<RamoPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/psicólogos/);
  });
});

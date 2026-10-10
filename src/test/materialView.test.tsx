import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MaterialOpenButton, materialKind } from "@/components/MaterialView";

// Materiais de link e de página escrita (11/10).
describe("Material", () => {
  it("reconhece o tipo; o antigo, sem tipo, é arquivo", () => {
    expect(materialKind({ id: "1", title: "a", created_at: "" })).toBe("file");
    expect(materialKind({ id: "1", title: "a", created_at: "", kind: "link" })).toBe("link");
    expect(materialKind({ id: "1", title: "a", created_at: "", kind: "page" })).toBe("page");
  });

  it("link abre em outra aba", () => {
    render(<MaterialOpenButton m={{ id: "1", title: "Vídeo", created_at: "", kind: "link", url: "https://youtu.be/x" }} />);
    const a = screen.getByRole("link", { name: /Abrir/ }) as HTMLAnchorElement;
    expect(a.href).toBe("https://youtu.be/x");
    expect(a.target).toBe("_blank");
  });

  it("página abre com o texto e a fórmula desenhada", () => {
    const { container } = render(<MaterialOpenButton m={{ id: "1", title: "Lista 1", created_at: "", kind: "page", content: "## Exercícios\n\n1. Resolva $x^2 = 4$" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Ler/ }));
    expect(screen.getByText("Exercícios")).toBeTruthy();
    expect(document.querySelector(".katex")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Salvar em PDF/ })).toBeTruthy();
    expect(container).toBeTruthy();
  });
});

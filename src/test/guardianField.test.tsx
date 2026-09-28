import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { GuardianField } from "@/components/GuardianField";
import { buildVocabulary } from "@/lib/vocabulary";

// Responsável atrás de "Menor de 18 anos" fora de aulas e pet (Thiago, 28/09).
function Campo({ model, inicial = "", onChange = () => {} }: { model: "aulas" | "pet" | "beleza" | "saude"; inicial?: string; onChange?: (v: string) => void }) {
  const [v, setV] = useState(inicial);
  return <GuardianField w={buildVocabulary(model, null, "pt-BR")} value={v} onChange={x => { setV(x); onChange(x); }} />;
}

describe("GuardianField", () => {
  it("aulas e pet: o campo de sempre, sem caixinha", () => {
    render(<Campo model="aulas" />);
    expect(screen.getByLabelText("Responsável")).toBeInTheDocument();
    expect(screen.queryByText("Menor de 18 anos")).toBeNull();
  });

  it("pet: o tutor aparece sempre", () => {
    render(<Campo model="pet" />);
    expect(screen.getByLabelText("Tutor")).toBeInTheDocument();
  });

  it("salão: só a caixinha; marcada abre o campo, desmarcada apaga o nome", () => {
    const onChange = vi.fn();
    render(<Campo model="beleza" onChange={onChange} />);
    expect(screen.queryByLabelText("Responsável")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Menor de 18 anos" }));
    fireEvent.change(screen.getByLabelText("Responsável"), { target: { value: "Rosa" } });
    expect(onChange).toHaveBeenLastCalledWith("Rosa");
    fireEvent.click(screen.getByRole("checkbox", { name: "Menor de 18 anos" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(screen.queryByLabelText("Responsável")).toBeNull();
  });

  it("clínica com responsável já salvo: abre marcado", () => {
    render(<Campo model="saude" inicial="Rosa" />);
    expect(screen.getByRole("checkbox", { name: "Menor de 18 anos" })).toBeChecked();
    expect((screen.getByLabelText("Responsável") as HTMLInputElement).value).toBe("Rosa");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { WheelSelect } from "@/components/WheelSelect";

// Caixas de seleção viram rodinha numa gaveta no celular (Thiago, 27/09); no
// computador continua a lista de sempre.
let mobile = true;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));

const opcoes = [
  { value: "agendada", label: "Agendada" },
  { value: "realizada", label: "Realizada" },
  { value: "cancelada", label: "Cancelada" },
];

describe("WheelSelect", () => {
  it("no celular abre a gaveta com a rodinha e troca o valor", () => {
    mobile = true;
    const onChange = vi.fn();
    render(<WheelSelect value="agendada" onValueChange={onChange} options={opcoes} label="Situação" />);
    const botao = screen.getByRole("button", { name: "Situação" });
    expect(botao).toHaveTextContent("Agendada");
    fireEvent.click(botao);
    const roda = screen.getByRole("listbox", { name: "Situação" });
    expect(within(roda).getByRole("option", { name: "Agendada" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(roda).getByRole("option", { name: "Cancelada" }));
    expect(onChange).toHaveBeenLastCalledWith("cancelada");
  });

  it("vazio: mostra o convite e, ao confirmar sem rolar, fica com a primeira", () => {
    mobile = true;
    const onChange = vi.fn();
    render(<WheelSelect value="" onValueChange={onChange} options={opcoes} label="Situação" placeholder="Escolha" />);
    fireEvent.click(screen.getByRole("button", { name: "Situação" }));
    expect(screen.getAllByRole("option").every(o => o.getAttribute("aria-selected") === "false")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Pronto" }));
    expect(onChange).toHaveBeenCalledWith("agendada");
  });

  it("opção desativada não entra na rodinha", () => {
    mobile = true;
    render(<WheelSelect value="agendada" onValueChange={() => {}} label="Situação"
      options={[...opcoes, { value: "x", label: "Travada", disabled: true }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Situação" }));
    expect(screen.queryByRole("option", { name: "Travada" })).toBeNull();
  });

  it("no computador é a caixa de seleção comum", () => {
    mobile = false;
    render(<WheelSelect value="realizada" onValueChange={() => {}} options={opcoes} label="Situação" />);
    expect(screen.getByRole("combobox", { name: "Situação" })).toHaveTextContent("Realizada");
  });
});

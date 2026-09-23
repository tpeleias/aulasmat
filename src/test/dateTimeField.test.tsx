import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateTimeField } from "@/components/DateTimeField";

describe("DateTimeField", () => {
  it("mostra dia e horário de uma aula existente (antes ficava em branco na edição)", () => {
    const { container } = render(<DateTimeField value="2026-09-24T15:30" onChange={() => {}} />);
    expect((container.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-09-24");
    expect(screen.getByText("15h")).toBeInTheDocument();
    expect(screen.getByText(":30")).toBeInTheDocument();
    expect(screen.getByText(/quinta-feira, 24 de setembro às 15:30/i)).toBeInTheDocument();
  });

  it("trocar o dia mantém a hora e avisa no formato de antes", () => {
    const onChange = vi.fn();
    const { container } = render(<DateTimeField value="2026-09-24T15:30" onChange={onChange} />);
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2026-09-25" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-25T15:30");
  });

  it("aula num minuto fora da lista (16:42) não é arredondada em silêncio", () => {
    render(<DateTimeField value="2026-09-24T16:42" onChange={() => {}} />);
    expect(screen.getByText(":42")).toBeInTheDocument();
  });

  it("minutos vão de 5 em 5", async () => {
    const { MINUTE_OPTIONS } = await import("@/components/DateTimeField");
    expect(MINUTE_OPTIONS).toEqual(["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  });

  it("sem valor, não avisa nada até ter dia, hora e minuto", () => {
    const onChange = vi.fn();
    const { container } = render(<DateTimeField value="" onChange={onChange} />);
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2026-09-25" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { NumberField } from "@/components/NumberField";

// Antes, apagar o "1" do Nº de aulas voltava a "1" na hora: só dava para
// digitar "14", nunca "4" (Thiago, 27/09).
function Harness({ onValue }: { onValue: (n: number) => void }) {
  const [n, setN] = useState(1);
  return <NumberField aria-label="n" min={1} fallback={1} value={n} onValueChange={x => { setN(x); onValue(x); }} />;
}

describe("NumberField", () => {
  it("deixa apagar o valor e digitar outro", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText("n") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "4" } });
    expect(input.value).toBe("4");
    expect(onValue).toHaveBeenLastCalledWith(4);
  });

  it("vazio ao sair vira o fallback", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText("n") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("1");
    expect(onValue).toHaveBeenLastCalledWith(1);
  });
});

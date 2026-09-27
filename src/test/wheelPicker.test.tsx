import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WheelPicker } from "@/components/WheelPicker";

// A rodinha de duração (Thiago, 27/09): começa no valor dado e anda de um em um.
describe("WheelPicker", () => {
  it("marca o valor atual e anda com as setas e com o toque", () => {
    const onChange = vi.fn();
    render(<WheelPicker label="Duração" options={[30, 45, 60, 90]} value={60} onChange={onChange} format={m => `${m} min`} />);
    expect(screen.getByRole("option", { name: "60 min" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Duração" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(90);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Duração" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(45);
    fireEvent.click(screen.getByRole("option", { name: "30 min" }));
    expect(onChange).toHaveBeenLastCalledWith(30);
  });
});

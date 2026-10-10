import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// Menu no toque (10/10): encostar o dedo (para rolar a tela) não abre; só o
// toque completo, que o navegador transforma em clique.
const Menu = () => (
  <DropdownMenu>
    <DropdownMenuTrigger>Cobrar</DropdownMenuTrigger>
    <DropdownMenuContent><DropdownMenuItem>Copiar mensagem</DropdownMenuItem></DropdownMenuContent>
  </DropdownMenu>
);
const pointer = (type: string, el: Element, name: "pointerDown" | "pointerUp") => {
  const ev = new MouseEvent(name.toLowerCase(), { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(ev, "pointerType", { value: type });
  fireEvent(el, ev);
};

describe("Menu no toque", () => {
  it("dedo encostando (rolagem) não abre; o toque completo abre", () => {
    render(<Menu />);
    const trigger = screen.getByText("Cobrar");
    pointer("touch", trigger, "pointerDown");
    expect(screen.queryByText("Copiar mensagem")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByText("Copiar mensagem")).toBeTruthy();
  });

  it("no mouse, abre ao apertar, como antes", () => {
    render(<Menu />);
    pointer("mouse", screen.getByText("Cobrar"), "pointerDown");
    expect(screen.getByText("Copiar mensagem")).toBeTruthy();
  });
});

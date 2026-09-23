import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useTapGuard } from "@/lib/tapGuard";

function Botao({ onTap, delayMs }: { onTap: () => void; delayMs: number }) {
  const guard = useTapGuard({ delayMs });
  return <button {...guard(onTap)}>aula</button>;
}

describe("useTapGuard com atraso", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-23T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("abre depois do atraso, não na hora", () => {
    const onTap = vi.fn();
    const { getByText } = render(<Botao onTap={onTap} delayMs={160} />);
    fireEvent.click(getByText("aula"));
    expect(onTap).not.toHaveBeenCalled();
    vi.advanceTimersByTime(170);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("rolar a tela durante o atraso cancela", () => {
    const onTap = vi.fn();
    const { getByText } = render(<Botao onTap={onTap} delayMs={160} />);
    fireEvent.click(getByText("aula"));
    fireEvent.scroll(window);
    vi.advanceTimersByTime(500);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("sem atraso (site), abre na hora como antes", () => {
    const onTap = vi.fn();
    const { getByText } = render(<Botao onTap={onTap} delayMs={0} />);
    fireEvent.click(getByText("aula"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

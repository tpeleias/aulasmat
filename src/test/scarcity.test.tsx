import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { scarcityFor, visibleStarts, SCARCITY_DEFAULT } from "@/lib/availability";
import { ScarcityEditor } from "@/components/ScarcityEditor";

// Escassez que dá para desligar e explicada na tela (Thiago, 02/10).
const monday = new Date(2030, 0, 7);
const starts = Array.from({ length: 8 }, (_, i) => { const d = new Date(monday); d.setHours(8 + i, 0, 0, 0); return d; });

describe("scarcityFor e visibleStarts", () => {
  it("sem nada gravado, o padrão (segunda: 1 a 3)", () => {
    expect(scarcityFor(monday, null)).toEqual(SCARCITY_DEFAULT["1"]);
  });
  it("empresa em 'todos': nulo, e aparecem os 8 horários", () => {
    const s = scarcityFor(monday, { off: true });
    expect(s).toBeNull();
    expect(visibleStarts(monday, starts, "x", s)).toHaveLength(8);
  });
  it("profissional com números próprios ganha da empresa em 'todos'", () => {
    expect(scarcityFor(monday, { off: true }, { "1": { min: 2, max: 2 } })).toEqual({ min: 2, max: 2 });
  });
  it("profissional em 'todos' ganha da empresa com escassez", () => {
    expect(scarcityFor(monday, { "1": { min: 1, max: 1 } }, { off: true })).toBeNull();
  });
  it("profissional sem escolha segue a empresa", () => {
    expect(scarcityFor(monday, { "1": { min: 4, max: 5 } }, null)).toEqual({ min: 4, max: 5 });
  });
  it("com escassez, mostra entre o mínimo e o máximo, sempre os mesmos no dia", () => {
    const a = visibleStarts(monday, starts, "x", { min: 2, max: 3 });
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(visibleStarts(monday, starts, "x", { min: 2, max: 3 })).toEqual(a);
  });
});

describe("ScarcityEditor", () => {
  it("na empresa, escolher 'Todos os horários livres' grava off e guarda os números", () => {
    const onChange = vi.fn();
    render(<ScarcityEditor value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Todos os horários livres/));
    const next = onChange.mock.calls[0][0];
    expect(next.off).toBe(true);
    expect(next["1"]).toEqual(SCARCITY_DEFAULT["1"]);
  });

  it("no profissional, 'Igual à empresa' grava nulo e diz o que a empresa mostra", () => {
    const onChange = vi.fn();
    render(<ScarcityEditor value={{ off: true }} inheritFrom={{ off: true }} onChange={onChange} />);
    expect(screen.getByText(/Hoje a empresa mostra todos os horários livres/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Igual à empresa/));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("a grade só aparece em 'Só alguns por dia', e o máximo acompanha o mínimo", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ScarcityEditor value={{ off: true }} onChange={onChange} />);
    expect(screen.queryByLabelText("Segunda: mínimo")).toBeNull();
    rerender(<ScarcityEditor value={{ "1": { min: 1, max: 3 } }} onChange={onChange} />);
    const min = screen.getByLabelText("Segunda: mínimo");
    fireEvent.focus(min);
    fireEvent.change(min, { target: { value: "5" } });
    const last = onChange.mock.calls.at(-1)![0];
    expect(last["1"]).toEqual({ min: 5, max: 5 });
  });

  it("explica como funciona", () => {
    render(<ScarcityEditor value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByText("Como funciona"));
    expect(screen.getByText(/A sua agenda mostra sempre tudo/)).toBeTruthy();
  });
});

describe("escassez com 0 (03/10)", () => {
  it("máximo 0: o dia não mostra horário", () => {
    expect(visibleStarts(monday, starts, "x", { min: 0, max: 0 })).toEqual([]);
  });
  it("mínimo 0 e máximo 2: de 0 a 2", () => {
    const n = visibleStarts(monday, starts, "x", { min: 0, max: 2 }).length;
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(2);
  });
  it("o editor aceita 0 no mínimo", () => {
    const onChange = vi.fn();
    render(<ScarcityEditor value={{ "1": { min: 1, max: 3 } }} onChange={onChange} />);
    const min = screen.getByLabelText("Segunda: mínimo");
    fireEvent.focus(min);
    fireEvent.change(min, { target: { value: "0" } });
    expect(onChange.mock.calls.at(-1)![0]["1"]).toEqual({ min: 0, max: 3 });
  });
});

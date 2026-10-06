import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CalendarMonth, monthGrid } from "@/components/CalendarMonth";

let mobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile }));
vi.mock("@/lib/haptics", () => ({ haptics: { tap: () => {} } }));
vi.mock("@/hooks/useVocabulary", async () => {
  const { buildVocabulary } = await import("@/lib/vocabulary");
  return { useWords: () => buildVocabulary("aulas") };
});

const oct = new Date(2026, 9, 1);
const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();
const base = { subject: "Matemática", duration_minutes: 60, teacher: "thiago", is_online: false, address: null };
const lessons = [
  { ...base, id: "1", student_name: "Bia", start_at: at(6, 8) },
  { ...base, id: "2", student_name: "Caio", start_at: at(6, 10) },
  { ...base, id: "3", student_name: "Duda", start_at: at(6, 14) },
  { ...base, id: "4", student_name: "Enzo", start_at: at(6, 16) },
  { ...base, id: "5", student_name: "Fê", start_at: at(7, 9), status: "cancelada" },
];
const props = { month: oct, lessons, teacherSlugs: ["thiago"], chosenColors: {}, onOpenLesson: vi.fn(), onOpenDay: vi.fn(), onNewOnDay: vi.fn() };

describe("Visão do mês (06/10)", () => {
  it("a grade começa no domingo e fecha semanas inteiras", () => {
    const g = monthGrid(oct);
    expect(g[0].getDay()).toBe(0);
    expect(g.length % 7).toBe(0);
    expect(g.some(d => d.getDate() === 31 && d.getMonth() === 9)).toBe(true);
  });

  it("no computador: até 3 aulas por dia com hora e nome, e '+1 mais'; cancelada não entra", () => {
    mobile = false;
    render(<CalendarMonth {...props} />);
    expect(screen.getByText("Bia")).toBeInTheDocument();
    expect(screen.queryByText("Enzo")).toBeNull();
    expect(screen.getByText("+1 mais")).toBeInTheDocument();
    expect(screen.queryByText("Fê")).toBeNull();
    expect(screen.getByText(/4 aulas no mês/)).toBeInTheDocument();
  });

  it("no celular: tocar no dia mostra a lista dele embaixo", () => {
    mobile = true;
    const onOpenLesson = vi.fn();
    render(<CalendarMonth {...props} onOpenLesson={onOpenLesson} />);
    fireEvent.click(screen.getByRole("button", { name: /6 de outubro: 4 aulas/ }));
    const lista = screen.getByRole("list");
    expect(within(lista).getAllByRole("button")).toHaveLength(4);
    fireEvent.click(within(lista).getByText("Enzo"));
    expect(onOpenLesson).toHaveBeenCalledWith(expect.objectContaining({ id: "4" }));
  });
});

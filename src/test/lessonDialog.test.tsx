import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DEFAULT_VOCABULARY } from "@/lib/vocabulary";

// O diálogo de aula chegou a abrir vazio para o admin (26/09): o bloco "Como
// foi?" do professor, que só aparece para ele, tinha ficado em volta do
// formulário inteiro. Sem os campos, o Salvar dizia "o nome não pode estar em
// branco" sem ter onde escrever o nome.

// Qualquer consulta ao banco devolve lista vazia.
const vazio = { data: [], error: null };
const chain: unknown = new Proxy(() => {}, {
  get: (_t, prop) => (prop === "then" ? (ok: (v: unknown) => void) => ok(vazio) : chain),
  apply: () => chain,
});

let isTeacher = false;
let services: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => chain, rpc: () => chain } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isTeacher }) }));
vi.mock("@/hooks/useTeachers", () => ({
  useTeachers: () => ({ teachers: [{ id: "t1", name: "Thiago", active: true, subject: "Matemática" }] }),
  teacherSlug: (n: string) => n.toLowerCase(),
}));
vi.mock("@/hooks/useVocabulary", () => ({ useWords: () => DEFAULT_VOCABULARY }));
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({ plan: {} }) }));
vi.mock("@/hooks/useMessageTemplates", () => ({ useMessageTemplates: () => ({ templates: {} }) }));
vi.mock("@/hooks/useServices", () => ({
  useServices: () => ({ services, links: [] }),
  teacherDoes: () => true,
  hourlyPrice: () => null,
}));
vi.mock("@/hooks/useLessonPrice", () => ({ useLessonPrice: () => ({ price: 100 }), FALLBACK_LESSON_PRICE: 100 }));

import { LessonDialog } from "@/components/LessonDialog";

describe("LessonDialog", () => {
  it("nova aula pelo admin mostra o formulário", () => {
    isTeacher = false;
    render(
      <LessonDialog open onOpenChange={() => {}} slotStart={new Date(2026, 9, 1, 14)} lesson={null} onSaved={() => {}} defaultTeacher="thiago" />,
    );
    const nome = document.querySelector('input[list="students-list"]');
    expect(nome).not.toBeNull();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeTruthy();
  });

  it("repetição: escolhe os dias da semana, começando pelo dia do início", () => {
    isTeacher = false;
    render(
      <LessonDialog open onOpenChange={() => {}} slotStart={new Date(2026, 9, 1, 14)} lesson={null} onSaved={() => {}} defaultTeacher="thiago" />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Repetir toda semana/ }));
    // 01/10/2026 é quinta.
    expect(screen.getByRole("button", { name: "qui" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "seg" }));
    expect(screen.getByRole("button", { name: "seg" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/toda seg e qui/)).toBeTruthy();
  });

  it("atendimento novo já vem com o serviço da matéria e a duração dele", () => {
    isTeacher = false;
    services = [{ id: "s1", name: "Matemática", duration_minutes: 90, price: null, mode: "ambos", color: null, active: true }];
    render(
      <LessonDialog open onOpenChange={() => {}} slotStart={new Date(2026, 9, 1, 14)} lesson={null} onSaved={() => {}} defaultTeacher="thiago" />,
    );
    expect(screen.getByText(/Matemática · 90 min/)).toBeTruthy();
    services = [];
  });
});

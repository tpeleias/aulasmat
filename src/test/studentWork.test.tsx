import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Materiais e tarefas numa janela própria (11/10).
const materials = [{ id: "m1", title: "Lista 1 - Frações", created_at: "2026-10-10T12:00:00Z", kind: "page", content: "1. $1/2 + 1/4$", uploaded_by: null }];
const tasks = [{ id: "t1", title: "Fazer a Lista 1", description: null, deadline: "2099-10-17T23:59:00Z", status: "pendente", created_by: null, material_id: "m1" }];
const inserts: { table: string; row: Record<string, unknown> }[] = [];

function builder(table: string) {
  const data = table === "student_materials" ? materials : table === "homework" ? tasks : [];
  const b: Record<string, unknown> = {};
  const done = Promise.resolve({ data, error: null });
  for (const k of ["select", "eq", "order", "in"]) b[k] = () => b;
  b.then = (r: (v: unknown) => unknown) => done.then(r);
  b.insert = (row: Record<string, unknown>) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); };
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: async () => ({ data: { allowed: true }, error: null }),
    auth: { getUser: async () => ({ data: { user: null } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}), createSignedUrl: async () => ({ data: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useVocabulary", async () => {
  const real = await vi.importActual<typeof import("@/lib/vocabulary")>("@/lib/vocabulary");
  return { useWords: () => real.DEFAULT_VOCABULARY, useTasksEnabled: () => true };
});

import StudentWorkDialog, { materialPrompt } from "@/components/StudentWorkDialog";

const student = { id: "s1", student_name: "Miguel", guardian_name: "Ana" };

describe("Materiais e tarefas", () => {
  beforeEach(() => { inserts.length = 0; });

  it("mostra materiais e, na aba de tarefas, a tarefa com o material dela", async () => {
    render(<StudentWorkDialog student={student} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Lista 1 - Frações")).toBeTruthy();
    expect(screen.getByText(/aparece no portal/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Tarefas/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Tarefas/ }));
    expect(await screen.findByText("Fazer a Lista 1")).toBeTruthy();
  });

  it("manda um texto (página) escrito ou colado da IA", async () => {
    render(<StudentWorkDialog student={student} open onOpenChange={() => {}} />);
    await screen.findByText("Lista 1 - Frações");
    fireEvent.click(screen.getByRole("button", { name: /Texto/ }));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Resumo de frações" } });
    fireEvent.change(screen.getByLabelText("Texto do material"), { target: { value: "## Frações\n\n$\\frac{1}{2}$" } });
    fireEvent.click(screen.getByRole("button", { name: /Mandar texto/ }));
    await waitFor(() => expect(inserts).toContainEqual({ table: "student_materials", row: expect.objectContaining({ kind: "page", title: "Resumo de frações", student_id: "s1" }) }));
  });

  it("Virar tarefa abre a tarefa já ligada ao material", async () => {
    render(<StudentWorkDialog student={student} open onOpenChange={() => {}} />);
    await screen.findByText("Lista 1 - Frações");
    fireEvent.click(screen.getByRole("button", { name: /Virar/ }));
    const title = await screen.findByLabelText("O que fazer") as HTMLInputElement;
    expect(title.value).toBe("Fazer: Lista 1 - Frações");
    fireEvent.click(screen.getByRole("button", { name: /Criar/ }));
    await waitFor(() => expect(inserts).toContainEqual({ table: "homework", row: expect.objectContaining({ material_id: "m1", student_id: "s1" }) }));
  });

  it("o prompt serve para qualquer IA e pede fórmulas em LaTeX", () => {
    const p = materialPrompt("aluno");
    expect(p).toContain("$...$");
    expect(p).not.toMatch(/Claude|ChatGPT|Gemini/);
  });
});

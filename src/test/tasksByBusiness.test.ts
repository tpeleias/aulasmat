import { describe, expect, it } from "vitest";
import { buildVocabulary, listWithTasks, tasksAreSubmitted, tasksDefault, taskStatusLabel } from "@/lib/vocabulary";

// Tarefas por ramo (03/10): o nome muda, e só alguns ramos já vêm com elas ligadas.

describe("tarefas por ramo", () => {
  it("cada ramo tem o seu nome", () => {
    expect(buildVocabulary("aulas", null, "pt-BR").task.p).toBe("Tarefas");
    expect(buildVocabulary("saude", null, "pt-BR").task.p).toBe("Orientações");
    expect(buildVocabulary("psicologia", null, "pt-BR").task.p).toBe("Atividades");
    expect(buildVocabulary("esportes", null, "pt-BR").task.s).toBe("Treino para casa");
    expect(buildVocabulary("beleza", null, "en").task.p).toBe("Aftercare tips");
  });

  it("ligadas por padrão só onde há algo para fazer entre um atendimento e outro", () => {
    expect(["aulas", "psicologia", "saude", "esportes"].every(m => tasksDefault(m as never))).toBe(true);
    expect(["beleza", "pet", "oficina", "outro"].some(m => tasksDefault(m as never))).toBe(false);
  });

  it("entregar só nas aulas; nos outros ramos é 'feita'", () => {
    expect(tasksAreSubmitted("aulas")).toBe(true);
    expect(tasksAreSubmitted("saude")).toBe(false);
    expect(taskStatusLabel("entregue", buildVocabulary("aulas", null, "pt-BR"))).toBe("Entregue");
    expect(taskStatusLabel("entregue", buildVocabulary("saude", null, "pt-BR"))).toBe("Feita");
    expect(taskStatusLabel("entregue", buildVocabulary("esportes", null, "pt-BR"))).toBe("Feito");
  });

  it("a lista some com as tarefas desligadas", () => {
    const v = buildVocabulary("saude", null, "pt-BR");
    expect(listWithTasks(["consultas", "materiais"], v, true)).toBe("consultas, materiais e orientações");
    expect(listWithTasks(["consultas", "materiais"], v, false)).toBe("consultas e materiais");
  });
});

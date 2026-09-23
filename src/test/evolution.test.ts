import { describe, it, expect } from "vitest";
import { buildTimeline, computeAttendance, type EvolutionLesson, type EvolutionHomework } from "@/lib/evolution";

const lesson = (over: Partial<EvolutionLesson> & { id: string; start_at: string; status: string }): EvolutionLesson => ({
  subject: "Matemática",
  teacher: "prof",
  class_summary: null,
  ...over,
});

const licao = (over: Partial<EvolutionHomework> & { id: string; deadline: string; status: string }): EvolutionHomework => ({
  title: "Lição",
  feedback: null,
  ...over,
});

describe("buildTimeline", () => {
  it("só aula realizada entra; canceladas, recusadas e futuras ficam de fora", () => {
    const lessons = [
      lesson({ id: "1", start_at: "2026-03-01T10:00:00Z", status: "realizada", class_summary: "Revisão" }),
      lesson({ id: "2", start_at: "2026-03-02T10:00:00Z", status: "cancelada" }),
      lesson({ id: "3", start_at: "2026-03-03T10:00:00Z", status: "recusada" }),
      lesson({ id: "4", start_at: "2026-03-04T10:00:00Z", status: "agendada" }),
      lesson({ id: "5", start_at: "2026-03-05T10:00:00Z", status: "solicitada" }),
    ];
    const timeline = buildTimeline(lessons, []);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toEqual({ kind: "aula", date: "2026-03-01T10:00:00Z", subject: "Matemática", teacher: "prof", summary: "Revisão" });
  });

  it("junta aula e lição, mais recente primeiro", () => {
    const lessons = [lesson({ id: "1", start_at: "2026-03-01T10:00:00Z", status: "realizada" })];
    const homework = [licao({ id: "h1", deadline: "2026-03-05T10:00:00Z", status: "entregue", feedback: "Bom trabalho" })];
    const timeline = buildTimeline(lessons, homework);
    expect(timeline.map(e => e.kind)).toEqual(["licao", "aula"]);
  });
});

describe("computeAttendance", () => {
  it("conta os três status resolvidos e calcula a taxa", () => {
    const lessons = [
      { status: "realizada" }, { status: "realizada" }, { status: "realizada" },
      { status: "cancelada" },
      { status: "recusada" },
      { status: "agendada" }, // não conta
      { status: "solicitada" }, // não conta
    ];
    expect(computeAttendance(lessons)).toEqual({ realizadas: 3, canceladas: 1, recusadas: 1, total: 5, taxa: 60 });
  });

  it("sem nenhuma aula resolvida, taxa é 0 e não NaN", () => {
    expect(computeAttendance([{ status: "agendada" }])).toEqual({ realizadas: 0, canceladas: 0, recusadas: 0, total: 0, taxa: 0 });
  });
});

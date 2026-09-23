// Junta o que já existe (aula realizada + resumo, lição + devolutiva) numa
// linha do tempo por aluno. Nada novo no banco - é o que o roteiro do Pro já
// dizia: "os dados existem, é juntar e desenhar".

export type EvolutionLesson = {
  id: string;
  start_at: string;
  subject: string | null;
  teacher: string;
  status: string;
  class_summary: string | null;
};

export type EvolutionHomework = {
  id: string;
  title: string;
  deadline: string;
  status: string;
  feedback: string | null;
};

export type TimelineEntry =
  | { kind: "aula"; date: string; subject: string | null; teacher: string; summary: string | null }
  | { kind: "licao"; date: string; title: string; status: string; feedback: string | null };

// Só aula REALIZADA vira entrada na linha do tempo - cancelada/recusada não
// aconteceu, e agendada/solicitada ainda não aconteceu. A presença (quantas
// de cada) é outra conta, feita por computeAttendance.
export function buildTimeline(lessons: EvolutionLesson[], homework: EvolutionHomework[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...lessons
      .filter(l => l.status === "realizada")
      .map((l): TimelineEntry => ({ kind: "aula", date: l.start_at, subject: l.subject, teacher: l.teacher, summary: l.class_summary })),
    ...homework.map((h): TimelineEntry => ({ kind: "licao", date: h.deadline, title: h.title, status: h.status, feedback: h.feedback })),
  ];
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export type AttendanceStats = {
  realizadas: number;
  canceladas: number;
  recusadas: number;
  total: number;
  taxa: number; // 0-100, arredondado
};

// Só os três status "resolvidos" entram na conta - agendada e solicitada
// ainda não aconteceram, então não são nem presença nem falta.
export function computeAttendance(lessons: { status: string }[]): AttendanceStats {
  const realizadas = lessons.filter(l => l.status === "realizada").length;
  const canceladas = lessons.filter(l => l.status === "cancelada").length;
  const recusadas = lessons.filter(l => l.status === "recusada").length;
  const total = realizadas + canceladas + recusadas;
  const taxa = total > 0 ? Math.round((realizadas / total) * 100) : 0;
  return { realizadas, canceladas, recusadas, total, taxa };
}

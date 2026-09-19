// Os status de uma aula, num lugar só.
//
// Antes as strings estavam espalhadas por umas quinze telas. Com três status
// isso passava; com cinco não, porque "solicitada" e "recusada" precisam
// aparecer com o nome certo em cinco lugares diferentes e ser tratadas como
// "não é aula confirmada" em vários outros. Um esquecido é uma tela mostrando
// "solicitada" como se a aula estivesse marcada.

export const LESSON_STATUSES = ["solicitada", "agendada", "realizada", "recusada", "cancelada"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

// Um pedido do aluno esperando resposta do professor.
export const isRequest = (status?: string | null) => status === "solicitada";

// O professor disse não, ou a aula foi desmarcada: não ocupa horário e não conta
// para nada. Tem que casar com o WHERE da constraint lessons_sem_sobreposicao e
// com o filtro de get_busy_ranges - se divergir, a tela mostra um horário que o
// banco recusa, ou esconde um que está livre.
export const isDiscarded = (status?: string | null) =>
  status === "cancelada" || status === "recusada";

// O que a família e o professor leem na tela. "solicitada" virou uma frase e não
// uma palavra porque "solicitada" sozinha não diz de quem se espera a ação.
const LABELS: Record<string, string> = {
  solicitada: "aguardando aprovação",
  agendada: "agendada",
  realizada: "realizada",
  recusada: "recusada",
  cancelada: "cancelada",
};

export const statusLabel = (status?: string | null) =>
  LABELS[status ?? ""] ?? status ?? "agendada";

// Cor do selo. Pedido é amarelo (pendente de alguém), recusado e cancelado são
// vermelhos, aula realizada é o estado "pronto".
export function statusBadgeVariant(status?: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (isRequest(status)) return "outline";
  if (isDiscarded(status)) return "destructive";
  if (status === "realizada") return "default";
  return "secondary";
}

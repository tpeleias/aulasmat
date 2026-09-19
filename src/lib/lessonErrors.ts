// O banco recusa duas aulas no mesmo horário do mesmo professor (constraint
// lessons_sem_sobreposicao). A mensagem crua do Postgres é ilegível para quem
// está do outro lado da tela - "conflicting key value violates exclusion
// constraint" não diz nada a um aluno. Toda tela que grava aula passa por aqui,
// para que a explicação seja a mesma em qualquer caminho.

type SupabaseError = { message?: string; code?: string } | null | undefined;

// 23P01 = exclusion_violation. Comparar pelo código é mais firme que pelo
// texto, mas o nome da constraint fica como rede caso o código não venha.
const CONFLITO = "23P01";

export function isSlotConflict(error: SupabaseError): boolean {
  if (!error) return false;
  return error.code === CONFLITO || (error.message ?? "").includes("lessons_sem_sobreposicao");
}

export function lessonErrorMessage(error: SupabaseError): string {
  if (!error) return "";
  if (isSlotConflict(error)) return "Esse horário já está ocupado para este professor.";
  return error.message || "Não foi possível salvar a aula.";
}

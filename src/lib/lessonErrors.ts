// O banco recusa duas aulas no mesmo horário do mesmo professor (constraint
// lessons_sem_sobreposicao). A mensagem crua do Postgres é ilegível para quem
// está do outro lado da tela - "conflicting key value violates exclusion
// constraint" não diz nada a um aluno. Toda tela que grava aula passa por aqui,
// para que a explicação seja a mesma em qualquer caminho.

import { dbErrorMessage } from "@/lib/dbErrors";
import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
type SupabaseError = { message?: string; hint?: string | null; code?: string } | null | undefined;

// 23P01 = exclusion_violation. Comparar pelo código é mais firme que pelo
// texto, mas o nome da constraint fica como rede caso o código não venha.
const CONFLITO = "23P01";

export function isSlotConflict(error: SupabaseError): boolean {
  if (!error) return false;
  return error.code === CONFLITO || (error.message ?? "").includes("lessons_sem_sobreposicao");
}

export function lessonErrorMessage(error: SupabaseError, v: Vocabulary = DEFAULT_VOCABULARY): string {
  if (!error) return "";
  if (isSlotConflict(error)) return L(`Esse horário já está ocupado para ${v.staff.este} ${v.staff.l}.`, `That time is already taken for this ${v.staff.l}.`);
  // 23505 no índice de troca: já existe um pedido de troca aberto para essa aula.
  if (error.code === "23505" && (error.message ?? "").includes("lessons_one_open_reschedule"))
    return L(`Já existe um pedido de troca para ${v.appointment.este} ${v.appointment.l}. Retire o pedido anterior para pedir outro horário.`,
      `There is already a reschedule request for this ${v.appointment.l}. Withdraw it before asking for another time.`);
  return dbErrorMessage(error, v, L(`Não foi possível salvar ${v.appointment.o} ${v.appointment.l}.`, `Could not save the ${v.appointment.l}.`));
}

// O banco não sabe as palavras de cada ramo, então as recusas dele vêm com
// texto neutro e uma chave em `hint` (migration 20260924060000). Aqui a chave
// vira a frase com as palavras da empresa. Chave desconhecida, ou sem chave:
// fica a mensagem que veio.

import { DEFAULT_VOCABULARY, cap, type Vocabulary } from "@/lib/vocabulary";
import { L, isEnglish } from "@/lib/i18n";

type DbError = { message?: string; hint?: string | null; code?: string } | null | undefined;

export function dbErrorMessage(error: DbError, v: Vocabulary = DEFAULT_VOCABULARY, fallback = L("Não foi possível salvar.", "Could not save.")): string {
  if (!error) return "";
  const [key, arg] = (error.hint ?? "").split(":");
  const n = Number(arg);
  const staff = L(n === 1 ? `${n} ${v.staff.l} ativo` : `${n} ${v.staff.lp} ativos`, n === 1 ? `${n} active ${v.staff.l}` : `${n} active ${v.staff.lp}`);
  const clients = L(`${n} ${v.client.lp} liberados`, `${n} active ${v.client.lp}`);
  switch (key) {
    case "limite_profissionais_cadastrar":
      return L(`O seu plano permite ${staff}. Para ter mais, mude de plano.`, `Your plan allows ${staff}. To add more, change your plan.`);
    case "limite_profissionais_reativar":
      return L(`O seu plano permite ${staff}. Desative outro antes, ou mude de plano.`, `Your plan allows ${staff}. Deactivate another one first, or change your plan.`);
    case "limite_clientes_cadastrar":
      return L(`O seu plano permite ${clients}. Para cadastrar mais, mude para o Cronys Pro.`, `Your plan allows ${clients}. To add more, upgrade to Cronys Pro.`);
    case "limite_clientes_liberar":
      return L(`O seu plano permite ${clients}. Trave outro antes, ou mude para o Cronys Pro.`, `Your plan allows ${clients}. Pause another one first, or upgrade to Cronys Pro.`);
    case "falta_desligada":
      return L("A cobrança de falta está desligada. Ligue em Configurações → Falta e desmarcação.", "No-show charges are off. Turn them on in Settings → No-shows and cancellations.");
    case "falta_status":
      return L(`Só dá para cobrar falta de ${v.appointment.um} ${v.appointment.l} ${v.appointment.pick("marcado", "marcada")} ou ${v.appointment.pick("desmarcado", "desmarcada")}.`, `You can only charge a no-show for a booked or canceled ${v.appointment.l}.`);
    case "pacote_pro":
      return L("Pacotes são do Cronys Pro.", "Packages are part of Cronys Pro.");
    case "cliente_pausado":
      return L(`Não é possível marcar ${v.appointment.l} para ${v.client.este} ${v.client.l} agora: o cadastro está pausado.`, `You can't book ${v.appointment.um} ${v.appointment.l} for this ${v.client.l} right now: the profile is paused.`);
    case "profissional_pausado":
      return L(`Não é possível marcar ${v.appointment.l} com ${v.staff.este} ${v.staff.l} agora: o cadastro está pausado.`, `You can't book ${v.appointment.um} ${v.appointment.l} with this ${v.staff.l} right now: the profile is paused.`);
    case "servicos_pro":
      return L(`No Cronys Essencial é ${v.topic.um} ${v.topic.l}. Vários são do Cronys Pro.`, `Cronys Essential includes one ${v.topic.l}. Multiple ${v.topic.lp} are part of Cronys Pro.`);
    case "servico_inativo":
      return L(`${cap(v.topic.este)} ${v.topic.l} não está disponível.`, `This ${v.topic.l} is not available.`);
    case "servico_profissional":
      return L(`${cap(v.staff.este)} ${v.staff.l} não faz ${v.topic.este} ${v.topic.l}.`, `This ${v.staff.l} does not offer this ${v.topic.l}.`);
    case "servico_invalido":
      return L(`${v.topic.s} não encontrado.`, `${v.topic.s} not found.`);
    case "resumo_aula":
      return L(`Só dá para escrever o resumo de ${v.appointment.um} ${v.appointment.l} sua que já começou.`, `You can only write notes for your own ${v.appointment.l} that has already started.`);
  }
  // Em inglês, a mensagem crua do banco (em português) não serve: vale a genérica.
  if (isEnglish()) return fallback;
  return error.message || fallback;
}

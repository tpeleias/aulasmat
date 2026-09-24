// O banco não sabe as palavras de cada ramo, então as recusas dele vêm com
// texto neutro e uma chave em `hint` (migration 20260924060000). Aqui a chave
// vira a frase com as palavras da empresa. Chave desconhecida, ou sem chave:
// fica a mensagem que veio.

import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";

type DbError = { message?: string; hint?: string | null; code?: string } | null | undefined;

export function dbErrorMessage(error: DbError, v: Vocabulary = DEFAULT_VOCABULARY, fallback = "Não foi possível salvar."): string {
  if (!error) return "";
  const [key, arg] = (error.hint ?? "").split(":");
  const n = Number(arg);
  const staff = n === 1 ? `${n} ${v.staff.l} ativo` : `${n} ${v.staff.lp} ativos`;
  const clients = `${n} ${v.client.lp} liberados`;
  switch (key) {
    case "limite_profissionais_cadastrar":
      return `O seu plano permite ${staff}. Para ter mais, mude de plano.`;
    case "limite_profissionais_reativar":
      return `O seu plano permite ${staff}. Desative outro antes, ou mude de plano.`;
    case "limite_clientes_cadastrar":
      return `O seu plano permite ${clients}. Para cadastrar mais, mude para o Cronys Pro.`;
    case "limite_clientes_liberar":
      return `O seu plano permite ${clients}. Trave outro antes, ou mude para o Cronys Pro.`;
    case "falta_desligada":
      return "A cobrança de falta está desligada. Ligue em Configurações → Falta e desmarcação.";
    case "falta_status":
      return `Só dá para cobrar falta de ${v.appointment.um} ${v.appointment.l} ${v.appointment.pick("marcado", "marcada")} ou ${v.appointment.pick("desmarcado", "desmarcada")}.`;
    case "pacote_pro":
      return "Pacotes são do Cronys Pro.";
    case "cliente_pausado":
      return `Não é possível marcar ${v.appointment.l} para ${v.client.este} ${v.client.l} agora: o cadastro está pausado.`;
    case "profissional_pausado":
      return `Não é possível marcar ${v.appointment.l} com ${v.staff.este} ${v.staff.l} agora: o cadastro está pausado.`;
  }
  return error.message || fallback;
}

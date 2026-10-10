// Os primeiros passos de uma empresa nova, na tela Hoje.
//
// A escola que se cadastra sozinha cai numa tela vazia. Esta lista diz o que
// fazer, na ordem em que faz sentido, e cada passo se marca sozinho a partir
// do que já existe no banco - ninguém precisa "ticar" nada. Empresa que já
// usa o app tem tudo feito e não vê a lista.
//
// 10/10: a ordem leva ao "ah, é isso" logo no primeiro dia - cliente,
// atendimento, atendimento realizado vira cobrança sozinho - e cada passo
// abre direto o que precisa (o cadastro, a marcação).

import type { Vocabulary } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
export type FirstStepsData = {
  /** Pix ou link de pagamento preenchido em Configurações. */
  hasPayment: boolean;
  students: number;
  lessons: number;
  /** Atendimentos realizados (viram cobrança no Financeiro). */
  doneLessons: number;
  /** Algum cliente (ou responsável) com login no portal. */
  portalLogins: number;
};

export type FirstStep = {
  key: "cliente" | "atendimento" | "cobranca" | "pagamento" | "portal";
  title: string;
  hint: string;
  to: string;
  done: boolean;
};

export function firstSteps(d: FirstStepsData, w: Vocabulary): FirstStep[] {
  const ap = w.appointment;
  return [
    {
      key: "cliente",
      title: L(`Cadastre ${w.client.o} ${w.client.pick("primeiro", "primeira")} ${w.client.l}`, `Add your first ${w.client.l}`),
      hint: L(`Só o nome já basta. Tem muitos? Dá para trazer de uma planilha em ${w.client.p}.`, `Just the name is enough. Have many? Bring them from a spreadsheet in ${w.client.p}.`),
      to: "/admin/alunos?novo=1",
      done: d.students > 0,
    },
    {
      key: "atendimento",
      title: L(`Marque ${ap.o} ${ap.pick("primeiro", "primeira")} ${ap.l}`, `Book your first ${ap.l}`),
      hint: L(`Escolha ${w.client.o} ${w.client.l}, o dia e o horário. Depois, o botão + faz isso de qualquer tela.`, `Pick the ${w.client.l}, day and time. Later, the + button does this from any screen.`),
      to: "/admin/agenda?new=1",
      done: d.lessons > 0,
    },
    {
      key: "cobranca",
      title: L(`Marque ${ap.o} ${ap.l} como ${ap.pick("realizado", "realizada")} e veja a cobrança`, `Mark the ${ap.l} as done and see the charge`),
      hint: L(`Na agenda, abra ${ap.o} ${ap.l} e marque como ${ap.pick("realizado", "realizada")}: o valor entra sozinho no Financeiro, pronto para cobrar pelo WhatsApp.`, `In the calendar, open the ${ap.l} and mark it as done: the amount goes to Billing on its own, ready to collect.`),
      to: d.doneLessons > 0 ? "/admin/financeiro" : "/admin/agenda",
      done: d.doneLessons > 0,
    },
    {
      key: "pagamento",
      title: L(`Valor ${ap.do} ${ap.l} e forma de pagamento`, `${ap.s} price and payment method`),
      hint: L("Confira o valor e coloque a chave Pix: a cobrança já sai com o código para copiar e colar.", "Check the price and add your payment link: collection messages include it automatically."),
      to: "/admin/configuracoes?secao=cobranca",
      done: d.hasPayment,
    },
    {
      key: "portal",
      title: L(`Convide ${w.payer.os} ${w.payer.lp} para o portal`, `Invite ${w.payer.lp} to the portal`),
      hint: L(`No portal dá para ver ${ap.os} ${ap.lp}, o que falta pagar e pedir horário.`, `In the portal they can see ${ap.lp}, what is still owed, and request times.`),
      to: "/admin/acessos",
      done: d.portalLogins > 0,
    },
  ];
}

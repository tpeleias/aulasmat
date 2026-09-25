// Os primeiros passos de uma empresa nova, na tela Hoje.
//
// A escola que se cadastra sozinha cai numa tela vazia. Esta lista diz o que
// fazer, na ordem em que faz sentido, e cada passo se marca sozinho a partir
// do que já existe no banco - ninguém precisa "ticar" nada. Empresa que já
// usa o app tem tudo feito e não vê a lista.

import type { Vocabulary } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
export type FirstStepsData = {
  /** Pix ou link de pagamento preenchido em Configurações. */
  hasPayment: boolean;
  students: number;
  lessons: number;
  /** Algum cliente (ou responsável) com login no portal. */
  portalLogins: number;
};

export type FirstStep = {
  key: "pagamento" | "cliente" | "atendimento" | "portal";
  title: string;
  hint: string;
  to: string;
  done: boolean;
};

export function firstSteps(d: FirstStepsData, w: Vocabulary): FirstStep[] {
  return [
    {
      key: "pagamento",
      title: L(`Valor ${w.appointment.do} ${w.appointment.l} e forma de pagamento`, `${w.appointment.s} price and payment method`),
      hint: L("Confira o valor e coloque a chave Pix: a cobrança já sai com o código para copiar e colar.", "Check the price and add your payment link: collection messages include it automatically."),
      to: "/admin/configuracoes",
      done: d.hasPayment,
    },
    {
      key: "cliente",
      title: L(`Cadastre ${w.client.o} ${w.client.pick("primeiro", "primeira")} ${w.client.l}`, `Add your first ${w.client.l}`),
      hint: L(`Um por um, ou vários de uma vez por planilha em ${w.client.p}.`, `One by one, or many at once from a spreadsheet in ${w.client.p}.`),
      to: "/admin/alunos",
      done: d.students > 0,
    },
    {
      key: "atendimento",
      title: L(`Marque ${w.appointment.o} ${w.appointment.pick("primeiro", "primeira")} ${w.appointment.l}`, `Book your first ${w.appointment.l}`),
      hint: L("Pela agenda, ou pelo botão + em qualquer tela.", "From the calendar, or with the + button on any screen."),
      to: "/admin/agenda",
      done: d.lessons > 0,
    },
    {
      key: "portal",
      title: L(`Convide ${w.guardian.os} ${w.guardian.lp} para o portal`, `Invite ${w.guardian.lp} to the portal`),
      hint: L(`No portal dá para ver ${w.appointment.os} ${w.appointment.lp}, o que falta pagar e pedir horário.`, `In the portal they can see ${w.appointment.lp}, what is still owed, and request times.`),
      to: "/admin/acessos",
      done: d.portalLogins > 0,
    },
  ];
}

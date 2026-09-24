// O cardápio do Cronys, para as telas que falam de preço (página inicial e
// /assinar). Quem decide o que cada plano PODE é o banco (plan_features); aqui
// está só o que se mostra. Os preços têm de bater com os do Stripe (lookup_key
// cronys_pro_solo_mensal etc.) - mudou lá, muda aqui.

import { Capacitor } from "@capacitor/core";

export type Tier = "essencial" | "pro_solo" | "pro";
export type Interval = "month" | "year";

export type PlanCard = {
  tier: Tier;
  nome: string;
  resumo: string;
  mensal: number;
  /** Preço do ano inteiro (2 meses grátis). */
  anual: number;
  itens: string[];
};

export const EXTRA_TEACHER = { mensal: 19, anual: 190 };
export const EQUIPE_INCLUDED = 5;

export const PLANS: PlanCard[] = [
  {
    tier: "essencial",
    nome: "Essencial",
    resumo: "Para começar",
    mensal: 0,
    anual: 0,
    itens: ["1 profissional", "Até 5 clientes", "Agenda, cobrança e portal da família", "Pix copia e cola com o valor"],
  },
  {
    tier: "pro_solo",
    nome: "Pro Solo",
    resumo: "Para quem atende sozinho",
    mensal: 49,
    anual: 490,
    itens: ["1 profissional", "Clientes sem limite", "Palavras do seu ramo", "Pacotes, vouchers e desconto por família", "Bloqueio que se repete toda semana"],
  },
  {
    tier: "pro",
    nome: "Pro Equipe",
    resumo: "Para escola, clínica ou estúdio",
    mensal: 99,
    anual: 990,
    itens: [`Até ${EQUIPE_INCLUDED} profissionais, cada um com acesso próprio`, `R$ ${EXTRA_TEACHER.mensal}/mês por profissional a mais`, "Tudo do Pro Solo"],
  },
];

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Pode mostrar preço e botão de assinar aqui? No app Android, não: a Google
 * Play proíbe vender bem digital dentro do app fora da cobrança dela, e isso
 * inclui botão ou link para pagar no site. No app a tela só informa.
 */
export function canSellHere() {
  return !Capacitor.isNativePlatform();
}

export function tierName(tier: string | null | undefined) {
  return tier === "pro_solo" ? "Cronys Pro Solo" : tier === "pro" ? "Cronys Pro Equipe" : "Cronys Essencial";
}

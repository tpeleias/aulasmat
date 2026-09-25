// O cardápio do Cronys, para as telas que falam de preço (página inicial e
// /assinar). Quem decide o que cada plano PODE é o banco (plan_features); aqui
// está só o que se mostra. Os preços têm de bater com os do Stripe (lookup_key
// cronys_pro_solo_mensal etc.) - mudou lá, muda aqui. Os slugs internos
// continuam pro_solo/pro; para o cliente eles se chamam Pro e Max.

import { Capacitor } from "@capacitor/core";

export type Tier = "essencial" | "pro_solo" | "pro";
export type Interval = "month" | "year";

export type PlanCard = {
  tier: Tier;
  nome: string;
  resumo: string;
  mensal: number;
  /** Preço do ano inteiro (10% de desconto sobre 12 meses). */
  anual: number;
  itens: string[];
};

export const EXTRA_TEACHER = { mensal: 29.9, anual: 322.9 };
/**
 * Adicional do assistente (lookup_key cronys_assistente_*), só para o Pro: no
 * Max pago ele vem incluso. Preço único. Só é oferecido quando o banco diz
 * que está à venda (assistant_on_sale).
 */
export const ASSISTANT_ADDON = { mensal: 39, anual: 421.2 };
export const EQUIPE_INCLUDED = 5;

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const PLANS: PlanCard[] = [
  {
    tier: "essencial",
    nome: "Essencial",
    resumo: "Para começar",
    mensal: 0,
    anual: 0,
    itens: ["1 profissional (você)", "Até 5 clientes", "Agenda, cobrança e portal da família", "Pix copia e cola com o valor"],
  },
  {
    tier: "pro_solo",
    nome: "Pro",
    resumo: "Para quem atende sozinho",
    mensal: 79.9,
    anual: 862.9,
    itens: ["1 profissional (você)", "Clientes sem limite", "Lembrete e confirmação pelo WhatsApp com um toque", "Pacotes, vouchers e desconto por família", "Palavras do seu ramo", "Bloqueio que se repete toda semana", `Assistente como adicional (${brl(ASSISTANT_ADDON.mensal)}/mês, até 100 mensagens/mês)`],
  },
  {
    tier: "pro",
    nome: "Max",
    resumo: "Para escola, clínica ou estúdio",
    mensal: 159.9,
    anual: 1726.9,
    itens: [`Até ${EQUIPE_INCLUDED} profissionais contando você (você + ${EQUIPE_INCLUDED - 1}), cada um com acesso próprio`, `${brl(EXTRA_TEACHER.mensal)}/mês por profissional a mais`, "Assistente com inteligência artificial incluso (até 200 mensagens/mês)", "\"Estou a caminho\" com a localização, pelo WhatsApp", "Lembretes automáticos pelo WhatsApp (em breve)", "Tudo do Pro"],
  },
];


/**
 * Pode mostrar preço e botão de assinar aqui? No app Android, não: a Google
 * Play proíbe vender bem digital dentro do app fora da cobrança dela, e isso
 * inclui botão ou link para pagar no site. No app a tela só informa.
 */
export function canSellHere() {
  return !Capacitor.isNativePlatform();
}

export function tierName(tier: string | null | undefined) {
  return tier === "pro_solo" ? "Cronys Pro" : tier === "pro" ? "Cronys Max" : "Cronys Essencial";
}

// O cardápio do Cronys, para as telas que falam de preço (página inicial e
// /assinar). Quem decide o que cada plano PODE é o banco (plan_features); aqui
// está só o que se mostra. Os preços têm de bater com os do Stripe (lookup_key
// cronys_pro_solo_mensal etc.) - mudou lá, muda aqui. Os slugs internos
// continuam pro_solo/pro; para o cliente eles se chamam Pro e Max.

import { Capacitor } from "@capacitor/core";

import { L, getCurrency, intlLocale } from "@/lib/i18n";
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

// Preços em real e, fora do Brasil, o preço de mercado de cada moeda. O anual
// é 10% de desconto sobre 12 meses (fora do real, arredondado para inteiro).
// Os números têm de bater com FOREIGN_PRICES em supabase/functions/_shared/stripe.ts.
type Price = { mensal: number; anual: number };
const FOREIGN: Record<"USD" | "EUR" | "GBP", { pro_solo: Price; pro: Price; extra: Price; assistant: Price }> = {
  USD: { pro_solo: { mensal: 15, anual: 162 }, pro: { mensal: 39, anual: 421 }, extra: { mensal: 7, anual: 76 }, assistant: { mensal: 9, anual: 97 } },
  EUR: { pro_solo: { mensal: 15, anual: 162 }, pro: { mensal: 39, anual: 421 }, extra: { mensal: 7, anual: 76 }, assistant: { mensal: 9, anual: 97 } },
  GBP: { pro_solo: { mensal: 13, anual: 140 }, pro: { mensal: 33, anual: 356 }, extra: { mensal: 6, anual: 65 }, assistant: { mensal: 8, anual: 86 } },
};
const cur = getCurrency();
const foreign = cur === "BRL" ? null : FOREIGN[cur];

/** Cupom de desconto só existe em real. */
export const COUPONS_AVAILABLE = !foreign;

export const EXTRA_TEACHER = foreign ? foreign.extra : { mensal: 29.9, anual: 322.9 };
/**
 * Adicional do assistente (lookup_key cronys_assistente_*), só para o Pro: no
 * Max pago ele vem incluso. Preço único. Só é oferecido quando o banco diz
 * que está à venda (assistant_on_sale).
 */
export const ASSISTANT_ADDON = foreign ? foreign.assistant : { mensal: 39, anual: 421.2 };
export const EQUIPE_INCLUDED = 5;

/** Preço de plano na moeda da empresa: "R$ 79,90", "$15", "€39", "£13". */
export const brl = (v: number) => v.toLocaleString(cur === "BRL" ? "pt-BR" : intlLocale(), { style: "currency", currency: cur, minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });

export const PLANS: PlanCard[] = [
  {
    tier: "essencial",
    nome: L("Essencial", "Essential"),
    resumo: L("Para começar", "To get started"),
    mensal: 0,
    anual: 0,
    itens: L(["1 profissional (você)", "Até 5 clientes", "Agenda, cobrança e portal da família", foreign ? "Link de pagamento com o valor" : "Pix copia e cola com o valor"],
      ["1 professional (you)", "Up to 5 clients", "Schedule, billing and client portal", "Payment link with the amount due"]),
  },
  {
    tier: "pro_solo",
    nome: "Pro",
    resumo: L("Para quem atende sozinho", "For solo professionals"),
    mensal: foreign ? foreign.pro_solo.mensal : 79.9,
    anual: foreign ? foreign.pro_solo.anual : 862.9,
    itens: L(["1 profissional (você)", "Clientes sem limite", "Lembrete e confirmação pelo WhatsApp com um toque", "Pacotes, vouchers e desconto por família", "Palavras do seu ramo", "Bloqueio que se repete toda semana", `Assistente como adicional (${brl(ASSISTANT_ADDON.mensal)}/mês, até 100 mensagens/mês)`],
      ["1 professional (you)", "Unlimited clients", "One-tap WhatsApp reminders and confirmations", "Packages, vouchers and family discounts", "Your industry's words", "Weekly recurring blocks", `Assistant add-on (${brl(ASSISTANT_ADDON.mensal)}/month, up to 100 messages/month)`]),
  },
  {
    tier: "pro",
    nome: "Max",
    resumo: L("Para escola, clínica ou estúdio", "For schools, clinics and studios"),
    mensal: foreign ? foreign.pro.mensal : 159.9,
    anual: foreign ? foreign.pro.anual : 1726.9,
    itens: L([`Até ${EQUIPE_INCLUDED} profissionais contando você (você + ${EQUIPE_INCLUDED - 1}), cada um com acesso próprio`, `${brl(EXTRA_TEACHER.mensal)}/mês por profissional a mais`, "Assistente com inteligência artificial incluso (até 200 mensagens/mês)", "\"Estou a caminho\" com a localização, pelo WhatsApp", "Lembretes automáticos pelo WhatsApp (em breve)", "Tudo do Pro"],
      [`Up to ${EQUIPE_INCLUDED} professionals including you (you + ${EQUIPE_INCLUDED - 1}), each with their own login`, `${brl(EXTRA_TEACHER.mensal)}/month per extra professional`, "AI assistant included (up to 200 messages/month)", "\"On my way\" with your location, via WhatsApp", "Automatic WhatsApp reminders (coming soon)", "Everything in Pro"]),
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
  return tier === "pro_solo" ? "Cronys Pro" : tier === "pro" ? "Cronys Max" : L("Cronys Essencial", "Cronys Essential");
}

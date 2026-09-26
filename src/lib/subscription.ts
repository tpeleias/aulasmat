// O cardápio do Cronys para as telas que falam de preço (página inicial e
// /assinar). Nenhum número mora aqui: preço, limite e recurso vêm de
// supabase/functions/_shared/plans.ts (o mesmo arquivo que a cobrança e o
// banco usam). Aqui só se monta o texto, na língua e na moeda da vez.

import { Capacitor } from "@capacitor/core";
import {
  ACTIVE_CLIENT_DAYS, ASSISTANT_ADDON, COUPON_CURRENCIES, PLANS as CFG, TRIAL_DAYS,
  annualMonthlyEquivalent, annualPrice, monthlyPrice, type Currency, type Interval, type Item, type PlanId,
} from "@shared/plans";
import { L, getCurrency, intlLocale } from "@/lib/i18n";

export type Tier = PlanId;
export type { Interval };

export type PlanCard = {
  tier: Tier;
  nome: string;
  resumo: string;
  mensal: number;
  /** Preço do ano inteiro. */
  anual: number;
  /** O anual dividido por 12 ("equivale a"). */
  anualMes: number;
  itens: string[];
};

const cur: Currency = getCurrency();

/** Cupom de lançamento só nas moedas de COUPON_CURRENCIES. */
export const COUPONS_AVAILABLE = COUPON_CURRENCIES.includes(cur);
export { TRIAL_DAYS, ACTIVE_CLIENT_DAYS };

/** Preço na moeda da vez: "R$ 49,90", "$15", "€39", "£12". */
export const money = (v: number) => v.toLocaleString(cur === "BRL" ? "pt-BR" : intlLocale(), {
  style: "currency", currency: cur, minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2,
});
/** Nome antigo, mantido para quem já importava. */
export const brl = money;

export const itemPrice = (item: Item, interval: Interval) =>
  interval === "year" ? annualPrice(item, cur) : monthlyPrice(item, cur);
export const itemMonthlyEquivalent = (item: Item) => annualMonthlyEquivalent(item, cur);

const per = (i: Interval) => (i === "year" ? L("ano", "year") : L("mês", "month"));
export const perLabel = per;

const clientes = (n: number | null) =>
  n === null ? L("Clientes ativos ilimitados", "Unlimited active clients") : L(`Até ${n} clientes ativos`, `Up to ${n} active clients`);

const extra = monthlyPrice("extra", cur);
const ia = monthlyPrice("assistant", cur);
const pix = cur === "BRL" ? L("Pix copia e cola com o valor", "Pix with the amount") : L("Link de pagamento com o valor", "Payment link with the amount due");

function itens(tier: Tier): string[] {
  const p = CFG[tier];
  switch (tier) {
    case "essencial":
      return [L("1 profissional (você)", "1 professional (you)"), clientes(p.maxActiveClients),
        L("Agenda, cobrança e portal do cliente", "Schedule, billing and client portal"),
        L("Palavras do seu ramo", "Your industry's words"), pix];
    case "start":
      return [L("1 profissional (você)", "1 professional (you)"), clientes(p.maxActiveClients),
        L("Tudo do Essencial", "Everything in Essential"),
        L("Lembrete e confirmação pelo WhatsApp com um toque", "One-tap WhatsApp reminders and confirmations"),
        L("Pacotes, vouchers e desconto por família", "Packages, vouchers and family discounts"),
        L("Bloqueio que se repete toda semana", "Weekly recurring blocks"),
        L(`IA como adicional (+${money(ia)}/mês, ${ASSISTANT_ADDON.messages} mensagens)`, `AI add-on (+${money(ia)}/month, ${ASSISTANT_ADDON.messages} messages)`)];
    case "pro_solo":
      return [clientes(p.maxActiveClients), L("Tudo do Start", "Everything in Start"),
        L(`Até ${p.maxTeachers} profissionais: você + ${money(extra)}/mês por profissional extra`,
          `Up to ${p.maxTeachers} professionals: you + ${money(extra)}/month per extra professional`),
        L(`Amostra de IA: ${p.assistantMessages} mensagens/mês`, `AI sample: ${p.assistantMessages} messages/month`),
        L(`IA como adicional (+${money(ia)}/mês, mais ${ASSISTANT_ADDON.messages} mensagens)`, `AI add-on (+${money(ia)}/month, ${ASSISTANT_ADDON.messages} more messages)`)];
    case "pro":
      return [L(`${p.includedTeachers} profissionais incluídos, cada um com acesso próprio`, `${p.includedTeachers} professionals included, each with their own login`),
        L(`Do ${p.includedTeachers + 1}º em diante, ${money(extra)}/mês cada`, `From the ${p.includedTeachers + 1}th on, ${money(extra)}/month each`),
        L(`IA inclusa (${p.assistantMessages} mensagens/mês)`, `AI included (${p.assistantMessages} messages/month)`),
        L("\"Estou a caminho\" com a localização, pelo WhatsApp", "\"On my way\" with your location, via WhatsApp"),
        L("Cada profissional com os próprios serviços", "Each professional with their own services"),
        L("Lembretes automáticos pelo WhatsApp (em breve)", "Automatic WhatsApp reminders (coming soon)"),
        L("Tudo do Pro", "Everything in Pro")];
  }
}

const RESUMO: Record<Tier, () => string> = {
  essencial: () => L("Para começar", "To get started"),
  start: () => L("Para quem está começando a crescer", "For solo professionals starting out"),
  pro_solo: () => L("Para quem atende sozinho ou em dupla", "For solo pros and small duos"),
  pro: () => L("Para escola, clínica ou estúdio", "For schools, clinics and studios"),
};

function card(tier: Tier): PlanCard {
  const paid = tier !== "essencial";
  return {
    tier,
    nome: L(CFG[tier].name.pt, CFG[tier].name.en),
    resumo: RESUMO[tier](),
    mensal: paid ? monthlyPrice(tier, cur) : 0,
    anual: paid ? annualPrice(tier, cur) : 0,
    anualMes: paid ? annualMonthlyEquivalent(tier, cur) : 0,
    itens: itens(tier),
  };
}

export const PLANS_CARDS: PlanCard[] = (["essencial", "start", "pro_solo", "pro"] as Tier[]).map(card);
/** Nome antigo. */
export const PLANS = PLANS_CARDS;

/** A tabela comparativa: uma linha por recurso, um valor por plano. */
export type CompareRow = { label: string; values: Record<Tier, string | boolean> };

export function comparisonRows(interval: Interval): CompareRow[] {
  const tiers: Tier[] = ["essencial", "start", "pro_solo", "pro"];
  const row = (label: string, f: (t: Tier) => string | boolean): CompareRow =>
    ({ label, values: Object.fromEntries(tiers.map(t => [t, f(t)])) as Record<Tier, string | boolean> });
  const yes = L("Sim", "Yes");
  return [
    row(interval === "year" ? L("Preço por ano", "Price per year") : L("Preço por mês", "Price per month"),
      t => (t === "essencial" ? L("Grátis", "Free") : money(itemPrice(t, interval)))),
    row(L("Profissionais", "Professionals"), t => {
      const p = CFG[t];
      if (p.maxTeachers === null) return L(`${p.includedTeachers} + extras`, `${p.includedTeachers} + extras`);
      return p.maxTeachers === 1 ? "1" : L(`até ${p.maxTeachers}`, `up to ${p.maxTeachers}`);
    }),
    row(L("Clientes ativos", "Active clients"), t => (CFG[t].maxActiveClients === null ? L("Ilimitados", "Unlimited") : String(CFG[t].maxActiveClients))),
    row(L("Agenda, cobrança e portal do cliente", "Schedule, billing and client portal"), () => yes),
    row(L("Palavras do seu ramo", "Your industry's words"), t => CFG[t].features.vocabulary),
    row(L("WhatsApp com um toque", "One-tap WhatsApp"), t => CFG[t].features.whatsapp_link),
    row(L("Pacotes, vouchers e desconto por família", "Packages, vouchers and family discounts"), t => CFG[t].features.packages),
    row(L("Bloqueio semanal", "Weekly blocks"), t => CFG[t].features.recurring_blocks),
    row(L("Assistente com IA", "AI assistant"), t => {
      const p = CFG[t];
      if (p.assistantMessages > 0 && !p.assistantAddon) return L(`${p.assistantMessages} msgs/mês`, `${p.assistantMessages} msgs/mo`);
      if (p.assistantMessages > 0) return L(`${p.assistantMessages} msgs/mês + adicional`, `${p.assistantMessages} msgs/mo + add-on`);
      return p.assistantAddon ? L("Adicional", "Add-on") : false;
    }),
    row(L("\"Estou a caminho\"", "\"On my way\""), t => CFG[t].features.arrival_location),
    row(L("Lembretes automáticos", "Automatic reminders"), t => (CFG[t].features.whatsapp_auto ? L("Em breve", "Coming soon") : false)),
  ];
}

/**
 * Pode mostrar preço e botão de assinar aqui? No app Android, não: a Google
 * Play proíbe vender bem digital dentro do app fora da cobrança dela, e isso
 * inclui botão ou link para pagar no site. No app a tela só informa.
 */
export function canSellHere() {
  return !Capacitor.isNativePlatform();
}

export function tierName(tier: string | null | undefined) {
  const t = (tier && tier in CFG ? tier : "essencial") as Tier;
  return `Cronys ${L(CFG[t].name.pt, CFG[t].name.en)}`;
}

/** "Cronys Start por R$ 29,90/mês" - o convite de upgrade. */
export function upgradeOffer(tier: Tier): string {
  return `${tierName(tier)} ${L("por", "for")} ${money(itemPrice(tier as Item, "month"))}/${perLabel("month")}`;
}

/** O plano seguinte para quem bateu N clientes ativos (o limite diz de qual plano veio). */
export function nextPlanForClients(limit: number): Tier | null {
  const order: Tier[] = ["essencial", "start", "pro_solo", "pro"];
  const i = order.findIndex(t => CFG[t].maxActiveClients === limit);
  return i >= 0 ? order.slice(i + 1).find(t => CFG[t].maxActiveClients === null || CFG[t].maxActiveClients! > limit) ?? null : null;
}

/** O plano seguinte para quem bateu N profissionais ativos. */
export function nextPlanForTeachers(limit: number): Tier | null {
  const order: Tier[] = ["pro_solo", "pro"];
  return order.find(t => CFG[t].maxTeachers === null || CFG[t].maxTeachers! > limit) ?? null;
}

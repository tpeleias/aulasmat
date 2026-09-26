// OS PLANOS DO CRONYS - o único lugar onde preço, limite e recurso são definidos.
//
// Quem lê daqui:
//   - o site e o app (src/lib/subscription.ts, src/hooks/usePlan.ts), pelo
//     atalho @shared/plans;
//   - as funções de cobrança (billing, stripe-webhook), por ../_shared/plans.ts;
//   - o banco: a função plan_features() é GERADA a partir deste arquivo
//     (npm run gen:plans) e o teste src/test/plans.test.ts falha se a última
//     migration que define plan_features() divergir daqui.
//
// Arquivo sem dependência nenhuma de propósito: roda no navegador, no Deno das
// funções e no Node dos scripts.
//
// Nomes internos (não mudam, estão no banco e no Stripe): essencial, start,
// pro_solo (= Pro) e pro (= Max).

export type PlanId = "essencial" | "start" | "pro_solo" | "pro";
export type PaidPlanId = Exclude<PlanId, "essencial">;
export type Currency = "BRL" | "USD" | "EUR" | "GBP";
export type Interval = "month" | "year";
/** O que se cobra: um plano, o profissional extra ou o adicional de IA. */
export type Item = PaidPlanId | "extra" | "assistant";

export const CURRENCIES: Currency[] = ["BRL", "USD", "EUR", "GBP"];

/** Cliente ativo: tem atendimento nos últimos N dias ou algum marcado para frente. */
export const ACTIVE_CLIENT_DAYS = 60;

/** Teste grátis de quem cria a empresa: o Pro, por N dias, sem cartão. Depois, Essencial. */
export const TRIAL_PLAN: PlanId = "pro_solo";
export const TRIAL_DAYS = 14;

/** O anual custa N mensalidades ("2 meses grátis", ~17% de desconto). */
export const ANNUAL_MONTHS_CHARGED = 10;

/** O adicional de IA (Start e Pro): mensagens por mês e o teto de custo que o acompanha. */
export const ASSISTANT_ADDON = { messages: 100, costCapUsd: 3 };

/** O cupom de lançamento (código LANCAMENTO no Stripe) vale só no mensal, e só nestas moedas. */
export const COUPON_CURRENCIES: Currency[] = ["BRL"];

/** Preço MENSAL de cada item, por moeda. O anual sai daqui (annualPrice). */
export const MONTHLY: Record<Currency, Record<Item, number>> = {
  BRL: { start: 29.9, pro_solo: 49.9, pro: 129.9, extra: 19.9, assistant: 24.9 },
  USD: { start: 8, pro_solo: 15, pro: 39, extra: 7, assistant: 9 },
  EUR: { start: 8, pro_solo: 15, pro: 39, extra: 7, assistant: 9 },
  GBP: { start: 7, pro_solo: 12, pro: 32, extra: 6, assistant: 8 },
};

export type PlanFeatures = {
  packages: boolean;
  recurring_blocks: boolean;
  vocabulary: boolean;
  whatsapp_link: boolean;
  /** Lembretes automáticos: ainda "em breve" nas telas. */
  whatsapp_auto: boolean;
  arrival_location: boolean;
  services_multi: boolean;
  teacher_services: boolean;
  any_teacher: boolean;
  /** Google Agenda: ocupado de lá bloqueia aqui, e os agendamentos vão para lá. */
  google_calendar: boolean;
};

export type PlanDef = {
  id: PlanId;
  name: { pt: string; en: string };
  /** Profissionais ativos no máximo; nulo = sem teto. */
  maxTeachers: number | null;
  /** Profissionais já pagos pelo plano; a partir daí, "profissional extra". */
  includedTeachers: number;
  /** Pode contratar profissional extra. */
  extraTeachers: boolean;
  /** Clientes ativos no máximo (ver ACTIVE_CLIENT_DAYS); nulo = sem teto. */
  maxActiveClients: number | null;
  /** Mensagens de IA por mês que o plano já traz (amostra no Pro, inclusas no Max). */
  assistantMessages: number;
  assistantCostCapUsd: number;
  /** O assistente do plano exige assinatura paga (Max); a amostra do Pro vale no teste. */
  assistantNeedsPayment: boolean;
  /** Pode contratar o adicional de IA. */
  assistantAddon: boolean;
  /** Franquia mensal de mensagens automáticas de WhatsApp. Nulo = ainda não existe. */
  autoMessagesQuota: number | null;
  features: PlanFeatures;
};

const PAID_FEATURES: PlanFeatures = {
  packages: true, recurring_blocks: true, vocabulary: true, whatsapp_link: true,
  whatsapp_auto: false, arrival_location: false, services_multi: true,
  teacher_services: false, any_teacher: false, google_calendar: false,
};

export const PLANS: Record<PlanId, PlanDef> = {
  essencial: {
    id: "essencial", name: { pt: "Essencial", en: "Essential" },
    maxTeachers: 1, includedTeachers: 1, extraTeachers: false, maxActiveClients: 10,
    assistantMessages: 0, assistantCostCapUsd: 0, assistantNeedsPayment: false, assistantAddon: false,
    autoMessagesQuota: null,
    features: {
      packages: false, recurring_blocks: false, vocabulary: true, whatsapp_link: false,
      whatsapp_auto: false, arrival_location: false, services_multi: false,
      teacher_services: false, any_teacher: false, google_calendar: false,
    },
  },
  start: {
    id: "start", name: { pt: "Start", en: "Start" },
    maxTeachers: 1, includedTeachers: 1, extraTeachers: false, maxActiveClients: 25,
    assistantMessages: 0, assistantCostCapUsd: 0, assistantNeedsPayment: false, assistantAddon: true,
    autoMessagesQuota: null,
    features: PAID_FEATURES,
  },
  pro_solo: {
    id: "pro_solo", name: { pt: "Pro", en: "Pro" },
    maxTeachers: 3, includedTeachers: 1, extraTeachers: true, maxActiveClients: null,
    assistantMessages: 20, assistantCostCapUsd: 0.6, assistantNeedsPayment: false, assistantAddon: true,
    autoMessagesQuota: null,
    features: { ...PAID_FEATURES, google_calendar: true },
  },
  pro: {
    id: "pro", name: { pt: "Max", en: "Max" },
    maxTeachers: null, includedTeachers: 5, extraTeachers: true, maxActiveClients: null,
    assistantMessages: 200, assistantCostCapUsd: 5, assistantNeedsPayment: true, assistantAddon: false,
    autoMessagesQuota: null,
    features: {
      ...PAID_FEATURES,
      whatsapp_auto: true, arrival_location: true, teacher_services: true, any_teacher: true,
      google_calendar: true,
    },
  },
};

export const PAID_PLANS: PaidPlanId[] = ["start", "pro_solo", "pro"];
/** Ordem de subida: o "plano seguinte" de cada um. */
export const PLAN_ORDER: PlanId[] = ["essencial", "start", "pro_solo", "pro"];

export function nextPlan(id: PlanId): PlanId | null {
  const i = PLAN_ORDER.indexOf(id);
  return i >= 0 && i < PLAN_ORDER.length - 1 ? PLAN_ORDER[i + 1] : null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function monthlyPrice(item: Item, currency: Currency): number {
  return MONTHLY[currency][item];
}

export function annualPrice(item: Item, currency: Currency): number {
  return round2(MONTHLY[currency][item] * ANNUAL_MONTHS_CHARGED);
}

export function price(item: Item, currency: Currency, interval: Interval): number {
  return interval === "year" ? annualPrice(item, currency) : monthlyPrice(item, currency);
}

/** O anual dividido por 12 ("equivale a R$ X/mês"). Não é parcelamento. */
export function annualMonthlyEquivalent(item: Item, currency: Currency): number {
  return round2(annualPrice(item, currency) / 12);
}

/** Em centavos, para o Stripe. */
export function priceCents(item: Item, currency: Currency, interval: Interval): number {
  return Math.round(price(item, currency, interval) * 100);
}

/** Mensagens de IA por mês: as do plano mais as do adicional, quando contratado. */
export function assistantMessages(plan: PlanId, addon: boolean): number {
  const p = PLANS[plan];
  return p.assistantMessages + (addon && p.assistantAddon ? ASSISTANT_ADDON.messages : 0);
}

/** Mensalidade de um plano com N profissionais ativos (os extras somados). */
export function teamMonthly(plan: PaidPlanId, teachers: number, currency: Currency): number {
  const p = PLANS[plan];
  const extras = p.extraTeachers ? Math.max(0, teachers - p.includedTeachers) : 0;
  return round2(MONTHLY[currency][plan] + extras * MONTHLY[currency].extra);
}

/**
 * Ao adicionar o N-ésimo profissional: cabe no plano atual? Se não cabe, ou
 * se o Max sai no mesmo preço ou mais barato com mais coisa, sugere o Max.
 */
export function teacherUpgrade(plan: PlanId, teachers: number): { fits: boolean; suggest: PlanId | null } {
  const p = PLANS[plan];
  const fits = p.maxTeachers === null || teachers <= p.maxTeachers;
  if (plan === "pro") return { fits, suggest: null };
  if (plan === "pro_solo") return { fits, suggest: teachers >= 4 ? "pro" : null };
  // Essencial e Start: um profissional só; o seguinte que aceita equipe é o Pro.
  return { fits, suggest: fits ? null : "pro_solo" };
}

/** O plano que o Stripe chama por este lookup_key (nulo para extra e IA). */
export const LOOKUP: Record<Item, Record<Interval, string>> = {
  start: { month: "cronys_start_mensal", year: "cronys_start_anual" },
  pro_solo: { month: "cronys_pro_solo_mensal", year: "cronys_pro_solo_anual" },
  pro: { month: "cronys_pro_equipe_mensal", year: "cronys_pro_equipe_anual" },
  extra: { month: "cronys_extra_mensal", year: "cronys_extra_anual" },
  assistant: { month: "cronys_assistente_mensal", year: "cronys_assistente_anual" },
};

/** Nome do produto no Stripe (o que aparece no checkout e na fatura). */
export const STRIPE_PRODUCT_NAME: Record<Item, string> = {
  start: "Cronys Start",
  pro_solo: "Cronys Pro",
  pro: "Cronys Max",
  extra: "Profissional extra",
  assistant: "Assistente Cronys (IA)",
};

export function itemOfLookup(key: string | null | undefined): { item: Item; interval: Interval } | null {
  if (!key) return null;
  for (const item of Object.keys(LOOKUP) as Item[]) {
    for (const interval of ["month", "year"] as Interval[]) {
      if (LOOKUP[item][interval] === key) return { item, interval };
    }
  }
  return null;
}

/** As colunas que o banco devolve em plan_features() - a forma é a mesma de antes, com os campos novos. */
export function planFeaturesJson(id: PlanId): Record<string, unknown> {
  const p = PLANS[id];
  return {
    nome: `Cronys ${p.name.pt}`,
    max_teachers: p.maxTeachers,
    included_teachers: p.includedTeachers,
    extra_teachers_allowed: p.extraTeachers,
    // Cadastro de cliente é livre; o que tem teto é cliente ATIVO.
    max_students: null,
    max_active_clients: p.maxActiveClients,
    active_client_days: ACTIVE_CLIENT_DAYS,
    assistant: false,
    assistant_included: p.assistantMessages > 0,
    assistant_messages: p.assistantMessages,
    assistant_cost_usd: p.assistantCostCapUsd,
    assistant_needs_payment: p.assistantNeedsPayment,
    assistant_addon: p.assistantAddon,
    assistant_addon_messages: ASSISTANT_ADDON.messages,
    assistant_addon_cost_usd: ASSISTANT_ADDON.costCapUsd,
    auto_messages_quota: p.autoMessagesQuota,
    ...p.features,
  };
}

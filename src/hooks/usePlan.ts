import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { L } from "@/lib/i18n";
import { PLANS as PLAN_CFG, planFeaturesJson, type PlanId } from "@shared/plans";
export type PlanSlug = "essencial" | "pro";

export type Plan = {
  plano: PlanSlug;
  nome: string;
  /** Nulo quer dizer ilimitado, e não zero. */
  max_teachers: number | null;
  max_students: number | null;
  assistant: boolean;
  /**
   * `true` = a Cronys liberou o assistente para esta empresa; `false` = não
   * liberou. Desde 20260924070000 nenhum plano traz o assistente sozinho.
   */
  assistant_override: boolean | null;
  packages: boolean;
  recurring_blocks: boolean;
  /** As palavras do ramo e as editadas. Sem isto, a tela fala genérico. */
  vocabulary?: boolean;
  /** Max de cortesia (testador) até esta data; nulo quando não é testador. */
  tester_until?: string | null;
  /** Fim do teste grátis do Pro; nulo quando não está em teste. */
  trial_ends_at?: string | null;
  /** Código que o cliente digita no cadastro pelo app (o apelido da empresa). */
  school_code?: string | null;
  /**
   * A faixa exata (migration 20260925010000). `plano` continua "pro" nas duas
   * faixas pagas, que é o que o app antigo entende; aqui se separa Pro (pro_solo) de Max (pro).
   */
  tier?: PlanId;
  /** Clientes ativos no máximo (nulo = ilimitado) e quantos há agora (migration 20260926100000). */
  max_active_clients?: number | null;
  active_client_days?: number;
  active_clients?: number;
  /** Mensagens de IA que o plano traz (amostra no Pro, inclusas no Max). */
  assistant_messages?: number;
  /** O plano aceita o adicional de IA (Start e Pro). */
  assistant_addon?: boolean;
  /** O plano aceita profissional extra (Pro e Max). */
  extra_teachers_allowed?: boolean;
  included_teachers?: number;
  /** none | active | past_due | canceled - a assinatura no Stripe. */
  billing_status?: string;
  billing_interval?: string | null;
  paid_until?: string | null;
  /** Até quando a assinatura atrasada segue valendo. */
  grace_until?: string | null;
  extra_teachers?: number;
  assistant_usage?: { used: number; limit: number; allowed: boolean } | null;
  /** O adicional do assistente está à venda (assistant_on_sale() no banco). */
  assistant_on_sale?: boolean;
  /** O assistente desta empresa veio do adicional comprado, e não de cortesia. */
  assistant_billed?: boolean;
  /** Max: o assistente vem incluso quando a assinatura está paga (migration 20260925070000). */
  assistant_included?: boolean;
  /** Pro e Max: lembrete e confirmação pelo WhatsApp de um toque. */
  whatsapp_link?: boolean;
  /** Max: o Cronys manda sozinho (em construção). */
  whatsapp_auto?: boolean;
  /** Max: "Estou a caminho" com a localização. */
  arrival_location?: boolean;
  /** Pro e Max: vários serviços (no Essencial, um). */
  services_multi?: boolean;
  /** Max: cada profissional com os próprios serviços. */
  teacher_services?: boolean;
  /** Max: a família pede "qualquer profissional", pela prioridade do admin. */
  any_teacher?: boolean;
};

// O que uma empresa sem resposta do banco enxerga. Fecha, não abre: mostrar a
// tela de venda para quem tem Pro é um aborrecimento; liberar o que é pago
// para quem não tem é um furo.
export const PLANO_DESCONHECIDO: Plan = {
  ...(planFeaturesJson("essencial") as Partial<Plan>),
  plano: "essencial",
  tier: "essencial",
  nome: "Cronys Essencial",
  max_teachers: 1,
  max_students: null,
  assistant: false,
  assistant_override: null,
  packages: false,
  recurring_blocks: false,
} as Plan;

let cached: Plan | null = null;

export function primePlan(p: Plan) { cached = p; }

/** O nome do plano na língua da empresa. */
export function planName(tier: string): string {
  const p = PLAN_CFG[(tier in PLAN_CFG ? tier : "essencial") as PlanId];
  return `Cronys ${L(p.name.pt, p.name.en)}`;
}

/** Esquece o plano guardado (depois de assinar, por exemplo) - a próxima tela relê. */
export function forgetPlan() { cached = null; }

/**
 * O plano da empresa de quem está logado.
 *
 * `loading` importa: enquanto ele for true a tela não deve dizer "você não
 * tem", porque ainda não sabe. Quem usa isto para esconder botão espera o
 * carregamento antes de mostrar a tela de venda.
 *
 * Isto é para a TELA. Quem impede de verdade é o banco - os limites e as
 * travas estão em gatilhos e funções (migration 20260921160000), e a tela só
 * evita que a pessoa esbarre neles sem entender por quê.
 */
export function usePlan() {
  const [plan, setPlan] = useState<Plan>(cached ?? PLANO_DESCONHECIDO);
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
    let alive = true;
    supabase.rpc("my_plan").then(({ data }) => {
      if (!alive) return;
      if (data && typeof data === "object") {
        const p = { ...PLANO_DESCONHECIDO, ...(data as Partial<Plan>) } as Plan;
        // O nome vem do banco em português; na língua da empresa, pela faixa.
        p.nome = planName(p.tier ?? (p.plano === "pro" ? "pro" : "essencial"));
        cached = p;
        setPlan(p);
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  return { plan, loading, isPro: plan.plano === "pro" };
}

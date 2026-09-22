import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PlanSlug = "essencial" | "pro";

export type Plan = {
  plano: PlanSlug;
  nome: string;
  /** Nulo quer dizer ilimitado, e não zero. */
  max_teachers: number | null;
  max_students: number | null;
  assistant: boolean;
  /**
   * Por que o assistente está como está:
   * `null` segue o plano, `false` a Cronys desligou à mão, `true` a Cronys
   * ligou à mão. É isso que decide se a tela VENDE o Pro ou AVISA que foi
   * desligado - mostrar a venda para quem já é Pro seria mentira.
   */
  assistant_override: boolean | null;
  packages: boolean;
  recurring_blocks: boolean;
};

// O que uma empresa sem resposta do banco enxerga. Fecha, não abre: mostrar a
// tela de venda para quem tem Pro é um aborrecimento; liberar o que é pago
// para quem não tem é um furo.
export const PLANO_DESCONHECIDO: Plan = {
  plano: "essencial",
  nome: "Cronys Essencial",
  max_teachers: 1,
  max_students: 5,
  assistant: false,
  assistant_override: null,
  packages: false,
  recurring_blocks: false,
};

let cached: Plan | null = null;

export function primePlan(p: Plan) { cached = p; }

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
        cached = p;
        setPlan(p);
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  return { plan, loading, isPro: plan.plano === "pro" };
}

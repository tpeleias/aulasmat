// Gera o SQL de plan_features() a partir de supabase/functions/_shared/plans.ts.
// O banco não lê TypeScript; então a função dele é escrita por aqui
// (npm run gen:plans) e o teste src/test/plans.test.ts confere que a última
// migration que a define é exatamente isto.
import { PLANS, TRIAL_DAYS, planFeaturesJson, type PlanId } from "@shared/plans";

export const PLAN_SQL_BEGIN = "-- >>> plan_features: GERADO por `npm run gen:plans` a partir de supabase/functions/_shared/plans.ts. Não edite à mão.";
export const PLAN_SQL_END = "-- <<< plan_features";

function literal(id: PlanId): string {
  const json = planFeaturesJson(id);
  const sorted = Object.fromEntries(Object.keys(json).sort().map(k => [k, json[k]]));
  return `'${JSON.stringify(sorted).replace(/'/g, "''")}'::jsonb`;
}

export function planFeaturesSql(): string {
  const paid = (Object.keys(PLANS) as PlanId[]).filter(id => id !== "essencial");
  return [
    PLAN_SQL_BEGIN,
    "CREATE OR REPLACE FUNCTION public.plan_features(_plan text)",
    "RETURNS jsonb",
    "LANGUAGE sql IMMUTABLE",
    "SET search_path TO 'public'",
    "AS $$",
    "  SELECT CASE _plan",
    ...paid.map(id => `    WHEN '${id}' THEN ${literal(id)}`),
    `    ELSE ${literal("essencial")}`,
    "  END",
    "$$;",
    "",
    "CREATE OR REPLACE FUNCTION public.plan_trial_days()",
    "RETURNS integer",
    "LANGUAGE sql IMMUTABLE",
    "SET search_path TO 'public'",
    `AS $$ SELECT ${TRIAL_DAYS} $$;`,
    PLAN_SQL_END,
  ].join("\n");
}

// npm run gen:plans - imprime o SQL de plan_features() gerado de
// supabase/functions/_shared/plans.ts, para colar numa migration nova.
import { planFeaturesSql } from "../src/lib/planSql";

console.log(planFeaturesSql());

import { differenceInCalendarDays, format } from "date-fns";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { usePlan } from "@/hooks/usePlan";
import { canSellHere } from "@/lib/subscription";

import { L } from "@/lib/i18n";
/**
 * Aviso do teste grátis do Pro, para a escola que se cadastrou sozinha.
 *
 * Como o ProUpsell, não tem botão de compra (regra da Google Play para bem
 * digital vendido fora da cobrança dela): só avisa até quando vai e o que
 * acontece depois. No site, leva para /assinar.
 */
export default function TrialBanner() {
  const { plan, loading } = usePlan();
  if (!loading && plan.tester_until && plan.billing_status !== "active") return <TesterBanner until={plan.tester_until} />;
  if (loading || !plan.trial_ends_at || plan.plano !== "pro") return null;
  const end = new Date(plan.trial_ends_at);
  const days = differenceInCalendarDays(end, new Date());
  if (Number.isNaN(days) || days < 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div>
        <div className="font-medium">
          {L("Teste grátis do Cronys Pro até", "Cronys Pro free trial until")} {format(end, L("dd/MM", "MMM d"))}
          {days === 0 ? L(" (termina hoje)", " (ends today)") : L(` (${days} dia${days === 1 ? "" : "s"})`, ` (${days} day${days === 1 ? "" : "s"})`)}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {L("Depois disso a conta passa para o Essencial: nada é apagado, e o que passar do limite fica pausado até você escolher o que liberar.",
             "After that your account moves to Essential: nothing is deleted, and anything over the limit is paused until you choose what to keep.")}
          {canSellHere() && <> <Link to="/assinar" className="font-medium text-primary underline">{L("Assinar agora", "Subscribe now")}</Link></>}
        </p>
      </div>
    </div>
  );
}

/** Max de cortesia dado pelo gestor (testador): até quando vai. */
function TesterBanner({ until }: { until: string }) {
  const end = new Date(until);
  const days = differenceInCalendarDays(end, new Date());
  if (Number.isNaN(days) || days < 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div>
        <div className="font-medium">
          {L("Cronys Max de cortesia até", "Complimentary Cronys Max until")} {format(end, L("dd/MM", "MMM d"))}
          {days === 0 ? L(" (termina hoje)", " (ends today)") : L(` (${days} dia${days === 1 ? "" : "s"})`, ` (${days} day${days === 1 ? "" : "s"})`)}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {L("Obrigado por testar! Depois disso a conta passa para o Essencial: nada é apagado, e o que passar do limite fica pausado até você escolher o que liberar.",
             "Thanks for testing! After that your account moves to Essential: nothing is deleted, and anything over the limit is paused until you choose what to keep.")}
          {canSellHere() && <> <Link to="/assinar" className="font-medium text-primary underline">{L("Assinar", "Subscribe")}</Link></>}
        </p>
      </div>
    </div>
  );
}

import { differenceInCalendarDays, format } from "date-fns";
import { Sparkles } from "lucide-react";
import { usePlan } from "@/hooks/usePlan";

/**
 * Aviso do teste grátis do Pro, para a escola que se cadastrou sozinha.
 *
 * Como o ProUpsell, não tem botão de compra (regra da Google Play para bem
 * digital vendido fora da cobrança dela): só avisa até quando vai e o que
 * acontece depois.
 */
export default function TrialBanner() {
  const { plan, loading } = usePlan();
  if (loading || !plan.trial_ends_at || plan.plano !== "pro") return null;
  const end = new Date(plan.trial_ends_at);
  const days = differenceInCalendarDays(end, new Date());
  if (Number.isNaN(days) || days < 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div>
        <div className="font-medium">
          Teste grátis do Cronys Pro até {format(end, "dd/MM")}
          {days === 0 ? " (termina hoje)" : ` (${days} dia${days === 1 ? "" : "s"})`}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Depois disso a conta passa para o Essencial: nada é apagado, e o que passar do limite fica
          pausado até você escolher o que liberar.
        </p>
      </div>
    </div>
  );
}

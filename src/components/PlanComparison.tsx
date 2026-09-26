import { Check, Minus } from "lucide-react";
import { PLANS_CARDS, comparisonRows, type Interval } from "@/lib/subscription";
import { L } from "@/lib/i18n";

/** A tabela "o que cada plano tem", montada do arquivo de planos. */
export function PlanComparison({ interval }: { interval: Interval }) {
  const rows = comparisonRows(interval);
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            <th className="p-3 font-medium">{L("Compare", "Compare")}</th>
            {PLANS_CARDS.map(p => <th key={p.tier} className="p-3 text-center font-semibold">{p.nome}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-b border-border last:border-0">
              <td className="p-3 text-muted-foreground">{r.label}</td>
              {PLANS_CARDS.map(p => {
                const v = r.values[p.tier];
                return (
                  <td key={p.tier} className="p-3 text-center">
                    {v === true ? <Check className="mx-auto h-4 w-4 text-primary" aria-label={L("sim", "yes")} />
                      : v === false ? <Minus className="mx-auto h-4 w-4 text-muted-foreground/60" aria-label={L("não", "no")} />
                      : v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

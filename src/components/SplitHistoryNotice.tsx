import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useWords } from "@/hooks/useVocabulary";
import { haptics } from "@/lib/haptics";
import { fmtMoney } from "@/lib/balance";
import { L } from "@/lib/i18n";

/**
 * Conta que ficou separada (10/10): o Rafael foi cadastrado sem responsável,
 * teve aulas e pagamentos, e só depois ganhou a responsável. O histórico
 * antigo ficou numa conta à parte. Agora, mudar o cadastro já leva o
 * histórico junto; este aviso resolve o que se separou antes, com um toque.
 */
export type SplitHistory = {
  student_id: string; student_name: string; guardian_name: string | null;
  from_guardian: string | null; lessons: number; transactions: number; balance: number;
};

export default function SplitHistoryNotice({ onMerged }: { onMerged?: () => void }) {
  const w = useWords();
  const ap = w.appointment;
  const [items, setItems] = useState<SplitHistory[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.rpc("split_client_histories" as never);
    setItems(error || !Array.isArray(data) ? [] : (data as SplitHistory[]));
  };
  useEffect(() => { load(); }, []);

  if (!items.length) return null;

  const where = (g: string | null, student: string) => g ? L(`na conta de ${g}`, `in ${g}'s account`) : L(`na conta de ${student} (sem ${w.guardian.l})`, `in ${student}'s account (no ${w.guardian.l})`);

  const merge = async (it: SplitHistory) => {
    haptics.tap();
    setBusy(it.student_id + (it.from_guardian ?? ""));
    const { error } = await supabase.rpc("merge_client_history" as never, { _student_id: it.student_id, _from_guardian: it.from_guardian } as never);
    setBusy(null);
    if (error) { haptics.warning(); toast.error(L("Não deu para juntar agora. Tente de novo.", "Couldn't merge now. Try again.")); return; }
    haptics.success();
    toast.success(L(`Pronto! Tudo de ${it.student_name} está numa conta só.`, `Done! Everything for ${it.student_name} is in one account.`));
    await load();
    onMerged?.();
  };

  return (
    <div className="space-y-2">
      {items.map(it => {
        const key = it.student_id + (it.from_guardian ?? "");
        const target = it.guardian_name ?? it.student_name;
        const parts = [
          it.lessons ? `${it.lessons} ${it.lessons === 1 ? ap.l : ap.lp}` : "",
          it.transactions ? L(`${it.transactions} ${it.transactions === 1 ? "lançamento" : "lançamentos"}`, `${it.transactions} ${it.transactions === 1 ? "entry" : "entries"}`) : "",
        ].filter(Boolean).join(L(" e ", " and "));
        return (
          <div key={key} className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-start gap-3">
              <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-semibold">{L(`O histórico de ${it.student_name} ficou separado`, `${it.student_name}'s history got split`)}</p>
                <p className="text-sm text-muted-foreground">
                  {L(`Há ${parts} ${where(it.from_guardian, it.student_name)}, de antes de mudar o cadastro`, `There are ${parts} ${where(it.from_guardian, it.student_name)}, from before the profile changed`)}
                  {Math.abs(it.balance) >= 0.01 ? L(` (saldo ${fmtMoney(it.balance)})`, ` (balance ${fmtMoney(it.balance)})`) : ""}.
                  {" "}{L(`Juntando, tudo passa para a conta de ${target}, como está no cadastro.`, `Merging moves everything to ${target}'s account, as in the profile.`)}
                </p>
                <Button size="sm" className="mt-1 rounded-xl" disabled={busy === key} onClick={() => merge(it)}>
                  {busy === key ? L("Juntando…", "Merging…") : L(`Juntar na conta de ${target}`, `Merge into ${target}'s account`)}
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

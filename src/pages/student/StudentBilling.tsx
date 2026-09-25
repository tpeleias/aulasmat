import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { PaymentMethods } from "@/components/PaymentMethods";
import { scopeToAccount, fmtMoney } from "@/lib/balance";
import { computeStatements, type LedgerTx, type LedgerLesson } from "@/lib/billing";
import { useWords } from "@/hooks/useVocabulary";

import { L } from "@/lib/i18n";
const fmt = (v: number) => fmtMoney(v);

export default function StudentBilling() {
  const { student } = useStudent();
  const w = useWords();
  const ap = w.appointment;
  const settings = useAppSettings();
  const [txs, setTxs] = useState<any[]>([]);
  const [lessons, setLessons] = useState<any[]>([]);

  useEffect(() => {
    if (!student) return;
    scopeToAccount(supabase.from("wallet_transactions").select("*"), student)
      .order("created_at", { ascending: false }).then(({ data }) => setTxs(data ?? []));
    scopeToAccount(supabase.from("lessons").select("*"), student)
      .eq("status", "realizada").then(({ data }) => setLessons(data ?? []));
  }, [student]);

  // Same ledger rule as the teacher's screen: money received pays the oldest lesson first,
  // so what is listed adds up to exactly what is owed.
  const statement = useMemo(
    () => computeStatements(txs as LedgerTx[], lessons as LedgerLesson[], w)[0] ?? null,
    [txs, lessons, w]
  );
  const owed = statement?.owed ?? 0;
  const credit = statement && statement.balance > 0 ? statement.balance : 0;
  const openItems = statement?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{L("Financeiro", "Billing")}</h1>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">{L("Em aberto", "Outstanding")}</div>
          <div className={`text-2xl font-bold tabular-nums ${owed > 0 ? "text-destructive" : ""}`}>{fmt(owed)}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">{L("Crédito", "Credit")}</div>
          <div className="text-2xl font-bold tabular-nums">{fmt(credit)}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">{L(`${ap.p} ${ap.pick("realizados", "realizadas")}`, `${ap.p} done`)}</div>
          <div className="text-2xl font-bold tabular-nums">{lessons.length}</div>
        </Card>
      </div>

      {openItems.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">{L(`${ap.p} em aberto`, `Outstanding ${ap.lp}`)}</h2>
          <div className="space-y-2">
            {openItems.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm first:border-0 first:pt-0">
                <div>
                  <div>{format(new Date(i.date), L("dd/MM/yyyy 'às' HH:mm", "MMM d, yyyy 'at' HH:mm"))}</div>
                  <div className="text-xs text-muted-foreground">{i.detail}{i.partial ? L(" · saldo restante", " · remaining balance") : ""}</div>
                </div>
                <Badge variant="destructive">{fmtMoney(i.amount)}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {settings?.show_payment_info_to_students && (settings.pix_key || settings.payment_link) && (
        <Card className="p-5 space-y-3 border-primary/40">
          <h2 className="font-semibold">{L("Como pagar", "How to pay")}</h2>
          <PaymentMethods settings={settings} amount={owed} />
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-semibold mb-3">{L("Extrato", "Statement")}</h2>
        {txs.length === 0 && <p className="text-sm text-muted-foreground">{L("Nenhum lançamento.", "No entries.")}</p>}
        <div className="space-y-2">
          {txs.map(t => (
            <div key={t.id} className="flex items-center justify-between border-t border-border pt-2 first:border-0 first:pt-0 text-sm">
              <div>
                <div>{t.description ?? (t.kind === "lesson" ? ap.s : t.kind === "voucher" ? "Voucher" : t.kind === "package" ? L("Pacote", "Package") : L("Lançamento", "Entry"))}</div>
                <div className="text-xs text-muted-foreground">{format(new Date(t.created_at), L("dd/MM/yyyy HH:mm", "MMM d, yyyy HH:mm"))}</div>
              </div>
              <Badge variant={Number(t.amount) >= 0 ? "default" : "destructive"}>{fmt(Number(t.amount))}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

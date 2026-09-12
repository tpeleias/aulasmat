import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { PaymentMethods } from "@/components/PaymentMethods";
import { scopeToAccount, fmtMoney } from "@/lib/balance";
import { computeStatements, type LedgerTx, type LedgerLesson } from "@/lib/billing";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function StudentBilling() {
  const { student } = useStudent();
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
    () => computeStatements(txs as LedgerTx[], lessons as LedgerLesson[])[0] ?? null,
    [txs, lessons]
  );
  const owed = statement?.owed ?? 0;
  const credit = statement && statement.balance > 0 ? statement.balance : 0;
  const openItems = statement?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Financeiro</h1>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Em aberto</div>
          <div className={`text-2xl font-bold tabular-nums ${owed > 0 ? "text-destructive" : ""}`}>{fmt(owed)}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Crédito</div>
          <div className="text-2xl font-bold tabular-nums">{fmt(credit)}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Aulas realizadas</div>
          <div className="text-2xl font-bold tabular-nums">{lessons.length}</div>
        </Card>
      </div>

      {openItems.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Aulas em aberto</h2>
          <div className="space-y-2">
            {openItems.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm first:border-0 first:pt-0">
                <div>
                  <div>{format(new Date(i.date), "dd/MM/yyyy 'às' HH:mm")}</div>
                  <div className="text-xs text-muted-foreground">{i.detail}{i.partial ? " · saldo restante" : ""}</div>
                </div>
                <Badge variant="destructive">{fmtMoney(i.amount)}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {settings?.show_payment_info_to_students && (settings.pix_key || settings.payment_link) && (
        <Card className="p-5 space-y-3 border-primary/40">
          <h2 className="font-semibold">Como pagar</h2>
          <PaymentMethods pixKey={settings.pix_key} paymentLink={settings.payment_link} />
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Extrato</h2>
        {txs.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>}
        <div className="space-y-2">
          {txs.map(t => (
            <div key={t.id} className="flex items-center justify-between border-t border-border pt-2 first:border-0 first:pt-0 text-sm">
              <div>
                <div>{t.description ?? (t.kind === "lesson" ? "Aula" : t.kind === "voucher" ? "Voucher" : t.kind === "package" ? "Pacote" : "Lançamento")}</div>
                <div className="text-xs text-muted-foreground">{format(new Date(t.created_at), "dd/MM/yyyy HH:mm")}</div>
              </div>
              <Badge variant={Number(t.amount) >= 0 ? "default" : "destructive"}>{fmt(Number(t.amount))}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

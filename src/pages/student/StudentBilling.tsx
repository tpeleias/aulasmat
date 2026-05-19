import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { PaymentMethods } from "@/components/PaymentMethods";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function StudentBilling() {
  const { student } = useStudent();
  const settings = useAppSettings();
  const [txs, setTxs] = useState<any[]>([]);

  useEffect(() => {
    if (!student) return;
    supabase.from("wallet_transactions").select("*").eq("student_name", student.student_name).order("created_at", { ascending: false }).then(({ data }) => setTxs(data ?? []));
  }, [student]);

  const balance = useMemo(() => txs.reduce((s, t) => s + Number(t.amount), 0), [txs]);
  const credits = txs.filter(t => t.kind !== "lesson");
  const debits = txs.filter(t => t.kind === "lesson");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Financeiro</h1>

      <div className="grid md:grid-cols-3 gap-3">
        <Card className="p-5"><div className="text-xs text-muted-foreground">Saldo atual</div><div className={`text-2xl font-bold ${balance < 0 ? "text-destructive" : ""}`}>{fmt(balance)}</div></Card>
        <Card className="p-5"><div className="text-xs text-muted-foreground">Total em créditos</div><div className="text-2xl font-bold">{fmt(credits.reduce((s, t) => s + Number(t.amount), 0))}</div></Card>
        <Card className="p-5"><div className="text-xs text-muted-foreground">Aulas debitadas</div><div className="text-2xl font-bold">{debits.length}</div></Card>
      </div>

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
                <div>{t.description ?? (t.kind === "lesson" ? "Aula" : t.kind)}</div>
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

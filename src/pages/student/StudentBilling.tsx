import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { PaymentMethods } from "@/components/PaymentMethods";
import { scopeToAccount, fmtMoney } from "@/lib/balance";
import { computeStatements, type LedgerTx, type LedgerLesson } from "@/lib/billing";
import { useWords } from "@/hooks/useVocabulary";
import AccountLedger from "@/components/AccountLedger";
import { Button } from "@/components/ui/button";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { payAction, payErrorText, useOnlinePayments } from "@/lib/onlinePayments";
import { openExternal } from "@/lib/whatsapp";
import { buildLedger, currentPurchase, type PackagePurchase, type PackageUse } from "@/lib/ledger";

import { L } from "@/lib/i18n";
const fmt = (v: number) => fmtMoney(v);

export default function StudentBilling() {
  const { student } = useStudent();
  const w = useWords();
  const ap = w.appointment;
  const settings = useAppSettings();
  const [txs, setTxs] = useState<any[]>([]);
  const [lessons, setLessons] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<PackagePurchase[]>([]);
  const [uses, setUses] = useState<PackageUse[]>([]);

  useEffect(() => {
    if (!student) return;
    scopeToAccount(supabase.from("wallet_transactions").select("*"), student)
      .order("created_at", { ascending: false }).then(({ data }) => setTxs(data ?? []));
    scopeToAccount(supabase.from("lessons").select("*"), student)
      .eq("status", "realizada").then(({ data }) => setLessons(data ?? []));
    // Pacotes por aulas (08/10): a família lê só as próprias compras (RLS).
    scopeToAccount(supabase.from("package_purchases" as never).select("*"), student)
      .then(({ data, error }: { data: unknown; error: unknown }) => setPurchases(error ? [] : ((data ?? []) as PackagePurchase[])));
    supabase.from("package_uses" as never).select("purchase_id, lesson_id, sessions")
      .then(({ data, error }) => setUses(error ? [] : ((data ?? []) as unknown as PackageUse[])));
  }, [student]);

  // Same ledger rule as the teacher's screen: money received pays the oldest lesson first,
  // so what is listed adds up to exactly what is owed.
  const statement = useMemo(
    () => computeStatements(txs as LedgerTx[], lessons as LedgerLesson[], w)[0] ?? null,
    [txs, lessons, w]
  );
  const owed = statement?.owed ?? 0;
  const credit = statement && statement.balance > 0 ? statement.balance : 0;
  // As mesmas abas do Financeiro do professor (08/10), sem os botões de editar.
  const ledger = useMemo(() => buildLedger(txs as LedgerTx[], lessons as LedgerLesson[], {
    appointment: ap.s, entry: L("Lançamento", "Entry"), payment: L("Pagamento", "Payment"),
    package: L("Pacote", "Package"), voucher: "Voucher", leftover: L("Sobra de desconto", "Leftover discount"), adjustment: L("Ajuste", "Adjustment"),
  }, { purchases, uses }), [txs, lessons, ap, purchases, uses]);
  const pkg = currentPurchase(ledger.packages);
  // Pagamento on-line pelo Stripe da empresa (09/10): só aparece se ela conectou.
  const online = useOnlinePayments();
  const [paying, setPaying] = useState(false);
  const payNow = async () => {
    setPaying(true);
    const r = await payAction<{ url: string }>({ action: "checkout" });
    setPaying(false);
    if (!r.ok || !r.data?.url) { toast.error(payErrorText(r.error)); return; }
    if (!openExternal(r.data.url)) window.location.href = r.data.url;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{L("Financeiro", "Billing")}</h1>

      {pkg && (
        <Card className="flex items-center justify-between gap-3 border-primary/40 bg-primary/5 p-5">
          <div>
            <div className="text-xs text-muted-foreground">{pkg.name}</div>
            <div className="text-2xl font-bold tabular-nums text-primary">
              {L(`Restam ${String(pkg.left).replace(".", ",")} ${pkg.left === 1 ? ap.l : ap.lp}`, `${pkg.left} ${pkg.left === 1 ? ap.l : ap.lp} left`)}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">{L(`de ${pkg.sessions}`, `of ${pkg.sessions}`)}</div>
        </Card>
      )}

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

      {online.connected && owed > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 p-5">
          <div>
            <div className="font-semibold">{L("Pagar agora", "Pay now")}</div>
            <div className="text-sm text-muted-foreground">{L(`${fmt(owed)} no cartão ou no Pix. O pagamento entra sozinho e você recebe o recibo.`, `${fmt(owed)} by card or Pix. It's recorded automatically and you get the receipt.`)}</div>
          </div>
          <Button size="lg" disabled={paying} onClick={payNow} className="gap-2"><CreditCard className="h-5 w-5" /> {paying ? L("Abrindo…", "Opening…") : L("Pagar com cartão ou Pix", "Pay by card or Pix")}</Button>
        </Card>
      )}

      {settings?.show_payment_info_to_students && (settings.pix_key || settings.payment_link) && (
        <Card className="p-5 space-y-3 border-primary/40">
          <h2 className="font-semibold">{L("Como pagar", "How to pay")}</h2>
          <PaymentMethods settings={settings} amount={owed} />
        </Card>
      )}

      <Card className="p-4 md:p-5">
        <h2 className="mb-3 font-semibold">{L("Extrato", "Statement")}</h2>
        <AccountLedger ledger={ledger} defaultTab={owed > 0 ? "lessons" : "payments"} />
      </Card>
    </div>
  );
}

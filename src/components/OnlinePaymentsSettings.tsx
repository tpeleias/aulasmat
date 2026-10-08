import { useState } from "react";
import { CheckCircle2, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { L } from "@/lib/i18n";
import { payAction, payErrorText, useOnlinePayments } from "@/lib/onlinePayments";

/**
 * Conectar o Stripe da empresa (09/10). Só aparece para empresa com a função
 * liberada (accounts.online_payments). A chave vai direto para o cofre pela
 * função "pay"; a tela nunca a lê de volta.
 */
export default function OnlinePaymentsSettings() {
  const { allowed, connected, loaded, reload } = useOnlinePayments();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!loaded || !allowed) return null;

  const connect = async () => {
    setBusy(true);
    const r = await payAction<{ test: boolean; name: string | null }>({ action: "connect", key: key.trim() });
    setBusy(false);
    if (!r.ok) { toast.error(payErrorText(r.error)); return; }
    toast.success(L(`Stripe conectado${r.data.name ? ` (${r.data.name})` : ""}${r.data.test ? " em modo de teste" : ""}`, `Stripe connected${r.data.name ? ` (${r.data.name})` : ""}${r.data.test ? " in test mode" : ""}`));
    setKey(""); setEditing(false);
    reload();
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">{L("Pagamento on-line (Stripe)", "Online payment (Stripe)")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {L("As famílias recebem um link \"Pagar com cartão ou Pix\" com o valor em aberto, no e-mail de cobrança e na mensagem do WhatsApp, e podem pagar pelo portal. Quando o pagamento cai, ele entra sozinho no Financeiro e a família recebe o recibo.",
           "Families get a \"Pay by card or Pix\" link with the open amount, in the billing email and the WhatsApp message, and can pay in the portal. When the payment lands it goes into Billing by itself and the family gets the receipt.")}
      </p>
      {connected && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success/10 px-3 py-2">
          <span className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" /> {L("Stripe conectado", "Stripe connected")}</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{L("Trocar a chave", "Change key")}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="stripe-key">{L("Chave secreta do Stripe", "Stripe secret key")}</Label>
          <Input id="stripe-key" type="password" autoComplete="off" placeholder="sk_test_... ou sk_live_..." value={key} onChange={e => setKey(e.target.value)} />
          <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
            <li>{L("No Stripe da empresa: Desenvolvedores → Chaves de API → Chave secreta → Revelar e copiar.", "In your company's Stripe: Developers → API keys → Secret key → Reveal and copy.")}</li>
            <li>{L("Para aceitar Pix: Configurações → Formas de pagamento → Pix → Ativar.", "To accept Pix: Settings → Payment methods → Pix → Turn on.")}</li>
            <li>{L("Comece com a chave de teste (sk_test_); quando estiver tudo certo, troque pela real (sk_live_).", "Start with the test key (sk_test_); when all is good, switch to the live one (sk_live_).")}</li>
          </ol>
          <div className="flex gap-2">
            <Button onClick={connect} disabled={busy || !key.trim()}>{busy ? L("Conectando…", "Connecting…") : L("Conectar", "Connect")}</Button>
            {connected && <Button variant="ghost" onClick={() => { setEditing(false); setKey(""); }}>{L("Cancelar", "Cancel")}</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

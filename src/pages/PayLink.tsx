import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, CreditCard, Lock, PartyPopper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CronysWordmark } from "@/components/brand";
import { fmtMoney } from "@/lib/balance";
import { L } from "@/lib/i18n";

/**
 * O link curto de pagamento (09/10): cronys.com.br/pagar/<código>. Mostra de
 * quem é a cobrança e o valor em aberto de agora, e só abre o Stripe ou o
 * Asaas da empresa quando a pessoa toca em "Pagar" (função "pay").
 */
type Info = { ok: boolean; error?: string; company?: string; name?: string; owed?: number; items?: number; available?: boolean };
type State = "loading" | "ready" | "paid" | "settled" | "unavailable" | "invalid";

export default function PayLink() {
  const { code = "" } = useParams();
  const [params] = useSearchParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<State>("loading");
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = L("Pagamento", "Payment");
    (async () => {
      const { data, error } = await supabase.functions.invoke("pay", { body: { action: "info", code } });
      const d = data as Info | null;
      if (error || !d?.ok) { setState(d?.error === "not_enabled" ? "unavailable" : "invalid"); return; }
      setInfo(d);
      if (d.company) document.title = L(`Pagamento · ${d.company}`, `Payment · ${d.company}`);
      if (params.get("pago") === "1") setState("paid");
      else if ((d.owed ?? 0) <= 0) setState("settled");
      else setState(d.available ? "ready" : "unavailable");
    })();
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setOpening(true); setFailed(false);
    const { data, error } = await supabase.functions.invoke("pay", { body: { action: "open", code } });
    const d = data as { ok?: boolean; url?: string; error?: string } | null;
    if (error || !d?.ok || !d.url) {
      setOpening(false);
      if (d?.error === "nothing_owed") { setState("settled"); return; }
      setFailed(true);
      return;
    }
    window.location.href = d.url;
  };

  const company = info?.company ?? "";
  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-5">
        <Card className="space-y-5 p-6 text-center">
          {state === "loading" && <p className="py-8 text-sm text-muted-foreground">{L("Carregando…", "Loading…")}</p>}

          {state === "invalid" && (
            <div className="space-y-2 py-4">
              <h1 className="text-xl font-bold">{L("Link inválido", "Invalid link")}</h1>
              <p className="text-sm text-muted-foreground">{L("Este link de pagamento não existe. Peça um novo a quem enviou.", "This payment link doesn't exist. Ask the sender for a new one.")}</p>
            </div>
          )}

          {company && state !== "invalid" && (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{L("Pagamento para", "Payment to")}</div>
              <div className="text-xl font-bold">{company}</div>
            </div>
          )}

          {state === "ready" && info && (
            <>
              <div className="rounded-2xl bg-primary/10 px-4 py-5">
                <div className="text-sm text-muted-foreground">{info.name ? L(`Olá, ${info.name}! Valor em aberto`, `Hi ${info.name}! Amount due`) : L("Valor em aberto", "Amount due")}</div>
                <div className="mt-1 text-4xl font-bold tabular-nums text-primary">{fmtMoney(info.owed ?? 0)}</div>
                {!!info.items && <div className="mt-1 text-xs text-muted-foreground">{L(`${info.items} ${info.items === 1 ? "item" : "itens"} em aberto`, `${info.items} open ${info.items === 1 ? "item" : "items"}`)}</div>}
              </div>
              <Button size="lg" className="w-full gap-2" disabled={opening} onClick={pay}>
                <CreditCard className="h-5 w-5" /> {opening ? L("Abrindo o pagamento…", "Opening payment…") : L("Pagar com cartão ou Pix", "Pay by card or Pix")}
              </Button>
              {failed && <p className="text-sm text-destructive">{L("Não deu para abrir agora. Tente de novo em instantes.", "Couldn't open it now. Try again shortly.")}</p>}
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" /> {L("Pagamento seguro. O recibo chega por e-mail.", "Secure payment. The receipt arrives by email.")}</p>
            </>
          )}

          {state === "paid" && (
            <div className="space-y-2 py-2">
              <PartyPopper className="mx-auto h-10 w-10 text-primary" />
              <h1 className="text-xl font-bold">{L("Pagamento recebido!", "Payment received!")}</h1>
              <p className="text-sm text-muted-foreground">{L("Obrigado! Ele é registrado em instantes e o recibo vai por e-mail. Já pode fechar esta página.", "Thank you! It's recorded shortly and the receipt goes by email. You can close this page.")}</p>
            </div>
          )}

          {state === "settled" && (
            <div className="space-y-2 py-2">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
              <h1 className="text-xl font-bold">{L("Tudo em dia", "All paid up")}</h1>
              <p className="text-sm text-muted-foreground">{L("Não há nada em aberto agora. Obrigado!", "There's nothing due right now. Thank you!")}</p>
            </div>
          )}

          {state === "unavailable" && (
            <div className="space-y-2 py-2">
              <h1 className="text-xl font-bold">{L("Pagamento indisponível", "Payment unavailable")}</h1>
              <p className="text-sm text-muted-foreground">{L("O pagamento on-line não está disponível no momento. Fale com quem enviou o link.", "Online payment isn't available right now. Contact the sender.")}</p>
            </div>
          )}
        </Card>
        <div className="flex justify-center opacity-70"><CronysWordmark tamanho="1rem" /></div>
      </div>
    </div>
  );
}

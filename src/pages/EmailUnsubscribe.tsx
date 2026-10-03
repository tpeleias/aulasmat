import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MailCheck, MailX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { L } from "@/lib/i18n";

/**
 * "Cancelar o recebimento" dos e-mails automáticos (03/10). O link traz a
 * empresa, o e-mail e uma assinatura (função "emails"); vale para os e-mails
 * daquela empresa para aquele endereço.
 *
 * Abrir a página não tira ninguém da lista: ela pergunta antes (o Thiago tocou
 * sem querer no link e saiu da lista). Depois de sair, dá para voltar.
 */
type State = "loading" | "ask" | "out" | "invalid";

export default function EmailUnsubscribe() {
  const [params] = useSearchParams();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const call = async (action: "unsubscribe_check" | "unsubscribe" | "resubscribe") => {
    const { data, error } = await supabase.functions.invoke("emails", {
      body: { action, c: params.get("c"), e: params.get("e"), t: params.get("t") },
    });
    const d = data as { ok?: boolean; account?: string | null; email?: string; out?: boolean } | null;
    if (error || !d?.ok) { setState("invalid"); return; }
    setAccount(d.account ?? null);
    setEmail(d.email ?? null);
    setState(d.out ? "out" : "ask");
  };

  useEffect(() => {
    document.title = L("E-mails automáticos", "Automatic emails");
    void call("unsubscribe_check");
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (action: "unsubscribe" | "resubscribe") => { setBusy(true); await call(action); setBusy(false); };
  const from = account ?? L("esta empresa", "this business");

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md space-y-4 p-6 text-center">
        {state === "loading" && <p className="text-sm text-muted-foreground">{L("Um instante…", "One moment…")}</p>}
        {state === "ask" && <>
          <MailCheck className="mx-auto h-8 w-8 text-primary" />
          <h1 className="text-lg font-semibold">{L(`Parar de receber os e-mails de ${from}?`, `Stop emails from ${from}?`)}</h1>
          <p className="text-sm text-muted-foreground">
            {L(`Você deixa de receber marcações, mudanças de horário e lembretes${email ? ` em ${email}` : ""}.`,
               `You'll stop getting bookings, time changes and reminders${email ? ` at ${email}` : ""}.`)}
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="destructive" className="rounded-xl" disabled={busy} onClick={() => act("unsubscribe")}>
              {L("Sim, parar de receber", "Yes, stop the emails")}
            </Button>
            <Button asChild variant="ghost" className="rounded-xl"><Link to="/">{L("Não, continuar recebendo", "No, keep getting them")}</Link></Button>
          </div>
        </>}
        {state === "out" && <>
          <MailX className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{L("Você saiu da lista", "You're off the list")}</h1>
          <p className="text-sm text-muted-foreground">
            {L(`Não chegam mais e-mails automáticos de ${from}${email ? ` em ${email}` : ""}.`,
               `No more automatic emails from ${from}${email ? ` at ${email}` : ""}.`)}
          </p>
          <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => act("resubscribe")}>
            {L("Foi sem querer: voltar a receber", "That was a mistake: get them again")}
          </Button>
        </>}
        {state === "invalid" && <>
          <MailX className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{L("Link inválido", "Invalid link")}</h1>
          <p className="text-sm text-muted-foreground">{L("Use o link que veio no próprio e-mail.", "Use the link that came in the email itself.")}</p>
        </>}
        <Link to="/" className="block text-xs text-primary underline">cronys.com.br</Link>
      </Card>
    </div>
  );
}

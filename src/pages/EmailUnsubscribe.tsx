import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MailCheck, MailX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { L } from "@/lib/i18n";

/**
 * "Cancelar o recebimento" dos e-mails automáticos (03/10). O link traz a
 * empresa, o e-mail e uma assinatura (função "emails"); vale para os e-mails
 * daquela empresa para aquele endereço.
 *
 * Abrir a página não tira ninguém da lista: ela mostra os tipos de e-mail e a
 * pessoa escolhe quais quer continuar recebendo, ou para de receber tudo. Quem
 * saiu de tudo tem o "voltar a receber".
 */
type State = "loading" | "ask" | "out" | "invalid";
type Reply = { ok?: boolean; account?: string | null; email?: string; out?: boolean; categories?: string[] };

export const EMAIL_CATEGORIES = () => [
  { key: "agenda", label: L("Marcações, mudanças de horário e cancelamentos", "Bookings, time changes and cancellations") },
  { key: "lembretes", label: L("Lembretes antes do atendimento", "Reminders before appointments") },
  { key: "financeiro", label: L("Cobranças e recibos de pagamento", "Payment reminders and receipts") },
  { key: "tarefas", label: L("Tarefas e orientações", "Tasks and instructions") },
  { key: "resumo", label: L("Resumo do atendimento", "Appointment summary") },
];

export default function EmailUnsubscribe() {
  const [params] = useSearchParams();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [keep, setKeep] = useState<Record<string, boolean>>({});

  const call = async (action: "unsubscribe_check" | "unsubscribe" | "resubscribe", category?: string) => {
    const { data, error } = await supabase.functions.invoke("emails", {
      body: { action, c: params.get("c"), e: params.get("e"), t: params.get("t"), ...(category ? { category } : {}) },
    });
    const d = data as Reply | null;
    if (error || !d?.ok) { setState("invalid"); return null; }
    setAccount(d.account ?? null);
    setEmail(d.email ?? null);
    const cats = d.categories ?? [];
    setOff(cats);
    setKeep(Object.fromEntries(EMAIL_CATEGORIES().map(c => [c.key, !cats.includes(c.key)])));
    setState(d.out ? "out" : "ask");
    return d;
  };

  useEffect(() => {
    document.title = L("E-mails automáticos", "Automatic emails");
    void call("unsubscribe_check");
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveChoice = async () => {
    setBusy(true);
    for (const c of EMAIL_CATEGORIES()) {
      const wasOff = off.includes(c.key);
      if (keep[c.key] && wasOff) await call("resubscribe", c.key);
      if (!keep[c.key] && !wasOff) await call("unsubscribe", c.key);
    }
    setBusy(false);
    toast.success(L("Pronto, sua escolha foi salva", "Done, your choice was saved"));
  };
  const act = async (action: "unsubscribe" | "resubscribe") => { setBusy(true); await call(action); setBusy(false); };
  const from = account ?? L("esta empresa", "this business");
  const changed = EMAIL_CATEGORIES().some(c => keep[c.key] === off.includes(c.key));

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md space-y-4 p-6">
        {state === "loading" && <p className="text-center text-sm text-muted-foreground">{L("Um instante…", "One moment…")}</p>}
        {state === "ask" && <>
          <MailCheck className="mx-auto h-8 w-8 text-primary" />
          <div className="space-y-1 text-center">
            <h1 className="text-lg font-semibold">{L(`Quais e-mails de ${from} você quer receber?`, `Which emails from ${from} do you want?`)}</h1>
            {email && <p className="text-sm text-muted-foreground">{L(`Para ${email}`, `To ${email}`)}</p>}
          </div>
          <div className="space-y-2">
            {EMAIL_CATEGORIES().map(c => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={!!keep[c.key]} onCheckedChange={v => setKeep(k => ({ ...k, [c.key]: v === true }))} /> {c.label}
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Button className="rounded-xl" disabled={busy || !changed} onClick={saveChoice}>{L("Salvar minha escolha", "Save my choice")}</Button>
            <Button variant="ghost" className="rounded-xl text-destructive hover:text-destructive" disabled={busy} onClick={() => act("unsubscribe")}>
              {L("Parar de receber todos", "Stop all of them")}
            </Button>
          </div>
        </>}
        {state === "out" && <div className="space-y-4 text-center">
          <MailX className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{L("Você saiu da lista", "You're off the list")}</h1>
          <p className="text-sm text-muted-foreground">
            {L(`Não chegam mais e-mails automáticos de ${from}${email ? ` em ${email}` : ""}.`,
               `No more automatic emails from ${from}${email ? ` at ${email}` : ""}.`)}
          </p>
          <Button variant="outline" className="rounded-xl" disabled={busy} onClick={() => act("resubscribe")}>
            {L("Foi sem querer: voltar a receber", "That was a mistake: get them again")}
          </Button>
        </div>}
        {state === "invalid" && <div className="space-y-2 text-center">
          <MailX className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{L("Link inválido", "Invalid link")}</h1>
          <p className="text-sm text-muted-foreground">{L("Use o link que veio no próprio e-mail.", "Use the link that came in the email itself.")}</p>
        </div>}
        <Link to="/" className="block text-center text-xs text-primary underline">cronys.com.br</Link>
      </Card>
    </div>
  );
}

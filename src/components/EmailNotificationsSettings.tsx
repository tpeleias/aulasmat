import { useState } from "react";
import { History, Lock, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlan } from "@/hooks/usePlan";
import { EmailHistoryDialog } from "@/components/EmailHistoryDialog";
import { EmailBrandingSettings } from "@/components/EmailBrandingSettings";
import { useWords } from "@/hooks/useVocabulary";
import { cap } from "@/lib/vocabulary";
import { L } from "@/lib/i18n";

/**
 * E-mails automáticos (03/10): o que a empresa manda, e para quem. Grava em
 * settings.email_notifications (migration 20261003020000); quem envia é a
 * função "emails". Chave ausente = ligada, menos o lembrete do dia - o mesmo
 * padrão de email_pref no banco.
 */
export type EmailPrefs = Record<string, unknown>;

// O que nasce desligado mesmo com os e-mails ligados (o mesmo de email_pref no banco).
const OFF_BY_DEFAULT = ["reminder_day", "billing_daily", "billing_weekly", "billing_monthly"];
const isOn = (p: EmailPrefs, k: string) => (k in p ? p[k] === true : !OFF_BY_DEFAULT.includes(k));

export function EmailNotificationsSettings({ value, onChange, accountId = null }: { value: EmailPrefs | null | undefined; onChange: (v: EmailPrefs) => void; accountId?: string | null }) {
  const w = useWords();
  const { plan } = usePlan();
  const canBilling = plan?.email_billing === true;
  const [history, setHistory] = useState(false);
  const p = value ?? {};
  const enabled = p.enabled === true;
  const [testing, setTesting] = useState(false);
  const set = (k: string, v: unknown) => onChange({ ...p, [k]: v } as EmailPrefs);
  const monthDay = Math.min(28, Math.max(1, Number((p as Record<string, unknown>).billing_month_day) || 1));

  const groups: { title: string; items: { k: string; label: string }[] }[] = [
    {
      title: L(`Para ${w.client.o} ${w.client.l} (ou ${w.guardian.o} ${w.guardian.l})`, `To the ${w.client.l} (or ${w.guardian.l})`),
      items: [
        { k: "client_booked", label: L(`${cap(w.appointment.s)} ${w.appointment.pick("marcado", "marcada")}`, `${w.appointment.s} booked`) },
        { k: "client_changed", label: L("Horário alterado", "Time changed") },
        { k: "client_cancelled", label: L(`${cap(w.appointment.s)} ${w.appointment.pick("cancelado", "cancelada")}`, `${w.appointment.s} canceled`) },
        { k: "client_requests", label: L("Pedido pelo portal: recebido, aprovado ou recusado", "Portal request: received, approved or declined") },
        { k: "reminder_eve", label: L("Lembrete na véspera (às 18h)", "Reminder the day before (6 PM)") },
        { k: "reminder_day", label: L("Lembrete no dia (às 7h)", "Reminder on the day (7 AM)") },
        { k: "homework_new", label: L("Tarefa nova", "New task") },
        { k: "homework_due", label: L("Tarefas pendentes na véspera (junto do lembrete)", "Pending tasks the day before (with the reminder)") },
        { k: "class_summary", label: L(`Resumo ${w.appointment.pick("do", "da")} ${w.appointment.l}, quando ${w.staff.o} ${w.staff.l} escreve`, `${w.appointment.s} summary, when the ${w.staff.l} writes one`) },
      ],
    },
    {
      title: L("Para a equipe", "To your team"),
      items: [
        { k: "teacher_changes", label: L(`${cap(w.staff.s)}: o que mudar na própria agenda`, `${w.staff.s}: changes to their own calendar`) },
        { k: "admin_requests", label: L("Admins: cada pedido novo do portal", "Admins: every new portal request") },
        { k: "agenda_tomorrow", label: L(`Agenda de amanhã, às 18h (cada ${w.staff.s} a sua; os admins, a de todos)`, `Tomorrow's schedule at 6 PM (each ${w.staff.s} their own; admins everything)`) },
      ],
    },
  ];

  const test = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("emails", { body: { action: "test" } });
    setTesting(false);
    const to = (data as { to?: string } | null)?.to;
    // 400 = o login não tem e-mail de verdade; o resto é falha no envio.
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    if (status === 400) toast.error(L("Não deu para enviar. Seu login precisa ter um e-mail de verdade.", "Couldn't send. Your login needs a real email address."));
    else if (error || !to) toast.error(L("O envio falhou agora. Tente de novo em alguns minutos.", "Sending failed. Try again in a few minutes."));
    else toast.success(L(`E-mail de teste enviado para ${to}`, `Test email sent to ${to}`));
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-sm uppercase text-muted-foreground"><Mail className="h-4 w-4" /> {L("E-mails automáticos", "Automatic emails")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {L(`Saem com o nome da empresa, e a resposta vai para o seu e-mail de contato. Só chegam a quem tem e-mail no cadastro (${w.client.lp}, ${w.guardian.lp} e ${w.staff.lp}) ou entra com e-mail.`,
               `Sent with your business name, and replies go to your contact email. They only reach people with an email in their profile (${w.client.lp}, ${w.guardian.lp} and ${w.staff.lp}) or who sign in with email.`)}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={v => set("enabled", v)} aria-label={L("Ligar e-mails automáticos", "Turn on automatic emails")} />
      </div>

      {enabled && (
        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.title} className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">{g.title}</p>
              {g.items.map(it => (
                <label key={it.k} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={isOn(p, it.k)} onCheckedChange={v => set(it.k, v === true)} /> {it.label}
                </label>
              ))}
            </div>
          ))}
          <div className="space-y-2">
            <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              {L("Financeiro", "Billing")}
              {!canBilling && <span className="inline-flex items-center gap-1 font-normal"><Lock className="h-3 w-3" /> {L("nos planos Start, Pro e Max", "on the Start, Pro and Max plans")}</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {L(`A cobrança vai só para quem tem valor em aberto, para ${w.guardian.o} ${w.guardian.l} (ou ${w.client.o} ${w.client.l} sem ${w.guardian.l}), com o Pix copia e cola já com o valor. No Financeiro dá para cobrar na mão, a qualquer momento.`,
                 `Payment reminders only go to people with an open balance, to the ${w.guardian.l} (or the ${w.client.l} without one), with the amount already filled in. You can also send them by hand from Billing.`)}
            </p>
            {([
              { k: "billing_daily", label: L(`Cobrança no fim do dia em que houve ${w.appointment.l} (19h)`, `Payment reminder at the end of a day with ${w.appointment.lp} (7 PM)`) },
              { k: "billing_weekly", label: L("Cobrança toda segunda-feira (9h)", "Payment reminder every Monday (9 AM)") },
            ]).map(it => (
              <label key={it.k} className={`flex items-center gap-2 text-sm ${canBilling ? "cursor-pointer" : "opacity-50"}`}>
                <Checkbox disabled={!canBilling} checked={canBilling && isOn(p, it.k)} onCheckedChange={v => set(it.k, v === true)} /> {it.label}
              </label>
            ))}
            <div className={`flex flex-wrap items-center gap-2 text-sm ${canBilling ? "" : "opacity-50"}`}>
              <label className={`flex items-center gap-2 ${canBilling ? "cursor-pointer" : ""}`}>
                <Checkbox disabled={!canBilling} checked={canBilling && isOn(p, "billing_monthly")} onCheckedChange={v => set("billing_monthly", v === true)} />
                {L("Cobrança todo mês, no dia", "Payment reminder every month, on day")}
              </label>
              <Select disabled={!canBilling} value={String(monthDay)} onValueChange={v => set("billing_month_day", Number(v))}>
                <SelectTrigger className="h-8 w-20 rounded-lg" aria-label={L("Dia do mês", "Day of the month")}><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: 28 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent>
              </Select>
              <span>{L("(9h)", "(9 AM)")}</span>
            </div>
            <label className={`flex items-center gap-2 text-sm ${canBilling ? "cursor-pointer" : "opacity-50"}`}>
              <Checkbox disabled={!canBilling} checked={canBilling && isOn(p, "payment_received")} onCheckedChange={v => set("payment_received", v === true)} />
              {L("Pagamento recebido, com o recibo em PDF", "Payment received, with the PDF receipt")}
            </label>
            <label className={`flex items-center gap-2 text-sm ${canBilling ? "cursor-pointer" : "opacity-50"}`}>
              <Checkbox disabled={!canBilling} checked={canBilling && isOn(p, "package_low")} onCheckedChange={v => set("package_low", v === true)} />
              {L(`Pacote acabando (o crédito não cobre ${w.appointment.pick("outro", "outra")} ${w.appointment.l}) e pacote encerrado`, `Package running out (credit won't cover another ${w.appointment.l}) and used up`)}
            </label>
          </div>
          <EmailBrandingSettings value={p} set={set} accountId={accountId}
            canBrand={plan?.email_branding === true} canCustom={plan?.email_custom === true} />
          <p className="text-xs text-muted-foreground">
            {L("Todo e-mail tem um link para a pessoa parar de receber, tudo ou só um tipo.", "Every email has a link for the person to stop receiving them, all or just one kind.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={test} disabled={testing}>
              <Send className="h-3.5 w-3.5" /> {L("Mandar um e-mail de teste para mim", "Send me a test email")}
            </Button>
            <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={() => setHistory(true)}>
              <History className="h-3.5 w-3.5" /> {L("Ver o que foi enviado", "See what was sent")}
            </Button>
          </div>
          <EmailHistoryDialog open={history} onOpenChange={setHistory} />
        </div>
      )}
    </Card>
  );
}

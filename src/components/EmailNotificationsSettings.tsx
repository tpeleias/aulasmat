import { useState } from "react";
import { Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useWords } from "@/hooks/useVocabulary";
import { cap } from "@/lib/vocabulary";
import { L } from "@/lib/i18n";

/**
 * E-mails automáticos (03/10): o que a empresa manda, e para quem. Grava em
 * settings.email_notifications (migration 20261003020000); quem envia é a
 * função "emails". Chave ausente = ligada, menos o lembrete do dia - o mesmo
 * padrão de email_pref no banco.
 */
export type EmailPrefs = Record<string, boolean>;

const isOn = (p: EmailPrefs, k: string) => (k in p ? p[k] === true : k !== "reminder_day");

export function EmailNotificationsSettings({ value, onChange }: { value: EmailPrefs | null | undefined; onChange: (v: EmailPrefs) => void }) {
  const w = useWords();
  const p = value ?? {};
  const enabled = p.enabled === true;
  const [testing, setTesting] = useState(false);
  const set = (k: string, v: boolean) => onChange({ ...p, [k]: v });

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
      ],
    },
    {
      title: L("Para a equipe", "To your team"),
      items: [
        { k: "teacher_changes", label: L(`${cap(w.staff.s)}: o que mudar na própria agenda`, `${w.staff.s}: changes to their own calendar`) },
        { k: "admin_requests", label: L("Admins: cada pedido novo do portal", "Admins: every new portal request") },
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
          <p className="text-xs text-muted-foreground">
            {L("Todo e-mail tem um link para a pessoa parar de receber.", "Every email has a link for the person to stop receiving them.")}
          </p>
          <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={test} disabled={testing}>
            <Send className="h-3.5 w-3.5" /> {L("Mandar um e-mail de teste para mim", "Send me a test email")}
          </Button>
        </div>
      )}
    </Card>
  );
}

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { emailAction, emailErrorText } from "@/lib/emailActions";
import { haptics } from "@/lib/haptics";
import { L } from "@/lib/i18n";

/**
 * "Lembrar por e-mail" no atendimento marcado (03/10), em todos os planos: vai
 * para o cliente e o responsável que têm e-mail, pela função "emails", e fica
 * no histórico. O profissional pode lembrar os próprios atendimentos.
 */
export function LessonEmailReminder({ lesson }: { lesson: { id?: string; status?: string; start_at: string } }) {
  const [busy, setBusy] = useState(false);
  if (!lesson.id || lesson.status !== "agendada" || new Date(lesson.start_at).getTime() < Date.now()) return null;
  const send = async () => {
    setBusy(true);
    const r = await emailAction<{ to: string[] }>({ action: "remind_lesson", lesson_id: lesson.id });
    setBusy(false);
    if (!r.ok) { haptics.warning(); toast.error(emailErrorText(r.error)); return; }
    haptics.success();
    if (!r.data.to.length) toast.message(L("Ninguém recebeu: os e-mails saíram da lista ou voltaram.", "No one got it: the emails unsubscribed or bounced."));
    else toast.success(L(`Lembrete enviado para ${r.data.to.join(", ")}`, `Reminder sent to ${r.data.to.join(", ")}`));
  };
  return (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={send} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
      {L("Lembrar por e-mail", "Remind by email")}
    </Button>
  );
}

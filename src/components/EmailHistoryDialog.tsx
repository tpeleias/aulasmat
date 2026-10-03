import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dateLocale, L, timeFmt } from "@/lib/i18n";

/**
 * O que saiu por e-mail (email_log, migration 20261003060000): quando, para
 * quem, o quê, e o que o Resend disse depois (entregue, voltou, spam). Sem
 * `account`, os últimos da empresa; com, só os daquela conta do Financeiro.
 */
export type EmailLogRow = {
  id: string; to_email: string; kind: string; subject: string; status: string;
  student_name: string | null; guardian_name: string | null; sent_by: string | null; created_at: string;
};

export const KIND_LABEL: Record<string, () => string> = {
  booked: () => L("Marcação", "Booked"), changed: () => L("Horário alterado", "Time changed"), cancelled: () => L("Cancelamento", "Canceled"),
  requested: () => L("Pedido recebido", "Request received"), approved: () => L("Pedido aprovado", "Request approved"), declined: () => L("Pedido recusado", "Request declined"),
  eve: () => L("Lembrete (véspera)", "Reminder (day before)"), day: () => L("Lembrete (no dia)", "Reminder (same day)"),
  lesson_reminder: () => L("Lembrete", "Reminder"), charge: () => L("Cobrança", "Payment reminder"),
  statement: () => L("Extrato", "Statement"), payment: () => L("Pagamento recebido", "Payment received"),
  package: () => L("Pacote acabando", "Package running out"), homework: () => L("Tarefa nova", "New task"),
  homework_due: () => L("Tarefas pendentes", "Pending tasks"), class_summary: () => L("Resumo do atendimento", "Appointment summary"),
  agenda_tomorrow: () => L("Agenda de amanhã", "Tomorrow's schedule"),
};

export function statusBadge(status: string) {
  switch (status) {
    case "delivered": return <Badge variant="secondary">{L("Entregue", "Delivered")}</Badge>;
    case "bounced": return <Badge variant="destructive">{L("Voltou", "Bounced")}</Badge>;
    case "complained": return <Badge variant="destructive">{L("Marcado como spam", "Marked as spam")}</Badge>;
    case "failed": return <Badge variant="destructive">{L("Falhou", "Failed")}</Badge>;
    default: return <Badge variant="outline">{L("Enviado", "Sent")}</Badge>;
  }
}

export function EmailHistoryDialog({ open, onOpenChange, account }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  account?: { student: string; guardian: string | null; label: string };
}) {
  const [rows, setRows] = useState<EmailLogRow[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    let q = (supabase.from as unknown as (t: string) => any)("email_log")
      .select("id, to_email, kind, subject, status, student_name, guardian_name, sent_by, created_at")
      .order("created_at", { ascending: false }).limit(100);
    if (account) q = account.guardian ? q.eq("guardian_name", account.guardian) : q.eq("student_name", account.student).is("guardian_name", null);
    void q.then(({ data }: { data: EmailLogRow[] | null }) => setRows(data ?? []));
  }, [open, account?.student, account?.guardian]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{account ? L(`E-mails de ${account.label}`, `Emails for ${account.label}`) : L("E-mails enviados", "Emails sent")}</DialogTitle>
          <DialogDescription>{L("Os mais recentes primeiro. \"Voltou\" quer dizer que o endereço não existe ou recusou: confira o cadastro.",
            "Newest first. \"Bounced\" means the address doesn't exist or refused it: check the profile.")}</DialogDescription>
        </DialogHeader>
        {rows === null && <p className="text-sm text-muted-foreground">{L("Carregando...", "Loading...")}</p>}
        {rows?.length === 0 && <p className="text-sm text-muted-foreground">{L("Nenhum e-mail enviado ainda.", "No emails sent yet.")}</p>}
        <ul className="divide-y">
          {rows?.map(r => (
            <li key={r.id} className="space-y-0.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{KIND_LABEL[r.kind]?.() ?? r.kind}{r.sent_by ? <span className="font-normal text-muted-foreground"> · {L("enviado na mão", "sent by hand")}</span> : null}</span>
                {statusBadge(r.status)}
              </div>
              <p className="text-xs text-muted-foreground">{format(new Date(r.created_at), L("dd/MM 'às' ", "MMM d, ") + timeFmt(), { locale: dateLocale() })} · {r.to_email}</p>
              <p className="truncate text-xs text-muted-foreground">{r.subject}</p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

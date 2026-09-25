import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarPlus, Settings2, Pencil, Trash2, MapPin, Wallet, Link2, TrendingUp, PauseCircle } from "lucide-react";
import { format, isFuture } from "date-fns";
import { fmtMoney, capitalize } from "@/lib/balance";
import { isDiscarded, statusLabel } from "@/lib/lessonStatus";
import type { AccountStatement } from "@/lib/billing";
import { daysOpen, isOverdue } from "@/lib/billing";
import { useWords } from "@/hooks/useVocabulary";

import { dateLocale, L } from "@/lib/i18n";
export type SheetStudent = {
  id: string; student_name: string; guardian_name: string | null; address: string | null; user_id: string | null;
};
export type SheetLesson = {
  id: string; start_at: string; duration_minutes: number; subject: string | null; teacher: string; status: string;
};

function openWaze(address: string) {
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, "_blank", "noopener,noreferrer");
}

export default function StudentSheet({ student, lessons, statement, open, onOpenChange, onSchedule, onManage, manageLabel = "Gerenciar", onEdit, onDelete, onBilling, onEvolution, onPause, showMoney = true }: {
  student: SheetStudent | null;
  lessons: SheetLesson[];
  statement?: AccountStatement;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSchedule?: () => void;
  // Os opcionais somem para o login de professor, que não administra o
  // cadastro nem vê o financeiro.
  onManage?: () => void;
  manageLabel?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  onBilling?: () => void;
  showMoney?: boolean;
  onEvolution: () => void;
  // Só vem quando a empresa tem aluno pausado pelo plano: é como o professor
  // troca quem ocupa as vagas do Essencial.
  onPause?: () => void;
}) {
  const w = useWords();
  if (!student) return null;

  const done = lessons.filter(l => l.status === "realizada");
  const next = lessons
    .filter(l => l.status === "agendada" && isFuture(new Date(l.start_at)))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const recent = lessons
    .filter(l => !isDiscarded(l.status))
    .sort((a, b) => b.start_at.localeCompare(a.start_at))
    .slice(0, 5);

  const owed = statement?.owed ?? 0;
  const credit = statement && statement.balance > 0 ? statement.balance : 0;
  const overdue = statement ? isOverdue(statement) : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t-0 px-5 pt-4 md:mx-auto md:max-w-lg md:rounded-3xl md:bottom-6"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/30 md:hidden" />
        <SheetTitle className="text-xl">{student.student_name}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-2">
          <span>{student.guardian_name ? `${L("Resp.", w.guardian.s)}: ${student.guardian_name}` : L("Sem responsável", `No ${w.guardian.l}`)}</span>
          {student.user_id && <Badge variant="outline" className="gap-1 text-[10px]"><Link2 className="h-3 w-3" /> {L("conta", "account")}</Badge>}
        </SheetDescription>
        {student.address && (
          <button onClick={() => openWaze(student.address!)} className="mt-1 flex items-center gap-1.5 text-left text-sm text-primary">
            <MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{student.address}</span>
          </button>
        )}

        <div className={`mt-4 grid gap-2 ${showMoney ? "grid-cols-3" : "grid-cols-2"}`}>
          <Stat label={L("Realizadas", "Done")} value={String(done.length)} />
          {showMoney && <Stat
            label={credit > 0 ? L("Crédito", "Credit") : owed > 0 ? L("A receber", "Due") : L("Financeiro", "Billing")}
            value={credit > 0 ? fmtMoney(credit) : owed > 0 ? fmtMoney(owed) : L("Em dia", "Up to date")}
            tone={overdue ? "destructive" : credit > 0 ? "success" : "default"}
            hint={overdue ? L(`${daysOpen(statement!.oldestOpenDate)} dias`, `${daysOpen(statement!.oldestOpenDate)} days`) : undefined}
          />}
          <Stat label={L("Próxima", "Next")} value={next ? format(new Date(next.start_at), L("EEE dd/MM", "EEE, MMM d"), { locale: dateLocale() }) : "—"} hint={next ? format(new Date(next.start_at), "HH:mm") : undefined} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {onSchedule && <Button onClick={onSchedule} className="h-11 gap-2 rounded-xl"><CalendarPlus className="h-4 w-4" /> {L("Agendar", "Book")}</Button>}
          {onBilling && <Button onClick={onBilling} variant="secondary" className="h-11 gap-2 rounded-xl"><Wallet className="h-4 w-4" /> {L("Financeiro", "Billing")}</Button>}
          {onManage && <Button onClick={onManage} variant="secondary" className="h-11 gap-2 rounded-xl"><Settings2 className="h-4 w-4" /> {manageLabel}</Button>}
          {onEdit && <Button onClick={onEdit} variant="secondary" className="h-11 gap-2 rounded-xl"><Pencil className="h-4 w-4" /> {L("Editar", "Edit")}</Button>}
          <Button onClick={onEvolution} variant="secondary" className="h-11 gap-2 rounded-xl"><TrendingUp className="h-4 w-4" /> {L("Evolução", "Progress")}</Button>
          {onPause && <Button onClick={onPause} variant="secondary" className="h-11 gap-2 rounded-xl"><PauseCircle className="h-4 w-4" /> {L("Pausar", "Pause")}</Button>}
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{L(`${w.appointment.pick("Últimos", "Últimas")} ${w.appointment.lp}`, `Recent ${w.appointment.lp}`)}</div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{L(`${w.appointment.nenhum} ${w.appointment.l} ${w.appointment.pick("registrado", "registrada")} ainda.`, `No ${w.appointment.lp} yet.`)}</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {recent.map(l => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium capitalize">{format(new Date(l.start_at), L("EEE dd/MM 'às' HH:mm", "EEE, MMM d 'at' HH:mm"), { locale: dateLocale() })}</div>
                    <div className="truncate text-xs text-muted-foreground">{l.subject ?? w.appointment.s} · {l.duration_minutes} min · {capitalize(l.teacher)}</div>
                  </div>
                  <Badge variant={l.status === "realizada" ? "secondary" : "outline"} className="shrink-0 text-[10px]">{statusLabel(l.status, w)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {onDelete && <button onClick={onDelete} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" /> {L("Excluir cadastro", "Delete profile")}
        </button>}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "success" | "destructive" }) {
  const color = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`truncate text-base font-semibold ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

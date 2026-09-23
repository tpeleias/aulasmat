import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarPlus, Settings2, Pencil, Trash2, MapPin, Wallet, Link2, TrendingUp, PauseCircle } from "lucide-react";
import { format, isFuture } from "date-fns";
import { ptBR } from "date-fns/locale";
import { fmtMoney, capitalize } from "@/lib/balance";
import { isDiscarded, statusLabel } from "@/lib/lessonStatus";
import type { AccountStatement } from "@/lib/billing";
import { daysOpen, isOverdue } from "@/lib/billing";

export type SheetStudent = {
  id: string; student_name: string; guardian_name: string | null; address: string | null; user_id: string | null;
};
export type SheetLesson = {
  id: string; start_at: string; duration_minutes: number; subject: string | null; teacher: string; status: string;
};

function openWaze(address: string) {
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, "_blank", "noopener,noreferrer");
}

export default function StudentSheet({ student, lessons, statement, open, onOpenChange, onSchedule, onManage, onEdit, onDelete, onBilling, onEvolution, onPause }: {
  student: SheetStudent | null;
  lessons: SheetLesson[];
  statement?: AccountStatement;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSchedule: () => void;
  onManage: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onBilling: () => void;
  onEvolution: () => void;
  // Só vem quando a empresa tem aluno pausado pelo plano: é como o professor
  // troca quem ocupa as vagas do Essencial.
  onPause?: () => void;
}) {
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
          <span>{student.guardian_name ? `Resp.: ${student.guardian_name}` : "Sem responsável"}</span>
          {student.user_id && <Badge variant="outline" className="gap-1 text-[10px]"><Link2 className="h-3 w-3" /> conta</Badge>}
        </SheetDescription>
        {student.address && (
          <button onClick={() => openWaze(student.address!)} className="mt-1 flex items-center gap-1.5 text-left text-sm text-primary">
            <MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{student.address}</span>
          </button>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Realizadas" value={String(done.length)} />
          <Stat
            label={credit > 0 ? "Crédito" : owed > 0 ? "A receber" : "Financeiro"}
            value={credit > 0 ? fmtMoney(credit) : owed > 0 ? fmtMoney(owed) : "Em dia"}
            tone={overdue ? "destructive" : credit > 0 ? "success" : "default"}
            hint={overdue ? `${daysOpen(statement!.oldestOpenDate)} dias` : undefined}
          />
          <Stat label="Próxima" value={next ? format(new Date(next.start_at), "EEE dd/MM", { locale: ptBR }) : "—"} hint={next ? format(new Date(next.start_at), "HH:mm") : undefined} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button onClick={onSchedule} className="h-11 gap-2 rounded-xl"><CalendarPlus className="h-4 w-4" /> Agendar</Button>
          <Button onClick={onBilling} variant="secondary" className="h-11 gap-2 rounded-xl"><Wallet className="h-4 w-4" /> Financeiro</Button>
          <Button onClick={onManage} variant="secondary" className="h-11 gap-2 rounded-xl"><Settings2 className="h-4 w-4" /> Gerenciar</Button>
          <Button onClick={onEdit} variant="secondary" className="h-11 gap-2 rounded-xl"><Pencil className="h-4 w-4" /> Editar</Button>
          <Button onClick={onEvolution} variant="secondary" className="h-11 gap-2 rounded-xl"><TrendingUp className="h-4 w-4" /> Evolução</Button>
          {onPause && <Button onClick={onPause} variant="secondary" className="h-11 gap-2 rounded-xl"><PauseCircle className="h-4 w-4" /> Pausar</Button>}
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Últimas aulas</div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma aula registrada ainda.</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {recent.map(l => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium capitalize">{format(new Date(l.start_at), "EEE dd/MM 'às' HH:mm", { locale: ptBR })}</div>
                    <div className="truncate text-xs text-muted-foreground">{l.subject ?? "Aula"} · {l.duration_minutes} min · {capitalize(l.teacher)}</div>
                  </div>
                  <Badge variant={l.status === "realizada" ? "secondary" : "outline"} className="shrink-0 text-[10px]">{statusLabel(l.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button onClick={onDelete} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" /> Excluir cadastro
        </button>
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

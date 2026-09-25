import { useCallback, useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { MessageSquarePlus, NotebookPen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useWords } from "@/hooks/useVocabulary";
import { capitalize } from "@/lib/balance";
import { LessonSummaryDialog, type SummaryLesson } from "@/components/LessonSummaryDialog";

import { dateLocale, L } from "@/lib/i18n";
type Row = SummaryLesson & { teacher: string };

const DAYS = 10;
const MAX = 5;

/**
 * Tela Hoje: os atendimentos dos últimos dias que já aconteceram e ainda
 * estão sem resumo, com o botão "Como foi?". É o lembrete de registrar - antes
 * o resumo só existia escondido nos detalhes do atendimento.
 */
export default function PendingSummaries({ refreshKey }: { refreshKey?: number }) {
  const w = useWords();
  const ap = w.appointment;
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("lessons").select("*")
      .eq("status", "realizada")
      .gte("start_at", subDays(new Date(), DAYS).toISOString())
      .lte("start_at", new Date().toISOString())
      .order("start_at", { ascending: false });
    const pending = ((data ?? []) as (Row & { absence_charged?: boolean })[])
      .filter(l => !(l.class_summary ?? "").trim() && !l.absence_charged);
    setRows(pending);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <NotebookPen className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">{L("Como foi?", "How did it go?")}</h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? ap.l : ap.lp} {L("sem resumo", "without notes")}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {L(`Conte em poucas linhas o que foi feito. ${cap(w.client.o)} ${w.client.l} vê em "Minhas ${ap.lp}", e fica na Evolução.`,
           `Write a few lines about what was done. The ${w.client.l} sees it in "My ${ap.lp}", and it stays in Progress.`)}
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.slice(0, MAX).map(l => (
          <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{l.student_name}</div>
              <div className="truncate text-xs text-muted-foreground">
                <span className="capitalize">{format(new Date(l.start_at), L("EEE dd/MM HH:mm", "EEE, MMM d, HH:mm"), { locale: dateLocale() })}</span>
                {l.subject ? ` · ${l.subject}` : ""} · {capitalize(l.teacher)}
              </div>
            </div>
            <Button size="sm" variant="secondary" className="shrink-0 gap-1 rounded-xl" onClick={() => setOpen(l)}>
              <MessageSquarePlus className="h-3.5 w-3.5" /> {L("Como foi?", "How did it go?")}
            </Button>
          </li>
        ))}
      </ul>
      {rows.length > MAX && (
        <p className="mt-2 text-xs text-muted-foreground">{L(`E mais ${rows.length - MAX}. Os outros aparecem aqui conforme você registra.`, `And ${rows.length - MAX} more. They show up here as you write.`)}</p>
      )}
      <LessonSummaryDialog
        lesson={open}
        onClose={() => setOpen(null)}
        onSaved={() => setRows(r => r.filter(x => x.id !== open?.id))}
      />
    </section>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

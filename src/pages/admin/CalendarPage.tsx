import { useEffect, useMemo, useState, useCallback } from "react";
import { addDays, addMinutes, format, getDay, isSameDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { LessonDialog } from "@/components/LessonDialog";

type Lesson = { id: string; student_name: string; guardian_name: string | null; subject: string | null; start_at: string; duration_minutes: number; price: number; package_type: string; payment_status: string; notes: string | null };
type Block = { id: string; title: string; block_type: string; start_at: string | null; end_at: string | null; weekday: number | null; start_time: string | null; end_time: string | null };
type Settings = { work_start: string; work_end: string; slot_minutes: number };

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [settings, setSettings] = useState<Settings>({ work_start: "08:00", work_end: "22:00", slot_minutes: 60 });
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [slotStart, setSlotStart] = useState<Date | undefined>(undefined);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    const from = weekStart.toISOString();
    const to = addDays(weekStart, 7).toISOString();
    const [s, l, b] = await Promise.all([
      supabase.from("settings").select("work_start, work_end, slot_minutes").eq("id", 1).maybeSingle(),
      supabase.from("lessons").select("*").gte("start_at", from).lt("start_at", to).order("start_at"),
      supabase.from("blocks").select("*"),
    ]);
    if (s.data) setSettings(s.data);
    setLessons((l.data ?? []) as Lesson[]);
    setBlocks((b.data ?? []) as Block[]);
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  const [hStart, hEnd] = useMemo(() => {
    const [a] = settings.work_start.split(":").map(Number);
    const [c] = settings.work_end.split(":").map(Number);
    return [a, c];
  }, [settings]);

  const hours = useMemo(() => Array.from({ length: hEnd - hStart }, (_, i) => hStart + i), [hStart, hEnd]);

  const slotMin = settings.slot_minutes;

  const getCellContent = (day: Date, hour: number) => {
    const cellStart = new Date(day); cellStart.setHours(hour, 0, 0, 0);
    const cellEnd = addMinutes(cellStart, slotMin);

    const lesson = lessons.find(l => {
      const ls = new Date(l.start_at);
      return isSameDay(ls, day) && ls < cellEnd && addMinutes(ls, l.duration_minutes) > cellStart;
    });
    if (lesson) return { type: "lesson" as const, lesson };

    const oneOff = blocks.find(b => b.block_type === "one_off" && b.start_at && b.end_at && new Date(b.start_at) < cellEnd && new Date(b.end_at) > cellStart);
    if (oneOff) return { type: "block" as const, label: oneOff.title };

    const wd = getDay(day);
    const recur = blocks.find(b => {
      if (b.block_type !== "recurring" || b.weekday !== wd || !b.start_time || !b.end_time) return false;
      const [sh, sm] = b.start_time.split(":").map(Number);
      const [eh, em] = b.end_time.split(":").map(Number);
      const bs = new Date(day); bs.setHours(sh, sm, 0, 0);
      const be = new Date(day); be.setHours(eh, em, 0, 0);
      return bs < cellEnd && be > cellStart;
    });
    if (recur) return { type: "block" as const, label: recur.title };

    return { type: "free" as const, cellStart };
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Calendário</h1>
          <p className="text-sm text-muted-foreground">{format(days[0], "dd 'de' MMM", { locale: ptBR })} — {format(days[6], "dd 'de' MMM yyyy", { locale: ptBR })}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoje</Button>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-[var(--shadow-card)] overflow-x-auto">
        <div className="min-w-[800px]">
          <div className="grid" style={{ gridTemplateColumns: "70px repeat(7, 1fr)" }}>
            <div className="border-b border-r border-border p-2 text-xs text-muted-foreground"></div>
            {days.map(d => (
              <div key={d.toISOString()} className={`border-b border-border p-2 text-center text-xs ${isSameDay(d, new Date()) ? "bg-accent text-accent-foreground font-semibold" : ""}`}>
                <div className="uppercase">{format(d, "EEE", { locale: ptBR })}</div>
                <div className="text-base font-semibold">{format(d, "dd")}</div>
              </div>
            ))}
            {hours.map(h => (
              <div key={h} className="contents">
                <div className="border-b border-r border-border p-1 text-[11px] text-muted-foreground text-right pr-2">{String(h).padStart(2, "0")}:00</div>
                {days.map(d => {
                  const cell = getCellContent(d, h);
                  if (cell.type === "lesson") return (
                    <button key={d.toISOString() + h} onClick={() => { setEditing(cell.lesson); setDlgOpen(true); }}
                      className={`border-b border-l border-border p-1.5 text-left text-xs hover:opacity-90 ${cell.lesson.payment_status === "pago" ? "bg-success/15" : "bg-primary/10"}`}>
                      <div className="font-semibold truncate text-primary">{cell.lesson.student_name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{cell.lesson.subject}</div>
                    </button>
                  );
                  if (cell.type === "block") return (
                    <div key={d.toISOString() + h} className="border-b border-l border-border p-1.5 text-xs bg-muted text-muted-foreground"
                      style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 4px, hsl(var(--border)) 4px, hsl(var(--border)) 5px)" }}>
                      <div className="truncate">{cell.label}</div>
                    </div>
                  );
                  return (
                    <button key={d.toISOString() + h} onClick={() => { setEditing(null); setSlotStart(cell.cellStart); setDlgOpen(true); }}
                      className="border-b border-l border-border p-1.5 text-xs hover:bg-accent group min-h-[52px]">
                      <Plus className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-4 mt-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-primary/10 border border-primary/30"></span>Aula pendente</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-success/15 border border-success/30"></span>Aula paga</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-muted border border-border"></span>Bloqueio</span>
      </div>

      <LessonDialog open={dlgOpen} onOpenChange={setDlgOpen} slotStart={slotStart} lesson={editing} onSaved={load} />
    </div>
  );
}

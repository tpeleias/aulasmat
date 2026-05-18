import { useEffect, useMemo, useState, useCallback } from "react";
import { addDays, addMinutes, format, getDay, isSameDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, MapPin, Wifi } from "lucide-react";
import { LessonDialog } from "@/components/LessonDialog";
import { useDefaultTeacher } from "@/hooks/useDefaultTeacher";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";

type Lesson = { id: string; student_name: string; guardian_name: string | null; subject: string | null; start_at: string; duration_minutes: number; price: number; package_type: string; payment_status: string; notes: string | null; teacher: string; address: string | null; is_online: boolean };
type BlockException = { id: string; block_id: string; exception_date: string };
type Block = { id: string; title: string; block_type: string; start_at: string | null; end_at: string | null; weekday: number | null; start_time: string | null; end_time: string | null };
type Settings = { work_start: string; work_end: string; slot_minutes: number };

const CELL_H = 52; // px per hour
const HEADER_H = 56; // px for the day header row

export default function CalendarPage() {
  const defaultTeacher = useDefaultTeacher();
  const { teachers } = useTeachers(true);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  const [settings, setSettings] = useState<Settings>({ work_start: "08:00", work_end: "22:00", slot_minutes: 60 });
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [exceptions, setExceptions] = useState<BlockException[]>([]);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [slotStart, setSlotStart] = useState<Date | undefined>(undefined);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    const from = weekStart.toISOString();
    const to = addDays(weekStart, 7).toISOString();
    const [s, l, b, ex] = await Promise.all([
      supabase.from("settings").select("work_start, work_end, slot_minutes").eq("id", 1).maybeSingle(),
      supabase.from("lessons").select("*").gte("start_at", from).lt("start_at", to).order("start_at"),
      supabase.from("blocks").select("*"),
      supabase.from("block_exceptions").select("*"),
    ]);
    if (s.data) setSettings(s.data);
    setLessons((l.data ?? []) as Lesson[]);
    setBlocks((b.data ?? []) as Block[]);
    setExceptions((ex.data ?? []) as BlockException[]);
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);

  const [hStart, hEnd] = useMemo(() => {
    const [a] = settings.work_start.split(":").map(Number);
    const [c] = settings.work_end.split(":").map(Number);
    return [a, c];
  }, [settings]);

  const hours = useMemo(() => Array.from({ length: hEnd - hStart }, (_, i) => hStart + i), [hStart, hEnd]);
  const slotMin = settings.slot_minutes;

  const skipRecurringForDay = async (blockId: string, day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const { error } = await supabase.from("block_exceptions").insert({ block_id: blockId, exception_date: dateStr });
    if (error) console.error(error);
    load();
  };

  const filteredLessons = useMemo(
    () => lessons.filter(l => l.teacher === teacherFilter),
    [lessons, teacherFilter]
  );

  const teacherBlocks = useMemo(
    () => blocks.filter(b => (b as any).teacher === teacherFilter || (b as any).teacher === "both"),
    [blocks, teacherFilter]
  );

  const getBlockForCell = (day: Date, hour: number) => {
    const cellStart = new Date(day); cellStart.setHours(hour, 0, 0, 0);
    const cellEnd = addMinutes(cellStart, 60);

    const oneOff = teacherBlocks.find(b => b.block_type === "one_off" && b.start_at && b.end_at && new Date(b.start_at) < cellEnd && new Date(b.end_at) > cellStart);
    if (oneOff) return { label: oneOff.title, blockId: oneOff.id, recurring: false };

    const wd = getDay(day);
    const dateStr = format(day, "yyyy-MM-dd");
    const recur = teacherBlocks.find(b => {
      if (b.block_type !== "recurring" || b.weekday !== wd || !b.start_time || !b.end_time) return false;
      if (exceptions.some(e => e.block_id === b.id && e.exception_date === dateStr)) return false;
      const [sh, sm] = b.start_time.split(":").map(Number);
      const [eh, em] = b.end_time.split(":").map(Number);
      const bs = new Date(day); bs.setHours(sh, sm, 0, 0);
      const be = new Date(day); be.setHours(eh, em, 0, 0);
      return bs < cellEnd && be > cellStart;
    });
    if (recur) return { label: recur.title, blockId: recur.id, recurring: true };
    return null;
  };

  const renderLesson = (lesson: Lesson, day: Date) => {
    const ls = new Date(lesson.start_at);
    const minutesFromTop = (ls.getHours() - hStart) * 60 + ls.getMinutes();
    if (minutesFromTop < 0) return null;
    const top = (minutesFromTop * CELL_H) / 60;
    const height = (lesson.duration_minutes * CELL_H) / 60 - 2;
    const isMay = lesson.teacher === "mayara";
    return (
      <button
        key={lesson.id}
        onClick={(e) => { e.stopPropagation(); setEditing(lesson); setDlgOpen(true); }}
        style={{ top, height }}
        className={`absolute left-0.5 right-0.5 z-10 p-1.5 text-left text-xs rounded-sm overflow-hidden hover:opacity-90 border-l-2 ${lesson.payment_status === "pago" ? "bg-success/20" : isMay ? "bg-fuchsia-500/15" : "bg-primary/15"} ${isMay ? "border-l-fuchsia-500" : "border-l-primary"}`}
      >
        <div className={`font-semibold truncate pr-5 leading-tight ${isMay ? "text-fuchsia-700 dark:text-fuchsia-400" : "text-primary"}`}>{lesson.student_name}</div>
        <div className="text-[10px] text-muted-foreground truncate pr-5 leading-tight">
          {format(ls, "HH:mm")} · {lesson.subject}
        </div>
        {lesson.is_online ? (
          <span className="absolute top-1 right-1 p-0.5 text-muted-foreground" title="Aula on-line"><Wifi className="w-3 h-3" /></span>
        ) : lesson.address ? (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lesson.address)}`}
            target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-1 right-1 p-0.5 text-muted-foreground hover:text-primary"
            title="Abrir rota no Google Maps"
          ><MapPin className="w-3 h-3" /></a>
        ) : null}
      </button>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Calendário</h1>
          <p className="text-sm text-muted-foreground">{format(days[0], "dd 'de' MMM", { locale: ptBR })} — {format(days[6], "dd 'de' MMM yyyy", { locale: ptBR })}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="inline-flex rounded-md border border-border p-0.5 bg-muted">
            <button onClick={() => setTeacherFilter("thiago")} className={`px-3 py-1 text-xs rounded ${teacherFilter === "thiago" ? "bg-background shadow-sm font-medium text-primary" : "text-muted-foreground"}`}>Thiago</button>
            <button onClick={() => setTeacherFilter("mayara")} className={`px-3 py-1 text-xs rounded ${teacherFilter === "mayara" ? "bg-background shadow-sm font-medium text-fuchsia-600" : "text-muted-foreground"}`}>Mayara</button>
          </div>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoje</Button>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-[var(--shadow-card)] overflow-x-auto">
        <div className="min-w-[800px] flex">
          {/* time gutter */}
          <div className="w-[70px] shrink-0">
            <div style={{ height: HEADER_H }} className="border-b border-r border-border" />
            {hours.map(h => (
              <div key={h} style={{ height: CELL_H }} className="border-b border-r border-border text-[11px] text-muted-foreground text-right pr-2 pt-1">
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* day columns */}
          {days.map(d => {
            const dayLessons = filteredLessons.filter(l => isSameDay(new Date(l.start_at), d));
            return (
              <div key={d.toISOString()} className="flex-1 min-w-0 relative">
                <div
                  style={{ height: HEADER_H }}
                  className={`border-b border-border p-2 text-center text-xs ${isSameDay(d, new Date()) ? "bg-accent text-accent-foreground font-semibold" : ""}`}
                >
                  <div className="uppercase">{format(d, "EEE", { locale: ptBR })}</div>
                  <div className="text-base font-semibold">{format(d, "dd")}</div>
                </div>

                {/* hour cells (for clicks + blocks) */}
                <div className="relative">
                  {hours.map(h => {
                    const block = getBlockForCell(d, h);
                    if (block) {
                      return (
                        <div
                          key={h}
                          style={{ height: CELL_H, backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 4px, hsl(var(--border)) 4px, hsl(var(--border)) 5px)" }}
                          className="border-b border-l border-border p-1.5 text-xs bg-muted text-muted-foreground group relative"
                        >
                          <div className="truncate">{block.label}</div>
                          {block.recurring && (
                            <button
                              onClick={() => { if (confirm(`Liberar este horário em ${format(d, "dd/MM")}? A regra recorrente continua valendo nas outras semanas.`)) skipRecurringForDay(block.blockId!, d); }}
                              className="absolute inset-0 opacity-0 hover:opacity-100 hover:bg-background/80 flex items-center justify-center text-[10px] text-destructive font-medium"
                              title="Liberar somente este dia"
                            >Liberar este dia</button>
                          )}
                        </div>
                      );
                    }
                    const cellStart = new Date(d); cellStart.setHours(h, 0, 0, 0);
                    return (
                      <button
                        key={h}
                        style={{ height: CELL_H }}
                        onClick={() => { setEditing(null); setSlotStart(cellStart); setDlgOpen(true); }}
                        className="w-full border-b border-l border-border p-1.5 text-xs hover:bg-accent group"
                      >
                        <Plus className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary" />
                      </button>
                    );
                  })}

                  {/* absolute-positioned lessons overlay */}
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="relative w-full h-full">
                      {dayLessons.map(l => (
                        <div key={l.id} className="pointer-events-auto">
                          {renderLesson(l, d)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-4 mt-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-primary/15 border-l-2 border-primary"></span>Thiago</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-fuchsia-500/15 border-l-2 border-fuchsia-500"></span>Mayara</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-success/20 border border-success/30"></span>Aula paga</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-muted border border-border"></span>Bloqueio</span>
      </div>

      <LessonDialog open={dlgOpen} onOpenChange={setDlgOpen} slotStart={slotStart} lesson={editing} onSaved={load} defaultTeacher={defaultTeacher} />
    </div>
  );
}

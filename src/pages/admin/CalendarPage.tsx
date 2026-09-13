import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { addDays, addMinutes, format, getDay, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, MapPin, Wifi, CalendarDays } from "lucide-react";
import { LessonDialog } from "@/components/LessonDialog";
import { useDefaultTeacher } from "@/hooks/useDefaultTeacher";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { syncUpcomingLessonsWidget } from "@/lib/widgetSync";
import { haptics } from "@/lib/haptics";
import { useTapGuard } from "@/lib/tapGuard";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Lesson = { id: string; student_name: string; guardian_name: string | null; subject: string | null; start_at: string; duration_minutes: number; price: number; package_type: string; payment_status: string; notes: string | null; teacher: string; address: string | null; is_online: boolean };
type BlockException = { id: string; block_id: string; exception_date: string };
type Block = { id: string; title: string; block_type: string; start_at: string | null; end_at: string | null; weekday: number | null; start_time: string | null; end_time: string | null };
type Settings = { work_start: string; work_end: string; slot_minutes: number };

const CELL_H = 52; // px per hour
const HEADER_H = 56; // px for the day header row
type DayCount = 1 | 3 | 7;

const DAY_COUNTS: { value: DayCount; label: string }[] = [
  { value: 1, label: "1 dia" },
  { value: 3, label: "3 dias" },
  { value: 7, label: "Semana" },
];

const LONG_PRESS_MS = 500;

function openWaze(address: string) {
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, "_blank", "noopener,noreferrer");
}

export default function CalendarPage() {
  const defaultTeacher = useDefaultTeacher();
  const { teachers } = useTeachers(true);
  const [dayCount, setDayCount] = useState<DayCount>(() => {
    try {
      const saved = Number(localStorage.getItem("agenda_dias"));
      if (DAY_COUNTS.some(o => o.value === saved)) return saved as DayCount;
    } catch { /* blocked storage: the default is fine */ }
    return 1;
  });
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  // Which teachers the "Todos" summary shows. Empty means every one of them.
  const [hiddenInSummary, setHiddenInSummary] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("agenda_resumo_ocultos") || "[]");
      return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  });
  const [settings, setSettings] = useState<Settings>({ work_start: "08:00", work_end: "22:00", slot_minutes: 60 });
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [upcoming, setUpcoming] = useState<Lesson[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [exceptions, setExceptions] = useState<BlockException[]>([]);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [slotStart, setSlotStart] = useState<Date | undefined>(undefined);
  const [freeing, setFreeing] = useState<{ blockId: string; day: Date; label: string } | null>(null);
  const tapGuard = useTapGuard();

  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(anchor, i)),
    [anchor, dayCount]
  );

  // A week always starts on Monday; shorter ranges start wherever you are.
  const anchorFor = (date: Date, count: DayCount) =>
    count === 7 ? startOfWeek(date, { weekStartsOn: 1 }) : startOfDay(date);

  const chooseDayCount = (count: DayCount) => {
    setDayCount(count);
    setAnchor(a => anchorFor(a, count));
    try { localStorage.setItem("agenda_dias", String(count)); } catch { /* not worth failing over */ }
  };

  const shiftRange = (direction: -1 | 1) => setAnchor(a => addDays(a, direction * dayCount));
  const goToToday = () => setAnchor(anchorFor(new Date(), dayCount));

  const toggleSummaryTeacher = (slug: string) =>
    setHiddenInSummary(prev => {
      const next = prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug];
      try { localStorage.setItem("agenda_resumo_ocultos", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

  const load = useCallback(async () => {
    const from = anchor.toISOString();
    const to = addDays(anchor, dayCount).toISOString();
    const nowIso = new Date().toISOString();
    const nextSevenDaysIso = addDays(new Date(), 7).toISOString();
    const [s, l, b, ex, up] = await Promise.all([
      supabase.from("settings").select("work_start, work_end, slot_minutes").eq("id", 1).maybeSingle(),
      supabase.from("lessons").select("*").gte("start_at", from).lt("start_at", to).order("start_at"),
      supabase.from("blocks").select("*"),
      supabase.from("block_exceptions").select("*"),
      supabase.from("lessons").select("*").gte("start_at", nowIso).lt("start_at", nextSevenDaysIso).eq("status", "agendada").order("start_at").limit(100),
    ]);
    if (s.data) setSettings(s.data);
    setLessons((l.data ?? []) as Lesson[]);
    setBlocks((b.data ?? []) as Block[]);
    setExceptions((ex.data ?? []) as BlockException[]);
    const upcomingLessons = (up.data ?? []) as Lesson[];
    setUpcoming(upcomingLessons);
    syncUpcomingLessonsWidget(upcomingLessons);
  }, [anchor, dayCount]);

  useEffect(() => { load(); }, [load]);

  const [hStart, hEnd] = useMemo(() => {
    const [a] = settings.work_start.split(":").map(Number);
    const [c] = settings.work_end.split(":").map(Number);
    return [a, c];
  }, [settings]);

  const hours = useMemo(() => Array.from({ length: hEnd - hStart }, (_, i) => hStart + i), [hStart, hEnd]);
  const slotMin = settings.slot_minutes;

  const pressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const openEditFor = (lesson: Lesson) => {
    setEditing(lesson);
    setDlgOpen(true);
  };

  const handlePressStart = (lesson: Lesson) => {
    longPressFired.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      openEditFor(lesson);
    }, LONG_PRESS_MS);
  };

  const cancelPressTimer = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handlePressEnd = (lesson: Lesson) => {
    const wasLongPress = longPressFired.current;
    cancelPressTimer();
    if (wasLongPress) return;
    if (!lesson.is_online && lesson.address) {
      openWaze(lesson.address);
    } else {
      openEditFor(lesson);
    }
  };

  const skipRecurringForDay = async (blockId: string, day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const { error } = await supabase.from("block_exceptions").insert({ block_id: blockId, exception_date: dateStr });
    if (error) console.error(error);
    load();
  };

  const filteredLessons = useMemo(
    () => teacherFilter === "all" ? lessons : lessons.filter(l => l.teacher === teacherFilter),
    [lessons, teacherFilter]
  );

  const teacherBlocks = useMemo(
    () => teacherFilter === "all"
      ? blocks
      : blocks.filter(b => (b as any).teacher === teacherFilter || (b as any).teacher === "both"),
    [blocks, teacherFilter]
  );

  const upcomingByTeacher = useMemo(() => {
    const teacherNames = new Map(teachers.map(t => [teacherSlug(t.name), t.name]));
    const order = new Map(teachers.map((t, index) => [teacherSlug(t.name), index]));
    const grouped = upcoming.reduce<Record<string, Lesson[]>>((acc, lesson) => {
      const key = lesson.teacher || "sem-professor";
      acc[key] = acc[key] ?? [];
      acc[key].push(lesson);
      return acc;
    }, {});

    return Object.entries(grouped)
      .filter(([teacher]) => !hiddenInSummary.includes(teacher))
      .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b))
      .map(([teacher, items]) => ({
        teacher,
        label: teacherNames.get(teacher) ?? teacher,
        items,
      }));
  }, [teachers, upcoming, hiddenInSummary]);

  const shownUpcomingCount = useMemo(
    () => upcomingByTeacher.reduce((total, group) => total + group.items.length, 0),
    [upcomingByTeacher]
  );

  const getBlockForCell = (day: Date, hour: number) => {
    if (teacherFilter === "all") return null;
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

  // Lay out lessons side-by-side when they overlap.
  // Returns map from lesson id => { col, cols }.
  const layoutDayLessons = (dayLessons: Lesson[]) => {
    const items = dayLessons
      .map(l => {
        const s = new Date(l.start_at).getTime();
        return { id: l.id, start: s, end: s + l.duration_minutes * 60000 };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const colEnds: number[] = []; // end time per column
    const colOf: Record<string, number> = {};
    for (const it of items) {
      let placed = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= it.start) { placed = c; break; }
      }
      if (placed === -1) { placed = colEnds.length; colEnds.push(it.end); }
      else colEnds[placed] = it.end;
      colOf[it.id] = placed;
    }

    // For each item, compute the max concurrent columns among items it overlaps with.
    const result: Record<string, { col: number; cols: number }> = {};
    for (const it of items) {
      const overlapping = items.filter(o => o.start < it.end && o.end > it.start);
      const maxCol = Math.max(...overlapping.map(o => colOf[o.id]));
      result[it.id] = { col: colOf[it.id], cols: maxCol + 1 };
    }
    return result;
  };


  const renderLesson = (lesson: Lesson, day: Date, col: number, cols: number) => {
    const ls = new Date(lesson.start_at);
    const minutesFromTop = (ls.getHours() - hStart) * 60 + ls.getMinutes();
    if (minutesFromTop < 0) return null;
    const top = (minutesFromTop * CELL_H) / 60;
    const height = (lesson.duration_minutes * CELL_H) / 60 - 2;
    const isMay = lesson.teacher === "mayara";
    const widthPct = 100 / cols;
    const leftPct = col * widthPct;
    return (
      <button
        key={lesson.id}
        onClick={(e) => { e.stopPropagation(); setEditing(lesson); setDlgOpen(true); }}
        style={{ top, height, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
        className={`absolute z-10 p-1.5 text-left text-xs rounded-sm overflow-hidden hover:opacity-90 hover:z-20 border-l-2 shadow-sm ${lesson.payment_status === "pago" ? "bg-success/20" : isMay ? "bg-fuchsia-500/15" : "bg-primary/15"} ${isMay ? "border-l-fuchsia-500" : "border-l-primary"}`}
      >
        <div className={`font-semibold truncate leading-tight ${isMay ? "text-fuchsia-700 dark:text-fuchsia-400" : "text-primary"}`}>{lesson.student_name}</div>
        <div className="text-[10px] text-muted-foreground truncate leading-tight">
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

  const renderTimeGutter = () => (
    <div className="w-[56px] md:w-[70px] shrink-0">
      <div style={{ height: HEADER_H }} className="border-b border-r border-border" />
      {hours.map(h => (
        <div key={h} style={{ height: CELL_H }} className="border-b border-r border-border text-[10px] md:text-[11px] text-muted-foreground text-right pr-1 md:pr-2 pt-1">
          {String(h).padStart(2, "0")}:00
        </div>
      ))}
    </div>
  );

  const renderDayColumn = (d: Date) => {
    const dayLessons = filteredLessons.filter(l => isSameDay(new Date(l.start_at), d));
    const layout = layoutDayLessons(dayLessons);
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
                      {...tapGuard(() => { haptics.tap(); setFreeing({ blockId: block.blockId!, day: d, label: block.label }); })}
                      className="absolute inset-0 flex items-end justify-center pb-1 text-[10px] font-medium text-transparent hover:text-destructive focus-visible:text-destructive"
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
                {...tapGuard(() => { haptics.tap(); setEditing(null); setSlotStart(cellStart); setDlgOpen(true); })}
                className="w-full border-b border-l border-border p-1.5 text-xs hover:bg-accent group"
              >
                <Plus className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary" />
              </button>
            );
          })}

          {/* absolute-positioned lessons overlay */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="relative w-full h-full">
              {dayLessons.map(l => {
                const lay = layout[l.id] ?? { col: 0, cols: 1 };
                return (
                  <div key={l.id} className="pointer-events-auto">
                    {renderLesson(l, d, lay.col, lay.cols)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Calendário</h1>
          <p className="text-sm text-muted-foreground">
            {teacherFilter === "all"
              ? `Próximos 7 dias · ${format(new Date(), "dd 'de' MMM", { locale: ptBR })} — ${format(addDays(new Date(), 7), "dd 'de' MMM yyyy", { locale: ptBR })}`
              : days.length === 1
                ? format(days[0], "EEEE, dd 'de' MMM yyyy", { locale: ptBR })
                : `${format(days[0], "dd 'de' MMM", { locale: ptBR })} — ${format(days[days.length - 1], "dd 'de' MMM yyyy", { locale: ptBR })}`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="inline-flex rounded-md border border-border p-0.5 bg-muted flex-wrap">
            <button onClick={() => setTeacherFilter("all")} className={`px-3 py-1 text-xs rounded ${teacherFilter === "all" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Todos</button>
            {teachers.map(t => {
              const slug = teacherSlug(t.name);
              const active = teacherFilter === slug;
              return (
                <button key={t.id} onClick={() => setTeacherFilter(slug)} className={`px-3 py-1 text-xs rounded capitalize ${active ? "bg-background shadow-sm font-medium text-primary" : "text-muted-foreground"}`}>{t.name}</button>
              );
            })}
          </div>
          {teacherFilter !== "all" && (
            <>
              <div className="inline-flex rounded-md border border-border p-0.5 bg-muted">
                {DAY_COUNTS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => chooseDayCount(o.value)}
                    className={`px-3 py-1 text-xs rounded ${dayCount === o.value ? "bg-background shadow-sm font-medium text-primary" : "text-muted-foreground"}`}
                  >{o.label}</button>
                ))}
              </div>
              <Button variant="outline" size="icon" onClick={() => shiftRange(-1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" onClick={goToToday}>Hoje</Button>
              <Button variant="outline" size="icon" onClick={() => shiftRange(1)}><ChevronRight className="w-4 h-4" /></Button>
            </>
          )}
        </div>
      </div>

      {teacherFilter === "all" ? (
        <div className="bg-card rounded-xl shadow-[var(--shadow-card)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-primary" />
            <h2 className="font-semibold">Próximas aulas — próximos 7 dias</h2>
            <span className="text-xs text-muted-foreground">({shownUpcomingCount})</span>
          </div>

          {teachers.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Mostrar:</span>
              {teachers.map(t => {
                const slug = teacherSlug(t.name);
                const on = !hiddenInSummary.includes(slug);
                return (
                  <button
                    key={t.id}
                    onClick={() => { haptics.tap(); toggleSummaryTeacher(slug); }}
                    className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                      on ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"
                    }`}
                  >{t.name}</button>
                );
              })}
              {hiddenInSummary.length > 0 && (
                <button
                  onClick={() => { haptics.tap(); setHiddenInSummary([]); try { localStorage.removeItem("agenda_resumo_ocultos"); } catch { /* ignore */ } }}
                  className="rounded-full px-2 py-1 text-xs text-muted-foreground underline underline-offset-2"
                >Todos</button>
              )}
            </div>
          )}

          {shownUpcomingCount === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {upcoming.length === 0 ? "Nenhuma aula agendada nos próximos 7 dias." : "Nenhuma aula dos professores selecionados."}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {upcomingByTeacher.map(group => (
                <section key={group.teacher} className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold capitalize">{group.label}</h3>
                    <span className="text-xs text-muted-foreground">{group.items.length} aulas</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {group.items.map(l => {
                      const ls = new Date(l.start_at);
                      return (
                        <li key={l.id}>
                          <button
                            onPointerDown={() => handlePressStart(l)}
                            onPointerUp={() => handlePressEnd(l)}
                            onPointerLeave={cancelPressTimer}
                            onPointerCancel={cancelPressTimer}
                            onContextMenu={(e) => e.preventDefault()}
                            className="w-full border-l-2 border-l-primary py-3 pl-3 pr-2 text-left transition-colors hover:bg-accent select-none"
                          >
                            <div className="flex items-start gap-3">
                              <div className="shrink-0 w-20">
                                <div className="text-[10px] uppercase text-muted-foreground leading-tight">{format(ls, "EEE", { locale: ptBR })}</div>
                                <div className="text-sm font-semibold leading-tight">{format(ls, "dd/MM")}</div>
                                <div className="text-xs text-muted-foreground leading-tight">{format(ls, "HH:mm")}</div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="font-medium truncate">{l.student_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {l.subject ?? "—"} · {l.duration_minutes}min{l.is_online ? " · on-line" : ""}
                                </div>
                                {!l.is_online && l.address && (
                                  <div className="text-xs text-muted-foreground break-words">{l.address}</div>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="bg-card rounded-xl shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between border-b border-border p-1.5">
          <Button variant="ghost" size="icon" onClick={() => shiftRange(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <div className="text-sm font-semibold capitalize text-center">
            {days.length === 1
              ? format(days[0], "EEEE, dd 'de' MMM", { locale: ptBR })
              : `${format(days[0], "dd/MM")} — ${format(days[days.length - 1], "dd/MM")}`}
          </div>
          <Button variant="ghost" size="icon" onClick={() => shiftRange(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        {/* A week needs more width than a phone has, so only that range scrolls sideways. */}
        <div className="overflow-x-auto">
          <div className={`flex ${dayCount === 7 ? "min-w-[760px]" : dayCount === 3 ? "min-w-[330px]" : ""}`}>
            {renderTimeGutter()}
            {days.map(d => renderDayColumn(d))}
          </div>
        </div>
      </div>
      )}

      <div className="flex gap-4 mt-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-primary/15 border-l-2 border-primary"></span>Thiago</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-fuchsia-500/15 border-l-2 border-fuchsia-500"></span>Mayara</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-success/20 border border-success/30"></span>Aula paga</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-muted border border-border"></span>Bloqueio</span>
      </div>

      <LessonDialog open={dlgOpen} onOpenChange={setDlgOpen} slotStart={slotStart} lesson={editing} onSaved={load} defaultTeacher={defaultTeacher} />

      <AlertDialog open={!!freeing} onOpenChange={v => !v && setFreeing(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar este horário?</AlertDialogTitle>
            <AlertDialogDescription>
              {freeing && `"${freeing.label}" sai da agenda em ${format(freeing.day, "EEEE, dd/MM", { locale: ptBR })}. A regra recorrente continua valendo nas outras semanas.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl"
              onClick={() => { if (freeing) skipRecurringForDay(freeing.blockId, freeing.day); setFreeing(null); }}
            >Liberar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

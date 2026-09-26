import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { addDays, addMinutes, format, getDay, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, MapPin, Wifi, CalendarDays } from "lucide-react";
import { LessonDialog } from "@/components/LessonDialog";
import { useDefaultTeacher } from "@/hooks/useDefaultTeacher";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { teacherColor, colorOf } from "@/lib/teacherColors";
import { useServices } from "@/hooks/useServices";
import { isDiscarded, isRequest } from "@/lib/lessonStatus";
import { capitalize } from "@/lib/balance";
import { phoneFinder, syncUpcomingLessonsWidget } from "@/lib/widgetSync";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { haptics } from "@/lib/haptics";
import { useTapGuard } from "@/lib/tapGuard";
import { Capacitor } from "@capacitor/core";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWords } from "@/hooks/useVocabulary";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/hooks/useAuth";

import { dateLocale, L } from "@/lib/i18n";
type Lesson = { id: string; student_name: string; guardian_name: string | null; subject: string | null; start_at: string; duration_minutes: number; price: number; package_type: string; payment_status: string; notes: string | null; teacher: string; address: string | null; is_online: boolean; status?: string | null };
type BlockException = { id: string; block_id: string; exception_date: string };
type Block = { id: string; title: string; block_type: string; start_at: string | null; end_at: string | null; weekday: number | null; start_time: string | null; end_time: string | null };
type Settings = { work_start: string; work_end: string; slot_minutes: number };

const CELL_H = 52; // px per hour
const HEADER_H = 56; // px for the day header row
type DayCount = 1 | 3 | 7;

const DAY_COUNTS: { value: DayCount; label: string }[] = [
  { value: 1, label: L("1 dia", "1 day") },
  { value: 3, label: L("3 dias", "3 days") },
  { value: 7, label: L("Semana", "Week") },
];

const LONG_PRESS_MS = 500;

// A week always starts on Sunday; shorter ranges start wherever you are.
function anchorFor(date: Date, count: DayCount) {
  return count === 7 ? startOfWeek(date, { weekStartsOn: 0 }) : startOfDay(date);
}

function openWaze(address: string) {
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, "_blank", "noopener,noreferrer");
}

export default function CalendarPage() {
  const defaultTeacher = useDefaultTeacher();
  const w = useWords();
  const ap = w.appointment;
  const { teachers: allTeachers } = useTeachers(true);
  // Professor só vê a agenda dele: nem abas, nem legenda, nem bloqueio dos outros.
  const { isTeacher } = useAuth();
  const teachers = useMemo(
    () => isTeacher ? allTeachers.filter(t => teacherSlug(t.name) === defaultTeacher) : allTeachers,
    [allTeachers, isTeacher, defaultTeacher],
  );
  const [dayCount, setDayCount] = useState<DayCount>(() => {
    try {
      const saved = Number(localStorage.getItem("agenda_dias"));
      if (DAY_COUNTS.some(o => o.value === saved)) return saved as DayCount;
    } catch { /* blocked storage: the default is fine */ }
    return 1;
  });
  const [anchor, setAnchor] = useState<Date>(() => anchorFor(new Date(), dayCount));
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  // Which teachers the "Todos" summary shows. Empty means every one of them.
  const [hiddenInSummary, setHiddenInSummary] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("agenda_resumo_ocultos") || "[]");
      return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  });
  const [settings, setSettings] = useState<Settings>({ work_start: "08:00", work_end: "22:00", slot_minutes: 60 });
  // WhatsApp de cada cliente, para o atalho de lembrete no widget.
  const [phones, setPhones] = useState<{ student_name: string; guardian_name: string | null; whatsapp: string | null }[]>([]);
  const { plan } = usePlan();
  // Professor abre direto na agenda dele (o resumo "Todos" é da empresa).
  useEffect(() => {
    if (isTeacher && defaultTeacher) setTeacherFilter(defaultTeacher);
  }, [isTeacher, defaultTeacher]);
  const { templates } = useMessageTemplates();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [upcoming, setUpcoming] = useState<Lesson[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [exceptions, setExceptions] = useState<BlockException[]>([]);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [slotStart, setSlotStart] = useState<Date | undefined>(undefined);
  const [freeing, setFreeing] = useState<{ blockId: string; day: Date; label: string } | null>(null);
  // No app, um toque só abre a aula depois de um instante sem rolagem - o
  // pedido foi não abrir sem querer ao rolar a agenda com o dedo em cima dela.
  const tapGuard = useTapGuard({ delayMs: Capacitor.isNativePlatform() ? 160 : 0 });
  const lessonTap = (lesson: Lesson) => tapGuard(() => { haptics.tap(); setEditing(lesson); setDlgOpen(true); });

  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(anchor, i)),
    [anchor, dayCount]
  );

  // A posição nesta lista é o que define a cor de cada professor na agenda.
  const teacherSlugs = useMemo(() => teachers.map(t => teacherSlug(t.name)), [teachers]);
  // A cor que o admin escolheu para cada um (em Profissionais) vale mais.
  const { services } = useServices(false);
  const serviceColor = (l: object) => colorOf(services?.find(s => s.id === (l as { service_id?: string | null }).service_id)?.color);
  const chosenColors = useMemo(() => Object.fromEntries(teachers.map(t => [teacherSlug(t.name), t.color])), [teachers]);

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
      supabase.from("settings").select("work_start, work_end, slot_minutes").maybeSingle(),
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
    // "*" e não a lista: whatsapp só existe depois da migration 20260925070000.
    const { data: st } = await supabase.from("students").select("*");
    setPhones(((st ?? []) as { student_name: string; guardian_name: string | null; whatsapp?: string | null }[])
      .map(x => ({ student_name: x.student_name, guardian_name: x.guardian_name, whatsapp: x.whatsapp ?? null })));
  }, [anchor, dayCount]);

  useEffect(() => { load(); }, [load]);
  // Google Agenda: ao abrir a agenda, puxa o ocupado de lá (a função ignora quem
  // sincronizou há menos de 2 minutos) e relê se algo veio.
  useEffect(() => {
    if (!plan.google_calendar) return;
    supabase.functions.invoke("google-calendar", { body: { action: "sync" } })
      .then(({ data }) => { if (data?.synced > 0) load(); })
      .catch(() => {});
  }, [plan.google_calendar]); // eslint-disable-line react-hooks/exhaustive-deps
  // Separado do load: os professores chegam depois, e a cor do widget depende
  // da ordem deles.
  useEffect(() => {
    syncUpcomingLessonsWidget(upcoming, teacherSlugs, {
      words: w, remind: !!plan.whatsapp_link, locate: !!plan.arrival_location, phoneOf: phoneFinder(phones), templates,
    });
  }, [upcoming, teacherSlugs, phones, plan.whatsapp_link, plan.arrival_location, w, templates]);

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
    if (oneOff) return {
      label: (oneOff as { source?: string }).source === "google" ? L("Ocupado (Google)", "Busy (Google)") : oneOff.title,
      blockId: oneOff.id, recurring: false,
    };

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
    const color = teacherColor(lesson.teacher, teacherSlugs, chosenColors);
    // Cancelada/recusada saem riscadas em vermelho; pedido sem resposta fica com
    // borda tracejada, porque não é aula até o professor aprovar.
    const isCancelled = isDiscarded(lesson.status);
    const isPending = isRequest(lesson.status);
    const widthPct = 100 / cols;
    const leftPct = col * widthPct;
    return (
      <button
        key={lesson.id}
        onPointerDown={lessonTap(lesson).onPointerDown}
        onClick={(e) => { e.stopPropagation(); lessonTap(lesson).onClick(e); }}
        style={{ top, height, left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }}
        className={`absolute z-10 p-1.5 text-left text-xs rounded-sm overflow-hidden hover:opacity-90 hover:z-20 border-l-2 shadow-sm ${isCancelled ? "bg-destructive/15" : isPending ? "bg-muted/60 border border-dashed" : lesson.payment_status === "pago" ? "bg-success/20" : color.bg} ${isCancelled ? "border-l-destructive" : color.border}`}
      >
        <div className={`font-semibold truncate leading-tight ${isCancelled ? "text-destructive line-through" : color.text}`}>{lesson.student_name}</div>
        <div className="text-[10px] text-muted-foreground truncate leading-tight">
          {isPending ? `${format(ls, "HH:mm")} · pedido`
            : (lesson as { absence_charged?: boolean }).absence_charged ? `${format(ls, "HH:mm")} · ${L("falta cobrada", "no-show charged")}`
            : `${format(ls, "HH:mm")} · ${lesson.subject ?? ap.s}`}
        </div>
        {lesson.is_online ? (
          <span className="absolute top-1 right-1 p-0.5 text-muted-foreground" title={L(`${ap.s} on-line`, `Online ${ap.l}`)}><Wifi className="w-3 h-3" /></span>
        ) : lesson.address ? (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lesson.address)}`}
            target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-1 right-1 p-0.5 text-muted-foreground hover:text-primary"
            title={L("Abrir rota no Google Maps", "Open route in Google Maps")}
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
          <div className="uppercase">{format(d, "EEE", { locale: dateLocale() })}</div>
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
                      title={L("Liberar somente este dia", "Free up this day only")}
                    >{L("Liberar este dia", "Free this day")}</button>
                  )}
                </div>
              );
            }
            const cellStart = new Date(d); cellStart.setHours(h, 0, 0, 0);
            return (
              <button
                key={h}
                style={{ height: CELL_H }}
                {...tapGuard(() => { if (isTeacher) return; haptics.tap(); setEditing(null); setSlotStart(cellStart); setDlgOpen(true); })}
                className={`w-full border-b border-l border-border p-1.5 text-xs group ${isTeacher ? "cursor-default" : "hover:bg-accent"}`}
              >
                {!isTeacher && <Plus className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary" />}
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
    // Segurar o dedo na agenda selecionava texto e o Android abria a barra
    // "Copiar, Compartilhar..." que não saía mais. Nada aqui é texto para
    // copiar: sem seleção e sem o menu de toque longo. O diálogo de aula abre
    // em portal (fora desta div no DOM), então o CSS não chega nos campos dele;
    // já o onContextMenu do React atravessa portal, por isso poupa campos de
    // texto - senão o "colar" dos inputs do diálogo sumiria junto.
    <div
      className="select-none [-webkit-touch-callout:none]"
      onContextMenu={(e) => {
        if (!(e.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) e.preventDefault();
      }}
    >
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{L("Calendário", "Calendar")}</h1>
          <p className="text-sm text-muted-foreground">
            {teacherFilter === "all"
              ? `${L("Próximos 7 dias", "Next 7 days")} · ${format(new Date(), L("dd 'de' MMM", "MMM d"), { locale: dateLocale() })} — ${format(addDays(new Date(), 7), L("dd 'de' MMM yyyy", "MMM d, yyyy"), { locale: dateLocale() })}`
              : days.length === 1
                ? format(days[0], L("EEEE, dd 'de' MMM yyyy", "EEEE, MMM d, yyyy"), { locale: dateLocale() })
                : `${format(days[0], L("dd 'de' MMM", "MMM d"), { locale: dateLocale() })} — ${format(days[days.length - 1], L("dd 'de' MMM yyyy", "MMM d, yyyy"), { locale: dateLocale() })}`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!isTeacher && <div className="inline-flex rounded-md border border-border p-0.5 bg-muted flex-wrap">
            <button onClick={() => setTeacherFilter("all")} className={`px-3 py-1 text-xs rounded ${teacherFilter === "all" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>{L("Todos", "All")}</button>
            {teachers.map(t => {
              const slug = teacherSlug(t.name);
              const active = teacherFilter === slug;
              return (
                <button key={t.id} onClick={() => setTeacherFilter(slug)} className={`px-3 py-1 text-xs rounded capitalize ${active ? "bg-background shadow-sm font-medium text-primary" : "text-muted-foreground"}`}>{t.name}</button>
              );
            })}
          </div>}
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
              <Button variant="outline" onClick={goToToday}>{L("Hoje", "Today")}</Button>
              <Button variant="outline" size="icon" onClick={() => shiftRange(1)}><ChevronRight className="w-4 h-4" /></Button>
            </>
          )}
        </div>
      </div>

      {teacherFilter === "all" ? (
        <div className="bg-card rounded-xl shadow-[var(--shadow-card)] p-5">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays className="w-4 h-4 text-primary" />
            <h2 className="font-semibold">{L(`${ap.proximos} ${ap.lp} — próximos 7 dias`, `Upcoming ${ap.lp} — next 7 days`)}</h2>
            <span className="text-xs text-muted-foreground">({shownUpcomingCount})</span>
          </div>

          {teachers.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{L("Mostrar:", "Show:")}</span>
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
                >{L("Todos", "All")}</button>
              )}
            </div>
          )}

          {shownUpcomingCount === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {upcoming.length === 0
                ? L(`${ap.nenhum} ${ap.l} ${ap.pick("agendado", "agendada")} nos próximos 7 dias.`, `No ${ap.lp} booked in the next 7 days.`)
                : L(`${ap.nenhum} ${ap.l} ${w.staff.dos} ${w.staff.lp} ${w.staff.pick("selecionados", "selecionadas")}.`, `No ${ap.lp} for the selected ${w.staff.lp}.`)}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {upcomingByTeacher.map(group => (
                <section key={group.teacher} className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold capitalize">{group.label}</h3>
                    <span className="text-xs text-muted-foreground">{group.items.length} {group.items.length === 1 ? ap.l : ap.lp}</span>
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
                            className={`w-full border-l-2 ${teacherColor(l.teacher, teacherSlugs, chosenColors).border} py-3 pl-3 pr-2 text-left transition-colors hover:bg-accent select-none`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="shrink-0 w-20">
                                <div className="text-[10px] uppercase text-muted-foreground leading-tight">{format(ls, "EEE", { locale: dateLocale() })}</div>
                                <div className="text-sm font-semibold leading-tight">{format(ls, L("dd/MM", "MMM d"))}</div>
                                <div className="text-xs text-muted-foreground leading-tight">{format(ls, "HH:mm")}</div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="font-medium truncate">{l.student_name}</div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  {serviceColor(l) && <span className={`h-2 w-2 shrink-0 rounded-full ${serviceColor(l)!.dot}`} />}
                                  {l.subject ?? "—"} · {l.duration_minutes}min{l.is_online ? L(" · on-line", " · online") : ""}
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
              ? format(days[0], L("EEEE, dd 'de' MMM", "EEEE, MMM d"), { locale: dateLocale() })
              : `${format(days[0], L("dd/MM", "MMM d"))} — ${format(days[days.length - 1], L("dd/MM", "MMM d"))}`}
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
        {teachers.map(t => {
          const color = teacherColor(teacherSlug(t.name), teacherSlugs, chosenColors);
          return (
            <span key={t.id} className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded border-l-2 ${color.bg} ${color.border}`}></span>
              {capitalize(t.name)}
            </span>
          );
        })}
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-success/20 border border-success/30"></span>{L(`${ap.s} ${ap.pick("pago", "paga")}`, `Paid ${ap.l}`)}</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-muted border border-border"></span>{L("Bloqueio", "Time off")}</span>
      </div>

      <LessonDialog open={dlgOpen} onOpenChange={setDlgOpen} slotStart={slotStart} lesson={editing} onSaved={load} defaultTeacher={defaultTeacher} />

      <AlertDialog open={!!freeing} onOpenChange={v => !v && setFreeing(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{L("Liberar este horário?", "Free up this time?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {freeing && L(`"${freeing.label}" sai da agenda em ${format(freeing.day, "EEEE, dd/MM", { locale: dateLocale() })}. A regra recorrente continua valendo nas outras semanas.`,
                `"${freeing.label}" is removed from ${format(freeing.day, "EEEE, MMM d", { locale: dateLocale() })}. The recurring rule still applies on other weeks.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">{L("Cancelar", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl"
              onClick={() => { if (freeing) skipRecurringForDay(freeing.blockId, freeing.day); setFreeing(null); }}
            >{L("Liberar", "Free up")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

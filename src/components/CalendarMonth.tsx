import { useMemo, useState } from "react";
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWords } from "@/hooks/useVocabulary";
import { haptics } from "@/lib/haptics";
import { dateLocale, L, timeFmt } from "@/lib/i18n";
import { isDiscarded, isRequest } from "@/lib/lessonStatus";
import { teacherColor } from "@/lib/teacherColors";
import { cn } from "@/lib/utils";

export type MonthLesson = { id: string; student_name: string; subject: string | null; start_at: string; duration_minutes: number; teacher: string; is_online: boolean; address: string | null; status?: string | null; payment_status?: string };

/** As semanas que a grade do mês mostra (domingo a sábado, de 4 a 6 linhas). */
export function monthGrid(month: Date): Date[] {
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const last = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days: Date[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

const MAX_CHIPS = 3;

/**
 * A visão do mês (06/10, a pedido da esposa do Thiago). No computador, cada
 * dia mostra até 3 atendimentos (hora e nome) e "+N"; no celular a grade só
 * tem pontinhos na cor de cada profissional, e o dia tocado aparece em lista
 * embaixo - o mês inteiro com nomes não cabe numa tela de celular.
 * Cancelados e recusados não entram; pedidos aparecem tracejados.
 */
export function CalendarMonth({ month, lessons, teacherSlugs, chosenColors, onOpenLesson, onOpenDay, onNewOnDay }: {
  month: Date;
  lessons: MonthLesson[];
  teacherSlugs: string[];
  chosenColors: Record<string, string | null | undefined>;
  onOpenLesson: (l: MonthLesson) => void;
  /** Ver o dia inteiro na visão de 1 dia. */
  onOpenDay: (d: Date) => void;
  onNewOnDay: (d: Date) => void;
}) {
  const w = useWords();
  const ap = w.appointment;
  const mobile = useIsMobile();
  const today = new Date();
  const days = useMemo(() => monthGrid(month), [month]);
  const [picked, setPicked] = useState<Date>(() => (isSameMonth(today, month) ? today : startOfMonth(month)));
  const pickedInMonth = isSameMonth(picked, month) ? picked : startOfMonth(month);

  const byDay = useMemo(() => {
    const map = new Map<string, MonthLesson[]>();
    for (const l of lessons) {
      if (isDiscarded(l.status)) continue;
      const k = format(new Date(l.start_at), "yyyy-MM-dd");
      map.set(k, [...(map.get(k) ?? []), l]);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return map;
  }, [lessons]);
  const dayLessons = (d: Date) => byDay.get(format(d, "yyyy-MM-dd")) ?? [];
  const weekdays = days.slice(0, 7).map(d => format(d, mobile ? "EEEEE" : "EEE", { locale: dateLocale() }));
  const total = useMemo(() => [...byDay.entries()].filter(([k]) => k.startsWith(format(month, "yyyy-MM"))).reduce((s, [, v]) => s + v.length, 0), [byDay, month]);

  const chip = (l: MonthLesson) => {
    const c = teacherColor(l.teacher, teacherSlugs, chosenColors);
    return (
      <button key={l.id} type="button" onClick={e => { e.stopPropagation(); haptics.tap(); onOpenLesson(l); }}
        className={cn("block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight border-l-2 hover:opacity-80",
          c.bg, c.border, isRequest(l.status) && "border border-dashed bg-muted/60")}
        title={`${format(new Date(l.start_at), timeFmt())} · ${l.student_name}${l.subject ? ` · ${l.subject}` : ""}`}>
        <span className="font-semibold tabular-nums">{format(new Date(l.start_at), timeFmt())}</span> {l.student_name}
      </button>
    );
  };

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium uppercase text-muted-foreground">
        {weekdays.map((d, i) => <div key={i} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map(d => {
          const list = dayLessons(d);
          const inMonth = isSameMonth(d, month);
          const isToday = isSameDay(d, today);
          const isPicked = mobile && isSameDay(d, pickedInMonth);
          const number = (
            <span className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums",
              isToday && "bg-primary font-semibold text-primary-foreground", !inMonth && "text-muted-foreground/60")}>
              {format(d, "d")}
            </span>
          );
          if (mobile) {
            const teachersOfDay = [...new Set(list.map(l => l.teacher))].slice(0, 3);
            return (
              <button key={d.toISOString()} type="button" onClick={() => { haptics.tap(); setPicked(d); }}
                aria-label={`${format(d, L("d 'de' MMMM", "MMMM d"), { locale: dateLocale() })}: ${list.length} ${list.length === 1 ? ap.l : ap.lp}`}
                aria-pressed={isPicked}
                className={cn("flex h-14 flex-col items-center gap-1 border-b border-r border-border pt-1",
                  isPicked && "bg-primary/10", !inMonth && "bg-muted/30")}>
                {number}
                {list.length > 0 && (
                  <span className="flex items-center gap-0.5">
                    {teachersOfDay.map(t => <span key={t} className={cn("h-1.5 w-1.5 rounded-full", teacherColor(t, teacherSlugs, chosenColors).dot)} />)}
                    {list.length > 1 && <span className="text-[9px] leading-none text-muted-foreground">{list.length}</span>}
                  </span>
                )}
              </button>
            );
          }
          return (
            <div key={d.toISOString()} onClick={() => onOpenDay(d)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter") onOpenDay(d); }}
              className={cn("group min-h-[104px] cursor-pointer space-y-0.5 border-b border-r border-border p-1 hover:bg-accent/40",
                !inMonth && "bg-muted/30")}>
              <div className="flex items-center justify-between">
                {number}
                <button type="button" aria-label={L(`Marcar ${ap.um} ${ap.l} neste dia`, `Book a ${ap.l} on this day`)}
                  onClick={e => { e.stopPropagation(); onNewOnDay(d); }}
                  className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100 focus:opacity-100">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {list.slice(0, MAX_CHIPS).map(chip)}
              {list.length > MAX_CHIPS && (
                <button type="button" onClick={e => { e.stopPropagation(); onOpenDay(d); }}
                  className="w-full rounded px-1 text-left text-[11px] font-medium text-primary hover:underline">
                  {L(`+${list.length - MAX_CHIPS} mais`, `+${list.length - MAX_CHIPS} more`)}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {mobile && (
        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold first-letter:uppercase">{format(pickedInMonth, L("EEEE, d 'de' MMMM", "EEEE, MMMM d"), { locale: dateLocale() })}</h3>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs" onClick={() => onOpenDay(pickedInMonth)}>{L("Ver o dia", "Open day")}</Button>
              <Button size="icon" variant="outline" className="h-8 w-8 rounded-xl" aria-label={L(`Marcar ${ap.um} ${ap.l}`, `Book a ${ap.l}`)} onClick={() => onNewOnDay(pickedInMonth)}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>
          {dayLessons(pickedInMonth).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{L(`${ap.nenhum} ${ap.l} neste dia.`, `No ${ap.lp} on this day.`)}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {dayLessons(pickedInMonth).map(l => {
                const c = teacherColor(l.teacher, teacherSlugs, chosenColors);
                return (
                  <li key={l.id}>
                    <button type="button" onClick={() => { haptics.tap(); onOpenLesson(l); }}
                      className={cn("flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left", c.border, isRequest(l.status) && "border-dashed")}>
                      <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">{format(new Date(l.start_at), timeFmt())}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{l.student_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {l.subject ?? ap.s} · {l.duration_minutes} min{l.is_online ? L(" · on-line", " · online") : l.address ? ` · ${l.address}` : ""}
                          {isRequest(l.status) ? L(" · pedido", " · request") : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <p className="px-3 pb-3 text-xs text-muted-foreground">{total} {total === 1 ? ap.l : ap.lp} {L("no mês", "this month")}</p>
    </div>
  );
}

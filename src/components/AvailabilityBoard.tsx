import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { addDays, startOfDay, format } from "date-fns";
import { computeFreeSlots, padRanges, fmtTime, pickScarcityCandidates, scarcityFor, SCARCITY_DEFAULT } from "@/lib/availability";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Flame } from "lucide-react";

import { dateLocale, L } from "@/lib/i18n";
type Props = { teacher?: string };

export function AvailabilityBoard({ teacher }: Props) {
  const { teachers } = useTeachers(true);
  const [slotsByDay, setSlotsByDay] = useState<{ day: Date; slots: { start: Date; end: Date }[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const from = startOfDay(new Date());
      const to = addDays(from, 5);
      const busyCall = teacher
        ? supabase.rpc("get_busy_ranges_by_teacher", { _from: from.toISOString(), _to: to.toISOString(), _teacher: teacher })
        : supabase.rpc("get_busy_ranges", { _from: from.toISOString(), _to: to.toISOString() });
      const recCall = teacher
        ? supabase.rpc("get_recurring_blocks_by_teacher", { _teacher: teacher })
        : supabase.rpc("get_recurring_blocks");
      const lessonsCall = (teacher
        ? supabase.from("lessons").select("start_at, duration_minutes").eq("teacher", teacher)
        : supabase.from("lessons").select("start_at, duration_minutes")
      ).gte("start_at", from.toISOString()).lt("start_at", to.toISOString());
      const [settingsR, busyR, recR, lessonsR] = await Promise.all([
        supabase.from("settings").select("work_start, work_end, slot_minutes, scarcity, buffer_minutes").maybeSingle(),
        busyCall,
        recCall,
        lessonsCall,
      ]);
      if (cancelled) return;
      const s: any = settingsR.data ?? { work_start: "08:00", work_end: "22:00", slot_minutes: 60, scarcity: SCARCITY_DEFAULT };
      const busy = (busyR.data ?? []).map((r: any) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }));
      const lessonRanges = (lessonsR.data ?? []).map((l: any) => ({
        start: new Date(l.start_at),
        end: new Date(new Date(l.start_at).getTime() + (l.duration_minutes ?? 60) * 60000),
      }));
      const blocksOnly = busy.filter(b => !lessonRanges.some(l => l.start.getTime() === b.start.getTime() && l.end.getTime() === b.end.getTime()));
      const rec = (recR.data ?? []) as any[];
      const free = computeFreeSlots(from, 5, s.work_start, s.work_end, s.slot_minutes, padRanges(busy, ((s as any)?.buffer_minutes) ?? 0), rec);
      const candidatesPool = computeFreeSlots(from, 5, s.work_start, s.work_end, s.slot_minutes, blocksOnly, rec);
      const now = new Date();
      const grouped: { day: Date; slots: { start: Date; end: Date }[] }[] = [];
      for (let i = 0; i < 5; i++) {
        const day = addDays(from, i);
        const sameDay = (d: Date) => d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
        const dayCandidates = candidatesPool.filter(f => sameDay(f.start) && f.end > now).map(f => f.start);
        const freeStartTimes = new Set(free.filter(f => sameDay(f.start) && f.end > now).map(f => f.start.getTime()));
        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
        const { min: minN, max: maxN } = scarcityFor(day, s.scarcity, teachers.find(t => teacherSlug(t.name) === teacher)?.scarcity);
        const picked = pickScarcityCandidates(day, dayCandidates, teacher ?? "all", minN, maxN);
        const visible = picked
          .filter(start => freeStartTimes.has(start.getTime()))
          .map(start => ({ start, end: new Date(start.getTime() + s.slot_minutes * 60000) }));
        grouped.push({ day, slots: visible });
      }
      setSlotsByDay(grouped);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // A lista de profissionais chega depois: sem ela, a escassez própria do
    // profissional era ignorada e o quadro mostrava horários diferentes da
    // página /disponibilidade/<profissional>.
  }, [teacher, teachers]);

  if (loading) return <p className="text-center text-muted-foreground py-12">{L("Carregando…", "Loading…")}</p>;

  return (
    <div className="space-y-6">
      {slotsByDay.map(({ day, slots }) => (
        <div key={day.toISOString()}>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {format(day, L("EEEE, dd 'de' MMMM", "EEEE, MMMM d"), { locale: dateLocale() })}
            </h3>
            {slots.length > 0 && slots.length <= 2 && (
              <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1 animate-pulse">
                <Flame className="w-3 h-3" /> {slots.length === 1 ? L("Último horário!", "Last slot!") : L("Restam poucos horários!", "Only a few slots left!")}
              </Badge>
            )}
          </div>
          {slots.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground text-center">{L("Sem horários livres neste dia.", "No free times on this day.")}</Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {slots.map(s => (
                <div key={s.start.toISOString()} className="bg-card border border-border rounded-lg p-3 text-center shadow-[var(--shadow-card)]">
                  <Clock className="w-3 h-3 inline mr-1 text-primary" />
                  <span className="font-semibold">{fmtTime(s.start)}</span>
                  <div className="text-[10px] text-muted-foreground">{L("até", "to")} {fmtTime(s.end)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default AvailabilityBoard;

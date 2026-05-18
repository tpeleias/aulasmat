import { useEffect, useMemo, useState } from "react";
import { addDays, startOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { useTeachers } from "@/hooks/useTeachers";
import { computeFreeSlots, fmtTime, pickScarcityCandidates } from "@/lib/availability";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Calendar, Clock, AlertCircle, Flame } from "lucide-react";
import { Navigate } from "react-router-dom";
import { capitalize } from "@/lib/balance";

const DAYS_AHEAD = 5;

export default function StudentBooking() {
  const settings = useAppSettings();
  const { student } = useStudent();
  const { teachers } = useTeachers(true);
  const [teacher, setTeacher] = useState<string>("");
  const [slotsByDay, setSlotsByDay] = useState<{ day: Date; slots: { start: Date; end: Date }[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!teacher && teachers[0]) setTeacher(teachers[0].name); }, [teachers, teacher]);

  const load = async () => {
    if (!teacher || !settings) return;
    setLoading(true);
    const from = startOfDay(new Date());
    const to = addDays(from, DAYS_AHEAD);
    const [busyR, recR, lessonsR] = await Promise.all([
      supabase.rpc("get_busy_ranges_by_teacher", { _from: from.toISOString(), _to: to.toISOString(), _teacher: teacher }),
      supabase.rpc("get_recurring_blocks_by_teacher", { _teacher: teacher }),
      supabase.from("lessons").select("start_at, duration_minutes").eq("teacher", teacher).gte("start_at", from.toISOString()).lt("start_at", to.toISOString()),
    ]);
    const busyRanges = (busyR.data ?? []).map((r: any) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }));
    const lessonRanges = (lessonsR.data ?? []).map((l: any) => ({
      start: new Date(l.start_at),
      end: new Date(new Date(l.start_at).getTime() + (l.duration_minutes ?? 60) * 60000),
    }));
    // Candidate pool ignores lessons so the scarcity "shop window" stays fixed
    const blocksOnly = busyRanges.filter(b => !lessonRanges.some(l => l.start.getTime() === b.start.getTime() && l.end.getTime() === b.end.getTime()));
    const rec = (recR.data ?? []) as any[];
    const free = computeFreeSlots(from, DAYS_AHEAD, settings.work_start, settings.work_end, settings.slot_minutes, busyRanges, rec);
    const candidatesPool = computeFreeSlots(from, DAYS_AHEAD, settings.work_start, settings.work_end, settings.slot_minutes, blocksOnly, rec);
    const s: any = settings;
    const now = new Date();
    const grouped: { day: Date; slots: { start: Date; end: Date }[] }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const day = addDays(from, i);
      const sameDay = (d: Date) => d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
      const dayCandidates = candidatesPool.filter(f => sameDay(f.start) && f.end > now).map(f => f.start);
      const freeStartTimes = new Set(free.filter(f => sameDay(f.start) && f.end > now).map(f => f.start.getTime()));
      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
      const minN = isWeekend ? (s.scarcity_weekend_min ?? 3) : (s.scarcity_weekday_min ?? 1);
      const maxN = isWeekend ? (s.scarcity_weekend_max ?? 7) : (s.scarcity_weekday_max ?? 3);
      const picked = pickScarcityCandidates(day, dayCandidates, teacher, minN, maxN);
      const visible = picked
        .filter(start => freeStartTimes.has(start.getTime()))
        .map(start => ({ start, end: new Date(start.getTime() + settings.slot_minutes * 60000) }));
      grouped.push({ day, slots: visible });
    }
    setSlotsByDay(grouped);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [teacher, settings?.work_start]);

  const book = async (start: Date) => {
    if (!student) return;
    setBusy(true);
    const { error } = await supabase.from("lessons").insert({
      student_name: student.student_name,
      guardian_name: student.guardian_name,
      address: student.address,
      subject: null,
      start_at: start.toISOString(),
      duration_minutes: settings?.slot_minutes ?? 60,
      price: 220,
      package_type: "single",
      payment_status: "pendente",
      teacher,
      status: "agendada",
      is_online: !student.address,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Aula agendada! O professor receberá o aviso."); load(); }
  };

  if (settings && !settings.allow_student_booking) {
    return <Navigate to="/aluno" replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Calendar className="w-6 h-6" /> Agendar aula</h1>
        <p className="text-sm text-muted-foreground">Escolha o professor e um horário livre.</p>
      </div>

      {teachers.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Nenhum professor disponível no momento.</Card>
      ) : (
        <>
          <div className="max-w-xs">
            <label className="text-xs text-muted-foreground">Professor</label>
            <Select value={teacher} onValueChange={setTeacher}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {teachers.map(t => <SelectItem key={t.id} value={t.name}>{capitalize(t.name)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}

          {!loading && slotsByDay.map(({ day, slots }) => (
            <div key={day.toISOString()}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {format(day, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                </h2>
                {slots.length > 0 && slots.length <= 2 && (
                  <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1 animate-pulse">
                    <Flame className="w-3 h-3" /> {slots.length === 1 ? "Último horário!" : "Restam poucos horários!"}
                  </Badge>
                )}
              </div>
              {slots.length === 0 ? (
                <Card className="p-3 text-xs text-muted-foreground">Sem horários livres.</Card>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {slots.map(s => (
                    <Button
                      key={s.start.toISOString()}
                      variant="outline"
                      disabled={busy}
                      onClick={() => book(s.start)}
                      className="flex flex-col h-auto py-2"
                    >
                      <span className="flex items-center gap-1 text-sm font-semibold"><Clock className="w-3 h-3" />{fmtTime(s.start)}</span>
                      <span className="text-[10px] text-muted-foreground">até {fmtTime(s.end)}</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

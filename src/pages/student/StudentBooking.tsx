import { useEffect, useMemo, useState } from "react";
import { addDays, startOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { useTeachers } from "@/hooks/useTeachers";
import { computeFreeSlots, fmtTime } from "@/lib/availability";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Calendar, Clock, AlertCircle } from "lucide-react";
import { Navigate } from "react-router-dom";
import { capitalize } from "@/lib/balance";

const DAYS_AHEAD = 7;

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
    const [busyR, recR] = await Promise.all([
      supabase.rpc("get_busy_ranges_by_teacher", { _from: from.toISOString(), _to: to.toISOString(), _teacher: teacher }),
      supabase.rpc("get_recurring_blocks_by_teacher", { _teacher: teacher }),
    ]);
    const busy = (busyR.data ?? []).map((r: any) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }));
    const rec = (recR.data ?? []) as any[];
    const free = computeFreeSlots(from, DAYS_AHEAD, settings.work_start, settings.work_end, settings.slot_minutes, busy, rec);
    const now = new Date();
    const grouped: { day: Date; slots: { start: Date; end: Date }[] }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const day = addDays(from, i);
      const sameDay = (d: Date) => d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
      const slots = free.filter(f => sameDay(f.start) && f.end > now);
      grouped.push({ day, slots });
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
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {format(day, "EEEE, dd 'de' MMMM", { locale: ptBR })}
              </h2>
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

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, startOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { computeFreeSlots, fmtTime } from "@/lib/availability";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Info, Clock, Flame } from "lucide-react";

// Deterministic seeded pseudo-random so the public view is stable per day/teacher
function seedRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6D2B79F5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function applyScarcity(
  slots: { start: Date; end: Date }[],
  dayKey: string,
  teacherKey: string,
): { start: Date; end: Date }[] {
  if (slots.length === 0) return slots;
  const rand = seedRandom(`${teacherKey}|${dayKey}`);
  // Random max between 1 and 3 (inclusive)
  const maxN = 1 + Math.floor(rand() * 3);
  // Prioritize earliest slots within the day for natural feel
  const sorted = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime());
  return sorted.slice(0, Math.min(maxN, sorted.length));
}

type Props = { teacher?: "thiago" | "mayara" };

const TEACHER_LABEL: Record<string, { name: string; subject: string }> = {
  thiago: { name: "Prof. Thiago", subject: "Matemática" },
  mayara: { name: "Profa. Mayara", subject: "Química" },
};

export default function PublicAvailability({ teacher }: Props) {
  const [slotsByDay, setSlotsByDay] = useState<{ day: Date; slots: { start: Date; end: Date }[] }[]>([]);
  const [loading, setLoading] = useState(true);

  const meta = teacher ? TEACHER_LABEL[teacher] : null;
  const title = meta ? `Horários disponíveis — ${meta.name} (${meta.subject})` : "Horários disponíveis";

  useEffect(() => {
    document.title = title;
    const m = document.querySelector('meta[name="description"]') || (() => {
      const el = document.createElement("meta"); el.setAttribute("name", "description"); document.head.appendChild(el); return el;
    })();
    m.setAttribute("content", `Horários livres ${meta ? `de ${meta.name} (${meta.subject})` : ""} para os próximos 5 dias.`);

    (async () => {
      const from = startOfDay(new Date());
      const to = addDays(from, 5);
      const busyCall = teacher
        ? supabase.rpc("get_busy_ranges_by_teacher", { _from: from.toISOString(), _to: to.toISOString(), _teacher: teacher })
        : supabase.rpc("get_busy_ranges", { _from: from.toISOString(), _to: to.toISOString() });
      const recCall = teacher
        ? supabase.rpc("get_recurring_blocks_by_teacher", { _teacher: teacher })
        : supabase.rpc("get_recurring_blocks");
      const [settingsR, busyR, recR] = await Promise.all([
        supabase.from("settings").select("work_start, work_end, slot_minutes").eq("id", 1).maybeSingle(),
        busyCall,
        recCall,
      ]);
      const s = settingsR.data ?? { work_start: "08:00", work_end: "22:00", slot_minutes: 60 };
      const busy = (busyR.data ?? []).map((r: any) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }));
      const rec = (recR.data ?? []) as any[];
      const free = computeFreeSlots(from, 5, s.work_start, s.work_end, s.slot_minutes, busy, rec);
      const grouped: { day: Date; slots: { start: Date; end: Date }[] }[] = [];
      for (let i = 0; i < 5; i++) {
        const day = addDays(from, i);
        grouped.push({ day, slots: free.filter(f => f.start.toDateString() === day.toDateString()) });
      }
      setSlotsByDay(grouped); setLoading(false);
    })();
  }, [teacher, title]);

  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-subtle)" }}>
      <header className="bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <GraduationCap className="text-primary-foreground w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">
              {meta ? `Aulas Particulares de ${meta.subject} — ${meta.name}` : "Aulas Particulares"}
            </h1>
            <p className="text-xs text-muted-foreground">Horários disponíveis para os próximos 5 dias</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card className="p-4 flex gap-3 bg-accent border-accent">
          <Info className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-accent-foreground">
            <strong>Estes são os horários livres para os próximos 5 dias.</strong> Entre em contato diretamente com o professor para reservar.
          </p>
        </Card>

        {loading && <p className="text-center text-muted-foreground py-12">Carregando…</p>}

        {!loading && slotsByDay.map(({ day, slots }) => (
          <div key={day.toISOString()}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {format(day, "EEEE, dd 'de' MMMM", { locale: ptBR })}
            </h2>
            {slots.length === 0 ? (
              <Card className="p-4 text-sm text-muted-foreground text-center">Sem horários livres neste dia.</Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {slots.map(s => (
                  <div key={s.start.toISOString()} className="bg-card border border-border rounded-lg p-3 text-center shadow-[var(--shadow-card)]">
                    <Clock className="w-3 h-3 inline mr-1 text-primary" />
                    <span className="font-semibold">{fmtTime(s.start)}</span>
                    <div className="text-[10px] text-muted-foreground">até {fmtTime(s.end)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <footer className="text-center text-xs text-muted-foreground pt-8 pb-4">
          Esta página é apenas informativa. Não há agendamento online.
        </footer>
      </main>
    </div>
  );
}

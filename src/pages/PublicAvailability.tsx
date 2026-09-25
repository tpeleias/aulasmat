import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, startOfDay, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { computeFreeSlots, padRanges, fmtTime, pickScarcityCandidates, scarcityFor, SCARCITY_DEFAULT } from "@/lib/availability";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Info, Clock, Flame } from "lucide-react";
import { useParams } from "react-router-dom";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";
import { colorOf } from "@/lib/teacherColors";

type PublicService = { id: string; name: string; duration_minutes: number; price: number | null; mode: "presencial" | "online" | "ambos"; color: string | null };
type PublicCatalog = {
  services: PublicService[];
  per_teacher: boolean;
  teachers: { slug: string; all_services: boolean; services: string[] }[];
};
type DaySlots = { day: Date; slots: { start: Date; end: Date }[] };

const DAYS = 5;

export default function PublicAvailability() {
  // O professor vem do endereço (/disponibilidade/<professor>), e nome e matéria
  // vêm do cadastro da empresa - antes eram dois nomes escritos no código.
  const { teacher } = useParams<{ teacher?: string }>();
  const { teachers } = useTeachers(true);
  const [slotsByDay, setSlotsByDay] = useState<DaySlots[]>([]);
  const [loading, setLoading] = useState(true);
  // Os serviços da empresa (função public_services, migration 20260925120000).
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [serviceId, setServiceId] = useState<string>("");

  useEffect(() => {
    supabase.rpc("public_services" as never).then(({ data, error }) => {
      // Antes da migration a função não existe: a página segue sem serviços.
      setCatalog(error || !data ? { services: [], per_teacher: false, teachers: [] } : (data as unknown as PublicCatalog));
    });
  }, []);

  // Quem faz o serviço (fora do Max, todos fazem todos).
  const does = (slug: string, sid: string) => {
    if (!catalog?.per_teacher) return true;
    const t = catalog.teachers.find(x => x.slug === slug);
    return !t || t.all_services || t.services.includes(sid);
  };
  // Na página de um profissional, só os serviços que ele faz.
  const offered = (catalog?.services ?? []).filter(sv => !teacher || does(teacher, sv.id));
  const service = offered.find(sv => sv.id === serviceId) ?? offered[0] ?? null;

  const found = teacher ? teachers.find(t => teacherSlug(t.name) === teacher) : undefined;
  const meta = found
    ? { name: capitalize(found.name), subject: found.subject ?? null }
    : null;
  const title = meta
    ? `Horários disponíveis — ${meta.name}${meta.subject ? ` (${meta.subject})` : ""}`
    : "Horários disponíveis";

  useEffect(() => {
    if (!catalog) return;
    document.title = title;
    const m = document.querySelector('meta[name="description"]') || (() => {
      const el = document.createElement("meta"); el.setAttribute("name", "description"); document.head.appendChild(el); return el;
    })();
    m.setAttribute("content", `Horários livres ${meta ? `de ${meta.name}${meta.subject ? ` (${meta.subject})` : ""}` : ""} para os próximos 5 dias.`);

    let alive = true;
    setLoading(true);
    (async () => {
      const from = startOfDay(new Date());
      const to = addDays(from, DAYS);
      const settingsR = await supabase.from("settings").select("work_start, work_end, slot_minutes, scarcity, buffer_minutes").maybeSingle();
      const s: any = settingsR.data ?? { work_start: "08:00", work_end: "22:00", slot_minutes: 60, scarcity: SCARCITY_DEFAULT };
      // A duração do horário é a do serviço escolhido.
      const minutes = service?.duration_minutes ?? s.slot_minutes;

      // Os horários de um profissional (ou da empresa toda, com `who` nulo).
      const slotsFor = async (who: string | null): Promise<DaySlots[]> => {
        const busyCall = who
          ? supabase.rpc("get_busy_ranges_by_teacher", { _from: from.toISOString(), _to: to.toISOString(), _teacher: who })
          : supabase.rpc("get_busy_ranges", { _from: from.toISOString(), _to: to.toISOString() });
        const recCall = who
          ? supabase.rpc("get_recurring_blocks_by_teacher", { _teacher: who })
          : supabase.rpc("get_recurring_blocks");
        const lessonsCall = (who
          ? supabase.from("lessons").select("start_at, duration_minutes").eq("teacher", who)
          : supabase.from("lessons").select("start_at, duration_minutes")
        ).gte("start_at", from.toISOString()).lt("start_at", to.toISOString());
        const [busyR, recR, lessonsR] = await Promise.all([busyCall, recCall, lessonsCall]);
        const busy = (busyR.data ?? []).map((r: any) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }));
        const lessonRanges = (lessonsR.data ?? []).map((l: any) => ({
          start: new Date(l.start_at),
          end: new Date(new Date(l.start_at).getTime() + (l.duration_minutes ?? 60) * 60000),
        }));
        // Candidate pool ignores lessons so the random "shop window" is fixed regardless of bookings
        const blocksOnly = busy.filter(b => !lessonRanges.some(l => l.start.getTime() === b.start.getTime() && l.end.getTime() === b.end.getTime()));
        const rec = (recR.data ?? []) as any[];
        const free = computeFreeSlots(from, DAYS, s.work_start, s.work_end, minutes, padRanges(busy, ((s as any)?.buffer_minutes) ?? 0), rec);
        const candidatesPool = computeFreeSlots(from, DAYS, s.work_start, s.work_end, minutes, blocksOnly, rec);
        const now = new Date();
        const grouped: DaySlots[] = [];
        for (let i = 0; i < DAYS; i++) {
          const day = addDays(from, i);
          const sameDay = (d: Date) => d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
          const dayCandidates = candidatesPool.filter(f => sameDay(f.start) && f.end > now).map(f => f.start);
          const freeStartTimes = new Set(free.filter(f => sameDay(f.start) && f.end > now).map(f => f.start.getTime()));
          const { min: minN, max: maxN } = scarcityFor(day, s.scarcity, teachers.find(t => teacherSlug(t.name) === who)?.scarcity);
          const picked = pickScarcityCandidates(day, dayCandidates, who ?? "all", minN, maxN);
          // Once a picked slot is booked it simply disappears — no replacement is shown
          const visible = picked
            .filter(start => freeStartTimes.has(start.getTime()))
            .map(start => ({ start, end: new Date(start.getTime() + minutes * 60000) }));
          grouped.push({ day, slots: visible });
        }
        return grouped;
      };

      let result: DaySlots[];
      const eligible = catalog.teachers.filter(t => service && does(t.slug, service.id));
      if (teacher) {
        result = await slotsFor(teacher);
      } else if (service && catalog.per_teacher && eligible.length < catalog.teachers.length) {
        // Nem todo profissional faz este serviço: junta só os horários de
        // quem faz, sem repetir o mesmo horário.
        const all = await Promise.all(eligible.map(t => slotsFor(t.slug)));
        result = Array.from({ length: DAYS }, (_, i) => {
          const byStart = new Map<number, { start: Date; end: Date }>();
          for (const per of all) for (const sl of per[i]?.slots ?? []) byStart.set(sl.start.getTime(), sl);
          return { day: addDays(from, i), slots: [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime()) };
        });
      } else {
        result = await slotsFor(null);
      }
      if (!alive) return;
      setSlotsByDay(result); setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacher, title, catalog, service?.id]);

  return (
    <div className="flex-1" style={{ background: "var(--gradient-subtle)" }}>
      <header className="bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <GraduationCap className="text-primary-foreground w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">
              {meta ? `Aulas Particulares${meta.subject ? ` de ${meta.subject}` : ""} — ${meta.name}` : "Aulas Particulares"}
            </h1>
            <p className="text-xs text-muted-foreground">Horários disponíveis para os próximos 5 dias</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {offered.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{offered.length > 1 ? "Escolha o serviço" : "Serviço"}</p>
            <div className="flex flex-wrap gap-2">
              {offered.map(sv => {
                const c = colorOf(sv.color);
                const on = service?.id === sv.id;
                return (
                  <button key={sv.id} type="button" onClick={() => setServiceId(sv.id)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-sm transition-colors ${on ? "border-primary bg-primary/10 font-medium" : "border-border bg-card hover:bg-accent"}`}>
                    {c && <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />}
                    {sv.name}
                    <span className="text-xs text-muted-foreground">
                      {sv.duration_minutes} min
                      {sv.price != null ? ` · ${Number(sv.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}
                      {sv.mode === "online" ? " · on-line" : sv.mode === "presencial" ? " · presencial" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Card className="p-4 flex gap-3 bg-accent border-accent">
          <Info className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-accent-foreground">
            <strong>Estes são os horários livres para os próximos 5 dias.</strong> Entre em contato diretamente com o professor para reservar.
          </p>
        </Card>

        {loading && <p className="text-center text-muted-foreground py-12">Carregando…</p>}

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

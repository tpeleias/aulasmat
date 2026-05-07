import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeFreeSlots } from "@/lib/availability";
import { CalendarPlus, CalendarX, CalendarClock, Eye, EyeOff, Clock } from "lucide-react";

type AuditRow = {
  id: string;
  created_at: string;
  action: "created" | "updated" | "cancelled";
  lesson_id: string | null;
  teacher: string | null;
  student_name: string | null;
  guardian_name: string | null;
  start_at: string | null;
  duration_minutes: number | null;
};

type Settings = { work_start: string; work_end: string; slot_minutes: number; scarcity_weekday_min: number; scarcity_weekday_max: number; scarcity_weekend_min: number; scarcity_weekend_max: number };

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

function pickScarcityCandidates(day: Date, candidateStarts: Date[], teacherKey: string, minN: number, maxN: number): Date[] {
  if (candidateStarts.length === 0) return [];
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
  const rand = seedRandom(`${teacherKey}|${dayKey}|${minN}-${maxN}`);
  const lo = Math.max(1, Math.min(minN, maxN));
  const hi = Math.max(lo, maxN);
  const target = lo + Math.floor(rand() * (hi - lo + 1));
  const count = Math.min(candidateStarts.length, target);
  const indices = candidateStarts.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, count).map(i => candidateStarts[i]).sort((a, b) => a.getTime() - b.getTime());
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  // Per-teacher pre-computed picked slot times for the next 5 days (only blocks, no lessons — same logic as public page)
  const [pickedByTeacher, setPickedByTeacher] = useState<Record<string, Set<number>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Registro de auditoria";
    (async () => {
      const from = startOfDay(new Date());
      const to = addDays(from, 5);

      const [auditR, settingsR] = await Promise.all([
        supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("settings").select("work_start, work_end, slot_minutes, scarcity_weekday_min, scarcity_weekday_max, scarcity_weekend_min, scarcity_weekend_max").eq("id", 1).maybeSingle(),
      ]);
      setRows((auditR.data ?? []) as AuditRow[]);
      const s: Settings = (settingsR.data as Settings) ?? { work_start: "08:00", work_end: "22:00", slot_minutes: 60, scarcity_weekday_min: 1, scarcity_weekday_max: 3, scarcity_weekend_min: 3, scarcity_weekend_max: 7 };
      setSettings(s);

      const teachers: ("thiago" | "mayara")[] = ["thiago", "mayara"];
      const map: Record<string, Set<number>> = {};
      await Promise.all(teachers.map(async (t) => {
        const [recR, blocksR] = await Promise.all([
          supabase.rpc("get_recurring_blocks_by_teacher", { _teacher: t }),
          supabase.from("blocks").select("*").eq("block_type", "one_off").or(`teacher.eq.${t},teacher.eq.both`),
        ]);
        const rec = (recR.data ?? []) as any[];
        const blocksOnly = ((blocksR.data ?? []) as any[])
          .filter(b => b.start_at && b.end_at && new Date(b.start_at) < to && new Date(b.end_at) > from)
          .map(b => ({ start: new Date(b.start_at), end: new Date(b.end_at) }));
        const candidates = computeFreeSlots(from, 5, s.work_start, s.work_end, s.slot_minutes, blocksOnly, rec);
        const picked = new Set<number>();
        for (let i = 0; i < 5; i++) {
          const day = addDays(from, i);
          const sameDay = (d: Date) => d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
          const dayCands = candidates.filter(c => sameDay(c.start)).map(c => c.start);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const minN = isWeekend ? s.scarcity_weekend_min : s.scarcity_weekday_min;
          const maxN = isWeekend ? s.scarcity_weekend_max : s.scarcity_weekday_max;
          for (const d of pickScarcityCandidates(day, dayCands, t, minN, maxN)) picked.add(d.getTime());
        }
        map[t] = picked;
      }));
      setPickedByTeacher(map);
      setLoading(false);
    })();
  }, []);

  const horizonEnd = useMemo(() => addDays(startOfDay(new Date()), 5), []);
  const horizonStart = useMemo(() => startOfDay(new Date()), []);

  const impactFor = (row: AuditRow): { kind: "in" | "out" | "past"; label: string } => {
    if (!row.start_at || !row.teacher) return { kind: "past", label: "—" };
    const start = new Date(row.start_at);
    if (start < horizonStart || start >= horizonEnd) {
      return { kind: "past", label: "Fora da janela pública (5 dias)" };
    }
    const set = pickedByTeacher[row.teacher];
    if (!set) return { kind: "past", label: "—" };
    return set.has(start.getTime())
      ? { kind: "in", label: "Estava/está visível na vitrine pública" }
      : { kind: "out", label: "Não aparecia na vitrine pública" };
  };

  const actionMeta = (a: AuditRow["action"]) => {
    if (a === "created") return { label: "Agendada", icon: CalendarPlus, cls: "bg-primary/10 text-primary border-primary/20" };
    if (a === "cancelled") return { label: "Cancelada", icon: CalendarX, cls: "bg-destructive/10 text-destructive border-destructive/20" };
    return { label: "Alterada", icon: CalendarClock, cls: "bg-muted text-foreground border-border" };
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Registro de auditoria</h1>
        <p className="text-sm text-muted-foreground">Histórico de aulas agendadas, alteradas e canceladas — e o impacto na lista pública de horários.</p>
      </div>

      <Card className="p-4 mb-4 text-sm text-muted-foreground flex gap-3">
        <Eye className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <div>
          A coluna <strong>Impacto na vitrine</strong> mostra se a aula afetada corresponde a um dos horários atualmente exibidos na página pública (próximos 5 dias).
          Se for um horário "escondido" pela política de escassez, agendá-lo ou cancelá-lo <strong>não muda</strong> o que o cliente vê.
        </div>
      </Card>

      {loading ? (
        <p className="text-center text-muted-foreground py-12">Carregando…</p>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Nenhum registro ainda.</Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Professor</TableHead>
                <TableHead>Aluno</TableHead>
                <TableHead>Aula em</TableHead>
                <TableHead>Impacto na vitrine pública</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const meta = actionMeta(r.action);
                const Icon = meta.icon;
                const impact = impactFor(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(r.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1 ${meta.cls}`}>
                        <Icon className="w-3 h-3" /> {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize text-sm">{r.teacher ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      <div>{r.student_name ?? "—"}</div>
                      {r.guardian_name && <div className="text-xs text-muted-foreground">{r.guardian_name}</div>}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {r.start_at ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {format(new Date(r.start_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {impact.kind === "in" && (
                        <Badge className="gap-1 bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15">
                          <Eye className="w-3 h-3" /> {impact.label}
                        </Badge>
                      )}
                      {impact.kind === "out" && (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <EyeOff className="w-3 h-3" /> {impact.label}
                        </Badge>
                      )}
                      {impact.kind === "past" && (
                        <span className="text-xs text-muted-foreground">{impact.label}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDays, format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState";
import PullToRefresh from "@/components/PullToRefresh";
import { LessonDialog } from "@/components/LessonDialog";
import { LessonRequests } from "@/components/LessonRequests";
import { useDefaultTeacher } from "@/hooks/useDefaultTeacher";
import { fmtMoney, capitalize } from "@/lib/balance";
import { computeStatements, type LedgerTx, type LedgerLesson } from "@/lib/billing";
import { syncBillingWidget } from "@/lib/widgetSync";
import { haptics } from "@/lib/haptics";
import { Bot, CalendarDays, CalendarPlus, Ban, MapPin, Wifi, ChevronRight, Sparkles, Wallet } from "lucide-react";
import PeriodSummary from "@/components/PeriodSummary";
import type { SummaryLesson } from "@/lib/periodSummary";
import { useAuth } from "@/hooks/useAuth";
import TrialBanner from "@/components/TrialBanner";

type Lesson = {
  id: string; student_name: string; guardian_name: string | null; subject: string | null; teacher: string;
  start_at: string; duration_minutes: number; status: string; address: string | null; is_online: boolean;
};

const SUGGESTIONS = [
  "Quais aulas tenho essa semana?",
  "Quem está devendo?",
  "Marca uma aula amanhã às 16h",
];

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function openWaze(address: string) {
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, "_blank", "noopener,noreferrer");
}

export default function HomePage() {
  const navigate = useNavigate();
  const teacher = useDefaultTeacher();
  // Login de professor: agenda sim, dinheiro e assistente não.
  const { isTeacher } = useAuth();
  const [today, setToday] = useState<Lesson[]>([]);
  const [next, setNext] = useState<Lesson | null>(null);
  const [txs, setTxs] = useState<LedgerTx[]>([]);
  const [doneLessons, setDoneLessons] = useState<LedgerLesson[]>([]);
  const [allLessons, setAllLessons] = useState<SummaryLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [dlgOpen, setDlgOpen] = useState(false);

  const load = useCallback(async () => {
    const now = new Date();
    const dayStart = startOfDay(now).toISOString();
    const dayEnd = startOfDay(addDays(now, 1)).toISOString();
    const [t, n, w, d] = await Promise.all([
      supabase.from("lessons").select("id, student_name, guardian_name, subject, teacher, start_at, duration_minutes, status, address, is_online")
        // Tudo que é aula de verdade hoje, inclusive as já realizadas - o que sai
        // são as descartadas e os pedidos sem resposta, que não são compromisso.
        .gte("start_at", dayStart).lt("start_at", dayEnd)
        .not("status", "in", "(cancelada,recusada,solicitada)").order("start_at"),
      supabase.from("lessons").select("id, student_name, guardian_name, subject, teacher, start_at, duration_minutes, status, address, is_online")
        .gte("start_at", now.toISOString()).eq("status", "agendada").order("start_at").limit(1),
      isTeacher
        ? Promise.resolve({ data: [] as LedgerTx[] })
        : supabase.from("wallet_transactions").select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at"),
      // Todas as aulas: o resumo do mês conta dadas, canceladas e ainda marcadas.
      supabase.from("lessons").select("id, student_name, start_at, duration_minutes, subject, teacher, status, price"),
    ]);
    setToday((t.data ?? []) as Lesson[]);
    setNext(((n.data ?? [])[0] as Lesson) ?? null);
    setTxs((w.data ?? []) as LedgerTx[]);
    const all = (d.data ?? []) as (LedgerLesson & SummaryLesson)[];
    setAllLessons(all);
    setDoneLessons(all.filter(l => l.status === "realizada"));
    setLoading(false);
  }, [isTeacher]);

  useEffect(() => { load(); }, [load]);

  const statements = useMemo(() => computeStatements(txs, doneLessons), [txs, doneLessons]);
  const debtors = useMemo(() => statements.filter(s => s.owed > 0), [statements]);
  const totalOwed = useMemo(() => debtors.reduce((s, a) => s + a.owed, 0), [debtors]);

  useEffect(() => {
    if (!loading && !isTeacher) syncBillingWidget({ totalOwed, accounts: debtors.map(d => ({ label: d.label, owed: d.owed })) });
  }, [loading, isTeacher, totalOwed, debtors]);

  const now = new Date();
  const nextToday = today.find(l => new Date(l.start_at).getTime() + l.duration_minutes * 60000 > now.getTime());

  const askAssistant = (text: string) => {
    haptics.tap();
    navigate("/admin/assistente", { state: { prefill: text } });
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-6">
        <header>
          <p className="text-sm text-muted-foreground capitalize">{format(now, "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
          <h1 className="text-2xl font-bold tracking-tight">{greeting(now)}, {capitalize(teacher)}</h1>
        </header>

        {!isTeacher && <TrialBanner />}

        <LessonRequests onChanged={load} />

        <section>
          <SectionTitle icon={CalendarDays} title="Hoje" action={<Link to="/admin/agenda" className="text-sm text-primary">Agenda</Link>} />
          {loading ? (
            <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}</div>
          ) : today.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nenhuma aula hoje"
              description={next
                ? `Próxima: ${format(new Date(next.start_at), "EEE dd/MM 'às' HH:mm", { locale: ptBR })} · ${next.student_name}`
                : "Nada agendado nos próximos dias."}
              action={<Button size="sm" variant="secondary" className="rounded-xl" onClick={() => setDlgOpen(true)}><CalendarPlus className="mr-1.5 h-4 w-4" /> Nova aula</Button>}
            />
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border">
              {today.map(l => {
                const start = new Date(l.start_at);
                const isNext = nextToday?.id === l.id;
                const past = start.getTime() + l.duration_minutes * 60000 <= now.getTime();
                return (
                  <li key={l.id} className={`flex items-center gap-3 px-4 py-3 ${isNext ? "bg-primary/5" : ""} ${past ? "opacity-60" : ""}`}>
                    <div className="w-12 shrink-0 text-center">
                      <div className="text-base font-semibold tabular-nums leading-tight">{format(start, "HH:mm")}</div>
                      <div className="text-[10px] text-muted-foreground">{l.duration_minutes} min</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{l.student_name}</span>
                        {isNext && <Badge className="h-5 rounded-full px-2 text-[10px]">próxima</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {l.subject ?? "Aula"} · {capitalize(l.teacher)}{l.is_online ? " · online" : ""}
                      </div>
                    </div>
                    {l.is_online ? (
                      <Wifi className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : l.address ? (
                      <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full text-primary" onClick={() => { haptics.tap(); openWaze(l.address!); }} title="Abrir rota">
                        <MapPin className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {!isTeacher && <section>
          <SectionTitle icon={Wallet} title="Financeiro" action={<Link to="/admin/financeiro" className="text-sm text-primary">Abrir</Link>} />
          {loading ? (
            <Skeleton className="h-24 w-full rounded-2xl" />
          ) : (
            <PeriodSummary compact lessons={allLessons} txs={txs} statements={statements} />
          )}
        </section>}

        {!isTeacher && <section>
          <SectionTitle icon={Bot} title="Assistente" />
          <Card className="space-y-3 rounded-2xl p-4">
            <button onClick={() => askAssistant("")} className="flex w-full items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-left text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> Peça algo: marcar, editar, cobrar…
            </button>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => askAssistant(s)} className="rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted">
                  {s}
                </button>
              ))}
            </div>
          </Card>
        </section>}

        <section className="grid grid-cols-2 gap-3">
          <Button onClick={() => { haptics.tap(); setDlgOpen(true); }} className="h-12 justify-start gap-2 rounded-2xl"><CalendarPlus className="h-4 w-4" /> Nova aula</Button>
          <Button asChild variant="secondary" className="h-12 justify-start gap-2 rounded-2xl"><Link to="/admin/bloqueios"><Ban className="h-4 w-4" /> Bloquear horário</Link></Button>
        </section>

        <LessonDialog open={dlgOpen} onOpenChange={setDlgOpen} defaultTeacher={teacher} onSaved={load} />
      </div>
    </PullToRefresh>
  );
}

function SectionTitle({ icon: Icon, title, action }: { icon: typeof CalendarDays; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-primary" /> {title}</h2>
      {action}
    </div>
  );
}

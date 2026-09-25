import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, FolderOpen, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useWords } from "@/hooks/useVocabulary";

import { dateLocale, L } from "@/lib/i18n";
export default function ChildDashboard() {
  const { student, loading } = useStudent();
  const w = useWords();
  const ap = w.appointment;
  const [lessons, setLessons] = useState<any[]>([]);
  const [homework, setHomework] = useState<any[]>([]);

  useEffect(() => {
    if (!student) return;
    const loadLessons = () => (supabase as any).rpc("get_child_lessons").then(({ data }: any) => {
      const ordered = [...(data ?? [])].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      setLessons(ordered);
    });
    const loadHw = () => supabase.from("homework").select("id, title, deadline, status").eq("student_id", student.id).order("deadline").then(({ data }) => setHomework(data ?? []));
    loadLessons(); loadHw();

    const channel = supabase
      .channel(`child-dash-${student.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lessons", filter: `student_name=eq.${student.student_name}` }, loadLessons)
      .on("postgres_changes", { event: "*", schema: "public", table: "homework", filter: `student_id=eq.${student.id}` }, loadHw)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [student]);

  if (loading) return <p className="text-sm text-muted-foreground">{L("Carregando...", "Loading...")}</p>;
  if (!student) return (
    <Card className="p-6">
      <h2 className="font-semibold mb-2">{L("Conta sem vínculo", "Account not linked")}</h2>
      <p className="text-sm text-muted-foreground">{L(`Avise ${w.staff.o} ${w.staff.l} ou ${w.guardian.seu} ${w.guardian.l}.`, `Let the ${w.staff.l} or your ${w.guardian.l} know.`)}</p>
    </Card>
  );

  const now = new Date();
  const upcoming = lessons.filter(l => new Date(l.start_at) >= now && l.status !== "realizada");
  const dueHomework = homework.filter(h => h.status !== "entregue");
  const nextLesson = upcoming[0] ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{L("Olá", "Hi")}, {student.student_name.split(" ")[0]} 👋</h1>
      </div>

      <Card className="p-6 space-y-4 border-primary/30">
        <div className="flex items-center gap-2 text-primary">
          <Calendar className="w-5 h-5" />
          <h2 className="font-semibold">{ap.proximo} {ap.l}</h2>
        </div>
        {nextLesson ? (
          <div className="space-y-2">
            <div className="text-2xl font-bold">{format(new Date(nextLesson.start_at), L("EEEE, dd 'de' MMMM", "EEEE, MMMM d"), { locale: dateLocale() })}</div>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>{format(new Date(nextLesson.start_at), "HH:mm", { locale: dateLocale() })}</span>
              <span>· {nextLesson.duration_minutes} min</span>
              <span>· {w.model === "aulas" ? L("Prof. ", "") : ""}{capitalize(nextLesson.teacher)}</span>
            </div>
            {nextLesson.subject && <Badge variant="secondary">{nextLesson.subject}</Badge>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{L(`${ap.nenhum} ${ap.l} ${ap.pick("agendado", "agendada")}.`, `No ${ap.l} booked.`)}</p>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">{ap.proximos} {ap.lp}</h2>
        {upcoming.length === 0 && <p className="text-sm text-muted-foreground">{L(`${ap.nenhum} ${ap.l} ${ap.pick("agendado", "agendada")}.`, `No ${ap.l} booked.`)}</p>}
        {upcoming.slice(0, 8).map(l => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 first:border-0 first:pt-0">
            <div>
              <div className="text-sm font-medium">{format(new Date(l.start_at), L("EEEE, dd/MM 'às' HH:mm", "EEEE, MMM d 'at' HH:mm"), { locale: dateLocale() })}</div>
              <div className="text-xs text-muted-foreground">{l.subject ?? ap.s} · {l.duration_minutes} min · {w.model === "aulas" ? L("Prof. ", "") : ""}{capitalize(l.teacher)}</div>
            </div>
          </div>
        ))}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StatCard icon={FolderOpen} label={L("Materiais", "Materials")} value={L("Acessar", "Open")} href="/meu-painel/materiais" />
        <StatCard icon={ListChecks} label={L("Tarefas", "Tasks")} value={dueHomework.length} href="/meu-painel/tarefas" />
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">{L("Tarefas com prazo", "Tasks due")}</h2>
        {dueHomework.length === 0 && <p className="text-sm text-muted-foreground">{L("Você está em dia!", "You're all caught up!")}</p>}
        {dueHomework.slice(0, 5).map(h => (
          <div key={h.id} className="flex items-center justify-between border-t border-border pt-2 first:border-0 first:pt-0">
            <div className="text-sm">
              <div className="font-medium">{h.title}</div>
              <div className="text-xs text-muted-foreground">{L("Prazo", "Due")}: {format(new Date(h.deadline), L("dd/MM HH:mm", "MMM d, HH:mm"))}</div>
            </div>
            <Badge variant="secondary">{h.status}</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}

function StatCard({ icon: Ic, label, value, href }: any) {
  return (
    <Link to={href}>
      <Card className="p-4 hover:shadow-md transition-shadow h-full">
        <Ic className="w-5 h-5 text-primary mb-2" />
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold">{value}</div>
      </Card>
    </Link>
  );
}

function capitalize(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

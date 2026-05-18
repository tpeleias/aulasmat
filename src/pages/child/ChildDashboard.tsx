import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, FolderOpen, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function ChildDashboard() {
  const { student, loading } = useStudent();
  const [lessons, setLessons] = useState<any[]>([]);
  const [homework, setHomework] = useState<any[]>([]);

  useEffect(() => {
    if (!student) return;
    supabase.from("lessons").select("*").eq("student_name", student.student_name).order("start_at", { ascending: true }).then(({ data }) => setLessons(data ?? []));
    supabase.from("homework").select("*").eq("student_id", student.id).order("deadline").then(({ data }) => setHomework(data ?? []));
  }, [student]);

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!student) return (
    <Card className="p-6">
      <h2 className="font-semibold mb-2">Conta sem vínculo</h2>
      <p className="text-sm text-muted-foreground">Avise o professor ou seu responsável.</p>
    </Card>
  );

  const now = new Date();
  const upcoming = lessons.filter(l => new Date(l.start_at) >= now);
  const dueHomework = homework.filter(h => h.status !== "entregue");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá, {student.student_name.split(" ")[0]} 👋</h1>
        <p className="text-sm text-muted-foreground">Aqui ficam suas aulas, materiais e tarefas.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard icon={Calendar} label="Próximas aulas" value={upcoming.length} href="/meu-painel/aulas" />
        <StatCard icon={ListChecks} label="Tarefas pendentes" value={dueHomework.length} href="/meu-painel/tarefas" />
        <StatCard icon={FolderOpen} label="Materiais" value="Acessar" href="/meu-painel/materiais" />
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">Próximas aulas</h2>
        {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma aula agendada.</p>}
        {upcoming.slice(0, 5).map(l => (
          <div key={l.id} className="border-t border-border pt-2 first:border-0 first:pt-0">
            <div className="text-sm font-medium">{format(new Date(l.start_at), "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}</div>
            <div className="text-xs text-muted-foreground">{l.subject ?? "Aula"} · {l.duration_minutes} min · Prof. {capitalize(l.teacher)}</div>
          </div>
        ))}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">Tarefas com prazo</h2>
        {dueHomework.length === 0 && <p className="text-sm text-muted-foreground">Você está em dia!</p>}
        {dueHomework.slice(0, 5).map(h => (
          <div key={h.id} className="flex items-center justify-between border-t border-border pt-2 first:border-0 first:pt-0">
            <div className="text-sm">
              <div className="font-medium">{h.title}</div>
              <div className="text-xs text-muted-foreground">Prazo: {format(new Date(h.deadline), "dd/MM HH:mm")}</div>
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

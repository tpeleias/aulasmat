import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { WhatsAppButton } from "./StudentDashboard";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function StudentLessons() {
  const { student } = useStudent();
  const settings = useAppSettings();
  const [lessons, setLessons] = useState<any[]>([]);

  useEffect(() => {
    if (!student) return;
    supabase.from("lessons").select("*").eq("student_name", student.student_name).order("start_at", { ascending: false }).then(({ data }) => setLessons(data ?? []));
  }, [student]);

  const now = new Date();
  const upcoming = lessons.filter(l => new Date(l.start_at) >= now && l.status !== "realizada").reverse();
  const past = lessons.filter(l => new Date(l.start_at) < now || l.status === "realizada");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Minhas aulas</h1>
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Próximas aulas ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">Aulas realizadas ({past.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming"><LessonList lessons={upcoming} settings={settings} /></TabsContent>
        <TabsContent value="past"><LessonList lessons={past} settings={settings} showSummary /></TabsContent>
      </Tabs>
    </div>
  );
}

function LessonList({ lessons, settings, showSummary }: any) {
  if (lessons.length === 0) return <Card className="p-6 text-center text-muted-foreground text-sm">Nada por aqui.</Card>;
  return (
    <div className="space-y-2">
      {lessons.map((l: any) => (
        <Card key={l.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">{format(new Date(l.start_at), "EEEE, dd/MM 'às' HH:mm", { locale: ptBR })}</div>
              <div className="text-xs text-muted-foreground">{l.subject ?? "Aula"} · {l.duration_minutes} min · Prof. {l.teacher}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={l.payment_status === "pago" ? "default" : "destructive"}>{fmt(l.price)} · {l.payment_status}</Badge>
              <Badge variant="secondary">{l.status ?? "agendada"}</Badge>
              <WhatsAppButton teacher={l.teacher} settings={settings} message={`Olá! Sobre a aula em ${format(new Date(l.start_at), "dd/MM HH:mm")}`} />
            </div>
          </div>
          {showSummary && l.class_summary && (
            <div className="text-sm mt-2 p-2 rounded bg-muted/40 border border-border italic">📝 {l.class_summary}</div>
          )}
        </Card>
      ))}
    </div>
  );
}

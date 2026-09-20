import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { scopeToAccount } from "@/lib/balance";
import { isDiscarded, isRequest, statusBadgeVariant, statusLabel } from "@/lib/lessonStatus";
import { WithdrawRequestButton } from "@/components/WithdrawRequestButton";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function StudentLessons() {
  const { student, isChild } = useStudent();
  const { role } = useAuth();
  const hideFinancial = role === "child" || isChild;
  const settings = useAppSettings({ enabled: !hideFinancial });
  const [lessons, setLessons] = useState<any[]>([]);

  const load = useCallback(() => {
    if (!student) return;
    if (hideFinancial) {
      (supabase as any).rpc("get_child_lessons").then(({ data }: any) => setLessons(data ?? []));
      return;
    }
    scopeToAccount(supabase.from("lessons").select("*"), student)
      .order("start_at", { ascending: false }).then(({ data }) => setLessons(data ?? []));
  }, [student, hideFinancial]);

  useEffect(() => { load(); }, [load]);

  const now = new Date();
  // A aba de cima junta o que está marcado e o que ainda é pedido, porque é
  // onde a família procura a resposta do professor.
  const upcoming = lessons.filter(l => new Date(l.start_at) >= now && l.status !== "realizada").reverse();
  const past = lessons.filter(l => new Date(l.start_at) < now || l.status === "realizada");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Minhas aulas</h1>
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Próximas e pedidos ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">Aulas realizadas ({past.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming"><LessonList lessons={upcoming} settings={settings} hideFinancial={hideFinancial} onChanged={load} /></TabsContent>
        <TabsContent value="past"><LessonList lessons={past} settings={settings} showSummary hideFinancial={hideFinancial} /></TabsContent>
      </Tabs>
    </div>
  );
}

function LessonList({ lessons, settings, showSummary, hideFinancial, onChanged }: any) {
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
              {/* Pedido sem resposta, recusado ou cancelado não tem cobrança para
                  mostrar - exibir valor ali fazia parecer que a família devia
                  por uma aula que ninguém confirmou. */}
              {!hideFinancial && !isRequest(l.status) && !isDiscarded(l.status) && (
                <Badge variant={l.payment_status === "pago" ? "default" : "destructive"}>{fmt(Number(l.price) * Number(l.duration_minutes) / 60)} · {l.payment_status}</Badge>
              )}
              <Badge variant={statusBadgeVariant(l.status)}>{statusLabel(l.status)}</Badge>
              {/* Quem pede é o responsável, então quem retira é ele. O filho abre
                  esta mesma tela pelo /meu-painel e não deve ver o botão. */}
              {!hideFinancial && isRequest(l.status) && onChanged && (
                <WithdrawRequestButton lessonId={l.id} startAt={l.start_at} onDone={onChanged} />
              )}
              {!hideFinancial && (
                <WhatsAppButton teacher={l.teacher} message={`Olá! Sobre a aula em ${format(new Date(l.start_at), "dd/MM HH:mm")}`} />
              )}
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

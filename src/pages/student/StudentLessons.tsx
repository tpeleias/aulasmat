import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { scopeToAccount, fmtMoney } from "@/lib/balance";
import { isDiscarded, isRequest, statusBadgeVariant, statusLabel } from "@/lib/lessonStatus";
import { WithdrawRequestButton } from "@/components/WithdrawRequestButton";
import { useWords } from "@/hooks/useVocabulary";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Repeat } from "lucide-react";

import { dateLocale, L } from "@/lib/i18n";
const fmt = (v: number) => fmtMoney(v);

export default function StudentLessons() {
  const { student, isChild } = useStudent();
  const w = useWords();
  const ap = w.appointment;
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
      <h1 className="text-2xl font-bold">{L(`${ap.pick("Meus", "Minhas")} ${ap.lp}`, `My ${ap.lp}`)}</h1>
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">{L(`${ap.pick("Próximos", "Próximas")} e pedidos`, "Upcoming and requests")} ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">{L(`${ap.p} ${ap.pick("realizados", "realizadas")}`, `Past ${ap.lp}`)} ({past.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming"><LessonList lessons={upcoming} all={lessons} settings={settings} hideFinancial={hideFinancial} onChanged={load} /></TabsContent>
        <TabsContent value="past"><LessonList lessons={past} settings={settings} showSummary hideFinancial={hideFinancial} /></TabsContent>
      </Tabs>
    </div>
  );
}

function LessonList({ lessons, all, settings, showSummary, hideFinancial, onChanged }: any) {
  const w = useWords();
  const ap = w.appointment;
  // Troca: o pedido aponta a aula que sai (reschedule_of). Os dois lados se
  // mostram - o pedido diz de qual aula é, e a aula diz que tem troca pedida.
  const byId = new Map<string, any>((all ?? lessons).map((l: any) => [l.id, l]));
  const openSwapFor = new Set((all ?? lessons).filter((l: any) => l.reschedule_of && isRequest(l.status)).map((l: any) => l.reschedule_of));
  const noticeMs = Number(settings?.min_request_notice_hours ?? 0) * 3600_000;
  const canSwap = (l: any) =>
    !hideFinancial && onChanged && settings?.allow_student_booking && l.status === "agendada"
    && new Date(l.start_at).getTime() >= Date.now() + noticeMs && !openSwapFor.has(l.id);
  if (lessons.length === 0) return <Card className="p-6 text-center text-muted-foreground text-sm">{L("Nada por aqui.", "Nothing here.")}</Card>;
  return (
    <div className="space-y-2">
      {lessons.map((l: any) => (
        <Card key={l.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">{format(new Date(l.start_at), L("EEEE, dd/MM 'às' HH:mm", "EEEE, MMM d 'at' HH:mm"), { locale: dateLocale() })}</div>
              <div className="text-xs text-muted-foreground">{l.subject ?? w.appointment.s} · {l.duration_minutes} min · {w.model === "aulas" ? L("Prof. ", "") : ""}{l.teacher}</div>
              {l.reschedule_of && isRequest(l.status) && byId.get(l.reschedule_of) && (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-primary">
                  <Repeat className="h-3 w-3" /> {L(`Troca ${ap.do} ${ap.l} de`, `Moving the ${ap.l} from`)} {format(new Date(byId.get(l.reschedule_of).start_at), L("dd/MM 'às' HH:mm", "MMM d 'at' HH:mm"))}
                </div>
              )}
              {openSwapFor.has(l.id) && l.status === "agendada" && (
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Repeat className="h-3 w-3" /> {L(`Troca pedida - continua ${ap.pick("marcado", "marcada")} até a resposta`, "Change requested - stays booked until the reply")}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Pedido sem resposta, recusado ou cancelado não tem cobrança para
                  mostrar - exibir valor ali fazia parecer que a família devia
                  por uma aula que ninguém confirmou. */}
              {!hideFinancial && !isRequest(l.status) && !isDiscarded(l.status) && (
                <Badge variant={l.payment_status === "pago" ? "default" : "destructive"}>{fmt(Number(l.price) * Number(l.duration_minutes) / 60)} · {L(l.payment_status, l.payment_status === "pago" ? "paid" : "pending")}</Badge>
              )}
              {/* Falta cobrada: a aula não aconteceu, mas entrou na cobrança pela
                  política da empresa - dizer isso evita a família achar que é erro. */}
              <Badge variant={l.absence_charged ? "destructive" : statusBadgeVariant(l.status)}>
                {l.absence_charged ? L("falta cobrada", "no-show charged") : statusLabel(l.status, w)}
              </Badge>
              {/* Quem pede é o responsável, então quem retira é ele. O filho abre
                  esta mesma tela pelo /meu-painel e não deve ver o botão. */}
              {!hideFinancial && isRequest(l.status) && onChanged && (
                <WithdrawRequestButton lessonId={l.id} startAt={l.start_at} onDone={onChanged} />
              )}
              {canSwap(l) && (
                <Button asChild size="sm" variant="outline" className="h-8 rounded-xl">
                  <Link to={`/aluno/agendar?troca=${l.id}`}><Repeat className="mr-1 h-3.5 w-3.5" /> {L("Trocar", "Reschedule")}</Link>
                </Button>
              )}
              {!hideFinancial && (
                <WhatsAppButton teacher={l.teacher} message={L(`Olá! Sobre ${w.appointment.o} ${w.appointment.l} em ${format(new Date(l.start_at), "dd/MM HH:mm")}`, `Hi! About the ${w.appointment.l} on ${format(new Date(l.start_at), "MMM d, HH:mm")}`)} />
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

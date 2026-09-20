import { useCallback, useEffect, useState } from "react";
import { format, isBefore } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { lessonErrorMessage } from "@/lib/lessonErrors";
import { capitalize } from "@/lib/balance";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { Check, X, Clock, MapPin, Wifi } from "lucide-react";

type Request = {
  id: string; student_name: string; guardian_name: string | null; teacher: string;
  start_at: string; duration_minutes: number; address: string | null; is_online: boolean;
  subject: string | null; notes: string | null;
};

/**
 * Os pedidos de aula que o aluno mandou e o professor ainda não respondeu.
 *
 * Aprovar é `solicitada -> agendada`; recusar é `solicitada -> recusada`, e é o
 * recusar que devolve o horário para a vitrine (a constraint e as funções de
 * horário livre ignoram as recusadas).
 *
 * Fica aqui e não numa página própria porque um pedido só serve se o professor
 * vê: uma tela a mais no menu é uma tela que ele não abre, e o aluno fica
 * esperando resposta de um horário que segue reservado.
 */
export function LessonRequests({ onChanged }: { onChanged?: () => void }) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<Request | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("lessons")
      .select("id, student_name, guardian_name, teacher, start_at, duration_minutes, address, is_online, subject, notes")
      .eq("status", "solicitada")
      .order("start_at");
    setRequests((data ?? []) as Request[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Se a família manda um pedido com o professor de app aberto, ele aparece sem
  // precisar recarregar - é o mesmo canal que o portal do aluno já usa.
  useEffect(() => {
    const channel = supabase
      .channel("lesson-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "lessons" }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const decide = async (req: Request, status: "agendada" | "recusada") => {
    setBusyId(req.id);
    haptics.tap();
    const { error } = await supabase.from("lessons").update({ status }).eq("id", req.id);
    setBusyId(null);
    if (error) { toast.error(lessonErrorMessage(error)); return; }
    toast.success(status === "agendada"
      ? `Aula de ${req.student_name} confirmada na agenda.`
      : `Pedido de ${req.student_name} recusado e o horário liberado.`);
    await load();
    onChanged?.();
  };

  if (requests.length === 0) return null;

  return (
    <>
      <Card className="rounded-2xl border-primary/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4 text-primary" /> Solicitações de aula
          </h2>
          <Badge variant="outline">{requests.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Pedidos feitos pelas famílias. O horário fica reservado até você responder.
        </p>

        <ul className="divide-y divide-border">
          {requests.map(r => {
            const start = new Date(r.start_at);
            const past = isBefore(start, new Date());
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{r.student_name}</span>
                    {/* A dica fica no <span> e não no ícone: <svg title=""> não
                        vira tooltip em navegador nenhum, e o tipo do lucide nem
                        aceita a prop. */}
                    {r.is_online ? (
                      <span title="Aula on-line" className="shrink-0 leading-none">
                        <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    ) : r.address ? (
                      <span title={r.address} className="shrink-0 leading-none">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    ) : null}
                    {/* O professor pode simplesmente não ter respondido. Dizer isso
                        é melhor que deixar o pedido velho parecendo atual. */}
                    {past && <Badge variant="destructive" className="h-5 px-2 text-[10px]">horário já passou</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(start, "EEE, dd/MM 'às' HH:mm", { locale: ptBR })} · {r.duration_minutes} min · {capitalize(r.teacher)}
                    {r.subject ? ` · ${r.subject}` : ""}
                  </div>
                  {/* O que a família escreveu. É isto que decide se você aceita e
                      como se prepara, então fica visível sem precisar abrir nada. */}
                  {r.notes && (
                    <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs italic text-muted-foreground">
                      “{r.notes}”
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm" variant="secondary" className="rounded-xl"
                    disabled={busyId === r.id}
                    onClick={() => setRefusing(r)}
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Recusar
                  </Button>
                  <Button
                    size="sm" className="rounded-xl"
                    disabled={busyId === r.id}
                    onClick={() => decide(r, "agendada")}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" /> Aprovar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <AlertDialog open={!!refusing} onOpenChange={open => { if (!open) setRefusing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recusar este pedido?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {refusing && (
                  <p className="text-foreground font-medium">
                    {refusing.student_name}
                    <br />
                    {format(new Date(refusing.start_at), "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                    {refusing.subject ? <><br />{refusing.subject}</> : null}
                  </p>
                )}
                {refusing?.notes && (
                  <p className="rounded bg-muted/50 px-2 py-1 text-sm italic">“{refusing.notes}”</p>
                )}
                <p>O horário volta a aparecer como livre e a família vê a recusa no portal.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { const r = refusing; setRefusing(null); if (r) decide(r, "recusada"); }}
            >
              Recusar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

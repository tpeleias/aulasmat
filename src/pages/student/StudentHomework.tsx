import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload, Download, Clock, AlertCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { differenceInDays, isPast, format } from "date-fns";
import { toast } from "sonner";
import { sanitizeFilename } from "@/lib/sanitizeFilename";

import { useTasksEnabled, useWords } from "@/hooks/useVocabulary";
import { tasksAreSubmitted, taskStatusLabel, type Vocabulary } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";

// As tarefas do cliente (03/10: o nome é o do ramo). Nas aulas a tarefa se
// entrega com arquivo; nos outros ramos se marca como feita, e o arquivo
// (uma foto, por exemplo) é opcional.
export default function StudentHomework() {
  const w = useWords();
  const tasks = useTasksEnabled();
  const { student } = useStudent();
  const [homeworks, setHomeworks] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, any[]>>({});

  const load = async () => {
    if (!student) return;
    const { data: hw } = await supabase.from("homework").select("*").eq("student_id", student.id).order("deadline");
    setHomeworks(hw ?? []);
    if (hw && hw.length > 0) {
      const { data: subs } = await supabase.from("homework_submissions").select("*").in("homework_id", hw.map((h: any) => h.id));
      const grouped: Record<string, any[]> = {};
      (subs ?? []).forEach((s: any) => { (grouped[s.homework_id] ||= []).push(s); });
      setSubmissions(grouped);
    }
  };
  useEffect(() => { load(); }, [student]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{w.task.p}</h1>
      {!tasks && <Card className="p-6 text-center text-muted-foreground text-sm">{L("Esta parte não está ligada aqui.", "This section isn't turned on here.")}</Card>}
      {tasks && homeworks.length === 0 && <Card className="p-6 text-center text-muted-foreground text-sm">{L(`${w.task.nenhum} ${w.task.l} por enquanto.`, `No ${w.task.lp} yet.`)}</Card>}
      {tasks && homeworks.map(h => (
        <HomeworkCard key={h.id} hw={h} subs={submissions[h.id] ?? []} student={student!} onChange={load} w={w} />
      ))}
    </div>
  );
}

function HomeworkCard({ hw, subs, student, onChange, w }: { hw: any; subs: any[]; student: any; onChange: () => void; w: Vocabulary }) {
  const submit = tasksAreSubmitted(w.model);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const deadline = new Date(hw.deadline);
  const overdue = isPast(deadline) && hw.status !== "entregue";
  const days = differenceInDays(deadline, new Date());

  const upload = async (file: File) => {
    setBusy(true);
    const safeName = sanitizeFilename(file.name);
    const path = `${student.id}/${hw.id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from("homework-submissions").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) { toast.error(upErr.message); setBusy(false); return; }
    const { error } = await supabase.from("homework_submissions").insert({
      homework_id: hw.id, file_path: path, file_type: file.type,
    });
    // O status vira "entregue" no banco, pelo gatilho do envio (migration 20261004010000).
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(submit ? L("Enviado!", "Submitted!") : L("Arquivo enviado!", "File sent!")); onChange(); }
  };

  const markDone = async (done: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc("mark_homework_done" as never, { _homework: hw.id, _done: done } as never);
    setBusy(false);
    if (error) toast.error(L("Não deu para marcar agora. Tente de novo.", "Couldn't update it now. Try again."));
    else { if (done) toast.success(L("Marcado como feito!", "Marked as done!")); onChange(); }
  };

  const download = async (path: string) => {
    const { data } = await supabase.storage.from("homework-submissions").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{hw.title}</div>
          {hw.description && <div className="text-sm text-muted-foreground mt-1">{hw.description}</div>}
        </div>
        {overdue ? (
          <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" /> {taskStatusLabel("atrasada", w)}</Badge>
        ) : hw.status === "entregue" ? (
          <Badge>{taskStatusLabel("entregue", w)}</Badge>
        ) : days === 0 ? (
          <Badge variant="destructive" className="gap-1"><Clock className="w-3 h-3" /> {L("Prazo hoje", "Due today")}</Badge>
        ) : (
          <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" /> {L(`Faltam ${days} ${days === 1 ? "dia" : "dias"}`, `${days} ${days === 1 ? "day" : "days"} left`)}</Badge>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{L("Prazo", "Due")}: {format(deadline, L("dd/MM/yyyy HH:mm", "MMM d, yyyy h:mm a"))}</div>

      {subs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">{submit ? L("Suas entregas", "Your submissions") : L("Seus arquivos", "Your files")}</div>
          {subs.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between border border-border rounded p-2">
              <div className="text-sm">
                <div>{L("Enviado em", "Sent on")} {format(new Date(s.submitted_at), L("dd/MM HH:mm", "MMM d, h:mm a"))}</div>
                {s.teacher_feedback && <div className="text-xs text-primary mt-1">{L("Retorno", "Feedback")}: {s.teacher_feedback}</div>}
              </div>
              <Button size="sm" variant="outline" onClick={() => download(s.file_path)}><Download className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        {submit ? (
          <Button onClick={() => fileRef.current?.click()} disabled={busy} variant={hw.status === "entregue" ? "outline" : "default"}>
            <Upload className="w-4 h-4 mr-1" /> {hw.status === "entregue" ? L("Enviar nova versão", "Upload new version") : L(`Enviar ${w.task.l}`, `Submit ${w.task.l}`)}
          </Button>
        ) : (
          <>
            {hw.status === "entregue" ? (
              <Button variant="outline" onClick={() => markDone(false)} disabled={busy}><RotateCcw className="w-4 h-4 mr-1" /> {L("Desmarcar", "Undo")}</Button>
            ) : (
              <Button onClick={() => markDone(true)} disabled={busy}><CheckCircle2 className="w-4 h-4 mr-1" /> {L("Marcar como feito", "Mark as done")}</Button>
            )}
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="w-4 h-4 mr-1" /> {L("Enviar foto ou arquivo", "Send a photo or file")}</Button>
          </>
        )}
      </div>
    </Card>
  );
}

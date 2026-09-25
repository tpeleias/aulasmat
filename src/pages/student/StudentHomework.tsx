import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload, Download, Clock, AlertCircle } from "lucide-react";
import { differenceInDays, isPast, format } from "date-fns";
import { toast } from "sonner";
import { sanitizeFilename } from "@/lib/sanitizeFilename";

import { L } from "@/lib/i18n";
export default function StudentHomework() {
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
      <h1 className="text-2xl font-bold">{L("Tarefas", "Tasks")}</h1>
      {homeworks.length === 0 && <Card className="p-6 text-center text-muted-foreground text-sm">{L("Nenhuma tarefa atribuída.", "No tasks assigned.")}</Card>}
      {homeworks.map(h => (
        <HomeworkCard key={h.id} hw={h} subs={submissions[h.id] ?? []} student={student!} onChange={load} />
      ))}
    </div>
  );
}

function HomeworkCard({ hw, subs, student, onChange }: any) {
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
    if (!error) await supabase.from("homework").update({ status: "entregue" }).eq("id", hw.id);
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(L("Tarefa enviada!", "Task submitted!")); onChange(); }
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
          <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" /> {L("Atrasado", "Late")}</Badge>
        ) : hw.status === "entregue" ? (
          <Badge>{L("Entregue", "Submitted")}</Badge>
        ) : days === 0 ? (
          <Badge variant="destructive" className="gap-1"><Clock className="w-3 h-3" /> {L("Entrega hoje", "Due today")}</Badge>
        ) : (
          <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" /> {L(`Faltam ${days} ${days === 1 ? "dia" : "dias"}`, `${days} ${days === 1 ? "day" : "days"} left`)}</Badge>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{L("Prazo", "Due")}: {format(deadline, L("dd/MM/yyyy HH:mm", "MMM d, yyyy HH:mm"))}</div>

      {subs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">{L("Suas entregas", "Your submissions")}</div>
          {subs.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between border border-border rounded p-2">
              <div className="text-sm">
                <div>{L("Enviado em", "Sent on")} {format(new Date(s.submitted_at), L("dd/MM HH:mm", "MMM d, HH:mm"))}</div>
                {s.teacher_feedback && <div className="text-xs text-primary mt-1">{L("Retorno", "Feedback")}: {s.teacher_feedback}</div>}
              </div>
              <Button size="sm" variant="outline" onClick={() => download(s.file_path)}><Download className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>
      )}

      <div>
        <input ref={fileRef} type="file" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button onClick={() => fileRef.current?.click()} disabled={busy} variant={hw.status === "entregue" ? "outline" : "default"}>
          <Upload className="w-4 h-4 mr-1" /> {hw.status === "entregue" ? L("Enviar nova versão", "Upload new version") : L("Enviar tarefa", "Submit task")}
        </Button>
      </div>
    </Card>
  );
}

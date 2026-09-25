import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useWords } from "@/hooks/useVocabulary";

export type SummaryLesson = {
  id: string;
  student_name: string;
  start_at: string;
  subject?: string | null;
  status?: string;
  class_summary?: string | null;
};

/**
 * "Como foi?": o resumo de um atendimento que já aconteceu, visível para a
 * família (Minhas aulas) e na Evolução. O admin grava direto; o professor
 * passa pela porta teacher_save_lesson_summary (só a aula dele, e ela vira
 * realizada se ainda estava marcada).
 */
export function LessonSummaryDialog({ lesson, onClose, onSaved }: {
  lesson: SummaryLesson | null;
  onClose: () => void;
  onSaved: (summary: string | null) => void;
}) {
  const { isTeacher } = useAuth();
  const w = useWords();
  const ap = w.appointment;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setText(lesson?.class_summary ?? ""); }, [lesson]);

  const save = async () => {
    if (!lesson) return;
    setBusy(true);
    const summary = text.trim() || null;
    const { error } = isTeacher
      ? await supabase.rpc("teacher_save_lesson_summary" as never, { _lesson: lesson.id, _summary: summary } as never)
      : await supabase.from("lessons").update({ class_summary: summary }).eq("id", lesson.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(summary ? "Resumo salvo" : "Resumo apagado");
    onSaved(summary);
    onClose();
  };

  return (
    <Dialog open={!!lesson} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Como foi {ap.o} {ap.l}?</DialogTitle>
          {lesson && (
            <DialogDescription>
              {lesson.student_name} · <span className="capitalize">{format(new Date(lesson.start_at), "EEE dd/MM 'às' HH:mm", { locale: ptBR })}</span>
              {lesson.subject ? ` · ${lesson.subject}` : ""}
            </DialogDescription>
          )}
        </DialogHeader>
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          autoFocus
          placeholder={w.model === "aulas"
            ? 'Ex: "Trabalhamos equações do 2º grau; ficou a lista 3 para casa. Precisa rever fatoração."'
            : "O que foi feito, como foi, e o que fica para a próxima vez."}
        />
        <p className="text-xs text-muted-foreground">
          Aparece para {w.client.o} {w.client.l} em "Minhas {ap.lp}" e na Evolução {w.client.do} {w.client.l}.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

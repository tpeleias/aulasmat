import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LessonSummaryDialog, type SummaryLesson } from "@/components/LessonSummaryDialog";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, BookOpen, GraduationCap, MessageSquarePlus, Pencil } from "lucide-react";
import { format, isPast } from "date-fns";
import { capitalize } from "@/lib/balance";
import { buildTimeline, computeAttendance, type EvolutionLesson, type EvolutionHomework } from "@/lib/evolution";
import ListSkeleton from "@/components/ListSkeleton";
import EmptyState from "@/components/EmptyState";
import { useWords } from "@/hooks/useVocabulary";

import { dateLocale, L } from "@/lib/i18n";
type StudentRow = { id: string; student_name: string; guardian_name: string | null };
type SubmissionRow = { homework_id: string; teacher_feedback: string | null; submitted_at: string };

const homeworkLabel = (h: { status: string; deadline: string }) =>
  h.status === "entregue" ? L("Entregue", "Submitted") : isPast(new Date(h.deadline)) ? L("Atrasada", "Late") : L("Pendente", "Pending");

// lessons não tem student_id (é texto, como o resto do app - accountKey em
// balance.ts é a mesma ideia, mas agrupa por FAMÍLIA; aqui precisa ser por
// ALUNO, senão dois irmãos dividiriam a mesma linha do tempo).
const studentMatchKey = (name: string, guardian: string | null) =>
  `${name.trim().toLowerCase()}|${(guardian ?? "").trim().toLowerCase()}`;

export default function EvolutionPage() {
  const w = useWords();
  const [searchParams, setSearchParams] = useSearchParams();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [homework, setHomework] = useState<(EvolutionHomework & { studentId: string })[]>([]);
  const [lessonsByStudent, setLessonsByStudent] = useState<Map<string, EvolutionLesson[]>>(new Map());
  const [loading, setLoading] = useState(true);

  const studentId = searchParams.get("aluno") ?? "";
  // O resumo sendo escrito ou editado ("Como foi?").
  const [editing, setEditing] = useState<SummaryLesson | null>(null);
  const applySummary = (id: string, summary: string | null) => setLessonsByStudent(prev => {
    const next = new Map(prev);
    for (const [k, list] of next) next.set(k, list.map(l => (l.id === id ? { ...l, class_summary: summary } : l)));
    return next;
  });

  useEffect(() => {
    (async () => {
      const [st, ls, hw, sub] = await Promise.all([
        supabase.from("students").select("id, student_name, guardian_name").order("student_name"),
        supabase.from("lessons").select("id, student_name, guardian_name, start_at, subject, teacher, status, class_summary"),
        supabase.from("homework").select("id, student_id, title, deadline, status"),
        supabase.from("homework_submissions").select("homework_id, teacher_feedback, submitted_at"),
      ]);
      setStudents((st.data ?? []) as StudentRow[]);

      const byStudent = new Map<string, EvolutionLesson[]>();
      for (const l of (ls.data ?? []) as (EvolutionLesson & { student_name: string; guardian_name: string | null })[]) {
        const key = studentMatchKey(l.student_name, l.guardian_name);
        const list = byStudent.get(key) ?? [];
        list.push(l);
        byStudent.set(key, list);
      }
      setLessonsByStudent(byStudent);

      // A devolutiva mais recente de cada lição - um aluno pode reenviar,
      // e é a última correção que importa pra linha do tempo.
      const lastFeedback = new Map<string, SubmissionRow>();
      for (const s of (sub.data ?? []) as SubmissionRow[]) {
        const cur = lastFeedback.get(s.homework_id);
        if (!cur || s.submitted_at > cur.submitted_at) lastFeedback.set(s.homework_id, s);
      }
      setHomework(
        ((hw.data ?? []) as (EvolutionHomework & { student_id: string })[]).map(h => ({
          ...h, studentId: h.student_id, feedback: lastFeedback.get(h.id)?.teacher_feedback ?? null,
        })),
      );
      setLoading(false);
    })();
  }, []);

  const student = students.find(s => s.id === studentId) ?? null;
  const studentLessons = useMemo(
    () => (student ? lessonsByStudent.get(studentMatchKey(student.student_name, student.guardian_name)) ?? [] : []),
    [lessonsByStudent, student],
  );
  const studentHomework = useMemo(() => homework.filter(h => h.studentId === studentId), [homework, studentId]);
  const attendance = useMemo(() => computeAttendance(studentLessons), [studentLessons]);
  const timeline = useMemo(() => buildTimeline(studentLessons, studentHomework), [studentLessons, studentHomework]);

  if (loading) return <ListSkeleton rows={4} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{L(`Evolução ${w.client.do} ${w.client.l}`, `${w.client.s} progress`)}</h1>
        <p className="text-sm text-muted-foreground">{L(`Presença, resumo ${w.appointment.dos} ${w.appointment.lp} e devolutiva das tarefas, numa linha do tempo.`, `Attendance, ${w.appointment.l} notes and homework feedback, on a timeline.`)}</p>
      </div>

      <Select value={studentId} onValueChange={v => setSearchParams({ aluno: v })}>
        <SelectTrigger className="w-full max-w-sm h-10 rounded-xl"><SelectValue placeholder={L(`Escolha ${w.client.o} ${w.client.l}`, `Choose the ${w.client.l}`)} /></SelectTrigger>
        <SelectContent>
          {students.map(s => <SelectItem key={s.id} value={s.id}>{s.student_name}</SelectItem>)}
        </SelectContent>
      </Select>

      {!student ? (
        <EmptyState icon={GraduationCap} title={L(`Escolha ${w.client.um} ${w.client.l}`, `Choose ${w.client.um} ${w.client.l}`)} description={L("A evolução é individual - escolha quem você quer acompanhar.", "Progress is individual - choose who you want to follow.")} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="rounded-2xl p-4">
              <div className="text-xs text-muted-foreground uppercase">{L("Presença", "Attendance")}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{attendance.total > 0 ? `${attendance.taxa}%` : "—"}</div>
              <div className="text-xs text-muted-foreground">{attendance.realizadas} {L("de", "of")} {attendance.total} {attendance.total === 1 ? w.appointment.l : w.appointment.lp}</div>
            </Card>
            <Card className="rounded-2xl p-4">
              <div className="text-xs text-muted-foreground uppercase">{L("Canceladas", "Canceled")}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{attendance.canceladas}</div>
            </Card>
            <Card className="rounded-2xl p-4">
              <div className="text-xs text-muted-foreground uppercase">{L("Recusadas", "Declined")}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{attendance.recusadas}</div>
            </Card>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{L("Linha do tempo", "Timeline")}</div>
            {timeline.length === 0 ? (
              <EmptyState icon={TrendingUp} title={L("Nada ainda", "Nothing yet")} description={L(`${w.appointment.p} ${w.appointment.pick("realizados", "realizadas")} e tarefas aparecem aqui conforme acontecem.`, `Completed ${w.appointment.lp} and homework show up here as they happen.`)} />
            ) : (
              <ul className="space-y-2">
                {timeline.map((e, i) => (
                  <li key={i}>
                    <Card className="rounded-2xl p-4">
                      {e.kind === "aula" ? (
                        <>
                          <div className="flex items-center gap-2 text-sm">
                            <GraduationCap className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="font-medium capitalize">{format(new Date(e.date), L("EEE dd/MM 'às' HH:mm", "EEE, MMM d 'at' HH:mm"), { locale: dateLocale() })}</span>
                            <span className="text-muted-foreground">· {e.subject ?? w.appointment.s} · {capitalize(e.teacher)}</span>
                          </div>
                          {e.summary ? (
                            <div className="mt-1.5 flex items-start gap-2">
                              <p className="flex-1 whitespace-pre-wrap text-sm text-muted-foreground">{e.summary}</p>
                              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title={L("Editar resumo", "Edit notes")}
                                onClick={() => setEditing({ id: e.id, student_name: student.student_name, start_at: e.date, subject: e.subject, class_summary: e.summary })}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" className="mt-2 h-8 gap-1.5 rounded-xl text-xs"
                              onClick={() => setEditing({ id: e.id, student_name: student.student_name, start_at: e.date, subject: e.subject, class_summary: null })}>
                              <MessageSquarePlus className="h-3.5 w-3.5" /> {L("Como foi? Escrever resumo", "How did it go? Write notes")}
                            </Button>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 text-sm">
                            <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="font-medium">{e.title}</span>
                            <Badge variant={e.status === "entregue" ? "secondary" : "outline"} className="text-[10px]">{homeworkLabel({ status: e.status, deadline: e.date })}</Badge>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{format(new Date(e.date), L("dd/MM", "MMM d"), { locale: dateLocale() })}</span>
                          </div>
                          {e.feedback && <p className="mt-1.5 text-sm text-muted-foreground">{e.feedback}</p>}
                        </>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      <LessonSummaryDialog lesson={editing} onClose={() => setEditing(null)} onSaved={summary => editing && applySummary(editing.id, summary)} />
    </div>
  );
}

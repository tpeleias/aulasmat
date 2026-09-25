import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, addWeeks } from "date-fns";
import { ExternalLink, ChevronDown } from "lucide-react";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";
import { isSlotConflict, lessonErrorMessage } from "@/lib/lessonErrors";
import { useLessonPrice, FALLBACK_LESSON_PRICE } from "@/hooks/useLessonPrice";
import { DateTimeField } from "@/components/DateTimeField";
import { useAuth } from "@/hooks/useAuth";
import { useWords } from "@/hooks/useVocabulary";
import { statusLabel } from "@/lib/lessonStatus";
import { cap } from "@/lib/vocabulary";
import type { LessonPackage } from "@/lib/packages";
import { LessonWhatsApp } from "@/components/LessonWhatsApp";
import { usePlan } from "@/hooks/usePlan";
import { confirmMessage, whatsAppLink } from "@/lib/whatsapp";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { useServices, teacherDoes, hourlyPrice } from "@/hooks/useServices";

type Lesson = {
  id?: string; student_name: string; guardian_name?: string | null; subject?: string | null;
  start_at: string; duration_minutes: number; price: number; package_type: string; payment_status: string; notes?: string | null;
  teacher: string; address?: string | null; is_online?: boolean;
  status?: string; class_summary?: string | null;
  /** Falta cobrada (migration 20260925040000). */
  absence_charged?: boolean;
  /** O serviço escolhido (migration 20260925110000). */
  service_id?: string | null;
};

type AbsencePolicy = { on: boolean; hours: number; percent: number };


// Every lesson is charged at the list price. The package discount is not a cheaper lesson:
// it is a voucher credited on the Financeiro page, which keeps the ledger closing at zero.
// O mesmo vale para o desconto de uma família: o valor da aula não muda.

export function LessonDialog({ open, onOpenChange, slotStart, lesson, onSaved, defaultTeacher, initialStudent }: {
  open: boolean; onOpenChange: (v: boolean) => void; slotStart?: Date; lesson?: Lesson | null; onSaved: () => void;
  defaultTeacher?: string;
  initialStudent?: { student_name: string; guardian_name?: string | null; address?: string | null } | null;
}) {
  const { teachers: allTeachers } = useTeachers(true);
  const v = useWords();
  const a = v.appointment;
  // pack5/pack10 são os valores antigos, gravados em aulas de antes dos pacotes
  // por empresa; continuam com nome para as aulas velhas se lerem certo.
  const PACKAGE_LABEL: Record<string, string> = {
    single: a.pick("Avulso", "Avulsa"), pack5: `Pacote 5 ${a.lp}`, pack10: `Pacote 10 ${a.lp}`,
  };
  // Os pacotes da empresa (Configurações → Pacotes). Escolher um repete {a.o}
  // {a.l} toda semana pelo número de {a.lp} do pacote.
  const [packages, setPackages] = useState<LessonPackage[]>([]);
  // A política de falta da empresa (Configurações). Só o admin cobra.
  const [absence, setAbsence] = useState<AbsencePolicy>({ on: false, hours: 24, percent: 100 });
  // Login de professor marca só as próprias aulas e não mexe em valor nem
  // apaga (o banco também não deixa - migration 20260924040000).
  const { isTeacher } = useAuth();
  const { plan } = usePlan();
  const { templates } = useMessageTemplates();
  const { services, links } = useServices(true);
  const perTeacher = !!plan.teacher_services;
  const teachersAll = isTeacher && defaultTeacher
    ? allTeachers.filter(t => teacherSlug(t.name) === defaultTeacher)
    : allTeachers;
  // O valor da hora sai das Configurações da empresa, não do código.
  const { price: listPrice } = useLessonPrice();
  // A matéria que já vem preenchida sai do cadastro do professor, não de uma
  // lista de nomes escrita no código.
  const subjectOf = (slug: string) =>
    teachersAll.find(t => teacherSlug(t.name) === slug)?.subject ?? "";
  const knownSubjects = teachersAll.map(t => t.subject).filter(Boolean) as string[];
  const baseTeacher = defaultTeacher || "";
  const [form, setForm] = useState<Lesson>({
    student_name: "", guardian_name: "", subject: "",
    start_at: "", duration_minutes: 60, price: listPrice, package_type: "single", payment_status: "pendente", notes: "",
    teacher: baseTeacher, address: "", is_online: false, status: "agendada", class_summary: "",
  });
  // Com serviço escolhido, a lista mostra só quem faz (e sempre quem já está).
  const teachers = teachersAll.filter(t =>
    teacherSlug(t.name) === form.teacher || teacherDoes(t, form.service_id, links, perTeacher));
  const [busy, setBusy] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [repeatCount, setRepeatCount] = useState(5);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [students, setStudents] = useState<Array<{ id: string; student_name: string; guardian_name: string | null; address: string | null; whatsapp?: string | null }>>([]);

  useEffect(() => {
    if (!open) return;
    // "*" e não a lista de colunas: plan_locked só existe depois da migration
    // 20260923020000, e pedir uma coluna que não existe derrubaria a consulta.
    // Aluno pausado pelo plano sai da sugestão - o banco recusaria a aula.
    supabase.from("students").select("*").order("student_name").then(({ data }) => {
      setStudents(((data ?? []) as any[]).filter(s => !s.plan_locked));
    });
    if (!isTeacher) {
      supabase.from("settings").select("*").maybeSingle().then(({ data }) => {
        const d = data as { charge_absence?: boolean; absence_notice_hours?: number; absence_charge_percent?: number } | null;
        setAbsence({ on: !!d?.charge_absence, hours: Number(d?.absence_notice_hours ?? 24), percent: Number(d?.absence_charge_percent ?? 100) });
      });
    }
    supabase.from("lesson_packages" as never).select("*").eq("active", true).order("sort_order")
      .then(({ data, error }) => { if (!error) setPackages((data ?? []) as unknown as LessonPackage[]); });
  }, [open]);

  useEffect(() => {
    if (lesson) {
      // O banco devolve "2026-09-23T18:00:00+00:00"; o campo de data só aceita
      // hora local sem fuso ("2026-09-23T15:00") e, com o outro formato, ficava
      // em branco na edição.
      setForm({ ...lesson, start_at: format(new Date(lesson.start_at), "yyyy-MM-dd'T'HH:mm"), address: lesson.address ?? "", is_online: lesson.is_online ?? false, status: lesson.status ?? "agendada", class_summary: lesson.class_summary ?? "" });
    } else {
      setForm({
        student_name: initialStudent?.student_name ?? "",
        guardian_name: initialStudent?.guardian_name ?? "",
        subject: subjectOf(baseTeacher),
        start_at: slotStart ? format(slotStart, "yyyy-MM-dd'T'HH:mm") : "",
        duration_minutes: 60, price: listPrice, package_type: "single", payment_status: "pendente", notes: "",
        teacher: baseTeacher,
        address: initialStudent?.address ?? "",
        is_online: false,
        status: "agendada",
        class_summary: "",
      });
      setRecurring(false);
      setRepeatCount(1);
      setConflictMsg(null);
    }
  }, [lesson, slotStart, open, baseTeacher, initialStudent]);

  // O valor da empresa costuma chegar antes de o diálogo abrir, mas pode
  // atrasar. Se atrasar, o formulário ainda está com o valor de último recurso
  // e adota o verdadeiro quando ele chega. A condição é o que impede isso de
  // apagar um valor que o professor já tenha digitado à mão.
  useEffect(() => {
    if (!open || lesson?.id) return;
    setForm(f => (f.price === FALLBACK_LESSON_PRICE && listPrice !== FALLBACK_LESSON_PRICE
      ? { ...f, price: listPrice }
      : f));
  }, [listPrice, open, lesson?.id]);

  const studentOptionLabel = (s: { student_name: string; guardian_name: string | null }) => {
    const dupes = students.filter(o => o.student_name.toLowerCase() === s.student_name.toLowerCase());
    if (dupes.length <= 1) return s.student_name;
    return `${s.student_name} (${s.guardian_name || `sem ${v.guardian.l}`})`;
  };

  const pickStudent = (name: string) => {
    const trimmed = name.trim().toLowerCase();
    // Exact match on the disambiguated label (picked from the dropdown) takes priority.
    const byLabel = students.find(s => studentOptionLabel(s).toLowerCase() === trimmed);
    const byNameMatches = students.filter(s => s.student_name.toLowerCase() === trimmed);
    // Only auto-fill from a bare name match when it's unambiguous - never guess between duplicates.
    const match = byLabel ?? (byNameMatches.length === 1 ? byNameMatches[0] : undefined);
    setForm(f => ({
      ...f,
      student_name: match ? match.student_name : name,
      guardian_name: match ? (match.guardian_name ?? "") : f.guardian_name,
      address: match ? (match.address ?? "") : f.address,
      is_online: match?.address ? false : f.is_online,
    }));
  };

  // O WhatsApp do cadastro: pelo nome e, havendo homônimos, pelo responsável.
  const phoneOf = (l: { student_name: string; guardian_name?: string | null }) => {
    const same = students.filter(s => s.student_name.toLowerCase() === l.student_name.trim().toLowerCase());
    const hit = same.length === 1 ? same[0]
      : same.find(s => (s.guardian_name ?? "").toLowerCase() === (l.guardian_name ?? "").trim().toLowerCase());
    return hit?.whatsapp ?? null;
  };

  const setTeacher = (t: string) => setForm(f => ({
    ...f,
    teacher: t,
    // Só troca a matéria se ela ainda for a sugestão automática de algum
    // professor - uma matéria digitada à mão pelo usuário é preservada.
    subject: !f.subject || knownSubjects.includes(f.subject)
      ? (subjectOf(t) || f.subject)
      : f.subject,
  }));

  // O serviço preenche o assunto, a duração, o preço e se é on-line.
  const setService = (id: string) => {
    if (id === "none") { setForm(f => ({ ...f, service_id: null })); return; }
    const sv = services?.find(x => x.id === id);
    if (!sv) return;
    setForm(f => ({
      ...f,
      service_id: sv.id,
      subject: sv.name,
      duration_minutes: sv.duration_minutes,
      price: hourlyPrice(sv) ?? listPrice,
      is_online: sv.mode === "online" ? true : sv.mode === "presencial" ? false : f.is_online,
    }));
  };

  const setPackage = (pkg: string) => {
    setForm(f => ({ ...f, package_type: pkg }));
    if (!lesson?.id) {
      const p = packages.find(x => x.name === pkg);
      // Pacote de um serviço: {a.o} {a.l} já vem com o serviço dele.
      if (p?.service_id && services?.some(s => s.id === p.service_id)) setService(p.service_id);
      const n = p ? p.lessons : pkg === "pack5" ? 5 : pkg === "pack10" ? 10 : 1;
      if (n > 1) { setRecurring(true); setRepeatCount(Math.min(52, n)); }
      else { setRecurring(false); setRepeatCount(1); }
    }
  };

  const buildOccurrences = (baseISO: string, count: number) => {
    const base = new Date(baseISO);
    return Array.from({ length: count }, (_, i) => addWeeks(base, i));
  };

  const ensureStudent = async () => {
    const name = form.student_name.trim();
    if (!name) return;
    const exists = students.some(s => s.student_name.toLowerCase() === name.toLowerCase());
    if (exists) return;
    const { error } = await supabase.from("students").insert({
      student_name: name,
      guardian_name: (form.guardian_name ?? "").trim() || null,
      address: form.is_online ? null : ((form.address ?? "").trim() || null),
    });
    if (error) console.warn("Não foi possível cadastrar automaticamente:", error.message);
    else toast.success(`${v.client.s} "${name}" ${v.client.pick("cadastrado", "cadastrada")} automaticamente`);
  };

  // "Série" é inferida, não gravada no banco: outras aulas do mesmo aluno/professor,
  // mesmo dia da semana e horário, ainda agendadas e no futuro em relação a esta.
  const findFutureSeriesMatches = async (base: Lesson): Promise<{ id: string; start_at: string }[]> => {
    if (!base.id) return [];
    const { data, error } = await supabase
      .from("lessons")
      .select("id,start_at")
      .eq("student_name", base.student_name)
      .eq("teacher", base.teacher)
      .eq("status", "agendada")
      .neq("id", base.id)
      .gt("start_at", base.start_at)
      .order("start_at");
    if (error || !data) return [];
    const baseDate = new Date(base.start_at);
    const baseWeekday = baseDate.getDay();
    const baseTime = format(baseDate, "HH:mm");
    return (data as { id: string; start_at: string }[]).filter(r => {
      const d = new Date(r.start_at);
      return d.getDay() === baseWeekday && format(d, "HH:mm") === baseTime;
    });
  };

  const save = async () => {
    if (!form.student_name.trim()) { toast.error(`Nome ${v.client.do} ${v.client.l} obrigatório`); return; }
    if (!form.start_at || Number.isNaN(new Date(form.start_at).getTime())) { toast.error(`Escolha o dia e o horário ${a.do} ${a.l}`); return; }
    setBusy(true);
    setConflictMsg(null);

    await ensureStudent();

    // Names are the key that ties a lesson to its student record and wallet - stray
    // whitespace silently orphans the lesson from the cadastro.
    const names = {
      student_name: form.student_name.trim(),
      guardian_name: (form.guardian_name ?? "").trim() || null,
    };

    if (lesson?.id) {
      const futureMatches = await findFutureSeriesMatches(lesson);
      const applyToAll = futureMatches.length > 0 && confirm(
        `${cap(a.este)} ${a.l} parece fazer parte de uma série: mesmo ${v.client.l}, ${v.staff.l}, dia da semana e horário se repetem em ${futureMatches.length} ${futureMatches.length === 1 ? a.l : a.lp} ${a.pick("futuro", "futura")}${futureMatches.length === 1 ? "" : "s"}.\n\nOK = aplicar esta alteração ${a.pick("a este e aos futuros", "a esta e às futuras")}.\nCancelar = alterar só ${a.este} ${a.l}.`
      );

      // payment_status is derived from the wallet by the database; never send it back.
      const { id: _ignore, payment_status: _ps, ...rest } = form as any;
      const payload = { ...rest, ...names, start_at: new Date(form.start_at).toISOString() };
      const { error } = await supabase.from("lessons").update(payload).eq("id", lesson.id);
      if (error) { setBusy(false); toast.error(lessonErrorMessage(error, v)); return; }

      if (applyToAll) {
        // status/class_summary/start_at ficam de fora: são específicos de cada aula,
        // só o horário (hora:minuto) é reaplicado, mantendo a data de cada ocorrência.
        const { id: _i2, payment_status: _ps2, status: _st, class_summary: _cs, start_at: _sa, ...futureRest } = form as any;
        const newTime = format(new Date(form.start_at), "HH:mm");
        const timeChanged = newTime !== format(new Date(lesson.start_at), "HH:mm");
        for (const m of futureMatches) {
          let start = m.start_at;
          if (timeChanged) {
            const d = new Date(m.start_at);
            const [hh, mm] = newTime.split(":").map(Number);
            d.setHours(hh, mm, 0, 0);
            start = d.toISOString();
          }
          const { error: futureError } = await supabase.from("lessons").update({ ...futureRest, ...names, start_at: start }).eq("id", m.id);
          if (futureError) toast.error(`${format(new Date(m.start_at), "dd/MM")}: ${lessonErrorMessage(futureError, v)}`);
        }
      }

      setBusy(false);
      const salva = `${a.s} ${a.pick("salvo", "salva")}`;
      toast.success(applyToAll ? `${salva} e ${a.pick("aplicado", "aplicada")} a mais ${futureMatches.length} ${futureMatches.length === 1 ? a.l : a.lp}` : salva);
      onOpenChange(false); onSaved();
      return;
    }

    if (!recurring || repeatCount <= 1) {
      // payment_status is derived from the wallet by the database; never send it back.
      const { id: _ignore, payment_status: _ps, ...rest } = form as any;
      const payload = { ...rest, ...names, start_at: new Date(form.start_at).toISOString() };
      const { error } = await supabase.from("lessons").insert(payload);
      setBusy(false);
      if (error) toast.error(lessonErrorMessage(error, v)); else { toast.success(`${a.s} ${a.pick("salvo", "salva")}`); onOpenChange(false); onSaved(); }
      return;
    }

    const occurrences = buildOccurrences(form.start_at, repeatCount);
    const minStart = occurrences[0].toISOString();
    const lastEnd = new Date(occurrences[occurrences.length - 1].getTime() + form.duration_minutes * 60000).toISOString();

    const { data: busyRanges } = await supabase.rpc("get_busy_ranges_by_teacher", {
      _from: minStart, _to: lastEnd, _teacher: form.teacher,
    });

    const conflicts: string[] = [];
    const toInsert: any[] = [];
    for (const occ of occurrences) {
      const occEnd = new Date(occ.getTime() + form.duration_minutes * 60000);
      const hit = (busyRanges ?? []).some((r: any) =>
        new Date(r.start_at) < occEnd && new Date(r.end_at) > occ
      );
      if (hit) conflicts.push(format(occ, "dd/MM HH:mm"));
      else { const { id: _i, payment_status: _ps, ...rest } = form as any; toInsert.push({ ...rest, ...names, start_at: occ.toISOString() }); }
    }

    if (toInsert.length === 0) {
      setBusy(false);
      setConflictMsg(`Todos os ${occurrences.length} horários estão ocupados: ${conflicts.join(", ")}`);
      return;
    }

    const { error } = await supabase.from("lessons").insert(toInsert);
    setBusy(false);
    if (error) {
      // O insert é uma instrução só: se um horário conflitar, nenhuma aula é
      // criada. Acontece quando alguém marcou no meio do caminho, depois de a
      // checagem acima ter lido a agenda.
      toast.error(isSlotConflict(error)
        ? `Um dos horários foi ocupado enquanto você preenchia. ${a.nenhum} ${a.l} foi ${a.pick("criado", "criada")} - abra de novo para ver a agenda atual.`
        : lessonErrorMessage(error, v));
      return;
    }

    // Pro e Max: avisar a família pelo WhatsApp com um toque, já com dia e hora.
    const first = toInsert[0];
    const notify = plan.whatsapp_link ? {
      action: {
        label: "Avisar no WhatsApp",
        onClick: () => { window.open(whatsAppLink(phoneOf(first), confirmMessage(first, v, templates)), "_blank", "noopener"); },
      },
      duration: 10000,
    } : undefined;
    if (conflicts.length > 0) {
      toast.success(`${toInsert.length} ${a.lp} ${a.pick("criados", "criadas")}. ${conflicts.length} ${a.pick("ignorados", "ignoradas")} por conflito: ${conflicts.join(", ")}`, notify);
    } else if (toInsert.length === 1) {
      toast.success(`${a.s} ${a.pick("marcado", "marcada")}`, notify);
    } else {
      toast.success(`${toInsert.length} ${a.lp} recorrentes ${a.pick("criados", "criadas")}`, notify);
    }
    onOpenChange(false);
    onSaved();
  };

  // Falta cobrada: a aula vira realizada, marcada como falta, ao percentual da
  // política. Quem decide é o banco (charge_lesson_absence); aqui é o pedido.
  // Resumo pelo professor (rpc teacher_save_lesson_summary): só da aula dele
  // que já começou, marcada ou realizada.
  const teacherCanSummarize = !!lesson?.id && isTeacher
    && (lesson.status === "realizada" || (lesson.status === "agendada" && new Date(lesson.start_at) <= new Date()));
  const [teacherSummary, setTeacherSummary] = useState("");
  useEffect(() => { setTeacherSummary(lesson?.class_summary ?? ""); }, [lesson?.id, lesson?.class_summary, open]);
  const saveTeacherSummary = async () => {
    if (!lesson?.id) return;
    setBusy(true);
    const { error } = await supabase.rpc("teacher_save_lesson_summary" as never, { _lesson: lesson.id, _summary: teacherSummary } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Resumo salvo");
    onOpenChange(false);
    onSaved();
  };

  const canChargeAbsence = !!lesson?.id && !isTeacher && absence.on && !lesson.absence_charged
    && ["agendada", "cancelada"].includes(lesson.status ?? "agendada");
  const hoursBefore = lesson?.start_at ? (new Date(lesson.start_at).getTime() - Date.now()) / 3_600_000 : Infinity;
  const lateCancel = absence.on && form.status === "cancelada" && hoursBefore < absence.hours;

  const chargeAbsence = async () => {
    if (!lesson?.id) return;
    const total = (lesson.price * lesson.duration_minutes / 60) * absence.percent / 100;
    if (!confirm(`Cobrar ${a.o} ${a.l} de ${lesson.student_name} como falta?\n\n` +
      `${cap(a.o)} ${a.l} fica como ${a.pick("realizado", "realizada")} e marcada como falta, e entra na cobrança por ` +
      `${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (${absence.percent}% do valor).`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("charge_lesson_absence" as never, { _lesson: lesson.id } as never);
    setBusy(false);
    if (error) { toast.error(lessonErrorMessage(error, v)); return; }
    toast.success(`Falta cobrada de ${lesson.student_name}`);
    onSaved();
    onOpenChange(false);
  };

  const remove = async () => {
    if (!lesson?.id) return;
    if (!confirm(`Excluir ${a.este} ${a.l}?`)) return;
    await supabase.from("wallet_transactions").delete().eq("lesson_id", lesson.id);
    const { error } = await supabase.from("lessons").delete().eq("id", lesson.id);
    if (error) toast.error(error.message); else { toast.success(`${a.s} ${a.pick("excluído", "excluída")}`); onOpenChange(false); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isTeacher ? cap(a.s) : lesson?.id ? `Editar ${a.l}` : `${a.novo} ${a.l}`}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {lesson?.id && <LessonWhatsApp lesson={lesson} phone={phoneOf(lesson)} />}
          {/* Login de professor: só consulta (migration 20260925100000). */}
          <fieldset disabled={isTeacher} className="contents">
          {services && services.length > 0 && (
            <div>
              <Label>{v.topic.s}</Label>
              <Select value={form.service_id ?? "none"} onValueChange={setService}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem {v.topic.l} da lista</SelectItem>
                  {services.map(sv => (
                    <SelectItem key={sv.id} value={sv.id}>
                      {sv.name} · {sv.duration_minutes} min{sv.price != null && !isTeacher ? ` · ${Number(sv.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{v.staff.s}</Label>
              {/* O valor é o apelido (teacherSlug), o mesmo que o banco compara
                  na trava de plano e nas permissões do professor. */}
              <Select value={form.teacher} onValueChange={setTeacher} disabled={isTeacher}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {teachers.map(t => <SelectItem key={t.id} value={teacherSlug(t.name)}>{capitalize(t.name)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{v.client.s}</Label>
              <Input
                list="students-list"
                value={form.student_name}
                onChange={e => pickStudent(e.target.value)}
                placeholder="Digite ou selecione"
              />
              <datalist id="students-list">
                {students.map(s => (
                  <option key={s.id} value={studentOptionLabel(s)} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{v.guardian.s}</Label><Input value={form.guardian_name ?? ""} onChange={e => setForm({ ...form, guardian_name: e.target.value })} /></div>
            <div><Label>{services?.length ? "Descrição" : v.topic.s}</Label><Input value={form.subject ?? ""} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
          </div>
          <div>
            <Label>Dia e horário</Label>
            <DateTimeField key={open ? (lesson?.id ?? "nova") : "fechado"} value={form.start_at} onChange={v => setForm(f => ({ ...f, start_at: v }))} />
          </div>
          <div>
            <Label>Duração</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {[30, 45, 60, 90, 120].map(m => (
                <Button key={m} type="button" size="sm" variant={form.duration_minutes === m ? "default" : "outline"}
                  className="h-8 rounded-full px-3" onClick={() => setForm(f => ({ ...f, duration_minutes: m }))}>
                  {m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`}
                </Button>
              ))}
              <Input type="number" inputMode="numeric" className="h-8 w-20" value={form.duration_minutes}
                onChange={e => setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))} aria-label="Duração em minutos" />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <Label>Endereço {v.client.do} {v.client.l}</Label>
              <Input
                value={form.address ?? ""}
                disabled={form.is_online}
                placeholder={form.is_online ? `${a.s} on-line` : "Rua, número, bairro, cidade"}
                onChange={e => setForm({ ...form, address: e.target.value })}
              />
              {form.address && !form.is_online && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(form.address)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                >
                  <ExternalLink className="w-3 h-3" /> Abrir rota no Google Maps
                </a>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer select-none">
              <Checkbox checked={!!form.is_online} onCheckedChange={v => setForm({ ...form, is_online: !!v, address: v ? "" : form.address })} />
              On-line
            </label>
          </div>
          {!isTeacher && <>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Pacote</Label>
              <Select value={form.package_type} onValueChange={setPackage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">{PACKAGE_LABEL.single}</SelectItem>
                  {packages.map(p => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                  {/* Aula antiga com pacote que não existe mais na lista: mostra o
                      nome que ela tem, em vez de um campo vazio. */}
                  {form.package_type !== "single" && !packages.some(p => p.name === form.package_type) && (
                    <SelectItem value={form.package_type}>{PACKAGE_LABEL[form.package_type] ?? form.package_type}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <span className="text-xs text-muted-foreground">
                Total: <strong className="text-foreground">
                  {(form.price * form.duration_minutes / 60).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </strong> ({form.duration_minutes} min)
              </span>
            </div>
          </div>
          <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            {cap(a.pick("todo", "toda"))} {a.l} entra pelo valor cheio (R$ {listPrice}/h). O desconto do pacote é lançado
            como <strong className="text-foreground">voucher</strong> no Financeiro ao registrar o pagamento.
          </div>
          </>}
          <Collapsible key={isTeacher ? "prof" : "admin"} defaultOpen={isTeacher} className="rounded-md border border-border bg-muted/30">
            <CollapsibleTrigger asChild>
              <button className="group flex w-full items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors">
                <span>{isTeacher ? "Detalhes adicionais (status e observações)" : "Detalhes adicionais (valor, status e observações)"}</span>
                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="p-3 pt-0 space-y-3">
              {!isTeacher && <div>
                <Label>Valor por hora (R$/h)</Label>
                <Input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Pagamento é marcado na página Financeiro (isso mantém a carteira correta).
                </p>
              </div>}
              <div><Label>Situação {a.do} {a.l}</Label>
                <Select value={form.status ?? "agendada"} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* "Solicitada" fica na lista para o professor poder responder o
                        pedido aqui também, e não só pela tela Hoje - ele chega neste
                        diálogo clicando no pedido na agenda. */}
                    <SelectItem value="solicitada">Solicitada (aguardando você)</SelectItem>
                    {(["agendada", "realizada", "recusada", "cancelada"] as const).map(st => (
                      <SelectItem key={st} value={st}>{cap(statusLabel(st, v))}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {lateCancel && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  Desmarcou com menos de {absence.hours}h de antecedência. Pela sua política, dá para cobrar como falta
                  ({absence.percent}% do valor) - use o botão "Cobrar como falta" abaixo em vez de só desmarcar.
                </p>
              )}
              {lesson?.absence_charged && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs">Falta cobrada: {a.o} {a.l} não aconteceu, mas entrou na cobrança.</p>
              )}
              {form.status === "realizada" && (
                <div>
                  <Label>Resumo {a.do} {a.l} (visível para {v.client.o} {v.client.l})</Label>
                  <Textarea
                    value={form.class_summary ?? ""}
                    onChange={e => setForm({ ...form, class_summary: e.target.value })}
                    placeholder={v.model === "aulas" ? 'Ex: "Trabalhamos equações do 2º grau e iniciamos a lista X."' : "O que foi feito, e o que fica para a próxima vez."}
                    rows={3}
                  />
                </div>
              )}
              <div><Label>Observações</Label><Textarea value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </CollapsibleContent>
          </Collapsible>
          {!lesson?.id && (
            <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox checked={recurring} onCheckedChange={v => setRecurring(!!v)} />
                Repetir semanalmente (mesmo dia e horário)
              </label>
              {recurring && (
                <div className="grid grid-cols-[auto_100px_1fr] items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Nº de {a.lp}</Label>
                  <Input type="number" min={2} max={52} value={repeatCount}
                    onChange={e => setRepeatCount(Math.max(1, Number(e.target.value) || 1))} />
                  <span className="text-xs text-muted-foreground">
                    Cria {repeatCount} {a.lp}, {a.um} por semana, a partir do início informado.
                  </span>
                </div>
              )}
              {conflictMsg && <div className="text-xs text-destructive">{conflictMsg}</div>}
            </div>
          )}
          </fieldset>
          {/* Professor: escreve o resumo da própria aula que já começou (e ela
              vira realizada). Resto do diálogo continua só leitura. */}
          {isTeacher && lesson?.id && teacherCanSummarize && (
            <div className="space-y-2 rounded-md border border-primary/40 p-3">
              <Label>Resumo {a.do} {a.l} (visível para {v.client.o} {v.client.l})</Label>
              <Textarea
                value={teacherSummary}
                onChange={e => setTeacherSummary(e.target.value)}
                placeholder={v.model === "aulas" ? 'Ex: "Trabalhamos equações do 2º grau e iniciamos a lista X."' : "O que foi feito, e o que fica para a próxima vez."}
                rows={3}
              />
              {lesson.status === "agendada" && (
                <p className="text-xs text-muted-foreground">Ao salvar, {a.o} {a.l} fica {a.pick("marcado", "marcada")} como {a.pick("realizado", "realizada")}.</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {lesson?.id && !isTeacher && <Button variant="destructive" onClick={remove}>Excluir</Button>}
          {canChargeAbsence && (
            <Button variant="outline" onClick={chargeAbsence} disabled={busy} title={`Cobra ${absence.percent}% do valor`}>
              Cobrar como falta
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isTeacher ? "Fechar" : "Cancelar"}</Button>
          {!isTeacher && <Button onClick={save} disabled={busy}>Salvar</Button>}
          {isTeacher && lesson?.id && teacherCanSummarize && (
            <Button onClick={saveTeacherSummary} disabled={busy}>
              {lesson.status === "agendada" ? `Salvar e marcar como ${a.pick("realizado", "realizada")}` : "Salvar resumo"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { WheelSelect } from "@/components/WheelSelect";
import { GuardianField } from "@/components/GuardianField";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { ExternalLink, ChevronDown } from "lucide-react";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { capitalize, fmtMoney } from "@/lib/balance";
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

import { L, currencySymbol, isEnglish, durationLabel } from "@/lib/i18n";
import { NumberField } from "@/components/NumberField";
import { WheelPicker } from "@/components/WheelPicker";

import { navAppName, routeUrl, useNavApp } from "@/lib/navigation";
import { buildOccurrences, countUntil, MAX_OCCURRENCES, WEEKDAY_SHORT, weekdaysLabel } from "@/lib/recurrence";

// A rodinha de duração: de 5 em 5 minutos, até 4 horas.
const DURATIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 5);
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
    single: L(a.pick("Avulso", "Avulsa"), "Single"), pack5: L(`Pacote 5 ${a.lp}`, `5-${a.l} package`), pack10: L(`Pacote 10 ${a.lp}`, `10-${a.l} package`),
  };
  // Os pacotes da empresa (Configurações → Pacotes). Escolher um repete {a.o}
  // {a.l} toda semana pelo número de {a.lp} do pacote.
  const [packages, setPackages] = useState<LessonPackage[]>([]);
  // A política de falta da empresa (Configurações). Só o admin cobra.
  const [absence, setAbsence] = useState<AbsencePolicy>({ on: false, hours: 24, percent: 100 });
  // Login de professor marca só as próprias aulas e não mexe em valor nem
  // apaga (o banco também não deixa - migration 20260924040000).
  const { isTeacher } = useAuth();
  const navApp = useNavApp();
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
  const [wheelOpen, setWheelOpen] = useState(false);
  // Sem serviço escolhido, a duração é a "Duração padrão" das Configurações
  // (settings.slot_minutes), não 60 fixo (Thiago, 27/09).
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [recurring, setRecurring] = useState(false);
  const [repeatCount, setRepeatCount] = useState(5);
  // Repetir por quantidade ou até uma data (Thiago, 01/10).
  const [repeatMode, setRepeatMode] = useState<"count" | "until">("count");
  const [repeatUntil, setRepeatUntil] = useState("");
  // Dias da repetição (0 = domingo). Vazio = o dia do início, como antes.
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
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
        const d = data as { charge_absence?: boolean; absence_notice_hours?: number; absence_charge_percent?: number; slot_minutes?: number } | null;
        const slot = Number(d?.slot_minutes);
        if (slot >= 5 && slot <= 480) {
          setDefaultDuration(slot);
          // O diálogo novo abriu antes de a configuração chegar: adota a dela.
          setForm(f => (!lesson?.id && !f.service_id && f.duration_minutes === 60 ? { ...f, duration_minutes: slot } : f));
        }
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
        duration_minutes: defaultDuration, price: listPrice, package_type: "single", payment_status: "pendente", notes: "",
        teacher: baseTeacher,
        address: initialStudent?.address ?? "",
        is_online: false,
        status: "agendada",
        class_summary: "",
      });
      setRecurring(false);
      setRepeatCount(1);
      setRepeatDays([]);
      setWheelOpen(false);
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

  const [studentFocus, setStudentFocus] = useState(false);
  const studentMatches = (() => {
    const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const q = norm(form.student_name);
    if (!q) return [];
    const hits = students.filter(s => norm(studentOptionLabel(s)).includes(q));
    // Já escolheu exatamente um: não fica oferecendo ele mesmo.
    if (hits.length === 1 && norm(studentOptionLabel(hits[0])) === q) return [];
    return hits.slice(0, 5);
  })();

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

  // Sem serviço, volta ao padrão o que ainda é o que o serviço tinha posto
  // (Thiago, 27/09: antes ficavam a duração e o valor do serviço anterior).
  // O que a pessoa mudou à mão depois de escolher o serviço fica.
  const clearService = (f: Lesson): Lesson => {
    const sv = services?.find(x => x.id === f.service_id);
    if (!sv) return { ...f, service_id: null };
    return {
      ...f,
      service_id: null,
      subject: f.subject === sv.name ? subjectOf(f.teacher) : f.subject,
      duration_minutes: f.duration_minutes === sv.duration_minutes ? defaultDuration : f.duration_minutes,
      price: f.price === (hourlyPrice(sv) ?? listPrice) ? listPrice : f.price,
    };
  };

  // O serviço preenche o assunto, a duração, o preço e se é on-line.
  const setService = (id: string) => {
    if (id === "none") { setForm(clearService); return; }
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

  // Atendimento novo: se a matéria que já veio preenchida é o nome de um
  // serviço, ele entra escolhido, com a duração e o valor dele (Thiago, 27/09:
  // quem não mexe em nada fica com a duração do serviço).
  // Uma vez por abertura (e de novo se trocar o profissional): digitar a
  // descrição depois não troca nada sozinho.
  const autoPicked = useRef<string | null>(null);
  useEffect(() => { if (!open) autoPicked.current = null; }, [open]);
  useEffect(() => {
    if (!open || lesson?.id || !services?.length || autoPicked.current === form.teacher) return;
    const name = (form.subject ?? "").trim().toLowerCase();
    if (!name) return;
    autoPicked.current = form.teacher;
    if (form.service_id) return;
    const hit = services.filter(x => x.name.trim().toLowerCase() === name);
    if (hit.length === 1) setService(hit[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lesson?.id, services, form.teacher, form.subject]);

  const setPackage = (pkg: string) => {
    setForm(f => ({ ...f, package_type: pkg }));
    if (!lesson?.id) {
      const p = packages.find(x => x.name === pkg);
      // Pacote de um serviço: {a.o} {a.l} já vem com o serviço dele.
      if (p?.service_id && services?.some(s => s.id === p.service_id)) setService(p.service_id);
      const n = p ? p.lessons : pkg === "pack5" ? 5 : pkg === "pack10" ? 10 : 1;
      if (n > 1) { setRecurring(true); setRepeatCount(Math.min(MAX_OCCURRENCES, n)); }
      else { setRecurring(false); setRepeatCount(1); }
    }
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
    else toast.success(L(`${v.client.s} "${name}" ${v.client.pick("cadastrado", "cadastrada")} automaticamente`, `${v.client.s} "${name}" added automatically`));
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
    if (!form.student_name.trim()) { toast.error(L(`Nome ${v.client.do} ${v.client.l} obrigatório`, `${v.client.s} name is required`)); return; }
    if (!form.start_at || Number.isNaN(new Date(form.start_at).getTime())) { toast.error(L(`Escolha o dia e o horário ${a.do} ${a.l}`, `Choose the ${a.l} date and time`)); return; }
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
        L(`${cap(a.este)} ${a.l} parece fazer parte de uma série: mesmo ${v.client.l}, ${v.staff.l}, dia da semana e horário se repetem em ${futureMatches.length} ${futureMatches.length === 1 ? a.l : a.lp} ${a.pick("futuro", "futura")}${futureMatches.length === 1 ? "" : "s"}.\n\nOK = aplicar esta alteração ${a.pick("a este e aos futuros", "a esta e às futuras")}.\nCancelar = alterar só ${a.este} ${a.l}.`,
          `This ${a.l} looks like part of a series: same ${v.client.l}, ${v.staff.l}, weekday and time repeat in ${futureMatches.length} upcoming ${futureMatches.length === 1 ? a.l : a.lp}.\n\nOK = apply this change to this one and the upcoming ones.\nCancel = change only this ${a.l}.`)
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
          if (futureError) toast.error(`${format(new Date(m.start_at), L("dd/MM", "MMM d"))}: ${lessonErrorMessage(futureError, v)}`);
        }
      }

      setBusy(false);
      const salva = L(`${a.s} ${a.pick("salvo", "salva")}`, `${a.s} saved`);
      toast.success(applyToAll ? L(`${salva} e ${a.pick("aplicado", "aplicada")} a mais ${futureMatches.length} ${futureMatches.length === 1 ? a.l : a.lp}`, `${salva} and applied to ${futureMatches.length} more ${futureMatches.length === 1 ? a.l : a.lp}`) : salva);
      onOpenChange(false); onSaved();
      return;
    }

    // Com dias escolhidos, até um atendimento só pode cair noutro dia que não o do início.
    // "Até tal data" vira a quantidade de atendimentos até lá.
    const totalCount = repeatMode === "until"
      ? Math.min(MAX_OCCURRENCES, repeatUntil ? countUntil(new Date(form.start_at), new Date(`${repeatUntil}T12:00`), repeatDays) : 0)
      : repeatCount;
    if (recurring && repeatMode === "until" && totalCount < 1) {
      setBusy(false);
      toast.error(L("Escolha até que dia repetir (depois do início).", "Pick the end date (after the start)."));
      return;
    }
    if (!recurring || (totalCount <= 1 && repeatDays.length === 0)) {
      // payment_status is derived from the wallet by the database; never send it back.
      const { id: _ignore, payment_status: _ps, ...rest } = form as any;
      const payload = { ...rest, ...names, start_at: new Date(form.start_at).toISOString() };
      const { error } = await supabase.from("lessons").insert(payload);
      setBusy(false);
      if (error) toast.error(lessonErrorMessage(error, v)); else { toast.success(L(`${a.s} ${a.pick("salvo", "salva")}`, `${a.s} saved`)); onOpenChange(false); onSaved(); }
      return;
    }

    const occurrences = buildOccurrences(new Date(form.start_at), totalCount, repeatDays);
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
      if (hit) conflicts.push(format(occ, L("dd/MM HH:mm", "MMM d, h:mm a")));
      else { const { id: _i, payment_status: _ps, ...rest } = form as any; toInsert.push({ ...rest, ...names, start_at: occ.toISOString() }); }
    }

    if (toInsert.length === 0) {
      setBusy(false);
      setConflictMsg(L(`Todos os ${occurrences.length} horários estão ocupados: ${conflicts.join(", ")}`, `All ${occurrences.length} times are taken: ${conflicts.join(", ")}`));
      return;
    }

    const { error } = await supabase.from("lessons").insert(toInsert);
    setBusy(false);
    if (error) {
      // O insert é uma instrução só: se um horário conflitar, nenhuma aula é
      // criada. Acontece quando alguém marcou no meio do caminho, depois de a
      // checagem acima ter lido a agenda.
      toast.error(isSlotConflict(error)
        ? L(`Um dos horários foi ocupado enquanto você preenchia. ${a.nenhum} ${a.l} foi ${a.pick("criado", "criada")} - abra de novo para ver a agenda atual.`, `One of the times was taken while you were filling this in. No ${a.l} was created - open it again to see the current calendar.`)
        : lessonErrorMessage(error, v));
      return;
    }

    // Pro e Max: avisar a família pelo WhatsApp com um toque, já com dia e hora.
    const first = toInsert[0];
    const notify = plan.whatsapp_link ? {
      action: {
        label: L("Avisar no WhatsApp", "Notify on WhatsApp"),
        onClick: () => { window.open(whatsAppLink(phoneOf(first), confirmMessage(first, v, templates)), "_blank", "noopener"); },
      },
      duration: 10000,
    } : undefined;
    if (conflicts.length > 0) {
      toast.success(L(`${toInsert.length} ${a.lp} ${a.pick("criados", "criadas")}. ${conflicts.length} ${a.pick("ignorados", "ignoradas")} por conflito: ${conflicts.join(", ")}`, `${toInsert.length} ${a.lp} created. ${conflicts.length} skipped due to conflicts: ${conflicts.join(", ")}`), notify);
    } else if (toInsert.length === 1) {
      toast.success(L(`${a.s} ${a.pick("marcado", "marcada")}`, `${a.s} booked`), notify);
    } else {
      toast.success(L(`${toInsert.length} ${a.lp} recorrentes ${a.pick("criados", "criadas")}`, `${toInsert.length} recurring ${a.lp} created`), notify);
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
    toast.success(L("Resumo salvo", "Notes saved"));
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
    if (!confirm(L(`Cobrar ${a.o} ${a.l} de ${lesson.student_name} como falta?\n\n` +
      `${cap(a.o)} ${a.l} fica como ${a.pick("realizado", "realizada")} e marcada como falta, e entra na cobrança por ` +
      `${fmtMoney(total)} (${absence.percent}% do valor).`,
      `Charge ${lesson.student_name}'s ${a.l} as a no-show?\n\nThe ${a.l} is marked as done and as a no-show, and is billed at ` +
      `${fmtMoney(total)} (${absence.percent}% of the price).`))) return;
    setBusy(true);
    const { error } = await supabase.rpc("charge_lesson_absence" as never, { _lesson: lesson.id } as never);
    setBusy(false);
    if (error) { toast.error(lessonErrorMessage(error, v)); return; }
    toast.success(L(`Falta cobrada de ${lesson.student_name}`, `No-show charged to ${lesson.student_name}`));
    onSaved();
    onOpenChange(false);
  };

  const remove = async () => {
    if (!lesson?.id) return;
    if (!confirm(L(`Excluir ${a.este} ${a.l}?`, `Delete this ${a.l}?`))) return;
    await supabase.from("wallet_transactions").delete().eq("lesson_id", lesson.id);
    const { error } = await supabase.from("lessons").delete().eq("id", lesson.id);
    if (error) toast.error(error.message); else { toast.success(L(`${a.s} ${a.pick("excluído", "excluída")}`, `${a.s} deleted`)); onOpenChange(false); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isTeacher ? cap(a.s) : lesson?.id ? L(`Editar ${a.l}`, `Edit ${a.l}`) : `${a.novo} ${a.l}`}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {lesson?.id && <LessonWhatsApp lesson={lesson} phone={phoneOf(lesson)} />}
          {/* Professor: escreve o resumo da própria aula que já começou (e ela
              vira realizada). Resto do diálogo continua só leitura. */}
          {isTeacher && lesson?.id && teacherCanSummarize && (
            <div className="space-y-2 rounded-md border border-primary/40 p-3">
              <Label>{L(`Como foi? Resumo ${a.do} ${a.l} (visível para ${v.client.o} ${v.client.l})`, `How did it go? ${a.s} notes (visible to the ${v.client.l})`)}</Label>
              <Textarea
                value={teacherSummary}
                onChange={e => setTeacherSummary(e.target.value)}
                placeholder={v.model === "aulas" ? L('Ex: "Trabalhamos equações do 2º grau e iniciamos a lista X."', 'E.g. "We worked on quadratic equations and started worksheet X."') : L("O que foi feito, e o que fica para a próxima vez.", "What was done, and what comes next.")}
                rows={3}
              />
              {lesson.status === "agendada" && (
                <p className="text-xs text-muted-foreground">{L(`Ao salvar, ${a.o} ${a.l} fica ${a.pick("marcado", "marcada")} como ${a.pick("realizado", "realizada")}.`, `Saving marks the ${a.l} as done.`)}</p>
              )}
            </div>
          )}
          {/* Login de professor: só consulta (migration 20260925100000). */}
          <fieldset disabled={isTeacher} className="contents">
          {services && services.length > 0 && (
            <div>
              <Label>{v.topic.s}</Label>
              <WheelSelect value={form.service_id ?? "none"} onValueChange={setService} label={v.topic.s} options={[
                { value: "none", label: L(`Sem ${v.topic.l} da lista`, `No ${v.topic.l} from the list`) },
                ...services.map(sv => ({
                  value: sv.id,
                  label: `${sv.name} · ${sv.duration_minutes} min${sv.price != null && !isTeacher ? ` · ${fmtMoney(Number(sv.price))}` : ""}`,
                })),
              ]} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{v.staff.s}</Label>
              {/* O valor é o apelido (teacherSlug), o mesmo que o banco compara
                  na trava de plano e nas permissões do professor. */}
              <WheelSelect value={form.teacher} onValueChange={setTeacher} disabled={isTeacher} label={v.staff.s}
                options={teachers.map(t => ({ value: teacherSlug(t.name), label: capitalize(t.name) }))} />
            </div>
            <div>
              <Label>{v.client.s}</Label>
              {/* Sugestões curtas enquanto digita, no lugar do datalist: no
                  celular ele abria a lista inteira de clientes, maior que a
                  tela (Thiago, 27/09). */}
              <div className="relative">
                <Input
                  value={form.student_name}
                  onChange={e => { pickStudent(e.target.value); setStudentFocus(true); }}
                  onFocus={() => setStudentFocus(true)}
                  onBlur={() => setStudentFocus(false)}
                  placeholder={L("Digite o nome", "Type the name")}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={studentFocus && studentMatches.length > 0}
                  aria-controls="students-suggestions"
                  aria-label={v.client.s}
                />
                {studentFocus && studentMatches.length > 0 && (
                  <ul id="students-suggestions" role="listbox" aria-label={L("Sugestões", "Suggestions")}
                    className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md">
                    {studentMatches.map(s => (
                      <li key={s.id} role="option" aria-selected={false}
                        onMouseDown={e => { e.preventDefault(); pickStudent(studentOptionLabel(s)); setStudentFocus(false); }}
                        className="cursor-pointer truncate px-3 py-2.5 text-sm hover:bg-accent">
                        {studentOptionLabel(s)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <GuardianField key={open ? (lesson?.id ?? "nova") : "fechado"} w={v} value={form.guardian_name ?? ""}
              onChange={g => setForm(f => ({ ...f, guardian_name: g }))} />
            <div><Label>{services?.length ? L("Descrição", "Description") : v.topic.s}</Label><Input value={form.subject ?? ""} onChange={e => {
              const subject = e.target.value;
              // Apagou o nome do serviço: deixa de ser aquele serviço, e a
              // duração e o valor dele voltam ao padrão (Thiago, 27/09).
              setForm(f => (f.service_id && !subject.trim() ? { ...clearService(f), subject } : { ...f, subject }));
            }} /></div>
          </div>
          <div>
            <Label>{L("Dia e horário", "Date and time")}</Label>
            <DateTimeField key={open ? (lesson?.id ?? "nova") : "fechado"} value={form.start_at} onChange={v => setForm(f => ({ ...f, start_at: v }))} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <Label>{L(`Endereço ${v.client.do} ${v.client.l}`, `${v.client.s} address`)}</Label>
              <Input
                value={form.address ?? ""}
                disabled={form.is_online}
                placeholder={form.is_online ? L(`${a.s} on-line`, `Online ${a.l}`) : L("Rua, número, bairro, cidade", "Street, number, city")}
                onChange={e => setForm({ ...form, address: e.target.value })}
              />
              {form.address && !form.is_online && (
                <a
                  href={routeUrl(form.address, navApp)}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                >
                  <ExternalLink className="w-3 h-3" /> {L(`Abrir rota no ${navAppName(navApp)}`, `Open route in ${navAppName(navApp)}`)}
                </a>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer select-none">
              <Checkbox checked={!!form.is_online} onCheckedChange={v => setForm({ ...form, is_online: !!v, address: v ? "" : form.address })} />
              {L("On-line", "Online")}
            </label>
          </div>
          {!isTeacher && <>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{L("Pacote", "Package")}</Label>
              {/* Aula antiga com pacote que não existe mais na lista: mostra o
                  nome que ela tem, em vez de um campo vazio. */}
              <WheelSelect value={form.package_type} onValueChange={setPackage} label={L("Pacote", "Package")} options={[
                { value: "single", label: PACKAGE_LABEL.single },
                ...packages.map(p => ({ value: p.name, label: p.name })),
                ...(form.package_type !== "single" && !packages.some(p => p.name === form.package_type)
                  ? [{ value: form.package_type, label: PACKAGE_LABEL[form.package_type] ?? form.package_type }] : []),
              ]} />
            </div>
            <div className="flex items-end">
              <span className="text-xs text-muted-foreground">
                Total: <strong className="text-foreground">
                  {fmtMoney(form.price * form.duration_minutes / 60)}
                </strong> ({form.duration_minutes} min)
              </span>
            </div>
          </div>
          <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            {L(<>{cap(a.pick("todo", "toda"))} {a.l} entra pelo valor cheio ({fmtMoney(listPrice)}/h). O desconto do pacote é lançado
            como <strong className="text-foreground">voucher</strong> no Financeiro ao registrar o pagamento.</>,
            <>Every {a.l} is billed at full price ({fmtMoney(listPrice)}/h). The package discount is added as a
            <strong className="text-foreground"> voucher</strong> in Billing when you record the payment.</>)}
          </div>
          </>}
          {/* "Como foi?" à vista quando {a.o} {a.l} já aconteceu - antes ficava
              escondido nos detalhes e ninguém achava. */}
          {!isTeacher && form.status === "realizada" && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <Label>{L(`Como foi? Resumo ${a.do} ${a.l} (visível para ${v.client.o} ${v.client.l})`, `How did it go? ${a.s} notes (visible to the ${v.client.l})`)}</Label>
              <Textarea
                className="mt-1"
                value={form.class_summary ?? ""}
                onChange={e => setForm({ ...form, class_summary: e.target.value })}
                placeholder={v.model === "aulas" ? L('Ex: "Trabalhamos equações do 2º grau e iniciamos a lista X."', 'E.g. "We worked on quadratic equations and started worksheet X."') : L("O que foi feito, e o que fica para a próxima vez.", "What was done, and what comes next.")}
                rows={3}
              />
            </div>
          )}
          <Collapsible key={isTeacher ? "prof" : "admin"} defaultOpen={isTeacher} className="rounded-md border border-border bg-muted/30">
            <CollapsibleTrigger asChild>
              <button className="group flex w-full items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors">
                <span>{isTeacher ? L("Detalhes adicionais (duração, status e observações)", "More details (length, status and notes)") : L("Detalhes adicionais (duração, valor, status e observações)", "More details (length, price, status and notes)")}</span>
                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="p-3 pt-0 space-y-3">
            <div>
              <Label>{L("Duração", "Duration")}</Label>
              {/* A duração à vista e, só se for mudar, a rodinha (Thiago, 27/09:
                  os atalhos de 30 min, 45 min, 1h… poluíam o diálogo). */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-semibold tabular-nums">{durationLabel(form.duration_minutes)}</span>
                <Button type="button" size="sm" variant="outline" className="h-9 rounded-xl" aria-expanded={wheelOpen}
                  onClick={() => setWheelOpen(o => !o)}>
                  {wheelOpen ? L("Pronto", "Done") : L("Outra duração", "Other length")}
                </Button>
              </div>
              {wheelOpen && (
                <div className="mt-2">
                  <WheelPicker
                    rows={5}
                    className="mx-auto max-w-xs"
                    label={L("Duração", "Duration")}
                    options={DURATIONS.includes(form.duration_minutes) ? DURATIONS : [...DURATIONS, form.duration_minutes].sort((x, y) => x - y)}
                    value={form.duration_minutes}
                    format={durationLabel}
                    onChange={m => setForm(f => ({ ...f, duration_minutes: m }))}
                  />
                </div>
              )}
            </div>
              {!isTeacher && <div>
                <Label>{L("Valor por hora", "Hourly rate")} ({currencySymbol()}/h)</Label>
                <NumberField step="0.01" inputMode="decimal" min={0} fallback={listPrice} value={form.price} onValueChange={n => setForm(f => ({ ...f, price: n }))} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {L("Pagamento é marcado na página Financeiro (isso mantém a carteira correta).", "Payments are recorded on the Billing page (that keeps balances correct).")}
                </p>
              </div>}
              <div><Label>{L(`Situação ${a.do} ${a.l}`, `${a.s} status`)}</Label>
                {/* "Solicitada" fica na lista para o professor poder responder o
                    pedido aqui também, e não só pela tela Hoje - ele chega neste
                    diálogo clicando no pedido na agenda. */}
                <WheelSelect value={form.status ?? "agendada"} onValueChange={st => setForm(f => ({ ...f, status: st }))}
                  label={L(`Situação ${a.do} ${a.l}`, `${a.s} status`)} options={[
                    { value: "solicitada", label: L("Solicitada (aguardando você)", "Requested (waiting for you)") },
                    ...(["agendada", "realizada", "recusada", "cancelada"] as const).map(st => ({ value: st, label: cap(statusLabel(st, v)) })),
                  ]} />
              </div>
              {lateCancel && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  {L(`Desmarcou com menos de ${absence.hours}h de antecedência. Pela sua política, dá para cobrar como falta (${absence.percent}% do valor) - use o botão "Cobrar como falta" abaixo em vez de só desmarcar.`,
                     `Canceled less than ${absence.hours}h in advance. Under your policy you can charge it as a no-show (${absence.percent}% of the price) - use "Charge as no-show" below instead of just canceling.`)}
                </p>
              )}
              {lesson?.absence_charged && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs">{L(`Falta cobrada: ${a.o} ${a.l} não aconteceu, mas entrou na cobrança.`, `No-show charged: the ${a.l} did not happen, but it was billed.`)}</p>
              )}
              <div><Label>{L("Observações", "Notes")}</Label><Textarea value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </CollapsibleContent>
          </Collapsible>
          {!lesson?.id && (
            <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox checked={recurring} onCheckedChange={v => {
                  setRecurring(!!v);
                  if (v && repeatCount < 2) setRepeatCount(4);
                }} />
                {L("Repetir toda semana", "Repeat every week")}
              </label>
              {recurring && (() => {
                const startDay = form.start_at ? new Date(form.start_at).getDay() : null;
                const days = repeatDays.length ? repeatDays : startDay !== null ? [startDay] : [];
                const en = isEnglish();
                const names = en ? WEEKDAY_SHORT.en : WEEKDAY_SHORT.pt;
                const toggle = (d: number) => {
                  const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
                  setRepeatDays(next.length ? next : days);
                };
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={L("Dias da semana", "Weekdays")}>
                      {[1, 2, 3, 4, 5, 6, 0].map(d => (
                        <Button key={d} type="button" size="sm" variant={days.includes(d) ? "default" : "outline"}
                          aria-pressed={days.includes(d)} className="h-8 w-11 rounded-full px-0 capitalize" onClick={() => toggle(d)}>
                          {names[d]}
                        </Button>
                      ))}
                    </div>
                    <div className="inline-flex rounded-full border border-border p-0.5" role="radiogroup" aria-label={L("Repetir por", "Repeat by")}>
                      {([["count", L("Quantidade", "Number")], ["until", L("Até uma data", "Until a date")]] as const).map(([m, label]) => (
                        <button key={m} type="button" role="radio" aria-checked={repeatMode === m}
                          onClick={() => {
                            setRepeatMode(m);
                            // Sem data ainda: sugere 2 meses depois do início.
                            if (m === "until" && !repeatUntil && form.start_at) setRepeatUntil(format(addDays(new Date(form.start_at), 56), "yyyy-MM-dd"));
                          }}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${repeatMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {repeatMode === "count" ? (
                      <div className="grid grid-cols-[auto_90px_1fr] items-center gap-2">
                        <Label className="text-xs text-muted-foreground">{L(`Nº de ${a.lp}`, `No. of ${a.lp}`)}</Label>
                        <NumberField inputMode="numeric" min={1} max={MAX_OCCURRENCES} fallback={1} value={repeatCount}
                          onValueChange={n => setRepeatCount(Math.round(n))} />
                        <span className="text-xs text-muted-foreground">
                          {days.length
                            ? L(`${repeatCount} ${repeatCount === 1 ? a.l : a.lp}, toda ${weekdaysLabel(days, false)}, a partir do início.`,
                                `${repeatCount} ${repeatCount === 1 ? a.l : a.lp}, every ${weekdaysLabel(days, true)}, from the start date.`)
                            : L("Escolha o dia e o horário primeiro.", "Pick the date and time first.")}
                        </span>
                      </div>
                    ) : (() => {
                      const startDate = form.start_at ? form.start_at.slice(0, 10) : undefined;
                      const n = form.start_at && repeatUntil ? countUntil(new Date(form.start_at), new Date(`${repeatUntil}T12:00`), repeatDays) : 0;
                      return (
                        <div className="grid grid-cols-[auto_150px_1fr] items-center gap-2">
                          <Label htmlFor="repetir-ate" className="text-xs text-muted-foreground">{L("Até", "Until")}</Label>
                          <Input id="repetir-ate" type="date" value={repeatUntil} min={startDate} onChange={e => setRepeatUntil(e.target.value)} />
                          <span className="text-xs text-muted-foreground">
                            {!days.length ? L("Escolha o dia e o horário primeiro.", "Pick the date and time first.")
                              : n < 1 ? L("Escolha uma data depois do início.", "Pick a date after the start.")
                              : n > MAX_OCCURRENCES
                                ? L(`Dá ${n} ${a.lp}; o máximo de uma vez é ${MAX_OCCURRENCES}. Serão ${a.pick("criados", "criadas")} só ${a.os} ${MAX_OCCURRENCES} ${a.pick("primeiros", "primeiras")}.`,
                                    `That's ${n} ${a.lp}; the most at once is ${MAX_OCCURRENCES}. Only the first ${MAX_OCCURRENCES} will be created.`)
                                : L(`${n} ${n === 1 ? a.l : a.lp}, toda ${weekdaysLabel(days, false)}, até ${format(new Date(`${repeatUntil}T12:00`), "dd/MM/yyyy")}.`,
                                    `${n} ${n === 1 ? a.l : a.lp}, every ${weekdaysLabel(days, true)}, until ${format(new Date(`${repeatUntil}T12:00`), "MMM d, yyyy")}.`)}
                          </span>
                        </div>
                      );
                    })()}
                    {repeatDays.length > 0 && startDay !== null && !repeatDays.includes(startDay) && (
                      <p className="text-[11px] text-muted-foreground">
                        {L(`O início (${names[startDay]}) não está entre os dias: ${a.o} ${a.pick("primeiro", "primeira")} fica no próximo dia escolhido.`,
                           `The start date (${names[startDay]}) is not one of the days: the first ${a.l} goes on the next chosen day.`)}
                      </p>
                    )}
                  </div>
                );
              })()}
              {conflictMsg && <div className="text-xs text-destructive">{conflictMsg}</div>}
            </div>
          )}
          </fieldset>
        </div>
        <DialogFooter className="gap-2">
          {lesson?.id && !isTeacher && <Button variant="destructive" onClick={remove}>{L("Excluir", "Delete")}</Button>}
          {canChargeAbsence && (
            <Button variant="outline" onClick={chargeAbsence} disabled={busy} title={L(`Cobra ${absence.percent}% do valor`, `Charges ${absence.percent}% of the price`)}>
              {L("Cobrar como falta", "Charge as no-show")}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isTeacher ? L("Fechar", "Close") : L("Cancelar", "Cancel")}</Button>
          {!isTeacher && <Button onClick={save} disabled={busy}>{L("Salvar", "Save")}</Button>}
          {isTeacher && lesson?.id && teacherCanSummarize && (
            <Button onClick={saveTeacherSummary} disabled={busy}>
              {lesson.status === "agendada" ? L(`Salvar e marcar como ${a.pick("realizado", "realizada")}`, "Save and mark as done") : L("Salvar resumo", "Save notes")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

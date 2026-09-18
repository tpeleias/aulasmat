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
import { useTeachers } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";

type Lesson = {
  id?: string; student_name: string; guardian_name?: string | null; subject?: string | null;
  start_at: string; duration_minutes: number; price: number; package_type: string; payment_status: string; notes?: string | null;
  teacher: string; address?: string | null; is_online?: boolean;
  status?: string; class_summary?: string | null;
};

const DEFAULT_SUBJECT: Record<string, string> = { thiago: "Matemática", mayara: "Química" };

// Every lesson is charged at the list price. The package discount is not a cheaper lesson:
// it is a voucher credited on the Cobrança page, which keeps the ledger closing at zero.
const LIST_PRICE = 220;
const PACKAGE_LABEL: Record<string, string> = { single: "Avulsa", pack5: "Pacote 5 aulas", pack10: "Pacote 10 aulas" };

export function LessonDialog({ open, onOpenChange, slotStart, lesson, onSaved, defaultTeacher, initialStudent }: {
  open: boolean; onOpenChange: (v: boolean) => void; slotStart?: Date; lesson?: Lesson | null; onSaved: () => void;
  defaultTeacher?: string;
  initialStudent?: { student_name: string; guardian_name?: string | null; address?: string | null } | null;
}) {
  const baseTeacher = defaultTeacher || "thiago";
  const [form, setForm] = useState<Lesson>({
    student_name: "", guardian_name: "", subject: DEFAULT_SUBJECT[baseTeacher] ?? "Matemática",
    start_at: "", duration_minutes: 60, price: LIST_PRICE, package_type: "single", payment_status: "pendente", notes: "",
    teacher: baseTeacher, address: "", is_online: false, status: "agendada", class_summary: "",
  });
  const [busy, setBusy] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [repeatCount, setRepeatCount] = useState(5);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [students, setStudents] = useState<Array<{ id: string; student_name: string; guardian_name: string | null; address: string | null }>>([]);

  const { teachers } = useTeachers(true);

  useEffect(() => {
    if (!open) return;
    supabase.from("students").select("id,student_name,guardian_name,address").order("student_name").then(({ data }) => {
      setStudents((data ?? []) as any);
    });
  }, [open]);

  useEffect(() => {
    if (lesson) {
      setForm({ ...lesson, address: lesson.address ?? "", is_online: lesson.is_online ?? false, status: lesson.status ?? "agendada", class_summary: lesson.class_summary ?? "" });
    } else {
      setForm({
        student_name: initialStudent?.student_name ?? "",
        guardian_name: initialStudent?.guardian_name ?? "",
        subject: DEFAULT_SUBJECT[baseTeacher] ?? "Matemática",
        start_at: slotStart ? format(slotStart, "yyyy-MM-dd'T'HH:mm") : "",
        duration_minutes: 60, price: LIST_PRICE, package_type: "single", payment_status: "pendente", notes: "",
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

  const studentOptionLabel = (s: { student_name: string; guardian_name: string | null }) => {
    const dupes = students.filter(o => o.student_name.toLowerCase() === s.student_name.toLowerCase());
    if (dupes.length <= 1) return s.student_name;
    return `${s.student_name} (${s.guardian_name || "sem responsável"})`;
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

  const setTeacher = (t: string) => setForm(f => ({
    ...f,
    teacher: t,
    subject: !f.subject || f.subject === DEFAULT_SUBJECT.thiago || f.subject === DEFAULT_SUBJECT.mayara
      ? DEFAULT_SUBJECT[t] ?? f.subject
      : f.subject,
  }));

  const setPackage = (pkg: string) => {
    setForm(f => ({ ...f, package_type: pkg }));
    if (!lesson?.id) {
      if (pkg === "pack5") { setRecurring(true); setRepeatCount(5); }
      else if (pkg === "pack10") { setRecurring(true); setRepeatCount(10); }
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
    if (error) console.warn("Não foi possível cadastrar aluno automaticamente:", error.message);
    else toast.success(`Aluno "${name}" cadastrado automaticamente`);
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
    if (!form.student_name.trim()) { toast.error("Nome do aluno obrigatório"); return; }
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
        `Esta aula parece fazer parte de uma série: mesmo aluno, professor, dia da semana e horário se repetem em ${futureMatches.length} aula(s) futura(s).\n\nOK = aplicar esta alteração a esta e às futuras.\nCancelar = alterar só esta aula.`
      );

      // payment_status is derived from the wallet by the database; never send it back.
      const { id: _ignore, payment_status: _ps, ...rest } = form as any;
      const payload = { ...rest, ...names, start_at: new Date(form.start_at).toISOString() };
      const { error } = await supabase.from("lessons").update(payload).eq("id", lesson.id);
      if (error) { setBusy(false); toast.error(error.message); return; }

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
          if (futureError) toast.error(`Aula futura não atualizada: ${futureError.message}`);
        }
      }

      setBusy(false);
      toast.success(applyToAll ? `Aula salva e aplicada a ${futureMatches.length} aula(s) futura(s)` : "Aula salva");
      onOpenChange(false); onSaved();
      return;
    }

    if (!recurring || repeatCount <= 1) {
      // payment_status is derived from the wallet by the database; never send it back.
      const { id: _ignore, payment_status: _ps, ...rest } = form as any;
      const payload = { ...rest, ...names, start_at: new Date(form.start_at).toISOString() };
      const { error } = await supabase.from("lessons").insert(payload);
      setBusy(false);
      if (error) toast.error(error.message); else { toast.success("Aula salva"); onOpenChange(false); onSaved(); }
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
    if (error) { toast.error(error.message); return; }

    if (conflicts.length > 0) {
      toast.success(`${toInsert.length} aulas criadas. ${conflicts.length} ignoradas por conflito: ${conflicts.join(", ")}`);
    } else {
      toast.success(`${toInsert.length} aulas recorrentes criadas`);
    }
    onOpenChange(false);
    onSaved();
  };

  const remove = async () => {
    if (!lesson?.id) return;
    if (!confirm("Excluir esta aula?")) return;
    await supabase.from("wallet_transactions").delete().eq("lesson_id", lesson.id);
    const { error } = await supabase.from("lessons").delete().eq("id", lesson.id);
    if (error) toast.error(error.message); else { toast.success("Aula excluída"); onOpenChange(false); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{lesson?.id ? "Editar aula" : "Nova aula"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Professor(a)</Label>
              <Select value={form.teacher} onValueChange={setTeacher}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {teachers.length === 0 && <SelectItem value="thiago">Thiago</SelectItem>}
                  {teachers.map(t => <SelectItem key={t.id} value={t.name}>{capitalize(t.name)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Aluno</Label>
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
            <div><Label>Responsável</Label><Input value={form.guardian_name ?? ""} onChange={e => setForm({ ...form, guardian_name: e.target.value })} /></div>
            <div><Label>Assunto</Label><Input value={form.subject ?? ""} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Duração (min)</Label><Input type="number" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: Number(e.target.value) })} /></div>
            <div><Label>Início</Label><Input type="datetime-local" value={form.start_at} onChange={e => setForm({ ...form, start_at: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <Label>Endereço do aluno</Label>
              <Input
                value={form.address ?? ""}
                disabled={form.is_online}
                placeholder={form.is_online ? "Aula on-line" : "Rua, número, bairro, cidade"}
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
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Pacote</Label>
              <Select value={form.package_type} onValueChange={setPackage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">{PACKAGE_LABEL.single}</SelectItem>
                  <SelectItem value="pack5">{PACKAGE_LABEL.pack5}</SelectItem>
                  <SelectItem value="pack10">{PACKAGE_LABEL.pack10}</SelectItem>
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
            Toda aula entra pelo valor cheio (R$ {LIST_PRICE}/h). O desconto do pacote é lançado
            como <strong className="text-foreground">voucher</strong> na Cobrança ao registrar o pagamento.
          </div>
          <Collapsible className="rounded-md border border-border bg-muted/30">
            <CollapsibleTrigger asChild>
              <button className="group flex w-full items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors">
                <span>Detalhes adicionais (valor, status e observações)</span>
                <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="p-3 pt-0 space-y-3">
              <div>
                <Label>Valor por hora (R$/h)</Label>
                <Input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Pagamento é marcado na página Cobrança (isso mantém a carteira correta).
                </p>
              </div>
              <div><Label>Situação da aula</Label>
                <Select value={form.status ?? "agendada"} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agendada">Agendada</SelectItem>
                    <SelectItem value="realizada">Realizada</SelectItem>
                    <SelectItem value="cancelada">Cancelada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.status === "realizada" && (
                <div>
                  <Label>Resumo da aula (visível para o aluno)</Label>
                  <Textarea
                    value={form.class_summary ?? ""}
                    onChange={e => setForm({ ...form, class_summary: e.target.value })}
                    placeholder='Ex: "Trabalhamos equações do 2º grau e iniciamos a lista X."'
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
                  <Label className="text-xs text-muted-foreground">Nº de aulas</Label>
                  <Input type="number" min={2} max={52} value={repeatCount}
                    onChange={e => setRepeatCount(Math.max(1, Number(e.target.value) || 1))} />
                  <span className="text-xs text-muted-foreground">
                    Cria {repeatCount} aulas, uma por semana, a partir do início informado.
                  </span>
                </div>
              )}
              {conflictMsg && <div className="text-xs text-destructive">{conflictMsg}</div>}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {lesson?.id && <Button variant="destructive" onClick={remove}>Excluir</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={busy}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

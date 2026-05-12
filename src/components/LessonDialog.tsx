import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, addWeeks } from "date-fns";
import { ExternalLink } from "lucide-react";

type Lesson = {
  id?: string; student_name: string; guardian_name?: string | null; subject?: string | null;
  start_at: string; duration_minutes: number; price: number; package_type: string; payment_status: string; notes?: string | null;
  teacher: string; address?: string | null; is_online?: boolean;
};

const DEFAULT_SUBJECT: Record<string, string> = { thiago: "Matemática", mayara: "Química" };

const PACKAGE_PRICES: Record<string, number> = { single: 220, pack5: 210, pack10: 200 };

export function LessonDialog({ open, onOpenChange, slotStart, lesson, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; slotStart?: Date; lesson?: Lesson | null; onSaved: () => void;
}) {
  const [form, setForm] = useState<Lesson>({
    student_name: "", guardian_name: "", subject: "Matemática",
    start_at: "", duration_minutes: 60, price: 220, package_type: "single", payment_status: "pendente", notes: "",
    teacher: "thiago", address: "", is_online: false,
  });
  const [busy, setBusy] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [repeatCount, setRepeatCount] = useState(5);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [students, setStudents] = useState<Array<{ id: string; student_name: string; guardian_name: string | null; address: string | null }>>([]);

  useEffect(() => {
    if (!open) return;
    supabase.from("students").select("id,student_name,guardian_name,address").order("student_name").then(({ data }) => {
      setStudents((data ?? []) as any);
    });
  }, [open]);

  useEffect(() => {
    if (lesson) {
      setForm({ ...lesson, address: lesson.address ?? "", is_online: lesson.is_online ?? false });
    } else {
      // Reset to defaults for a new lesson — never carry the previous lesson's id.
      setForm({
        student_name: "", guardian_name: "", subject: "Matemática",
        start_at: slotStart ? format(slotStart, "yyyy-MM-dd'T'HH:mm") : "",
        duration_minutes: 60, price: 220, package_type: "single", payment_status: "pendente", notes: "",
        teacher: "thiago", address: "", is_online: false,
      });
      setRecurring(false);
      setRepeatCount(1);
      setConflictMsg(null);
    }
  }, [lesson, slotStart, open]);

  const pickStudent = (name: string) => {
    const match = students.find(s => s.student_name.toLowerCase() === name.trim().toLowerCase());
    setForm(f => ({
      ...f,
      student_name: name,
      guardian_name: match?.guardian_name ?? f.guardian_name,
      address: match?.address ?? f.address,
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
    setForm(f => ({ ...f, package_type: pkg, price: PACKAGE_PRICES[pkg] ?? f.price }));
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

  const save = async () => {
    if (!form.student_name.trim()) { toast.error("Nome do aluno obrigatório"); return; }
    setBusy(true);
    setConflictMsg(null);

    if (lesson?.id || !recurring || repeatCount <= 1) {
      const payload = { ...form, start_at: new Date(form.start_at).toISOString() };
      const { error } = lesson?.id
        ? await supabase.from("lessons").update(payload).eq("id", lesson.id)
        : await supabase.from("lessons").insert(payload);
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
      else toInsert.push({ ...form, start_at: occ.toISOString() });
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
    const { error } = await supabase.from("lessons").delete().eq("id", lesson.id);
    if (error) toast.error(error.message); else { toast.success("Aula excluída"); onOpenChange(false); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{lesson?.id ? "Editar aula" : "Nova aula"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Professor(a)</Label>
              <Select value={form.teacher} onValueChange={setTeacher}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="thiago">Thiago</SelectItem>
                  <SelectItem value="mayara">Mayara</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Aluno</Label><Input value={form.student_name} onChange={e => setForm({ ...form, student_name: e.target.value })} /></div>
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
                  <SelectItem value="single">Avulsa — R$ 220</SelectItem>
                  <SelectItem value="pack5">Pacote 5 — R$ 210/aula</SelectItem>
                  <SelectItem value="pack10">Pacote 10 — R$ 200/aula</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} /></div>
          </div>
          <div><Label>Status pagamento</Label>
            <Select value={form.payment_status} onValueChange={v => setForm({ ...form, payment_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="pago">Pago</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
          <div><Label>Observações</Label><Textarea value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
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

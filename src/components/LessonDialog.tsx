import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

type Lesson = {
  id?: string; student_name: string; guardian_name?: string | null; subject?: string | null;
  start_at: string; duration_minutes: number; price: number; package_type: string; payment_status: string; notes?: string | null;
  teacher: string;
};

const PACKAGE_PRICES: Record<string, number> = { single: 220, pack5: 210, pack10: 200 };

export function LessonDialog({ open, onOpenChange, slotStart, lesson, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; slotStart?: Date; lesson?: Lesson | null; onSaved: () => void;
}) {
  const [form, setForm] = useState<Lesson>({
    student_name: "", guardian_name: "", subject: "Matemática",
    start_at: "", duration_minutes: 60, price: 220, package_type: "single", payment_status: "pendente", notes: ""
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (lesson) setForm(lesson);
    else if (slotStart) setForm(f => ({ ...f, start_at: format(slotStart, "yyyy-MM-dd'T'HH:mm") }));
  }, [lesson, slotStart, open]);

  const setPackage = (pkg: string) => setForm(f => ({ ...f, package_type: pkg, price: PACKAGE_PRICES[pkg] ?? f.price }));

  const save = async () => {
    if (!form.student_name.trim()) { toast.error("Nome do aluno obrigatório"); return; }
    setBusy(true);
    const payload = { ...form, start_at: new Date(form.start_at).toISOString() };
    const { error } = lesson?.id
      ? await supabase.from("lessons").update(payload).eq("id", lesson.id)
      : await supabase.from("lessons").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Aula salva"); onOpenChange(false); onSaved(); }
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
            <div><Label>Aluno</Label><Input value={form.student_name} onChange={e => setForm({ ...form, student_name: e.target.value })} /></div>
            <div><Label>Responsável</Label><Input value={form.guardian_name ?? ""} onChange={e => setForm({ ...form, guardian_name: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Assunto</Label><Input value={form.subject ?? ""} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
            <div><Label>Duração (min)</Label><Input type="number" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: Number(e.target.value) })} /></div>
          </div>
          <div><Label>Início</Label><Input type="datetime-local" value={form.start_at} onChange={e => setForm({ ...form, start_at: e.target.value })} /></div>
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

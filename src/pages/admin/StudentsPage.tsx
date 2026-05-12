import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

type Student = {
  id: string; student_name: string; guardian_name: string | null; address: string | null;
};
type Lesson = { student_name: string; start_at: string };
type Tx = { student_name: string; guardian_name: string | null; amount: number };

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [editing, setEditing] = useState<Partial<Student> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: s }, { data: l }, { data: t }] = await Promise.all([
      supabase.from("students").select("*").order("student_name"),
      supabase.from("lessons").select("student_name,start_at").lt("start_at", new Date().toISOString()),
      supabase.from("wallet_transactions").select("student_name,guardian_name,amount"),
    ]);
    setStudents((s ?? []) as Student[]);
    setLessons((l ?? []) as Lesson[]);
    setTxs((t ?? []) as Tx[]);
  };
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const lessonCount = new Map<string, number>();
    for (const l of lessons) {
      const k = norm(l.student_name);
      lessonCount.set(k, (lessonCount.get(k) ?? 0) + 1);
    }
    const balByStudent = new Map<string, number>();
    const balByGuardian = new Map<string, number>();
    for (const t of txs) {
      const g = norm(t.guardian_name);
      if (g) balByGuardian.set(g, (balByGuardian.get(g) ?? 0) + Number(t.amount));
      else {
        const s = norm(t.student_name);
        balByStudent.set(s, (balByStudent.get(s) ?? 0) + Number(t.amount));
      }
    }
    return { lessonCount, balByStudent, balByGuardian };
  }, [lessons, txs]);

  const balanceFor = (st: Student) => {
    const g = norm(st.guardian_name);
    if (g && stats.balByGuardian.has(g)) return stats.balByGuardian.get(g)!;
    return stats.balByStudent.get(norm(st.student_name)) ?? 0;
  };

  const save = async () => {
    if (!editing?.student_name?.trim()) { toast.error("Nome do aluno obrigatório"); return; }
    setBusy(true);
    const payload = {
      student_name: editing.student_name.trim(),
      guardian_name: editing.guardian_name?.trim() || null,
      address: editing.address?.trim() || null,
    };
    const { error } = editing.id
      ? await supabase.from("students").update(payload).eq("id", editing.id)
      : await supabase.from("students").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Aluno salvo"); setEditing(null); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este aluno do cadastro? (Não afeta aulas existentes)")) return;
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Aluno excluído"); load(); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6" /> Alunos</h1>
          <p className="text-sm text-muted-foreground">Cadastro de clientes com histórico e saldo.</p>
        </div>
        <Button onClick={() => setEditing({ student_name: "", guardian_name: "", address: "" })}>
          <Plus className="w-4 h-4 mr-1" /> Novo aluno
        </Button>
      </div>

      <div className="grid gap-3">
        {students.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">Nenhum aluno cadastrado ainda.</Card>
        )}
        {students.map(st => {
          const count = stats.lessonCount.get(norm(st.student_name)) ?? 0;
          const bal = balanceFor(st);
          return (
            <Card key={st.id} className="p-4">
              <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{st.student_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {st.guardian_name ? `Resp.: ${st.guardian_name}` : "Sem responsável"}
                    {st.address ? ` · ${st.address}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary">{count} {count === 1 ? "aula realizada" : "aulas realizadas"}</Badge>
                  <Badge variant={bal >= 0 ? "default" : "destructive"}>Saldo: {fmt(bal)}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => setEditing(st)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(st.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Editar aluno" : "Novo aluno"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Nome do aluno</Label>
              <Input value={editing?.student_name ?? ""} onChange={e => setEditing(p => ({ ...p!, student_name: e.target.value }))} />
            </div>
            <div><Label>Responsável</Label>
              <Input value={editing?.guardian_name ?? ""} onChange={e => setEditing(p => ({ ...p!, guardian_name: e.target.value }))} />
            </div>
            <div><Label>Endereço</Label>
              <Input value={editing?.address ?? ""} onChange={e => setEditing(p => ({ ...p!, address: e.target.value }))} placeholder="Rua, número, bairro, cidade" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} disabled={busy}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

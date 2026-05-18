import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, Trash2, Link2, FileText, Plus, Download } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type Student = { id: string; student_name: string; user_id: string | null };

export function StudentManageDialog({ student, open, onOpenChange, onChanged }: {
  student: Student | null; open: boolean; onOpenChange: (v: boolean) => void; onChanged: () => void;
}) {
  if (!student) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{student.student_name}</DialogTitle></DialogHeader>
        <Tabs defaultValue="account">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="account">Conta</TabsTrigger>
            <TabsTrigger value="materials">Materiais</TabsTrigger>
            <TabsTrigger value="homework">Tarefas</TabsTrigger>
          </TabsList>
          <TabsContent value="account" className="mt-4">
            <AccountTab student={student} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="materials" className="mt-4">
            <MaterialsTab student={student} />
          </TabsContent>
          <TabsContent value="homework" className="mt-4">
            <HomeworkTab student={student} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AccountTab({ student, onChanged }: { student: Student; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const link = async () => {
    if (!email.trim()) { toast.error("Informe o e-mail"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("link-student-account", {
      body: { student_id: student.id, email: email.trim(), password: password || undefined },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Erro ao vincular");
    } else {
      toast.success("Conta vinculada");
      onChanged();
    }
  };

  const unlink = async () => {
    if (!confirm("Desvincular a conta deste aluno?")) return;
    const { error } = await supabase.from("students").update({ user_id: null }).eq("id", student.id);
    if (error) toast.error(error.message); else { toast.success("Desvinculado"); onChanged(); }
  };

  return (
    <div className="space-y-4">
      {student.user_id ? (
        <Card className="p-4 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Conta vinculada</div>
            <div className="text-xs text-muted-foreground font-mono">{student.user_id}</div>
          </div>
          <Button variant="destructive" size="sm" onClick={unlink}>Desvincular</Button>
        </Card>
      ) : (
        <Card className="p-4 space-y-3">
          <div>
            <div className="text-sm font-medium mb-1">Vincular conta de acesso</div>
            <p className="text-xs text-muted-foreground">Informe o e-mail do aluno/responsável. Se ainda não existir, defina uma senha temporária para criar a conta.</p>
          </div>
          <div><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div><Label>Senha temporária (opcional, só para criar)</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
          <Button onClick={link} disabled={busy} className="gap-2"><Link2 className="w-4 h-4" /> Vincular</Button>
        </Card>
      )}
    </div>
  );
}

function MaterialsTab({ student }: { student: Student }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("student_materials").select("*").eq("student_id", student.id).order("created_at", { ascending: false });
    setItems(data ?? []);
  };
  useEffect(() => { load(); }, [student.id]);

  const upload = async (file: File) => {
    if (!title.trim()) { toast.error("Dê um título ao material"); return; }
    setBusy(true);
    const path = `${student.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("student-materials").upload(path, file);
    if (upErr) { toast.error(upErr.message); setBusy(false); return; }
    const { error } = await supabase.from("student_materials").insert({
      student_id: student.id, title: title.trim(), file_path: path, file_type: file.type,
    });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Material enviado"); setTitle(""); load(); }
    if (fileRef.current) fileRef.current.value = "";
  };

  const remove = async (item: any) => {
    if (!confirm("Excluir material?")) return;
    await supabase.storage.from("student-materials").remove([item.file_path]);
    const { error } = await supabase.from("student_materials").delete().eq("id", item.id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); load(); }
  };

  const download = async (path: string) => {
    const { data } = await supabase.storage.from("student-materials").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div><Label>Título do material</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Lista de exercícios — equação 2º grau" /></div>
        <input ref={fileRef} type="file" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button onClick={() => fileRef.current?.click()} disabled={busy} className="gap-2"><Upload className="w-4 h-4" /> Enviar arquivo</Button>
      </Card>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhum material.</p>}
        {items.map(m => (
          <Card key={m.id} className="p-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{m.title}</div>
              <div className="text-xs text-muted-foreground">{format(new Date(m.created_at), "dd/MM/yyyy HH:mm")}</div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => download(m.file_path)}><Download className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => remove(m)}><Trash2 className="w-4 h-4" /></Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function HomeworkTab({ student }: { student: Student }) {
  const [items, setItems] = useState<any[]>([]);
  const [subs, setSubs] = useState<Record<string, any[]>>({});
  const [form, setForm] = useState({ title: "", description: "", deadline: "" });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: hw } = await supabase.from("homework").select("*").eq("student_id", student.id).order("deadline", { ascending: false });
    setItems(hw ?? []);
    if (hw && hw.length > 0) {
      const { data } = await supabase.from("homework_submissions").select("*").in("homework_id", hw.map((h: any) => h.id));
      const g: Record<string, any[]> = {};
      (data ?? []).forEach((s: any) => { (g[s.homework_id] ||= []).push(s); });
      setSubs(g);
    } else setSubs({});
  };
  useEffect(() => { load(); }, [student.id]);

  const create = async () => {
    if (!form.title.trim() || !form.deadline) { toast.error("Título e prazo obrigatórios"); return; }
    setBusy(true);
    const { error } = await supabase.from("homework").insert({
      student_id: student.id, title: form.title.trim(),
      description: form.description.trim() || null,
      deadline: new Date(form.deadline).toISOString(),
    });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Tarefa criada"); setForm({ title: "", description: "", deadline: "" }); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir tarefa?")) return;
    const { error } = await supabase.from("homework").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const giveFeedback = async (sub: any) => {
    const fb = prompt("Feedback para o aluno:", sub.teacher_feedback ?? "");
    if (fb === null) return;
    await supabase.from("homework_submissions").update({ teacher_feedback: fb }).eq("id", sub.id);
    toast.success("Feedback salvo"); load();
  };

  const download = async (path: string) => {
    const { data } = await supabase.storage.from("homework-submissions").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium">Nova tarefa</div>
        <div><Label>Título</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
        <div><Label>Descrição</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
        <div><Label>Prazo</Label><Input type="datetime-local" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
        <Button onClick={create} disabled={busy} className="gap-2"><Plus className="w-4 h-4" /> Criar tarefa</Button>
      </Card>

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhuma tarefa.</p>}
        {items.map(h => (
          <Card key={h.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{h.title}</div>
                {h.description && <div className="text-xs text-muted-foreground">{h.description}</div>}
                <div className="text-xs text-muted-foreground mt-1">Prazo: {format(new Date(h.deadline), "dd/MM/yyyy HH:mm")}</div>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant={h.status === "entregue" ? "default" : "secondary"}>{h.status}</Badge>
                <Button size="icon" variant="ghost" onClick={() => remove(h.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
            {(subs[h.id] ?? []).map(s => (
              <div key={s.id} className="text-xs border-t border-border pt-2 flex items-center justify-between">
                <div>
                  <div>Entrega em {format(new Date(s.submitted_at), "dd/MM HH:mm")}</div>
                  {s.teacher_feedback && <div className="text-primary">Feedback: {s.teacher_feedback}</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => download(s.file_path)}><Download className="w-4 h-4" /></Button>
                  <Button size="sm" variant="outline" onClick={() => giveFeedback(s)}>Feedback</Button>
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

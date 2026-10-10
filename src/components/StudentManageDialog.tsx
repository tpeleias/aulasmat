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
import { Upload, Trash2, Link2, Plus, Download } from "lucide-react";
import { MaterialIcon, MaterialOpenButton, type Material } from "@/components/MaterialView";
import { toast } from "sonner";
import { format } from "date-fns";
import { sanitizeFilename } from "@/lib/sanitizeFilename";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { useTasksEnabled, useWords } from "@/hooks/useVocabulary";
import { cap, listWithTasks, taskStatusLabel } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
type Student = { id: string; student_name: string; guardian_name?: string | null; user_id: string | null; guardian_username?: string | null; child_user_id?: string | null; child_username?: string | null };

// teacherMode: o login de professor (funcionário) só vê Materiais e Tarefas, só
// põe para quem já teve aula com ele e só apaga o que ele mesmo pôs - o banco
// confere tudo isso (migration 20260925100000); aqui é só para não oferecer.
export function StudentManageDialog({ student, open, onOpenChange, onChanged, teacherMode = false, tab }: {
  student: Student | null; open: boolean; onOpenChange: (v: boolean) => void; onChanged: () => void; teacherMode?: boolean;
  /** Aba que abre primeiro (o botão "Materiais e tarefas" do aluno abre direto nos materiais). */
  tab?: "account" | "materials" | "homework";
}) {
  const w0 = useWords();
  const tasks = useTasksEnabled();
  const [canAdd, setCanAdd] = useState(true);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    if (!teacherMode || !student || !open) { setCanAdd(true); return; }
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    supabase.rpc("teacher_has_student" as never, { _student: student.id, _only_done: true } as never)
      .then(({ data }) => setCanAdd(data === true));
  }, [teacherMode, student, open]);
  if (!student) return null;
  const perms = teacherMode ? { canAdd, ownerId: me } : { canAdd: true, ownerId: null };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{student.student_name}</DialogTitle></DialogHeader>
        {teacherMode && !canAdd && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {L(`Você poderá pôr ${listWithTasks(["materiais"], w0, tasks)} depois ${w0.appointment.pick("do primeiro", "da primeira")} ${w0.appointment.l} ${w0.appointment.pick("feito", "feita")} com ${student.student_name}.`, `You'll be able to add ${listWithTasks(["materials"], w0, tasks)} after your first ${w0.appointment.l} with ${student.student_name}.`)}
          </p>
        )}
        <Tabs key={`${student.id}-${tab ?? ""}`} defaultValue={tab && !(teacherMode && tab === "account") ? tab : teacherMode ? "materials" : "account"}>
          <TabsList className={`grid ${["grid-cols-1", "grid-cols-2", "grid-cols-3"][(teacherMode ? 0 : 1) + (tasks ? 1 : 0)]} w-full`}>
            {!teacherMode && <TabsTrigger value="account">{L("Conta", "Account")}</TabsTrigger>}
            <TabsTrigger value="materials">{L("Materiais", "Materials")}</TabsTrigger>
            {tasks && <TabsTrigger value="homework">{w0.task.p}</TabsTrigger>}
          </TabsList>
          {!teacherMode && (
            <TabsContent value="account" className="mt-4">
              <AccountTab student={student} onChanged={onChanged} />
            </TabsContent>
          )}
          <TabsContent value="materials" className="mt-4">
            <MaterialsTab student={student} perms={perms} />
          </TabsContent>
          <TabsContent value="homework" className="mt-4">
            <HomeworkTab student={student} perms={perms} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AccountTab({ student, onChanged }: { student: Student; onChanged: () => void }) {
  const w = useWords();
  const [byUsername, setByUsername] = useState(false);
  const [email, setEmail] = useState("");
  const [guardianUser, setGuardianUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [newPw, setNewPw] = useState<string | null>(null);

  const link = async () => {
    // Families without an e-mail they actually read get a username instead; the server
    // refuses one that already belongs to a student or to another guardian.
    const body = byUsername
      ? { student_id: student.id, username: guardianUser, password }
      : { student_id: student.id, email: email.trim(), password: password || undefined };

    if (byUsername) {
      if (!isValidUsername(guardianUser)) { toast.error(L("Usuário inválido (3-30 caracteres: letras minúsculas, números, ponto, traço ou underline)", "Invalid username (3-30 characters: lowercase letters, numbers, dot, dash or underscore)")); return; }
      if (password.length < 6) { toast.error(L("Senha deve ter ao menos 6 caracteres", "Password must have at least 6 characters")); return; }
    } else if (!email.trim()) {
      toast.error(L("Informe o e-mail", "Enter the email")); return;
    }

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("link-student-account", { body });
    setBusy(false);
    if (error || (data as any)?.error) toast.error((data as any)?.error || error?.message || L("Erro ao vincular", "Error linking"));
    else { toast.success(L("Conta vinculada. A senha deverá ser trocada no primeiro acesso.", "Account linked. The password must be changed on first sign-in.")); onChanged(); }
  };

  const unlink = async () => {
    if (!confirm(L(`Desvincular a conta d${w.client.este} ${w.client.l}?`, `Unlink this ${w.client.l}'s account?`))) return;
    const { error } = await supabase.from("students").update({ user_id: null }).eq("id", student.id);
    if (error) toast.error(error.message); else { toast.success(L("Desvinculado", "Unlinked")); onChanged(); }
  };

  const resetPassword = async () => {
    if (!confirm(L(`Gerar uma nova senha provisória? ${cap(w.payer.o)} ${w.payer.l} deverá trocá-la no próximo acesso.`, `Generate a new temporary password? The ${w.payer.l} will have to change it on next sign-in.`))) return;
    setBusy(true); setNewPw(null);
    const { data, error } = await supabase.functions.invoke("admin-reset-student-password", {
      body: { student_id: student.id },
    });
    setBusy(false);
    if (error || (data as any)?.error) toast.error((data as any)?.error || error?.message || L("Erro ao resetar", "Error resetting"));
    else { setNewPw((data as any).password); toast.success(L("Senha redefinida", "Password reset")); }
  };

  return (
    <div className="space-y-4">
      {student.user_id ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{L("Conta vinculada", "Linked account")}</div>
              <div className="text-xs text-muted-foreground font-mono break-all">
                {student.guardian_username ? `${L("usuário", "username")}: ${student.guardian_username}` : student.user_id}
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={unlink}>{L("Desvincular", "Unlink")}</Button>
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {L(`Por segurança, senhas são armazenadas com hash e não podem ser visualizadas. Em vez disso, gere uma nova senha provisória — ${w.payer.o} ${w.payer.l} ${w.payer.pick("será forçado", "será forçada")} a trocá-la no próximo login.`,
                 `For security, passwords are hashed and can't be viewed. Instead, generate a new temporary password — the ${w.payer.l} will have to change it on next sign-in.`)}
            </p>
            <Button onClick={resetPassword} disabled={busy} variant="outline" size="sm">{L("Resetar senha", "Reset password")}</Button>
            {newPw && (
              <div className="rounded-md bg-muted p-3 text-sm flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">{L("Nova senha provisória", "New temporary password")}</div>
                  <div className="font-mono font-bold">{newPw}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newPw); toast.success(L("Copiada", "Copied")); }}>{L("Copiar", "Copy")}</Button>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-4 space-y-3">
          <div>
            <div className="text-sm font-medium mb-1">{L(`Criar acesso ${w.payer.do} ${w.payer.l}`, `Create ${w.payer.l} login`)}</div>
            <p className="text-xs text-muted-foreground">
              {L("Por e-mail, se a pessoa usa um. Por nome de usuário, quando não usa: funciona igual, só não serve para recuperar senha sozinho.", "By email, if they use one. By username when they don't: it works the same, but they can't recover the password on their own.")}
            </p>
          </div>

          <div className="inline-flex rounded-md border border-border p-0.5 bg-muted text-xs">
            <button type="button" onClick={() => setByUsername(false)} className={`px-3 py-1 rounded ${!byUsername ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>E-mail</button>
            <button type="button" onClick={() => setByUsername(true)} className={`px-3 py-1 rounded ${byUsername ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>{L("Usuário", "Username")}</button>
          </div>

          {byUsername ? (
            <>
              <div>
                <Label>{L("Nome de usuário", "Username")}</Label>
                <Input value={guardianUser} onChange={e => setGuardianUser(normalizeUsername(e.target.value))} placeholder={L("ex: flavia.miguel", "e.g. mary.smith")} autoCapitalize="none" autoCorrect="off" />
              </div>
              <div><Label>{L("Senha", "Password")}</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
            </>
          ) : (
            <>
              <div><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div><Label>{L("Senha temporária (opcional, só para criar)", "Temporary password (optional, only when creating)")}</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
            </>
          )}
          <Button onClick={link} disabled={busy} className="gap-2"><Link2 className="w-4 h-4" /> {L("Criar acesso", "Create login")}</Button>
        </Card>
      )}

      {/* Pet não entra no app; o login é do tutor. */}
      {/* Login próprio do menor: em aulas sempre; nos ramos em que quem paga
          é o próprio cliente, só se ele tem responsável (menor de 18). */}
      {w.model !== "pet" && (w.model === "aulas" || !!student.guardian_name?.trim() || !!student.child_user_id)
        && <ChildAccessSection student={student} onChanged={onChanged} />}
    </div>
  );
}

function ChildAccessSection({ student, onChanged }: { student: Student; onChanged: () => void }) {
  const w = useWords();
  const tasks = useTasksEnabled();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [resetPw, setResetPw] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!isValidUsername(username)) { toast.error(L("Username inválido (3-30 caracteres: letras minúsculas, números, ponto, traço, underline)", "Invalid username (3-30 characters: lowercase letters, numbers, dot, dash, underscore)")); return; }
    if (password.length < 6) { toast.error(L("Senha deve ter ao menos 6 caracteres", "Password must have at least 6 characters")); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-child-account", {
      body: { student_id: student.id, username, password, action: "create" },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || "Erro"); return; }
    toast.success(L(`Acesso criado para ${(data as any).username}`, `Login created for ${(data as any).username}`));
    setUsername(""); setPassword("");
    onChanged();
  };

  const reset = async () => {
    if (resetPw.length < 6) { toast.error(L("Senha deve ter ao menos 6 caracteres", "Password must have at least 6 characters")); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-child-account", {
      body: { student_id: student.id, password: resetPw, action: "reset" },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || "Erro"); return; }
    toast.success(L("Senha redefinida", "Password reset"));
    setResetPw(""); setShowReset(false);
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="text-sm font-medium mb-1">{L(`Acesso próprio ${w.client.do} ${w.client.l} (ex.: criança ou adolescente)`, `The ${w.client.l}'s own login (e.g. a child or teenager)`)}</div>
        <p className="text-xs text-muted-foreground">
          {L(`Login simples por username, com acesso restrito a ${listWithTasks([w.appointment.lp, "materiais"], w, tasks)} (sem dados financeiros).`, `Simple username login, limited to ${listWithTasks([w.appointment.lp, "materials"], w, tasks)} (no billing data).`)}
        </p>
      </div>
      {student.child_username ? (
        <div className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-sm">
            <div className="text-xs text-muted-foreground">{L("Nome de usuário", "Username")}</div>
            <div className="font-mono font-bold">{student.child_username}</div>
          </div>
          {!showReset ? (
            <Button variant="outline" size="sm" onClick={() => setShowReset(true)}>{L("Redefinir senha", "Reset password")}</Button>
          ) : (
            <div className="space-y-2 border-t border-border pt-3">
              <div><Label>{L("Nova senha", "New password")}</Label><Input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)} minLength={6} /></div>
              <div className="flex gap-2">
                <Button size="sm" onClick={reset} disabled={busy}>{L("Salvar", "Save")}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowReset(false); setResetPw(""); }}>{L("Cancelar", "Cancel")}</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <Label>Username</Label>
            <Input value={username} onChange={e => setUsername(normalizeUsername(e.target.value))} placeholder={L("ex: miguel.silva", "e.g. mike.smith")} autoCapitalize="none" autoCorrect="off" />
          </div>
          <div><Label>{L("Senha", "Password")}</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
          <Button onClick={create} disabled={busy} size="sm">{L(`Gerar acesso ${w.client.do} ${w.client.l}`, `Create the ${w.client.l}'s login`)}</Button>
        </div>
      )}
    </Card>
  );
}

// canAdd: pode pôr coisa nova. ownerId: se definido, só apaga o que tem esse dono.
type Perms = { canAdd: boolean; ownerId: string | null };

function MaterialsTab({ student, perms }: { student: Student; perms: Perms }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<Material[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("student_materials").select("*").eq("student_id", student.id).order("created_at", { ascending: false });
    setItems((data ?? []) as Material[]);
  };
  useEffect(() => { load(); }, [student.id]);

  const upload = async (file: File) => {
    const finalTitle = title.trim() || file.name.replace(/\.[^.]+$/, "");
    setBusy(true);
    try {
      const path = `${student.id}/${Date.now()}-${sanitizeFilename(file.name)}`;
      const { error: upErr } = await supabase.storage.from("student-materials").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) {
        console.error("[materials] storage upload error", upErr);
        toast.error(L(`Falha no upload: ${upErr.message}`, `Upload failed: ${upErr.message}`));
        return;
      }
      const { error } = await supabase.from("student_materials").insert({
        student_id: student.id, title: finalTitle, file_path: path, file_type: file.type,
      });
      if (error) {
        console.error("[materials] insert error", error);
        toast.error(L(`Falha ao registrar: ${error.message}`, `Couldn't save: ${error.message}`));
        return;
      }
      toast.success(L("Upload concluído com sucesso", "Upload complete"));
      setTitle("");
      load();
    } catch (e: any) {
      console.error("[materials] unexpected", e);
      toast.error(L(`Erro inesperado: ${e?.message ?? String(e)}`, `Unexpected error: ${e?.message ?? String(e)}`));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Link (Drive, YouTube, site): o aluno abre direto, sem baixar.
  const addLink = async () => {
    const u = url.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) { toast.error(L("Cole um link que comece com https://", "Paste a link starting with https://")); return; }
    setBusy(true);
    const { error } = await supabase.from("student_materials").insert({
      student_id: student.id, title: title.trim() || u.replace(/^https?:\/\//i, "").slice(0, 80), kind: "link", url: u,
    } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(L("Link adicionado", "Link added"));
    setTitle(""); setUrl(""); load();
  };

  const remove = async (item: Material) => {
    if (!confirm(L("Excluir material?", "Delete material?"))) return;
    if (item.file_path) await supabase.storage.from("student-materials").remove([item.file_path]);
    const { error } = await supabase.from("student_materials").delete().eq("id", item.id);
    if (error) toast.error(error.message); else { toast.success(L("Excluído", "Deleted")); load(); }
  };

  return (
    <div className="space-y-4">
      {perms.canAdd && <Card className="p-4 space-y-3">
        <div><Label>{L("Título do material (opcional)", "Material title (optional)")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder={L("Padrão: nome do arquivo", "Default: file name")} /></div>
        <input ref={fileRef} type="file" hidden onClick={(e) => { (e.target as HTMLInputElement).value = ""; }} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        <Button onClick={() => fileRef.current?.click()} disabled={busy} className="gap-2"><Upload className="w-4 h-4" /> {busy ? L("Enviando...", "Uploading...") : L("Enviar arquivo", "Upload file")}</Button>
        <div className="flex gap-2">
          <Input value={url} onChange={e => setUrl(e.target.value)} placeholder={L("Ou cole um link (Drive, YouTube...)", "Or paste a link (Drive, YouTube...)")} aria-label={L("Link do material", "Material link")} />
          <Button variant="outline" onClick={addLink} disabled={busy || !url.trim()} className="shrink-0 gap-1.5"><Link2 className="w-4 h-4" /> {L("Adicionar", "Add")}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{L("Com o Claude ligado ao Cronys, dá para pedir: “manda para o aluno uma lista de exercícios sobre frações”. Ele escreve e o material aparece aqui.", "With Claude connected to Cronys, you can ask: “send the student a worksheet on fractions”. It writes it and the material shows up here.")}</p>
      </Card>}
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{L("Nenhum material.", "No materials.")}</p>}
        {items.map(m => (
          <Card key={m.id} className="p-3 flex items-center gap-2">
            <MaterialIcon m={m} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{m.title}</div>
              <div className="text-xs text-muted-foreground">{format(new Date(m.created_at), L("dd/MM/yyyy HH:mm", "MMM d, yyyy h:mm a"))}</div>
            </div>
            <MaterialOpenButton m={m} />
            {(!perms.ownerId || m.uploaded_by === perms.ownerId) && <Button size="icon" variant="ghost" onClick={() => remove(m)} aria-label={L("Excluir", "Delete")}><Trash2 className="w-4 h-4" /></Button>}
          </Card>
        ))}
      </div>
    </div>
  );
}

function HomeworkTab({ student, perms }: { student: Student; perms: Perms }) {
  const w = useWords();
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
    if (!form.title.trim() || !form.deadline) { toast.error(L("Título e prazo obrigatórios", "Title and due date are required")); return; }
    setBusy(true);
    const { error } = await supabase.from("homework").insert({
      student_id: student.id, title: form.title.trim(),
      description: form.description.trim() || null,
      deadline: new Date(form.deadline).toISOString(),
    });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(L(`${w.task.s} ${w.task.pick("criado", "criada")}`, `${w.task.s} created`)); setForm({ title: "", description: "", deadline: "" }); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm(L(`Excluir ${w.task.o} ${w.task.l}?`, `Delete this ${w.task.l}?`))) return;
    const { error } = await supabase.from("homework").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  const giveFeedback = async (sub: any) => {
    const fb = prompt(L(`Feedback para ${w.client.o} ${w.client.l}:`, `Feedback for the ${w.client.l}:`), sub.teacher_feedback ?? "");
    if (fb === null) return;
    await supabase.from("homework_submissions").update({ teacher_feedback: fb }).eq("id", sub.id);
    toast.success(L("Feedback salvo", "Feedback saved")); load();
  };

  const download = async (path: string) => {
    const { data } = await supabase.storage.from("homework-submissions").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="space-y-4">
      {perms.canAdd && <Card className="p-4 space-y-3">
        <div className="text-sm font-medium">{w.task.novo} {w.task.l}</div>
        <div><Label>{L("Título", "Title")}</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
        <div><Label>{L("Descrição", "Description")}</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
        <div><Label>{L("Prazo", "Due date")}</Label><Input type="datetime-local" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
        <Button onClick={create} disabled={busy} className="gap-2"><Plus className="w-4 h-4" /> {L(`Criar ${w.task.l}`, `Create ${w.task.l}`)}</Button>
      </Card>}

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{L(`${w.task.nenhum} ${w.task.l}.`, `No ${w.task.lp}.`)}</p>}
        {items.map(h => (
          <Card key={h.id} className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{h.title}</div>
                {h.description && <div className="text-xs text-muted-foreground">{h.description}</div>}
                <div className="text-xs text-muted-foreground mt-1">{L("Prazo", "Due")}: {format(new Date(h.deadline), L("dd/MM/yyyy HH:mm", "MMM d, yyyy h:mm a"))}</div>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant={h.status === "entregue" ? "default" : "secondary"}>{taskStatusLabel(h.status, w)}</Badge>
                {(!perms.ownerId || h.created_by === perms.ownerId) && <Button size="icon" variant="ghost" onClick={() => remove(h.id)}><Trash2 className="w-4 h-4" /></Button>}
              </div>
            </div>
            {(subs[h.id] ?? []).map(s => (
              <div key={s.id} className="text-xs border-t border-border pt-2 flex items-center justify-between">
                <div>
                  <div>{L("Entrega em", "Submitted on")} {format(new Date(s.submitted_at), L("dd/MM HH:mm", "MMM d, h:mm a"))}</div>
                  {s.teacher_feedback && <div className="text-primary">{L("Feedback", "Feedback")}: {s.teacher_feedback}</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => download(s.file_path)}><Download className="w-4 h-4" /></Button>
                  {perms.canAdd && <Button size="sm" variant="outline" onClick={() => giveFeedback(s)}>Feedback</Button>}
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

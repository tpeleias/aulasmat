import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isPast, set as setTime } from "date-fns";
import {
  AlertCircle, BookOpen, CheckCircle2, Clock, Copy, Download, Eye, FileText, Link2, ListChecks, MessageSquare,
  PenLine, Plus, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownPage, MaterialIcon, MaterialOpenButton, materialKind, type Material } from "@/components/MaterialView";
import { useTasksEnabled, useWords } from "@/hooks/useVocabulary";
import { sanitizeFilename } from "@/lib/sanitizeFilename";
import { listWithTasks, taskStatusLabel, tasksAreSubmitted, type Vocabulary } from "@/lib/vocabulary";
import { intlLocale, L } from "@/lib/i18n";

/**
 * Materiais e tarefas de um cliente (11/10), numa janela só deles - antes
 * ficavam em abas dentro de "Gerenciar", junto do acesso. Três jeitos de pôr
 * material (arquivo, link, texto escrito ou colado de uma IA) e tarefas com
 * prazo, que podem apontar para um material ("Virar tarefa").
 *
 * teacherMode: o login de profissional só põe para quem já atendeu e só apaga
 * o que ele mesmo pôs - o banco confere (migration 20260925100000).
 */
type Student = { id: string; student_name: string; guardian_name?: string | null };
type Task = {
  id: string; title: string; description: string | null; deadline: string; status: string;
  created_by: string | null; material_id?: string | null;
};
type Submission = { id: string; homework_id: string; file_path: string | null; submitted_at: string; teacher_feedback: string | null; student_note?: string | null };
type Perms = { canAdd: boolean; ownerId: string | null };

/** Instruções para colar em qualquer IA (ChatGPT, Gemini, Claude...) e trazer o material no formato que o Cronys mostra. */
export function materialPrompt(clientWord: string, en = false): string {
  if (en) return [
    `Write the material below for my ${clientWord}. Format it like this, so I can paste it into Cronys:`,
    "- Markdown: headings with ##, numbered lists for exercises, **bold** for important words.",
    "- Math in LaTeX: inline between $...$ (e.g. $x^2 + 1$) and on its own line between $$...$$.",
    "- No images, no tables with merged cells, no links unless I ask.",
    "- If there is an answer key, put it at the end under \"## Answer key\".",
    "- Reply only with the material, nothing before or after.",
    "",
    "Material I need:",
    "",
  ].join("\n");
  return [
    `Escreva o material abaixo para o meu ${clientWord}. Use este formato, para eu colar no Cronys:`,
    "- Markdown: títulos com ##, listas numeradas para exercícios, **negrito** para o que é importante.",
    "- Matemática em LaTeX: na linha entre $...$ (ex.: $x^2 + 1$) e em destaque entre $$...$$.",
    "- Sem imagens, sem tabelas com células mescladas e sem links, a não ser que eu peça.",
    "- Se tiver gabarito, coloque no fim, em \"## Gabarito\".",
    "- Responda só com o material, sem nada antes ou depois.",
    "",
    "Material que eu preciso:",
    "",
  ].join("\n");
}

const KIND_LABEL = () => ({ file: L("Arquivo", "File"), link: L("Link", "Link"), page: L("Texto", "Text") });

export default function StudentWorkDialog({ student, open, onOpenChange, teacherMode = false }: {
  student: Student | null; open: boolean; onOpenChange: (v: boolean) => void; teacherMode?: boolean;
}) {
  const w = useWords();
  const tasksOn = useTasksEnabled();
  const [tab, setTab] = useState<"materials" | "tasks">("materials");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subs, setSubs] = useState<Record<string, Submission[]>>({});
  const [perms, setPerms] = useState<Perms>({ canAdd: true, ownerId: null });
  const [aiOn, setAiOn] = useState(false);
  const [taskFromMaterial, setTaskFromMaterial] = useState<Material | null>(null);

  const load = async () => {
    if (!student) return;
    const [m, h] = await Promise.all([
      supabase.from("student_materials").select("*").eq("student_id", student.id).order("created_at", { ascending: false }),
      supabase.from("homework").select("*").eq("student_id", student.id).order("deadline", { ascending: true }),
    ]);
    setMaterials((m.data ?? []) as Material[]);
    const hw = (h.data ?? []) as Task[];
    setTasks(hw);
    if (hw.length) {
      const { data } = await supabase.from("homework_submissions").select("*").in("homework_id", hw.map(x => x.id));
      const g: Record<string, Submission[]> = {};
      ((data ?? []) as Submission[]).forEach(s => { (g[s.homework_id] ||= []).push(s); });
      setSubs(g);
    } else setSubs({});
  };

  useEffect(() => {
    if (!open || !student) return;
    setTab("materials"); setTaskFromMaterial(null);
    load();
    if (teacherMode) {
      supabase.auth.getUser().then(({ data }) => setPerms(p => ({ ...p, ownerId: data.user?.id ?? null })));
      supabase.rpc("teacher_has_student" as never, { _student: student.id, _only_done: true } as never)
        .then(({ data }) => setPerms(p => ({ ...p, canAdd: data === true })));
    } else {
      setPerms({ canAdd: true, ownerId: null });
      supabase.rpc("ai_connector_my_access" as never).then(({ data }) => setAiOn((data as { allowed?: boolean } | null)?.allowed === true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id, teacherMode]);

  if (!student) return null;
  const pending = tasks.filter(t => t.status !== "entregue").length;

  const makeTask = (m: Material) => { setTaskFromMaterial(m); setTab("tasks"); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{tasksOn ? L(`Materiais e ${w.task.lp}`, `Materials and ${w.task.lp}`) : L("Materiais", "Materials")}</DialogTitle>
          <DialogDescription>
            {student.student_name}{student.guardian_name ? ` · ${student.guardian_name}` : ""} · {L(`tudo aqui aparece no portal ${w.client.pick("do", "da")} ${w.client.l}`, `everything here shows up in the ${w.client.l}'s portal`)}
          </DialogDescription>
        </DialogHeader>

        {teacherMode && !perms.canAdd && (
          <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            {L(`Você poderá pôr ${listWithTasks(["materiais"], w, tasksOn)} depois ${w.appointment.pick("do primeiro", "da primeira")} ${w.appointment.l} ${w.appointment.pick("feito", "feita")} com ${student.student_name}.`,
               `You'll be able to add ${listWithTasks(["materials"], w, tasksOn)} after your first ${w.appointment.l} with ${student.student_name}.`)}
          </p>
        )}

        <Tabs value={tasksOn ? tab : "materials"} onValueChange={v => setTab(v as "materials" | "tasks")}>
          {tasksOn && (
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="materials" className="gap-1.5"><FileText className="h-4 w-4" /> {L("Materiais", "Materials")} <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{materials.length}</Badge></TabsTrigger>
              <TabsTrigger value="tasks" className="gap-1.5"><ListChecks className="h-4 w-4" /> {w.task.p} {pending > 0 && <Badge className="ml-1 h-5 px-1.5 text-[10px]">{pending}</Badge>}</TabsTrigger>
            </TabsList>
          )}
          <TabsContent value="materials" className="mt-4">
            <MaterialsPanel student={student} items={materials} perms={perms} onChanged={load} onMakeTask={tasksOn ? makeTask : undefined} w={w} />
          </TabsContent>
          {tasksOn && (
            <TabsContent value="tasks" className="mt-4">
              <TasksPanel student={student} tasks={tasks} subs={subs} materials={materials} perms={perms} onChanged={load}
                fromMaterial={taskFromMaterial} clearFromMaterial={() => setTaskFromMaterial(null)} w={w} />
            </TabsContent>
          )}
        </Tabs>

        {aiOn && perms.canAdd && (
          <p className="flex gap-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>{L(`Com a sua IA conectada, é só pedir: “faz uma lista de exercícios para ${student.student_name} e passa como tarefa até sexta”. Ela escreve, você confirma e aparece aqui.`,
                     `With your AI connected, just ask: “make a worksheet for ${student.student_name} and assign it as a task due Friday”. It writes it, you confirm, and it shows up here.`)}</span>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Materiais
// ---------------------------------------------------------------------------
function MaterialsPanel({ student, items, perms, onChanged, onMakeTask, w }: {
  student: Student; items: Material[]; perms: Perms; onChanged: () => void; onMakeTask?: (m: Material) => void; w: Vocabulary;
}) {
  const [mode, setMode] = useState<null | "file" | "link" | "page">(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const kinds = KIND_LABEL();

  const reset = () => { setMode(null); setTitle(""); setUrl(""); setContent(""); setPreview(false); };

  const uploadFile = async (file: File) => {
    setBusy(true);
    const path = `${student.id}/${Date.now()}-${sanitizeFilename(file.name)}`;
    const { error: upErr } = await supabase.storage.from("student-materials").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (upErr) { setBusy(false); toast.error(L(`Falha no envio: ${upErr.message}`, `Upload failed: ${upErr.message}`)); return; }
    const { error } = await supabase.from("student_materials").insert({
      student_id: student.id, title: title.trim() || file.name.replace(/\.[^.]+$/, ""), file_path: path, file_type: file.type,
    });
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (error) { toast.error(error.message); return; }
    toast.success(L("Arquivo enviado", "File uploaded")); reset(); onChanged();
  };

  const addLink = async () => {
    const u = url.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) { toast.error(L("Cole um link que comece com https://", "Paste a link starting with https://")); return; }
    setBusy(true);
    const { error } = await supabase.from("student_materials").insert({
      student_id: student.id, title: title.trim() || u.replace(/^https?:\/\//i, "").slice(0, 80), kind: "link", url: u,
    } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(L("Link adicionado", "Link added")); reset(); onChanged();
  };

  const addPage = async () => {
    if (!title.trim()) { toast.error(L("Dê um título, por exemplo “Lista 1 - Frações”.", "Add a title, e.g. “Worksheet 1 - Fractions”.")); return; }
    if (!content.trim()) { toast.error(L("Escreva ou cole o texto.", "Write or paste the text.")); return; }
    setBusy(true);
    const { error } = await supabase.from("student_materials").insert({
      student_id: student.id, title: title.trim(), kind: "page", content: content.trim(),
    } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(L("Texto enviado", "Text sent")); reset(); onChanged();
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(materialPrompt(w.client.l, L(false, true)));
      toast.success(L("Prompt copiado. Cole na sua IA (ChatGPT, Gemini, Claude...), diga o que quer e cole a resposta aqui.", "Prompt copied. Paste it into your AI (ChatGPT, Gemini, Claude...), say what you want and paste the answer here."));
    } catch { toast.error(L("Não deu para copiar neste aparelho.", "Couldn't copy on this device.")); }
  };

  const remove = async (m: Material) => {
    if (!confirm(L(`Excluir "${m.title}"? ${w.client.pick("O", "A")} ${w.client.l} deixa de ver.`, `Delete "${m.title}"? The ${w.client.l} will no longer see it.`))) return;
    if (m.file_path) await supabase.storage.from("student-materials").remove([m.file_path]);
    const { error } = await supabase.from("student_materials").delete().eq("id", m.id);
    if (error) toast.error(error.message); else { toast.success(L("Excluído", "Deleted")); onChanged(); }
  };

  const options = [
    { id: "file" as const, icon: Upload, label: L("Arquivo", "File"), hint: L("PDF, foto, Word", "PDF, photo, Word") },
    { id: "link" as const, icon: Link2, label: L("Link", "Link"), hint: L("Drive, YouTube, site", "Drive, YouTube, website") },
    { id: "page" as const, icon: PenLine, label: L("Texto", "Text"), hint: L("Escreva ou cole da IA", "Write or paste from AI") },
  ];

  return (
    <div className="space-y-4">
      {perms.canAdd && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{L(`Mandar material para ${student.student_name}`, `Send material to ${student.student_name}`)}</p>
          <div className="grid grid-cols-3 gap-2">
            {options.map(o => (
              <button key={o.id} type="button" onClick={() => { setMode(mode === o.id ? null : o.id); if (o.id === "file" && mode !== "file") setTimeout(() => fileRef.current?.click(), 0); }}
                className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-colors ${mode === o.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60"}`}
                aria-pressed={mode === o.id}>
                <o.icon className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">{o.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{o.hint}</span>
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" hidden data-testid="material-file" onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />

          {mode && (
            <Card className="space-y-3 rounded-xl p-3">
              <div>
                <Label htmlFor="mat-title" className="text-xs">{mode === "page" ? L("Título", "Title") : L("Título (opcional)", "Title (optional)")}</Label>
                <Input id="mat-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                  placeholder={mode === "page" ? L("Ex.: Lista 1 - Frações", "E.g. Worksheet 1 - Fractions") : mode === "file" ? L("Padrão: o nome do arquivo", "Default: the file name") : L("Ex.: Vídeo da aula", "E.g. Lesson video")} />
              </div>
              {mode === "file" && (
                <Button onClick={() => fileRef.current?.click()} disabled={busy} className="w-full gap-2 rounded-xl"><Upload className="h-4 w-4" /> {busy ? L("Enviando…", "Uploading…") : L("Escolher arquivo", "Choose file")}</Button>
              )}
              {mode === "link" && (
                <div className="space-y-2">
                  <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" aria-label={L("Link do material", "Material link")} inputMode="url" />
                  <p className="text-[11px] text-muted-foreground">{L("No Google Drive, deixe o arquivo como “Qualquer pessoa com o link”.", "On Google Drive, set the file to “Anyone with the link”.")}</p>
                  <Button onClick={addLink} disabled={busy || !url.trim()} className="w-full gap-2 rounded-xl"><Link2 className="h-4 w-4" /> {L("Adicionar link", "Add link")}</Button>
                </div>
              )}
              {mode === "page" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={copyPrompt}><Copy className="h-3.5 w-3.5" /> {L("Copiar prompt para IA", "Copy AI prompt")}</Button>
                    <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={() => setPreview(p => !p)} disabled={!content.trim()}>
                      {preview ? <PenLine className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {preview ? L("Voltar a editar", "Back to editing") : L("Ver como fica", "Preview")}
                    </Button>
                  </div>
                  {preview ? (
                    <div className="max-h-80 overflow-y-auto rounded-xl border border-border p-3"><MarkdownPage content={content} /></div>
                  ) : (
                    <Textarea value={content} onChange={e => setContent(e.target.value)} rows={9} maxLength={30000} aria-label={L("Texto do material", "Material text")}
                      placeholder={L("Escreva aqui, ou peça à sua IA (com o prompt acima) e cole a resposta. Fórmulas: $x^2$", "Write here, or ask your AI (with the prompt above) and paste the answer. Formulas: $x^2$")} />
                  )}
                  <Button onClick={addPage} disabled={busy} className="w-full gap-2 rounded-xl"><BookOpen className="h-4 w-4" /> {L("Mandar texto", "Send text")}</Button>
                </div>
              )}
              <Button variant="ghost" size="sm" className="w-full gap-1 text-muted-foreground" onClick={reset}><X className="h-3.5 w-3.5" /> {L("Cancelar", "Cancel")}</Button>
            </Card>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">{L("Já mandados", "Already sent")}</p>
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {L(`Nada por aqui ainda. Mande o primeiro material: um arquivo, um link ou um texto.`, `Nothing here yet. Send the first material: a file, a link or a text.`)}
          </div>
        )}
        {items.map(m => (
          <Card key={m.id} className="flex items-center gap-3 rounded-xl p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10"><MaterialIcon m={m} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.title}</div>
              <div className="text-xs text-muted-foreground">{kinds[materialKind(m)]} · {format(new Date(m.created_at), L("dd/MM/yyyy HH:mm", "MMM d, yyyy h:mm a"))}</div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              <MaterialOpenButton m={m} />
              {onMakeTask && perms.canAdd && (
                <Button size="sm" variant="outline" className="gap-1" onClick={() => onMakeTask(m)}><ListChecks className="h-4 w-4" /> <span className="hidden sm:inline">{L(`Virar ${w.task.l}`, `Make ${w.task.l}`)}</span></Button>
              )}
              {(!perms.ownerId || m.uploaded_by === perms.ownerId) && (
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(m)} aria-label={L(`Excluir ${m.title}`, `Delete ${m.title}`)}><Trash2 className="h-4 w-4" /></Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------
function quickDeadline(days: number) {
  return format(setTime(addDays(new Date(), days), { hours: 23, minutes: 59, seconds: 0 }), "yyyy-MM-dd'T'HH:mm");
}

function TasksPanel({ student, tasks, subs, materials, perms, onChanged, fromMaterial, clearFromMaterial, w }: {
  student: Student; tasks: Task[]; subs: Record<string, Submission[]>; materials: Material[]; perms: Perms; onChanged: () => void;
  fromMaterial: Material | null; clearFromMaterial: () => void; w: Vocabulary;
}) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", deadline: quickDeadline(7), material_id: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!fromMaterial) return;
    setCreating(true);
    setForm({ title: L(`Fazer: ${fromMaterial.title}`, `Do: ${fromMaterial.title}`), description: "", deadline: quickDeadline(7), material_id: fromMaterial.id });
  }, [fromMaterial]);

  const byId = useMemo(() => Object.fromEntries(materials.map(m => [m.id, m])), [materials]);
  const todo = tasks.filter(t => t.status !== "entregue");
  const done = tasks.filter(t => t.status === "entregue").sort((a, b) => b.deadline.localeCompare(a.deadline));

  const create = async () => {
    if (!form.title.trim() || !form.deadline) { toast.error(L("Preencha o título e o prazo.", "Fill in the title and the due date.")); return; }
    setBusy(true);
    const { error } = await supabase.from("homework").insert({
      student_id: student.id, title: form.title.trim(), description: form.description.trim() || null,
      deadline: new Date(form.deadline).toISOString(), ...(form.material_id ? { material_id: form.material_id } : {}),
    } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(L(`${w.task.s} ${w.task.pick("criado", "criada")}. ${w.client.pick("O", "A")} ${w.client.l} recebe o aviso.`, `${w.task.s} created. The ${w.client.l} gets notified.`));
    setCreating(false); clearFromMaterial();
    setForm({ title: "", description: "", deadline: quickDeadline(7), material_id: "" });
    onChanged();
  };

  const remove = async (t: Task) => {
    if (!confirm(L(`Excluir "${t.title}"?`, `Delete "${t.title}"?`))) return;
    const { error } = await supabase.from("homework").delete().eq("id", t.id);
    if (error) toast.error(error.message); else onChanged();
  };

  return (
    <div className="space-y-4">
      {perms.canAdd && !creating && (
        <Button onClick={() => setCreating(true)} className="w-full gap-2 rounded-xl"><Plus className="h-4 w-4" /> {L(`${w.task.novo} ${w.task.l}`, `New ${w.task.l}`)}</Button>
      )}
      {perms.canAdd && creating && (
        <Card className="space-y-3 rounded-xl p-3">
          <div>
            <Label htmlFor="task-title" className="text-xs">{L("O que fazer", "What to do")}</Label>
            <Input id="task-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} maxLength={200} placeholder={L("Ex.: Fazer os exercícios 1 a 5", "E.g. Do exercises 1 to 5")} />
          </div>
          <div>
            <Label htmlFor="task-desc" className="text-xs">{L("Detalhes (opcional)", "Details (optional)")}</Label>
            <Textarea id="task-desc" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>
          {materials.length > 0 && (
            <div>
              <Label htmlFor="task-mat" className="text-xs">{L("Material da tarefa (opcional)", "Task material (optional)")}</Label>
              <select id="task-mat" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.material_id}
                onChange={e => setForm({ ...form, material_id: e.target.value })}>
                <option value="">{L("Nenhum", "None")}</option>
                {materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="task-deadline" className="text-xs">{L("Prazo", "Due")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {[{ d: 1, l: L("Amanhã", "Tomorrow") }, { d: 3, l: L("Em 3 dias", "In 3 days") }, { d: 7, l: L("Em 1 semana", "In 1 week") }].map(q => (
                <Button key={q.d} type="button" size="sm" variant={form.deadline === quickDeadline(q.d) ? "default" : "outline"} className="h-8 rounded-full"
                  onClick={() => setForm({ ...form, deadline: quickDeadline(q.d) })}>{q.l}</Button>
              ))}
            </div>
            <Input id="task-deadline" type="datetime-local" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 rounded-xl" onClick={() => { setCreating(false); clearFromMaterial(); }}>{L("Cancelar", "Cancel")}</Button>
            <Button onClick={create} disabled={busy} className="flex-1 gap-2 rounded-xl"><Plus className="h-4 w-4" /> {L(`Criar ${w.task.l}`, `Create ${w.task.l}`)}</Button>
          </div>
        </Card>
      )}

      <TaskSection title={L("Para fazer", "To do")} empty={L(`${w.task.nenhum} ${w.task.l} em aberto.`, `No open ${w.task.lp}.`)}
        tasks={todo} subs={subs} byId={byId} perms={perms} onChanged={onChanged} onRemove={remove} w={w} />
      {done.length > 0 && (
        <TaskSection title={tasksAreSubmitted(w.model) ? L("Entregues", "Submitted") : L(w.task.pick("Feitos", "Feitas"), "Done")} empty=""
          tasks={done} subs={subs} byId={byId} perms={perms} onChanged={onChanged} onRemove={remove} w={w} />
      )}
    </div>
  );
}

function TaskSection({ title, empty, tasks, subs, byId, perms, onChanged, onRemove, w }: {
  title: string; empty: string; tasks: Task[]; subs: Record<string, Submission[]>; byId: Record<string, Material>;
  perms: Perms; onChanged: () => void; onRemove: (t: Task) => void; w: Vocabulary;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title} <span className="text-muted-foreground">· {tasks.length}</span></p>
      {tasks.length === 0 && empty && <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{empty}</div>}
      {tasks.map(t => <TaskCard key={t.id} t={t} subs={subs[t.id] ?? []} material={t.material_id ? byId[t.material_id] : undefined} perms={perms} onChanged={onChanged} onRemove={onRemove} w={w} />)}
    </div>
  );
}

function TaskCard({ t, subs, material, perms, onChanged, onRemove, w }: {
  t: Task; subs: Submission[]; material?: Material; perms: Perms; onChanged: () => void; onRemove: (t: Task) => void; w: Vocabulary;
}) {
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const deadline = new Date(t.deadline);
  const late = t.status !== "entregue" && isPast(deadline);
  const when = deadline.toLocaleString(intlLocale(), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const download = async (path: string) => {
    const { data } = await supabase.storage.from("homework-submissions").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };
  const saveReply = async (s: Submission) => {
    const { error } = await supabase.from("homework_submissions").update({ teacher_feedback: reply.trim() || null }).eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success(L("Retorno salvo", "Feedback saved")); setReplyFor(null); onChanged();
  };

  return (
    <Card className={`space-y-2 rounded-xl p-3 ${late ? "border-destructive/50" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{t.status === "entregue" ? <CheckCircle2 className="h-5 w-5 text-primary" /> : late ? <AlertCircle className="h-5 w-5 text-destructive" /> : <Clock className="h-5 w-5 text-muted-foreground" />}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{t.title}</div>
          {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{L("até", "due")} {when}</span>
            <Badge variant={t.status === "entregue" ? "default" : late ? "destructive" : "secondary"} className="h-5 text-[10px]">
              {taskStatusLabel(late ? "atrasada" : t.status, w)}
            </Badge>
          </div>
        </div>
        {(!perms.ownerId || t.created_by === perms.ownerId) && (
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => onRemove(t)} aria-label={L(`Excluir ${t.title}`, `Delete ${t.title}`)}><Trash2 className="h-4 w-4" /></Button>
        )}
      </div>
      {material && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-2 py-1.5 text-xs">
          <MaterialIcon m={material} className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{material.title}</span>
          <MaterialOpenButton m={material} />
        </div>
      )}
      {subs.map(s => (
        <div key={s.id} className="space-y-1.5 border-t border-border pt-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span>{L("Entregue em", "Submitted on")} {format(new Date(s.submitted_at), L("dd/MM HH:mm", "MMM d, h:mm a"))}{s.student_note ? ` · “${s.student_note}”` : ""}</span>
            <div className="flex gap-1">
              {s.file_path && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => download(s.file_path!)}><Download className="h-3.5 w-3.5" /> {L("Ver", "View")}</Button>}
              {perms.canAdd && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { setReplyFor(s.id); setReply(s.teacher_feedback ?? ""); }}><MessageSquare className="h-3.5 w-3.5" /> {L("Responder", "Reply")}</Button>}
            </div>
          </div>
          {s.teacher_feedback && replyFor !== s.id && <div className="text-primary">{L("Seu retorno", "Your feedback")}: {s.teacher_feedback}</div>}
          {replyFor === s.id && (
            <div className="space-y-1.5">
              <Textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} aria-label={L("Retorno", "Feedback")} placeholder={L("Ex.: Muito bem! Revise o exercício 3.", "E.g. Well done! Check exercise 3 again.")} />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setReplyFor(null)}>{L("Cancelar", "Cancel")}</Button>
                <Button size="sm" className="h-7" onClick={() => saveReply(s)}>{L("Salvar retorno", "Save feedback")}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

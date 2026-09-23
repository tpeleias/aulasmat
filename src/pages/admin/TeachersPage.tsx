import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTeachers, teacherSlug, type Teacher } from "@/hooks/useTeachers";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { publicSiteUrl } from "@/lib/publicUrl";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { GraduationCap, Plus, Trash2, ChevronDown, Pencil, KeyRound } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { SCARCITY_DEFAULT, type ScarcityDay } from "@/lib/availability";
import { toast } from "sonner";
import { capitalize } from "@/lib/balance";
import { usePlan } from "@/hooks/usePlan";
import { ProUpsell } from "@/components/ProUpsell";

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export default function TeachersPage() {
  const { plan } = usePlan();
  const { teachers, reload } = useTeachers(false);
  // O limite conta professor ATIVO, igual ao gatilho do banco.
  const ativos = teachers.filter(t => t.active).length;
  const semVaga = plan.max_teachers !== null && ativos >= plan.max_teachers;
  const [name, setName] = useState("");
  // A escassez da empresa: serve de ponto de partida quando um professor passa
  // a ter a própria, para ele não começar com números vindos do nada.
  const [accountScarcity, setAccountScarcity] = useState<Record<string, ScarcityDay> | null>(null);
  useEffect(() => {
    supabase.from("settings").select("scarcity").maybeSingle()
      .then(({ data }) => setAccountScarcity(((data as any)?.scarcity ?? null)));
  }, []);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const v = name.trim().toLowerCase();
    if (!v) { toast.error("Informe o nome do professor"); return; }
    setBusy(true);
    const { error } = await supabase.from("teachers" as any).insert({ name: v });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Professor cadastrado"); setName(""); reload(); }
  };

  // Renomear passa pelo banco (rename_teacher) porque aulas e bloqueios
  // guardam o professor pelo apelido do nome: trocar só o nome deixaria todas
  // as aulas dele órfãs na agenda. O nome segue em minúsculas, como no cadastro.
  const [renaming, setRenaming] = useState<Teacher | null>(null);
  const [newName, setNewName] = useState("");
  const newSlug = teacherSlug(newName.trim().toLowerCase());
  const oldSlug = renaming ? teacherSlug(renaming.name) : "";
  const slugTaken = !!renaming && teachers.some(t => t.id !== renaming.id && teacherSlug(t.name) === newSlug);

  // Login próprio do professor (papel 'teacher'): vê a própria agenda e os
  // alunos, sem financeiro nem administração. A função confere que quem chama
  // é admin desta escola.
  const [accessFor, setAccessFor] = useState<Teacher | null>(null);
  const [accessUser, setAccessUser] = useState("");
  const [accessPw, setAccessPw] = useState("");
  // user_id só vem depois da migration 20260924040000; antes disso o botão
  // nem aparece.
  const hasAccessColumn = teachers.some(t => "user_id" in t);

  const openAccess = (t: Teacher) => {
    setAccessFor(t);
    setAccessUser(teacherSlug(t.name).replace(/[^a-z0-9._-]/g, ""));
    setAccessPw("");
  };

  const callAccess = async (action: "create" | "reset" | "remove") => {
    if (!accessFor) return;
    if (action === "remove" && !confirm(`Remover o acesso de ${capitalize(accessFor.name)}? As aulas dele continuam.`)) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-teacher-login", {
      body: { teacher_id: accessFor.id, action, username: accessUser.trim().toLowerCase(), password: accessPw },
    });
    setBusy(false);
    const msg = (data as { error?: string } | null)?.error;
    if (error || msg) { toast.error(msg || "Não foi possível concluir. Tente de novo."); return; }
    if (action === "create") {
      const text = `Seu acesso ao Cronys: usuário ${accessUser.trim().toLowerCase()}, senha ${accessPw}. Entre em ${publicSiteUrl()}/ ou pelo app.`;
      try { await navigator.clipboard.writeText(text); toast.success("Acesso criado - usuário e senha copiados para enviar"); }
      catch { toast.success("Acesso criado"); }
    } else {
      toast.success(action === "reset" ? "Senha trocada" : "Acesso removido");
    }
    setAccessFor(null);
    reload();
  };

  const rename = async () => {
    if (!renaming) return;
    const v = newName.trim().toLowerCase();
    if (!v || !newSlug) { toast.error("Informe o nome do professor"); return; }
    if (slugTaken) { toast.error("Já existe um professor com esse nome"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("rename_teacher" as never, {
      _teacher: renaming.id, _new_name: v, _old_slug: oldSlug, _new_slug: newSlug,
    } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const n = (data as { aulas?: number } | null)?.aulas ?? 0;
    toast.success(`Professor renomeado${n ? ` - ${n} aula${n === 1 ? "" : "s"} atualizada${n === 1 ? "" : "s"}` : ""}`);
    setRenaming(null);
    reload();
  };

  const toggleActive = async (id: string, active: boolean) => {
    const { error } = await supabase.from("teachers" as any).update({ active }).eq("id", id);
    if (error) toast.error(error.message); else reload();
  };

  // O número fica guardado mesmo com o botão desligado: desligar é "não quero
  // divulgar agora", não "apagar o contato".
  const saveWhatsApp = async (id: string, whatsapp: string) => {
    const { error } = await supabase.from("teachers" as any)
      .update({ whatsapp: whatsapp.trim() || null }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("WhatsApp salvo"); reload(); }
  };

  const toggleWhatsApp = async (id: string, enabled: boolean) => {
    const { error } = await supabase.from("teachers" as any).update({ whatsapp_enabled: enabled }).eq("id", id);
    if (error) toast.error(error.message); else reload();
  };

  // Nulo significa "usa a escassez da empresa". Ligar copia a da empresa como
  // ponto de partida, para o professor não começar com números do nada.
  const setScarcity = async (id: string, scarcity: Record<string, ScarcityDay> | null) => {
    const { error } = await supabase.from("teachers" as any).update({ scarcity }).eq("id", id);
    if (error) toast.error(error.message); else reload();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este professor? (As aulas e bloqueios já criados continuam intactos)")) return;
    const { error } = await supabase.from("teachers" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removido"); reload(); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><GraduationCap className="w-6 h-6" /> Professores</h1>
        <p className="text-sm text-muted-foreground">Cadastre os professores que aparecem na agenda e o WhatsApp de cada um. Não cria conta de acesso — somente registro de nome.</p>
      </div>

      <Card className="p-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Nome do professor</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: João" onKeyDown={e => e.key === "Enter" && add()} />
          </div>
          <Button onClick={add} disabled={busy || semVaga} className="gap-1"><Plus className="w-4 h-4" /> Adicionar</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">O nome é guardado em minúsculas e usado como identificador interno.</p>
        {semVaga && (
          <div className="mt-3">
            <ProUpsell titulo={`O Cronys Essencial vai até ${plan.max_teachers} professor${plan.max_teachers === 1 ? "" : "es"}`} icon={GraduationCap} compacto>
              você já tem {ativos} ativo{ativos === 1 ? "" : "s"}. No Cronys Pro não há limite —
              é o plano de quem tem equipe.
            </ProUpsell>
          </div>
        )}
      </Card>

      <div className="space-y-2">
        {teachers.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum professor cadastrado.</Card>}
        {teachers.map(t => (
          <Card key={t.id} className="p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{capitalize(t.name)}</div>
                <div className="text-xs text-muted-foreground">
                  {t.active ? "Ativo" : t.plan_locked ? "Pausado pela mudança de plano - ative para liberar" : "Inativo"}
                  {t.user_id ? " · tem acesso próprio" : ""}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={t.active} onCheckedChange={v => toggleActive(t.id, v)} />
                {hasAccessColumn && (
                  <Button size="icon" variant="ghost" title={t.user_id ? "Acesso do professor" : "Criar acesso para o professor"} onClick={() => openAccess(t)}>
                    <KeyRound className={`w-4 h-4 ${t.user_id ? "text-primary" : ""}`} />
                  </Button>
                )}
                <Button size="icon" variant="ghost" title="Editar nome" onClick={() => { setRenaming(t); setNewName(capitalize(t.name)); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => remove(t.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">WhatsApp de {capitalize(t.name)}</label>
                  <Input
                    defaultValue={t.whatsapp ?? ""}
                    placeholder="5511999999999"
                    onBlur={e => { if ((e.target.value.trim() || null) !== (t.whatsapp ?? null)) saveWhatsApp(t.id, e.target.value); }}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Switch checked={t.whatsapp_enabled !== false} onCheckedChange={v => toggleWhatsApp(t.id, v)} />
                <span className="text-muted-foreground">
                  {t.whatsapp_enabled !== false
                    ? "Botão de WhatsApp aparece no app"
                    : "Número guardado, mas o botão não aparece"}
                </span>
              </label>
            </div>

            <Collapsible className="rounded-md border border-border bg-muted/30">
              <CollapsibleTrigger asChild>
                <button className="group flex w-full items-center justify-between p-3 text-left text-sm">
                  <span>
                    Escassez na página pública
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.scarcity ? "personalizada" : "igual à da empresa"}
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 p-3 pt-0">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none pb-1">
                  <Switch
                    checked={!!t.scarcity}
                    onCheckedChange={v => setScarcity(t.id, v ? (accountScarcity ?? SCARCITY_DEFAULT) : null)}
                  />
                  <span className="text-muted-foreground">
                    {t.scarcity
                      ? `Números próprios de ${capitalize(t.name)}`
                      : "Seguindo a configuração da empresa"}
                  </span>
                </label>

                {t.scarcity && (
                  <>
                    <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 items-center">
                      <span />
                      <span className="text-[11px] text-muted-foreground text-center">Mínimo</span>
                      <span className="text-[11px] text-muted-foreground text-center">Máximo</span>
                    </div>
                    {DIAS.map((nome, i) => {
                      const d = t.scarcity?.[String(i)] ?? SCARCITY_DEFAULT[String(i)];
                      const salvar = (campo: "min" | "max", valor: number) => {
                        const proximo = { ...(t.scarcity ?? {}), [String(i)]: { ...d, [campo]: Math.max(1, Math.min(12, valor || 1)) } };
                        setScarcity(t.id, proximo);
                      };
                      return (
                        <div key={i} className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 items-center">
                          <span className="text-sm">{nome}</span>
                          <Input type="number" min={1} max={12} defaultValue={d.min}
                            onBlur={e => Number(e.target.value) !== d.min && salvar("min", Number(e.target.value))} />
                          <Input type="number" min={1} max={12} defaultValue={d.max}
                            onBlur={e => Number(e.target.value) !== d.max && salvar("max", Number(e.target.value))} />
                        </div>
                      );
                    })}
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))}
      </div>
      <Dialog open={!!renaming} onOpenChange={v => !v && setRenaming(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar nome do professor</DialogTitle>
            <DialogDescription>As aulas e os bloqueios dele acompanham o nome novo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            {slugTaken && <p className="text-xs text-destructive">Já existe um professor com esse nome.</p>}
            {renaming && newSlug && newSlug !== oldSlug && (
              <p className="text-xs text-muted-foreground">
                O link público de horários muda de <span className="font-mono break-all">{publicSiteUrl()}/disponibilidade/{oldSlug}</span> para{" "}
                <span className="font-mono break-all">{publicSiteUrl()}/disponibilidade/{newSlug}</span>. Quem tiver o link antigo vai precisar do novo.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancelar</Button>
            <Button onClick={rename} disabled={busy || !newSlug || slugTaken}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!accessFor} onOpenChange={v => !v && setAccessFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acesso de {accessFor ? capitalize(accessFor.name) : ""}</DialogTitle>
            <DialogDescription>
              Com o acesso próprio, o professor vê e marca só as aulas dele, vê os alunos e cadastra
              novos, e mexe nos próprios bloqueios. Não vê o financeiro, os valores nem as configurações.
            </DialogDescription>
          </DialogHeader>
          {accessFor?.user_id ? (
            <div className="space-y-2">
              <Label>Nova senha</Label>
              <Input type="text" value={accessPw} onChange={e => setAccessPw(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Usuário</Label>
                <Input value={accessUser} onChange={e => setAccessUser(e.target.value.toLowerCase())} placeholder="ex.: mayara" />
                <p className="text-[11px] text-muted-foreground">Letras minúsculas, números, ponto, traço ou underline. É o que ele digita para entrar.</p>
              </div>
              <div className="space-y-1">
                <Label>Senha</Label>
                <Input type="text" value={accessPw} onChange={e => setAccessPw(e.target.value)} placeholder="Mínimo 6 caracteres" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {accessFor?.user_id && <Button variant="destructive" onClick={() => callAccess("remove")} disabled={busy}>Remover acesso</Button>}
            <Button variant="outline" onClick={() => setAccessFor(null)}>Cancelar</Button>
            {accessFor?.user_id
              ? <Button onClick={() => callAccess("reset")} disabled={busy || accessPw.length < 6}>Trocar senha</Button>
              : <Button onClick={() => callAccess("create")} disabled={busy || accessPw.length < 6 || accessUser.trim().length < 3}>Criar acesso</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
import { GraduationCap, Plus, Trash2, ChevronDown, ChevronUp, Pencil, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorPicker } from "@/components/ColorPicker";
import { teacherColor } from "@/lib/teacherColors";
import { useServices } from "@/hooks/useServices";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { SCARCITY_DEFAULT, type ScarcityDay } from "@/lib/availability";
import { toast } from "sonner";
import { capitalize } from "@/lib/balance";
import { usePlan } from "@/hooks/usePlan";
import { ProUpsell } from "@/components/ProUpsell";
import { money, itemPrice, upgradeOffer } from "@/lib/subscription";
import { teacherUpgrade, type PlanId } from "@shared/plans";
import { useWords } from "@/hooks/useVocabulary";
import { dbErrorMessage } from "@/lib/dbErrors";
import { cap } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
const DIAS = L(["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"], ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

export default function TeachersPage() {
  const { plan } = usePlan();
  const w = useWords();
  const st = w.staff;
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
  const { services, links, reload: reloadServices } = useServices(true);
  // Serviço por profissional e "qualquer profissional" são do Max.
  const perTeacher = !!plan.teacher_services && (services?.length ?? 0) > 0;
  const slugs = teachers.map(t => teacherSlug(t.name));
  // A etiqueta "faz todos os serviços", no vocabulário da empresa.
  const todos = L(`Faz ${w.topic.pick("todos", "todas")} ${w.topic.os} ${w.topic.lp}`, `Offers all ${w.topic.lp}`);

  // Max com assinatura: cada profissional ativo acima dos incluídos é
  // cobrado. Depois de mudar quem está ativo, acerta a assinatura no Stripe
  // (edge function billing). Falhar aqui não desfaz nada; o webhook e a
  // próxima mudança acertam de novo.
  const syncSeats = () => {
    if (plan.billing_status !== "active" && plan.billing_status !== "past_due") return;
    supabase.functions.invoke("billing", { body: { action: "sync_seats" } }).catch(() => {});
  };
  const incluidos = plan.included_teachers ?? null;
  // Pro e Max cobram profissional extra acima dos incluídos (plans.ts).
  const cobraExtra = !!plan.extra_teachers_allowed && incluidos !== null;
  // Quem bate o teto: o Pro sugere o Max; Essencial e Start, o Pro.
  const sugestao = teacherUpgrade((plan.tier ?? "essencial") as PlanId, ativos + 1).suggest;

  const add = async () => {
    const v = name.trim().toLowerCase();
    if (!v) { toast.error(L(`Informe o nome ${st.do} ${st.l}`, `Enter the ${st.l}'s name`)); return; }
    setBusy(true);
    const { error } = await supabase.from("teachers" as any).insert({ name: v });
    setBusy(false);
    if (error) toast.error(dbErrorMessage(error, w)); else { toast.success(L(`${st.s} ${st.pick("cadastrado", "cadastrada")}`, `${st.s} added`)); setName(""); reload(); syncSeats(); }
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
    if (action === "remove" && !confirm(L(`Remover o acesso de ${capitalize(accessFor.name)}? ${cap(w.appointment.os)} ${w.appointment.lp} continuam.`, `Remove ${capitalize(accessFor.name)}'s login? The ${w.appointment.lp} stay.`))) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-teacher-login", {
      body: { teacher_id: accessFor.id, action, username: accessUser.trim().toLowerCase(), password: accessPw },
    });
    setBusy(false);
    const msg = (data as { error?: string } | null)?.error;
    if (error || msg) { toast.error(msg || L("Não foi possível concluir. Tente de novo.", "Couldn't finish. Please try again.")); return; }
    if (action === "create") {
      const text = L(`Seu acesso ao Cronys: usuário ${accessUser.trim().toLowerCase()}, senha ${accessPw}. Entre em ${publicSiteUrl()}/ ou pelo app.`,
        `Your Cronys login: username ${accessUser.trim().toLowerCase()}, password ${accessPw}. Sign in at ${publicSiteUrl()}/ or in the app.`);
      try { await navigator.clipboard.writeText(text); toast.success(L("Acesso criado - usuário e senha copiados para enviar", "Login created - username and password copied to send")); }
      catch { toast.success(L("Acesso criado", "Login created")); }
    } else {
      toast.success(action === "reset" ? L("Senha trocada", "Password changed") : L("Acesso removido", "Login removed"));
    }
    setAccessFor(null);
    reload();
  };

  const rename = async () => {
    if (!renaming) return;
    const v = newName.trim().toLowerCase();
    if (!v || !newSlug) { toast.error(L(`Informe o nome ${st.do} ${st.l}`, `Enter the ${st.l}'s name`)); return; }
    if (slugTaken) { toast.error(L(`Já existe ${st.um} ${st.l} com esse nome`, `There is already a ${st.l} with that name`)); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("rename_teacher" as never, {
      _teacher: renaming.id, _new_name: v, _old_slug: oldSlug, _new_slug: newSlug,
    } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const n = (data as { aulas?: number } | null)?.aulas ?? 0;
    const ap = w.appointment;
    toast.success(L(`${st.s} ${st.pick("renomeado", "renomeada")}${n ? ` - ${n} ${n === 1 ? ap.l : ap.lp} ${ap.pick("atualizado", "atualizada")}${n === 1 ? "" : "s"}` : ""}`,
      `${st.s} renamed${n ? ` - ${n} ${n === 1 ? ap.l : ap.lp} updated` : ""}`));
    setRenaming(null);
    reload();
  };

  const toggleActive = async (id: string, active: boolean) => {
    const { error } = await supabase.from("teachers" as any).update({ active }).eq("id", id);
    if (error) toast.error(dbErrorMessage(error, w)); else { reload(); syncSeats(); }
  };

  // O número fica guardado mesmo com o botão desligado: desligar é "não quero
  // divulgar agora", não "apagar o contato".
  const saveWhatsApp = async (id: string, whatsapp: string) => {
    const { error } = await supabase.from("teachers" as any)
      .update({ whatsapp: whatsapp.trim() || null }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(L("WhatsApp salvo", "WhatsApp saved")); reload(); }
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

  const setColor = async (id: string, color: string | null) => {
    const { error } = await supabase.from("teachers" as any).update({ color }).eq("id", id);
    if (error) toast.error(dbErrorMessage(error, w)); else reload();
  };

  const setAllServices = async (id: string, all_services: boolean) => {
    const { error } = await supabase.from("teachers" as any).update({ all_services }).eq("id", id);
    if (error) toast.error(dbErrorMessage(error, w)); else reload();
  };

  const toggleService = async (teacherId: string, serviceId: string, on: boolean) => {
    const { error } = on
      ? await supabase.from("teacher_services" as never).insert({ teacher_id: teacherId, service_id: serviceId } as never)
      : await supabase.from("teacher_services" as never).delete().eq("teacher_id", teacherId).eq("service_id", serviceId);
    if (error) toast.error(dbErrorMessage(error, w)); else reloadServices();
  };

  // A ordem da lista é a prioridade do "qualquer profissional": sobe/desce
  // regrava a ordem de todos (as antigas podem estar todas em zero).
  const move = async (index: number, delta: -1 | 1) => {
    const j = index + delta;
    if (j < 0 || j >= teachers.length) return;
    const order = teachers.map(t => t.id);
    [order[index], order[j]] = [order[j], order[index]];
    setBusy(true);
    const results = await Promise.all(order.map((id, i) =>
      supabase.from("teachers" as any).update({ sort_order: i + 1 }).eq("id", id)));
    setBusy(false);
    const err = results.find(r => r.error)?.error;
    if (err) toast.error(dbErrorMessage(err, w));
    reload();
  };

  const remove = async (id: string) => {
    if (!confirm(L(`Excluir ${st.este} ${st.l}? (${cap(w.appointment.os)} ${w.appointment.lp} e bloqueios já criados continuam intactos)`, `Delete this ${st.l}? (Existing ${w.appointment.lp} and time off stay untouched)`))) return;
    const { error } = await supabase.from("teachers" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success(L("Removido", "Removed")); reload(); syncSeats(); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><GraduationCap className="w-6 h-6" /> {st.p}</h1>
        <p className="text-sm text-muted-foreground">{L(`Cadastre ${st.os} ${st.lp} que aparecem na agenda e o WhatsApp de cada um. O acesso próprio de cada um é opcional, pelo ícone da chave.`, `Add the ${st.lp} who appear on the calendar and each one's WhatsApp. Their own login is optional, through the key icon.`)}</p>
      </div>

      <Card className="p-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">{L(`Nome ${st.do} ${st.l}`, `${st.s} name`)}</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={L("Ex: João", "E.g. John")} onKeyDown={e => e.key === "Enter" && add()} />
          </div>
          <Button onClick={add} disabled={busy || semVaga} className="gap-1"><Plus className="w-4 h-4" /> {L("Adicionar", "Add")}</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">{L("O nome é guardado em minúsculas e usado como identificador interno.", "The name is saved in lowercase and used as an internal identifier.")}</p>
        {cobraExtra && (
          <p className="text-xs text-muted-foreground mt-1">
            {L(`O ${plan.nome} inclui ${incluidos} ${incluidos === 1 ? st.l : st.lp}, contando você se você atende (${ativos} ${ativos === 1 ? "ativo" : "ativos"} agora); cada um a mais custa ${money(itemPrice("extra", "month"))}/mês${plan.max_teachers !== null ? `, até ${plan.max_teachers} no total` : ""}. Se você só administra, desative o seu nome aqui e ele não conta.`,
               `${plan.nome} includes ${incluidos} ${incluidos === 1 ? st.l : st.lp}, counting you if you also serve clients (${ativos} active now); each extra one is ${money(itemPrice("extra", "month"))}/month${plan.max_teachers !== null ? `, up to ${plan.max_teachers} in total` : ""}. If you only manage, deactivate your name here and it won't count.`)}
            {ativos > incluidos! ? L(` ${ativos - incluidos!} a mais entra${ativos - incluidos! === 1 ? "" : "m"} na assinatura.`, ` ${ativos - incluidos!} extra ${ativos - incluidos! === 1 ? "is" : "are"} added to the subscription.`) : ""}
          </p>
        )}
        {semVaga && (
          <div className="mt-3">
            <ProUpsell titulo={L(`O ${plan.nome} vai até ${plan.max_teachers} ${plan.max_teachers === 1 ? st.l : st.lp}`, `${plan.nome} allows up to ${plan.max_teachers} ${plan.max_teachers === 1 ? st.l : st.lp}`)} icon={GraduationCap} compacto>
              {sugestao === "pro"
                ? L(`você já tem ${ativos} ativos. Com mais um, o melhor é o ${upgradeOffer("pro")}: até 5 incluídos e IA inclusa.`,
                    `you already have ${ativos} active. For one more, the best fit is ${upgradeOffer("pro")}: up to 5 included, AI included.`)
                : L(`você já tem ${ativos} ativo${ativos === 1 ? "" : "s"}. No ${upgradeOffer("pro_solo")} cabem até 3, cada extra por ${money(itemPrice("extra", "month"))}/mês.`,
                    `you already have ${ativos} active. ${upgradeOffer("pro_solo")} fits up to 3, each extra for ${money(itemPrice("extra", "month"))}/month.`)}
            </ProUpsell>
          </div>
        )}
      </Card>

      <div className="space-y-2">
        {teachers.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">{L(`${st.nenhum} ${st.l} ${st.pick("cadastrado", "cadastrada")}.`, `No ${st.lp} yet.`)}</Card>}
        {plan.any_teacher && teachers.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {L(`A ordem desta lista é a prioridade quando ${w.client.o} ${w.client.l} pede "qualquer ${st.l}": fica com ${st.o} primeir${st.pick("o", "a")} que estiver livre no horário. Use as setas para mudar.`,
               `This order is the priority when a ${w.client.l} asks for "any ${st.l}": the first one free at that time gets it. Use the arrows to change it.`)}
          </p>
        )}
        {teachers.map((t, i) => (
          <Card key={t.id} className={`p-3 space-y-3 border-l-4 ${teacherColor(teacherSlug(t.name), slugs, { [teacherSlug(t.name)]: t.color }).border}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                {plan.any_teacher && teachers.length > 1 && (
                  <div className="flex flex-col">
                    <Button size="icon" variant="ghost" className="h-6 w-6" title={L("Subir na prioridade", "Move up in priority")} disabled={busy || i === 0} onClick={() => move(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" title={L("Descer na prioridade", "Move down in priority")} disabled={busy || i === teachers.length - 1} onClick={() => move(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
                  </div>
                )}
              <div>
                <div className="flex flex-wrap items-center gap-1.5 font-medium">
                  {plan.any_teacher && teachers.length > 1 && <span className="text-xs text-muted-foreground">{i + 1}º</span>}
                  {capitalize(t.name)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.active ? L("Ativo", "Active") : t.plan_locked ? L("Pausado pela mudança de plano - ative para liberar", "Paused by the plan change - activate to release") : L("Inativo", "Inactive")}
                  {t.user_id ? L(" · tem acesso próprio", " · has own login") : ""}
                </div>
                {perTeacher && t.all_services !== false && (
                  <Badge variant="secondary" className="mt-1 text-[10px] font-normal">{todos}</Badge>
                )}
              </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={t.active} onCheckedChange={v => toggleActive(t.id, v)} />
                {hasAccessColumn && (
                  <Button size="icon" variant="ghost" title={t.user_id ? L(`Acesso ${st.do} ${st.l}`, `${st.s} login`) : L(`Criar acesso para ${st.o} ${st.l}`, `Create a login for the ${st.l}`)} onClick={() => openAccess(t)}>
                    <KeyRound className={`w-4 h-4 ${t.user_id ? "text-primary" : ""}`} />
                  </Button>
                )}
                <Button size="icon" variant="ghost" title={L("Editar nome", "Edit name")} onClick={() => { setRenaming(t); setNewName(capitalize(t.name)); }}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => remove(t.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <label className="text-xs text-muted-foreground">{L("Cor na agenda", "Calendar color")}</label>
              <ColorPicker value={t.color} onChange={c => setColor(t.id, c)} allowNone noneLabel={L("Automática (pela posição)", "Automatic (by position)")} />
            </div>

            {perTeacher && services && (
              <div className="border-t border-border pt-3 space-y-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <Switch checked={t.all_services !== false} onCheckedChange={v => setAllServices(t.id, v)} />
                  <span className="text-muted-foreground">
                    {t.all_services !== false ? todos : L(`Faz só ${w.topic.os} ${w.topic.lp} marcad${w.topic.pick("o", "a")}s`, `Offers only the checked ${w.topic.lp}`)}
                  </span>
                </label>
                {t.all_services === false && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {services.map(sv => {
                      const on = links.some(l => l.teacher_id === t.id && l.service_id === sv.id);
                      return (
                        <label key={sv.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm cursor-pointer">
                          <Checkbox checked={on} onCheckedChange={v => toggleService(t.id, sv.id, v === true)} />
                          {sv.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">{L(`WhatsApp de ${capitalize(t.name)}`, `${capitalize(t.name)}'s WhatsApp`)}</label>
                  <Input
                    defaultValue={t.whatsapp ?? ""}
                    placeholder={L("5511999999999", "15551234567")}
                    onBlur={e => { if ((e.target.value.trim() || null) !== (t.whatsapp ?? null)) saveWhatsApp(t.id, e.target.value); }}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Switch checked={t.whatsapp_enabled !== false} onCheckedChange={v => toggleWhatsApp(t.id, v)} />
                <span className="text-muted-foreground">
                  {t.whatsapp_enabled !== false
                    ? L("Botão de WhatsApp aparece no app", "WhatsApp button shows in the app")
                    : L("Número guardado, mas o botão não aparece", "Number saved, but the button is hidden")}
                </span>
              </label>
            </div>

            <Collapsible className="rounded-md border border-border bg-muted/30">
              <CollapsibleTrigger asChild>
                <button className="group flex w-full items-center justify-between p-3 text-left text-sm">
                  <span>
                    {L("Escassez na página pública", "Scarcity on the public page")}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.scarcity ? L("personalizada", "custom") : L("igual à da empresa", "same as the business")}
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
                      ? L(`Números próprios de ${capitalize(t.name)}`, `${capitalize(t.name)}'s own numbers`)
                      : L("Seguindo a configuração da empresa", "Following the business setting")}
                  </span>
                </label>

                {t.scarcity && (
                  <>
                    <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 items-center">
                      <span />
                      <span className="text-[11px] text-muted-foreground text-center">{L("Mínimo", "Min")}</span>
                      <span className="text-[11px] text-muted-foreground text-center">{L("Máximo", "Max")}</span>
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
            <DialogTitle>{L(`Editar nome ${st.do} ${st.l}`, `Edit ${st.l} name`)}</DialogTitle>
            <DialogDescription>{L(`${cap(w.appointment.os)} ${w.appointment.lp} e os bloqueios acompanham o nome novo.`, `${w.appointment.p} and time off follow the new name.`)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{L("Nome", "Name")}</Label>
            <Input value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            {slugTaken && <p className="text-xs text-destructive">{L(`Já existe ${st.um} ${st.l} com esse nome.`, `There is already a ${st.l} with that name.`)}</p>}
            {renaming && newSlug && newSlug !== oldSlug && (
              <p className="text-xs text-muted-foreground">
                {L("O link público de horários muda de", "The public schedule link changes from")} <span className="font-mono break-all">{publicSiteUrl()}/disponibilidade/{oldSlug}</span> {L("para", "to")}{" "}
                <span className="font-mono break-all">{publicSiteUrl()}/disponibilidade/{newSlug}</span>. {L("Quem tiver o link antigo vai precisar do novo.", "Anyone with the old link will need the new one.")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>{L("Cancelar", "Cancel")}</Button>
            <Button onClick={rename} disabled={busy || !newSlug || slugTaken}>{L("Salvar", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!accessFor} onOpenChange={v => !v && setAccessFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{L(`Acesso de ${accessFor ? capitalize(accessFor.name) : ""}`, `${accessFor ? capitalize(accessFor.name) : ""}'s login`)}</DialogTitle>
            <DialogDescription>
              {L(`Com o acesso próprio, ${st.o} ${st.l} consulta ${w.appointment.os} ${w.appointment.lp} ${st.pick("dele", "dela")} e ${w.client.os} ${w.client.lp} com quem já atende, põe material e tarefa e mexe nos próprios bloqueios. Quem marca e desmarca é você. Não vê o financeiro, os valores nem as configurações.`,
                 `With their own login, the ${st.l} sees their ${w.appointment.lp} and the ${w.client.lp} they already serve, adds materials and homework, and manages their own time off. You book and cancel. They don't see billing, prices or settings.`)}
            </DialogDescription>
          </DialogHeader>
          {accessFor?.user_id ? (
            <div className="space-y-2">
              <Label>{L("Nova senha", "New password")}</Label>
              <Input type="text" value={accessPw} onChange={e => setAccessPw(e.target.value)} placeholder={L("Mínimo 6 caracteres", "At least 6 characters")} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>{L("Usuário", "Username")}</Label>
                <Input value={accessUser} onChange={e => setAccessUser(e.target.value.toLowerCase())} placeholder={L("ex.: mayara", "e.g. mary")} />
                <p className="text-[11px] text-muted-foreground">{L("Letras minúsculas, números, ponto, traço ou underline. É o que ele digita para entrar.", "Lowercase letters, numbers, dot, dash or underscore. It's what they type to sign in.")}</p>
              </div>
              <div className="space-y-1">
                <Label>{L("Senha", "Password")}</Label>
                <Input type="text" value={accessPw} onChange={e => setAccessPw(e.target.value)} placeholder={L("Mínimo 6 caracteres", "At least 6 characters")} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {accessFor?.user_id && <Button variant="destructive" onClick={() => callAccess("remove")} disabled={busy}>{L("Remover acesso", "Remove login")}</Button>}
            <Button variant="outline" onClick={() => setAccessFor(null)}>{L("Cancelar", "Cancel")}</Button>
            {accessFor?.user_id
              ? <Button onClick={() => callAccess("reset")} disabled={busy || accessPw.length < 6}>{L("Trocar senha", "Change password")}</Button>
              : <Button onClick={() => callAccess("create")} disabled={busy || accessPw.length < 6 || accessUser.trim().length < 3}>{L("Criar acesso", "Create login")}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

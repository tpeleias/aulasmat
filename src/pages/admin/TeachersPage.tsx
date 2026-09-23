import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTeachers } from "@/hooks/useTeachers";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { GraduationCap, Plus, Trash2, ChevronDown } from "lucide-react";
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
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={t.active} onCheckedChange={v => toggleActive(t.id, v)} />
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
    </div>
  );
}

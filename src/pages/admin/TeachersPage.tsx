import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTeachers } from "@/hooks/useTeachers";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { GraduationCap, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { capitalize } from "@/lib/balance";

export default function TeachersPage() {
  const { teachers, reload } = useTeachers(false);
  const [name, setName] = useState("");
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
          <Button onClick={add} disabled={busy} className="gap-1"><Plus className="w-4 h-4" /> Adicionar</Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">O nome é guardado em minúsculas e usado como identificador interno.</p>
      </Card>

      <div className="space-y-2">
        {teachers.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum professor cadastrado.</Card>}
        {teachers.map(t => (
          <Card key={t.id} className="p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{capitalize(t.name)}</div>
                <div className="text-xs text-muted-foreground">{t.active ? "Ativo" : "Inativo"}</div>
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
          </Card>
        ))}
      </div>
    </div>
  );
}

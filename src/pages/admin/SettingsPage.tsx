import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function SettingsPage() {
  const [s, setS] = useState({ work_start: "08:00", work_end: "22:00", slot_minutes: 60 });
  useEffect(() => { supabase.from("settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => data && setS(data)); }, []);
  const save = async () => {
    const { error } = await supabase.from("settings").update(s).eq("id", 1);
    if (error) toast.error(error.message); else toast.success("Configurações salvas");
  };
  return (
    <div className="space-y-6 max-w-xl">
      <div><h1 className="text-2xl font-bold">Configurações</h1><p className="text-sm text-muted-foreground">Janela de trabalho do calendário.</p></div>
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Início do dia</Label><Input type="time" value={s.work_start.slice(0,5)} onChange={e => setS({ ...s, work_start: e.target.value })} /></div>
          <div><Label>Fim do dia</Label><Input type="time" value={s.work_end.slice(0,5)} onChange={e => setS({ ...s, work_end: e.target.value })} /></div>
        </div>
        <div><Label>Duração do slot (min)</Label><Input type="number" value={s.slot_minutes} onChange={e => setS({ ...s, slot_minutes: Number(e.target.value) })} /></div>
        <Button onClick={save}>Salvar</Button>
      </Card>
    </div>
  );
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { MaterialIcon, MaterialOpenButton, type Material } from "@/components/MaterialView";

import { L } from "@/lib/i18n";
export default function StudentMaterials() {
  const { student } = useStudent();
  const [materials, setMaterials] = useState<Material[]>([]);

  useEffect(() => {
    if (!student) return;
    supabase.from("student_materials").select("*").eq("student_id", student.id).order("created_at", { ascending: false }).then(({ data }) => setMaterials((data ?? []) as Material[]));
  }, [student]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{L("Materiais", "Materials")}</h1>
      <p className="text-sm text-muted-foreground">{L("Arquivos, links e textos compartilhados com você.", "Files, links and texts shared with you.")}</p>
      {materials.length === 0 && <Card className="p-6 text-center text-muted-foreground text-sm">{L("Nenhum material disponível.", "No materials available.")}</Card>}
      {materials.map(m => (
        <Card key={m.id} className="p-4 flex items-center gap-3">
          <MaterialIcon m={m} className="w-6 h-6 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{m.title}</div>
            <div className="text-xs text-muted-foreground">{format(new Date(m.created_at), L("dd/MM/yyyy", "MMM d, yyyy"))}</div>
          </div>
          <MaterialOpenButton m={m} />
        </Card>
      ))}
    </div>
  );
}

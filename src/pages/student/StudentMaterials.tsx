import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";
import { format } from "date-fns";

export default function StudentMaterials() {
  const { student } = useStudent();
  const [materials, setMaterials] = useState<any[]>([]);

  useEffect(() => {
    if (!student) return;
    supabase.from("student_materials").select("*").eq("student_id", student.id).order("created_at", { ascending: false }).then(({ data }) => setMaterials(data ?? []));
  }, [student]);

  const download = async (path: string, title: string) => {
    const { data } = await supabase.storage.from("student-materials").createSignedUrl(path, 60);
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl; a.download = title; a.target = "_blank"; a.click();
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Materiais</h1>
      <p className="text-sm text-muted-foreground">Arquivos compartilhados pelo professor.</p>
      {materials.length === 0 && <Card className="p-6 text-center text-muted-foreground text-sm">Nenhum material disponível.</Card>}
      {materials.map(m => (
        <Card key={m.id} className="p-4 flex items-center gap-3">
          <FileText className="w-6 h-6 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{m.title}</div>
            <div className="text-xs text-muted-foreground">{format(new Date(m.created_at), "dd/MM/yyyy")}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => download(m.file_path, m.title)}>
            <Download className="w-4 h-4 mr-1" /> Baixar
          </Button>
        </Card>
      ))}
    </div>
  );
}

import { useState } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";

interface ExportControlsProps {
  targetRef: React.RefObject<HTMLElement>;
  fileName: string;
}

export function ExportControls({ targetRef, fileName }: ExportControlsProps) {
  const [exporting, setExporting] = useState(false);

  const handleExportImage = async () => {
    if (!targetRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(targetRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `${fileName}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      toast.error("Não foi possível exportar a imagem");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" onClick={handleExportImage} disabled={exporting}>
        <Download className="w-4 h-4" />
        {exporting ? "Exportando..." : "Exportar imagem"}
      </Button>
      <Button type="button" variant="outline" onClick={() => window.print()}>
        <Printer className="w-4 h-4" />
        Imprimir
      </Button>
    </div>
  );
}

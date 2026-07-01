import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Shuffle } from "lucide-react";
import { generateSeatingMap } from "@/lib/seatingShuffle";
import { generateSeatingMapWithAI } from "@/lib/seatingAi";
import { PreviewMapDialog } from "./PreviewMapDialog";
import type { ClassRoom } from "@/types/seating";

interface ShuffleControlsProps {
  classRoom: ClassRoom;
  useAI: boolean;
  onSetUseAI: (useAI: boolean) => void;
  onApplyAssignments: (studentIdBySeatIndex: (string | null)[]) => void;
}

export function ShuffleControls({ classRoom, useAI, onSetUseAI, onApplyAssignments }: ShuffleControlsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [proposedAssignment, setProposedAssignment] = useState<(string | null)[]>([]);

  const totalSeats = classRoom.rows * classRoom.cols;
  const canGenerate = classRoom.students.length > 0 && classRoom.students.length <= totalSeats;

  const runGeneration = async () => {
    setLoading(true);
    try {
      const result = useAI
        ? await generateSeatingMapWithAI(classRoom.students, classRoom.rows, classRoom.cols)
        : generateSeatingMap(classRoom.students, classRoom.rows, classRoom.cols);
      setProposedAssignment(result);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar o mapa");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <Switch id="use-ai" checked={useAI} onCheckedChange={onSetUseAI} />
        <Label htmlFor="use-ai" className="text-sm">
          Usar IA para gerar mapa
        </Label>
      </div>

      <Button type="button" onClick={runGeneration} disabled={!canGenerate || loading}>
        <Shuffle className="w-4 h-4" />
        {loading ? "Gerando..." : "Gerar novo mapa"}
      </Button>

      {!canGenerate && classRoom.students.length > totalSeats && (
        <span className="text-xs text-destructive">Mais alunos do que carteiras disponíveis.</span>
      )}

      <PreviewMapDialog
        open={open}
        onOpenChange={setOpen}
        classRoom={classRoom}
        proposedAssignment={proposedAssignment}
        loading={loading}
        onRegenerate={runGeneration}
        onAccept={() => {
          onApplyAssignments(proposedAssignment);
          setOpen(false);
          toast.success("Mapa aplicado");
        }}
      />
    </div>
  );
}

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ClassRoom } from "@/types/seating";

interface PreviewMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classRoom: ClassRoom;
  proposedAssignment: (string | null)[];
  loading: boolean;
  onRegenerate: () => void;
  onAccept: () => void;
}

export function PreviewMapDialog({
  open,
  onOpenChange,
  classRoom,
  proposedAssignment,
  loading,
  onRegenerate,
  onAccept,
}: PreviewMapDialogProps) {
  const studentsById = new Map(classRoom.students.map((s) => [s.id, s]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo mapa proposto</DialogTitle>
          <DialogDescription>
            Confira a distribuição sugerida. Você pode aceitar ou gerar novamente.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto py-2">
          <div
            className="grid gap-2 mx-auto w-fit"
            style={{ gridTemplateColumns: `repeat(${classRoom.cols}, minmax(0, 1fr))` }}
          >
            {proposedAssignment.map((studentId, i) => {
              const student = studentId ? studentsById.get(studentId) : undefined;
              const seatColor = classRoom.seats[i]?.color ?? undefined;
              return (
                <div
                  key={i}
                  style={seatColor ? { backgroundColor: seatColor, borderColor: seatColor } : undefined}
                  className="aspect-square min-w-[56px] sm:min-w-[68px] rounded-lg border-2 border-dashed bg-card flex items-center justify-center p-1 text-center"
                >
                  <span className="text-[11px] font-medium leading-tight break-words line-clamp-2">
                    {student?.name ?? ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onRegenerate} disabled={loading}>
            {loading ? "Gerando..." : "Gerar novamente"}
          </Button>
          <Button type="button" onClick={onAccept} disabled={loading}>
            Aceitar mapa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

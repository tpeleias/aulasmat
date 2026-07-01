import { useState } from "react";
import { Info, Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { getContrastTextColor } from "@/lib/color";
import { cn } from "@/lib/utils";
import type { Seat, Student } from "@/types/seating";

interface DragPayload {
  studentId: string;
  fromSeatIndex: number | null;
}

interface SeatCardProps {
  seat: Seat;
  seatIndex: number;
  student: Student | undefined;
  onDropStudent: (payload: DragPayload) => void;
  onColorChange: (color: string | null) => void;
}

export function SeatCard({ seat, seatIndex, student, onDropStudent, onColorChange }: SeatCardProps) {
  const [dragOver, setDragOver] = useState(false);
  const textColor = seat.color ? getContrastTextColor(seat.color) : undefined;

  const handleDragStart = (e: React.DragEvent) => {
    if (!student) return;
    e.dataTransfer.setData("application/json", JSON.stringify({ studentId: student.id, fromSeatIndex: seatIndex }));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as DragPayload;
      if (payload.fromSeatIndex === seatIndex) return;
      onDropStudent(payload);
    } catch {
      // dado de arrasto inválido — ignora
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={seat.color ? { backgroundColor: seat.color, borderColor: seat.color } : undefined}
      className={cn(
        "relative aspect-square min-w-[60px] sm:min-w-[76px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center p-1 text-center transition-colors bg-card",
        dragOver && "border-primary bg-primary/10",
        student && !seat.color && "border-solid",
      )}
    >
      {student ? (
        <div
          draggable
          onDragStart={handleDragStart}
          className="w-full h-full flex flex-col items-center justify-center gap-1 cursor-grab active:cursor-grabbing select-none"
        >
          <span
            className="text-[11px] sm:text-xs font-medium leading-tight break-words line-clamp-2"
            style={textColor ? { color: textColor } : undefined}
          >
            {student.name}
          </span>
          {student.observation && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Ver observação do aluno"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                >
                  <Info className="w-3.5 h-3.5" style={textColor ? { color: textColor } : undefined} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 text-sm" onClick={(e) => e.stopPropagation()}>
                <p className="font-medium mb-1">{student.name}</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{student.observation}</p>
              </PopoverContent>
            </Popover>
          )}
        </div>
      ) : (
        <span className="text-[10px] text-muted-foreground">{seatIndex + 1}</span>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full border border-border shadow-sm"
            aria-label="Cor da carteira"
          >
            <Palette className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2 flex items-center gap-2">
          <input
            type="color"
            value={seat.color ?? "#ffffff"}
            onChange={(e) => onColorChange(e.target.value)}
            className="w-10 h-10 cursor-pointer border-none bg-transparent p-0"
            aria-label="Selecionar cor"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => onColorChange(null)}>
            Remover cor
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

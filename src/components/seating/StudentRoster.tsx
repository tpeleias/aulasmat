import { useState } from "react";
import { Trash2, MessageSquareText, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClassRoom } from "@/types/seating";

interface StudentRosterProps {
  classRoom: ClassRoom;
  onAddStudent: (name: string) => void;
  onRemoveStudent: (studentId: string) => void;
  onRenameStudent: (studentId: string, name: string) => void;
  onSetObservation: (studentId: string, observation: string) => void;
  onUnassignSeat: (fromSeatIndex: number) => void;
}

export function StudentRoster({
  classRoom,
  onAddStudent,
  onRemoveStudent,
  onRenameStudent,
  onSetObservation,
  onUnassignSeat,
}: StudentRosterProps) {
  const [newName, setNewName] = useState("");

  const seatIndexByStudent = new Map<string, number>();
  classRoom.seats.forEach((seat, i) => {
    if (seat.studentId) seatIndexByStudent.set(seat.studentId, i);
  });

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    onAddStudent(name);
    setNewName("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const { fromSeatIndex } = JSON.parse(raw) as { fromSeatIndex: number | null };
      if (fromSeatIndex !== null) onUnassignSeat(fromSeatIndex);
    } catch {
      // dado de arrasto inválido — ignora
    }
  };

  return (
    <div
      className="flex flex-col gap-3 h-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="flex gap-2">
        <Input
          placeholder="Nome do aluno"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <Button type="button" onClick={handleAdd}>
          Adicionar
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Arraste um aluno para uma carteira. Solte aqui para tirar da carteira.
      </p>

      <div className="flex flex-col gap-2 overflow-y-auto pr-1">
        {classRoom.students.length === 0 && (
          <p className="text-sm text-muted-foreground italic">Nenhum aluno cadastrado ainda.</p>
        )}
        {classRoom.students.map((student) => {
          const seatIndex = seatIndexByStudent.get(student.id);
          const isSeated = seatIndex !== undefined;
          return (
            <div
              key={student.id}
              draggable={!isSeated}
              onDragStart={(e) => {
                if (isSeated) return;
                e.dataTransfer.setData(
                  "application/json",
                  JSON.stringify({ studentId: student.id, fromSeatIndex: null }),
                );
                e.dataTransfer.effectAllowed = "move";
              }}
              className={cn(
                "flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5",
                !isSeated && "cursor-grab active:cursor-grabbing",
              )}
            >
              {!isSeated && <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />}
              <Input
                value={student.name}
                onChange={(e) => onRenameStudent(student.id, e.target.value)}
                className="h-8 flex-1 min-w-0 border-none shadow-none px-1 focus-visible:ring-1"
              />
              {isSeated && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  Carteira {seatIndex + 1}
                </Badge>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 shrink-0", student.observation && "text-primary")}
                    aria-label="Observação do aluno"
                  >
                    <MessageSquareText className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72">
                  <p className="text-sm font-medium mb-2">Observação — {student.name}</p>
                  <Textarea
                    value={student.observation}
                    onChange={(e) => onSetObservation(student.id, e.target.value)}
                    placeholder="Ex: precisa sentar na frente, não pode ficar perto de X, problema de visão..."
                    rows={4}
                  />
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                aria-label="Remover aluno"
                onClick={() => onRemoveStudent(student.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

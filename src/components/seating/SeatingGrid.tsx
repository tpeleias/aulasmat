import { SeatCard } from "./SeatCard";
import type { ClassRoom } from "@/types/seating";

interface SeatingGridProps {
  classRoom: ClassRoom;
  onPlaceFromRoster: (studentId: string, seatIndex: number) => void;
  onSwapSeats: (seatIndexA: number, seatIndexB: number) => void;
  onSetSeatColor: (seatIndex: number, color: string | null) => void;
}

export function SeatingGrid({ classRoom, onPlaceFromRoster, onSwapSeats, onSetSeatColor }: SeatingGridProps) {
  const studentsById = new Map(classRoom.students.map((s) => [s.id, s]));

  return (
    <div className="w-full">
      <div className="mb-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Frente da sala
      </div>
      <div className="overflow-x-auto pb-2">
        <div
          className="grid gap-2 mx-auto w-fit"
          style={{ gridTemplateColumns: `repeat(${classRoom.cols}, minmax(0, 1fr))` }}
        >
          {classRoom.seats.map((seat, seatIndex) => (
            <SeatCard
              key={seatIndex}
              seat={seat}
              seatIndex={seatIndex}
              student={seat.studentId ? studentsById.get(seat.studentId) : undefined}
              onColorChange={(color) => onSetSeatColor(seatIndex, color)}
              onDropStudent={({ studentId, fromSeatIndex }) => {
                if (fromSeatIndex === null) onPlaceFromRoster(studentId, seatIndex);
                else onSwapSeats(fromSeatIndex, seatIndex);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

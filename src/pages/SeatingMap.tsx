import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSeatingApp } from "@/lib/seatingStorage";
import { ClassTabs } from "@/components/seating/ClassTabs";
import { GridSettings } from "@/components/seating/GridSettings";
import { StudentRoster } from "@/components/seating/StudentRoster";
import { SeatingGrid } from "@/components/seating/SeatingGrid";
import { ShuffleControls } from "@/components/seating/ShuffleControls";
import { ExportControls } from "@/components/seating/ExportControls";

export default function SeatingMap() {
  const {
    state,
    activeClass,
    setActiveClassId,
    renameClass,
    setGridSize,
    addStudent,
    removeStudent,
    renameStudent,
    setObservation,
    setSeatColor,
    placeStudentInSeat,
    swapSeats,
    unassignSeat,
    applySeatAssignments,
    setUseAI,
  } = useSeatingApp();

  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Mapa de Sala — Portal de Aulas";
  }, []);

  if (!activeClass) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-primary">
              <LayoutGrid className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold">Mapa de Sala de Aula</span>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Voltar</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
        <ClassTabs
          classes={state.classes}
          activeClassId={state.activeClassId}
          onSelect={setActiveClassId}
          onRename={renameClass}
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <GridSettings classRoom={activeClass} onApply={(rows, cols) => setGridSize(activeClass.id, rows, cols)} />
          <ExportControls targetRef={gridRef} fileName={activeClass.name} />
        </div>

        <ShuffleControls
          classRoom={activeClass}
          useAI={state.useAI}
          onSetUseAI={setUseAI}
          onApplyAssignments={(assignments) => applySeatAssignments(activeClass.id, assignments)}
        />

        <div className="flex flex-col lg:flex-row gap-6">
          <div id="seating-print-area" ref={gridRef} className="flex-1 bg-card rounded-xl border border-border p-4">
            <SeatingGrid
              classRoom={activeClass}
              onPlaceFromRoster={(studentId, seatIndex) => placeStudentInSeat(activeClass.id, studentId, seatIndex)}
              onSwapSeats={(a, b) => swapSeats(activeClass.id, a, b)}
              onSetSeatColor={(seatIndex, color) => setSeatColor(activeClass.id, seatIndex, color)}
            />
          </div>

          <div className="w-full lg:w-80 shrink-0 bg-card rounded-xl border border-border p-4">
            <StudentRoster
              classRoom={activeClass}
              onAddStudent={(name) => addStudent(activeClass.id, name)}
              onRemoveStudent={(studentId) => removeStudent(activeClass.id, studentId)}
              onRenameStudent={(studentId, name) => renameStudent(activeClass.id, studentId, name)}
              onSetObservation={(studentId, observation) => setObservation(activeClass.id, studentId, observation)}
              onUnassignSeat={(fromSeatIndex) => unassignSeat(activeClass.id, fromSeatIndex)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

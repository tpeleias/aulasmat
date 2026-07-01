import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ClassRoom } from "@/types/seating";

interface GridSettingsProps {
  classRoom: ClassRoom;
  onApply: (rows: number, cols: number) => void;
}

const MIN_SIZE = 1;
const MAX_SIZE = 12;

export function GridSettings({ classRoom, onApply }: GridSettingsProps) {
  const [rows, setRows] = useState(classRoom.rows);
  const [cols, setCols] = useState(classRoom.cols);

  useEffect(() => {
    setRows(classRoom.rows);
    setCols(classRoom.cols);
  }, [classRoom.id, classRoom.rows, classRoom.cols]);

  const clamp = (n: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, n || MIN_SIZE));

  const dirty = rows !== classRoom.rows || cols !== classRoom.cols;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="rows" className="text-xs text-muted-foreground">
          Linhas
        </Label>
        <Input
          id="rows"
          type="number"
          min={MIN_SIZE}
          max={MAX_SIZE}
          value={rows}
          onChange={(e) => setRows(clamp(Number(e.target.value)))}
          className="w-20"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="cols" className="text-xs text-muted-foreground">
          Colunas
        </Label>
        <Input
          id="cols"
          type="number"
          min={MIN_SIZE}
          max={MAX_SIZE}
          value={cols}
          onChange={(e) => setCols(clamp(Number(e.target.value)))}
          className="w-20"
        />
      </div>
      <Button type="button" variant="secondary" disabled={!dirty} onClick={() => onApply(rows, cols)}>
        Aplicar grade
      </Button>
    </div>
  );
}

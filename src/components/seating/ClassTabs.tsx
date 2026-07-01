import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClassRoom } from "@/types/seating";

interface ClassTabsProps {
  classes: ClassRoom[];
  activeClassId: string;
  onSelect: (classId: string) => void;
  onRename: (classId: string, name: string) => void;
}

export function ClassTabs({ classes, activeClassId, onSelect, onRename }: ClassTabsProps) {
  const activeClass = classes.find((c) => c.id === activeClassId);

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={activeClassId} onValueChange={onSelect}>
        <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1">
          {classes.map((c) => (
            <TabsTrigger key={c.id} value={c.id} className="max-w-[10rem] truncate">
              {c.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeClass && (
        <div className="flex items-center gap-2 max-w-sm">
          <Label htmlFor="class-name" className="shrink-0 text-sm text-muted-foreground">
            Nome da turma
          </Label>
          <Input
            id="class-name"
            value={activeClass.name}
            onChange={(e) => onRename(activeClass.id, e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

export interface Student {
  id: string;
  name: string;
  observation: string;
}

export interface Seat {
  studentId: string | null;
  color: string | null;
}

export interface ClassRoom {
  id: string;
  name: string;
  rows: number;
  cols: number;
  students: Student[];
  seats: Seat[];
}

export interface SeatingState {
  classes: ClassRoom[];
  activeClassId: string;
  useAI: boolean;
}

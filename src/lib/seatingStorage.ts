import { useCallback, useEffect, useState } from "react";
import type { ClassRoom, Seat, SeatingState, Student } from "@/types/seating";

const STORAGE_KEY = "aulasmat.seatingMap.v1";
const DEFAULT_ROWS = 4;
const DEFAULT_COLS = 6;

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptySeats(rows: number, cols: number): Seat[] {
  return Array.from({ length: rows * cols }, () => ({ studentId: null, color: null }));
}

function defaultState(): SeatingState {
  const classes: ClassRoom[] = Array.from({ length: 7 }, (_, i) => ({
    id: makeId(),
    name: `Turma ${i + 1}`,
    rows: DEFAULT_ROWS,
    cols: DEFAULT_COLS,
    students: [],
    seats: emptySeats(DEFAULT_ROWS, DEFAULT_COLS),
  }));
  return { classes, activeClassId: classes[0].id, useAI: false };
}

function loadState(): SeatingState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as SeatingState;
    if (!parsed.classes || parsed.classes.length === 0) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
}

export function useSeatingApp() {
  const [state, setState] = useState<SeatingState>(loadState);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage indisponível (modo privado sem quota, etc.) — segue sem persistir
    }
  }, [state]);

  const activeClass = state.classes.find((c) => c.id === state.activeClassId) ?? state.classes[0];

  const updateClass = useCallback((classId: string, updater: (c: ClassRoom) => ClassRoom) => {
    setState((s) => ({ ...s, classes: s.classes.map((c) => (c.id === classId ? updater(c) : c)) }));
  }, []);

  const setActiveClassId = useCallback((id: string) => {
    setState((s) => ({ ...s, activeClassId: id }));
  }, []);

  const renameClass = useCallback((classId: string, name: string) => {
    updateClass(classId, (c) => ({ ...c, name }));
  }, [updateClass]);

  const setGridSize = useCallback((classId: string, rows: number, cols: number) => {
    updateClass(classId, (c) => {
      const nextSeats = emptySeats(rows, cols);
      // preserve seats that still fit within the new grid bounds by (row, col) position
      for (let r = 0; r < Math.min(rows, c.rows); r++) {
        for (let col = 0; col < Math.min(cols, c.cols); col++) {
          nextSeats[r * cols + col] = c.seats[r * c.cols + col];
        }
      }
      return { ...c, rows, cols, seats: nextSeats };
    });
  }, [updateClass]);

  const addStudent = useCallback((classId: string, name: string) => {
    const student: Student = { id: makeId(), name, observation: "" };
    updateClass(classId, (c) => ({ ...c, students: [...c.students, student] }));
  }, [updateClass]);

  const removeStudent = useCallback((classId: string, studentId: string) => {
    updateClass(classId, (c) => ({
      ...c,
      students: c.students.filter((s) => s.id !== studentId),
      seats: c.seats.map((seat) => (seat.studentId === studentId ? { ...seat, studentId: null } : seat)),
    }));
  }, [updateClass]);

  const renameStudent = useCallback((classId: string, studentId: string, name: string) => {
    updateClass(classId, (c) => ({
      ...c,
      students: c.students.map((s) => (s.id === studentId ? { ...s, name } : s)),
    }));
  }, [updateClass]);

  const setObservation = useCallback((classId: string, studentId: string, observation: string) => {
    updateClass(classId, (c) => ({
      ...c,
      students: c.students.map((s) => (s.id === studentId ? { ...s, observation } : s)),
    }));
  }, [updateClass]);

  const setSeatColor = useCallback((classId: string, seatIndex: number, color: string | null) => {
    updateClass(classId, (c) => ({
      ...c,
      seats: c.seats.map((seat, i) => (i === seatIndex ? { ...seat, color } : seat)),
    }));
  }, [updateClass]);

  /** Move a student from the roster (unseated) into a seat, displacing any current occupant back to the roster. */
  const placeStudentInSeat = useCallback((classId: string, studentId: string, seatIndex: number) => {
    updateClass(classId, (c) => {
      const seats = c.seats.map((seat) => (seat.studentId === studentId ? { ...seat, studentId: null } : seat));
      seats[seatIndex] = { ...seats[seatIndex], studentId };
      return { ...c, seats };
    });
  }, [updateClass]);

  /** Swap the occupants of two seats. Color stays with the seat/position, not the student. */
  const swapSeats = useCallback((classId: string, seatIndexA: number, seatIndexB: number) => {
    updateClass(classId, (c) => {
      const seats = [...c.seats];
      const studentA = seats[seatIndexA].studentId;
      const studentB = seats[seatIndexB].studentId;
      seats[seatIndexA] = { ...seats[seatIndexA], studentId: studentB };
      seats[seatIndexB] = { ...seats[seatIndexB], studentId: studentA };
      return { ...c, seats };
    });
  }, [updateClass]);

  /** Unassign a student from their seat, sending them back to the roster pool. */
  const unassignSeat = useCallback((classId: string, seatIndex: number) => {
    updateClass(classId, (c) => ({
      ...c,
      seats: c.seats.map((seat, i) => (i === seatIndex ? { ...seat, studentId: null } : seat)),
    }));
  }, [updateClass]);

  const applySeatAssignments = useCallback((classId: string, studentIdBySeatIndex: (string | null)[]) => {
    updateClass(classId, (c) => ({
      ...c,
      seats: c.seats.map((seat, i) => ({ ...seat, studentId: studentIdBySeatIndex[i] ?? null })),
    }));
  }, [updateClass]);

  const setUseAI = useCallback((useAI: boolean) => {
    setState((s) => ({ ...s, useAI }));
  }, []);

  return {
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
  };
}

import type { Student } from "@/types/seating";

const MAX_ATTEMPTS = 400;
const DIACRITICS_REGEX = new RegExp("[\\u0300-\\u036f]", "g");

function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(DIACRITICS_REGEX, "");
}

function normalize(text: string): string {
  return stripDiacritics(text).toLowerCase();
}

const NEGATIVE_PROXIMITY = /longe|distante|separ|evitar|afastad/;

function mentionsWithNegativeProximity(observation: string, otherName: string): boolean {
  const obs = normalize(observation);
  const name = normalize(otherName).trim();
  if (!name) return false;
  if (!obs.includes(name)) return false;
  if (NEGATIVE_PROXIMITY.test(obs)) return true;
  return obs.includes("nao") && obs.includes("perto");
}

function requiresFront(observation: string): boolean {
  return /\bfrente\b/.test(normalize(observation));
}

interface Constraints {
  frontRequired: Set<string>;
  forbiddenPairs: Array<[string, string]>;
}

export function extractConstraints(students: Student[]): Constraints {
  const frontRequired = new Set<string>();
  const forbiddenPairs: Array<[string, string]> = [];
  const seenPairs = new Set<string>();

  for (const student of students) {
    if (student.observation && requiresFront(student.observation)) {
      frontRequired.add(student.id);
    }
  }

  for (const a of students) {
    for (const b of students) {
      if (a.id === b.id || !a.observation) continue;
      if (mentionsWithNegativeProximity(a.observation, b.name)) {
        const key = [a.id, b.id].sort().join("|");
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          forbiddenPairs.push([a.id, b.id]);
        }
      }
    }
  }

  return { frontRequired, forbiddenPairs };
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function seatRowCol(index: number, cols: number): [number, number] {
  return [Math.floor(index / cols), index % cols];
}

/** Seats count as "close" if they're the same seat or a neighbor (including diagonals). */
function seatsAreClose(indexA: number, indexB: number, cols: number): boolean {
  const [rowA, colA] = seatRowCol(indexA, cols);
  const [rowB, colB] = seatRowCol(indexB, cols);
  return Math.abs(rowA - rowB) <= 1 && Math.abs(colA - colB) <= 1;
}

function countViolations(
  assignment: (string | null)[],
  forbiddenPairs: Array<[string, string]>,
  cols: number,
): number {
  if (forbiddenPairs.length === 0) return 0;
  const seatByStudent = new Map<string, number>();
  assignment.forEach((studentId, seatIndex) => {
    if (studentId) seatByStudent.set(studentId, seatIndex);
  });
  let violations = 0;
  for (const [a, b] of forbiddenPairs) {
    const seatA = seatByStudent.get(a);
    const seatB = seatByStudent.get(b);
    if (seatA === undefined || seatB === undefined) continue;
    if (seatsAreClose(seatA, seatB, cols)) violations++;
  }
  return violations;
}

function attemptAssignment(
  students: Student[],
  totalSeats: number,
  rows: number,
  cols: number,
  frontRequired: Set<string>,
): (string | null)[] {
  const assignment: (string | null)[] = Array.from({ length: totalSeats }, () => null);
  const allSeatIndices = Array.from({ length: totalSeats }, (_, i) => i);

  const frontStudents = students.filter((s) => frontRequired.has(s.id));
  const otherStudents = shuffleArray(students.filter((s) => !frontRequired.has(s.id)));

  const frontRows = frontStudents.length > 0 ? Math.min(rows, Math.max(1, Math.ceil(frontStudents.length / cols))) : 0;
  const frontSeatIndices = allSeatIndices.filter((i) => seatRowCol(i, cols)[0] < frontRows);
  const otherSeatIndices = allSeatIndices.filter((i) => seatRowCol(i, cols)[0] >= frontRows);

  const shuffledFrontStudents = shuffleArray(frontStudents);
  const shuffledFrontSeats = shuffleArray(frontSeatIndices);

  shuffledFrontStudents.forEach((student, i) => {
    if (i < shuffledFrontSeats.length) assignment[shuffledFrontSeats[i]] = student.id;
  });

  const leftoverFrontSeats = shuffledFrontSeats.slice(shuffledFrontStudents.length);
  const remainingSeats = shuffleArray([...otherSeatIndices, ...leftoverFrontSeats]);

  otherStudents.forEach((student, i) => {
    if (i < remainingSeats.length) assignment[remainingSeats[i]] = student.id;
  });

  return assignment;
}

export function generateSeatingMap(students: Student[], rows: number, cols: number): (string | null)[] {
  const totalSeats = rows * cols;
  const { frontRequired, forbiddenPairs } = extractConstraints(students);

  let best: (string | null)[] | null = null;
  let bestViolations = Infinity;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const assignment = attemptAssignment(students, totalSeats, rows, cols, frontRequired);
    const violations = countViolations(assignment, forbiddenPairs, cols);
    if (violations < bestViolations) {
      best = assignment;
      bestViolations = violations;
      if (violations === 0) break;
    }
  }

  return best ?? Array.from({ length: totalSeats }, () => null);
}

// Cores por professor, usadas na agenda e na legenda.
//
// A paleta é uma lista de classes escritas por extenso porque o Tailwind lê o
// código-fonte para decidir o que incluir no build: classe montada na hora
// (`bg-${cor}-500/15`) simplesmente não existiria no CSS final.
//
// A cor vem da posição do professor na lista ordenada da empresa, não do nome -
// era o nome cravado no código que fazia a agenda de qualquer empresa aparecer
// pintada como a do Thiago e da Mayara.
const PALETTE = [
  { bg: "bg-primary/15", border: "border-l-primary", text: "text-primary" },
  { bg: "bg-fuchsia-500/15", border: "border-l-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-400" },
  { bg: "bg-emerald-500/15", border: "border-l-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  { bg: "bg-amber-500/15", border: "border-l-amber-500", text: "text-amber-700 dark:text-amber-400" },
  { bg: "bg-sky-500/15", border: "border-l-sky-500", text: "text-sky-700 dark:text-sky-400" },
  { bg: "bg-violet-500/15", border: "border-l-violet-500", text: "text-violet-700 dark:text-violet-400" },
] as const;

export type TeacherColor = (typeof PALETTE)[number];

export function teacherColor(slug: string, slugs: string[]): TeacherColor {
  const i = slugs.indexOf(slug);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

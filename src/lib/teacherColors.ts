// Cores por profissional (e por serviço), usadas na agenda e na legenda.
//
// A paleta é uma lista de classes escritas por extenso porque o Tailwind lê o
// código-fonte para decidir o que incluir no build: classe montada na hora
// (`bg-${cor}-500/15`) simplesmente não existiria no CSS final.
//
// O admin escolhe a cor de cada profissional (teachers.color, migration
// 20260925110000). Sem escolha, a cor vem da posição dele na lista da empresa,
// não do nome - era o nome cravado no código que fazia a agenda de qualquer
// empresa aparecer pintada como a do Thiago e da Mayara.
// "azul" é a cor principal do app (o nome ficou da primeira versão do tema).
export const PALETTE = {
  azul: { label: "Cor do app", bg: "bg-primary/15", border: "border-l-primary", text: "text-primary", dot: "bg-primary" },
  rosa: { label: "Rosa", bg: "bg-fuchsia-500/15", border: "border-l-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-400", dot: "bg-fuchsia-500" },
  verde: { label: "Verde", bg: "bg-emerald-500/15", border: "border-l-emerald-500", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  ambar: { label: "Âmbar", bg: "bg-amber-500/15", border: "border-l-amber-500", text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  ceu: { label: "Céu", bg: "bg-sky-500/15", border: "border-l-sky-500", text: "text-sky-700 dark:text-sky-400", dot: "bg-sky-500" },
  violeta: { label: "Violeta", bg: "bg-violet-500/15", border: "border-l-violet-500", text: "text-violet-700 dark:text-violet-400", dot: "bg-violet-500" },
  vermelho: { label: "Vermelho", bg: "bg-rose-500/15", border: "border-l-rose-500", text: "text-rose-700 dark:text-rose-400", dot: "bg-rose-500" },
  laranja: { label: "Laranja", bg: "bg-orange-500/15", border: "border-l-orange-500", text: "text-orange-700 dark:text-orange-400", dot: "bg-orange-500" },
  turquesa: { label: "Turquesa", bg: "bg-teal-500/15", border: "border-l-teal-500", text: "text-teal-700 dark:text-teal-400", dot: "bg-teal-500" },
  cinza: { label: "Cinza", bg: "bg-slate-500/15", border: "border-l-slate-500", text: "text-slate-700 dark:text-slate-300", dot: "bg-slate-500" },
} as const;

export type ColorKey = keyof typeof PALETTE;
export type TeacherColor = (typeof PALETTE)[ColorKey];

export const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[];

// A ordem de antes, para quem não escolheu cor continuar com a mesma.
const BY_POSITION: ColorKey[] = ["azul", "rosa", "verde", "ambar", "ceu", "violeta"];

export function isColorKey(c: unknown): c is ColorKey {
  return typeof c === "string" && c in PALETTE;
}

/** A cor da posição (sem escolha do admin). */
export function positionColorKey(slug: string, slugs: string[]): ColorKey {
  const i = slugs.indexOf(slug);
  return BY_POSITION[(i < 0 ? 0 : i) % BY_POSITION.length];
}

/**
 * A cor do profissional: a escolhida (`chosen[slug]`) ou, sem escolha, a da
 * posição na lista.
 */
export function teacherColor(slug: string, slugs: string[], chosen?: Record<string, string | null | undefined>): TeacherColor {
  const c = chosen?.[slug];
  return PALETTE[isColorKey(c) ? c : positionColorKey(slug, slugs)];
}

export function colorOf(key: string | null | undefined): TeacherColor | null {
  return isColorKey(key) ? PALETTE[key] : null;
}

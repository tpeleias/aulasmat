// Nomes digitados à mão (10/10). O Financeiro junta a família pelo nome do
// responsável, então "Taciana" e "Thaciana" viram duas contas. Estas contas
// ajudam o cadastro a avisar antes de salvar.

/** Sem acento, sem espaço sobrando, minúsculo. */
export function foldName(s: string | null | undefined) {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/**
 * Um nome já cadastrado parecido com o digitado, mas não igual (o Financeiro
 * trataria como outra pessoa): acento, maiúscula com acento ou até 2 letras de
 * diferença. Nulo quando é igual a um existente ou não lembra nenhum.
 */
export function similarName(typed: string, existing: (string | null | undefined)[]): string | null {
  const t = typed.trim();
  if (t.length < 3) return null;
  const lower = t.toLowerCase();
  const names = [...new Set(existing.map(e => (e ?? "").trim()).filter(Boolean))];
  if (names.some(n => n.toLowerCase() === lower)) return null;
  const ft = foldName(t);
  const max = ft.length >= 8 ? 2 : 1;
  let best: { name: string; d: number } | null = null;
  for (const n of names) {
    const d = foldName(n) === ft ? 0 : distance(ft, foldName(n));
    if (d <= max && (!best || d < best.d)) best = { name: n, d };
  }
  return best?.name ?? null;
}

/** Outro cadastro com o mesmo nome e o mesmo responsável (ou os dois sem). */
export function sameClient(
  student: string, guardian: string | null | undefined,
  others: { id?: string; student_name: string; guardian_name?: string | null }[], selfId?: string,
) {
  const s = student.trim().toLowerCase(), g = (guardian ?? "").trim().toLowerCase();
  return others.find(o => o.id !== selfId && o.student_name.trim().toLowerCase() === s && (o.guardian_name ?? "").trim().toLowerCase() === g) ?? null;
}

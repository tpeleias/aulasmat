// Sanitiza nome de arquivo para uso seguro como chave no Supabase Storage.
// Remove acentos, cedilhas, espaços e caracteres especiais.
export function sanitizeFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";

  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-") // troca o resto por hífen
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

  const cleanBase = clean(base) || "arquivo";
  const cleanExt = clean(ext);
  return cleanExt ? `${cleanBase}.${cleanExt}` : cleanBase;
}

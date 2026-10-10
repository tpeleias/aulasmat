// Importar clientes de planilha.
//
// Quem vem do caderno ou do Excel desiste no cadastro um a um. Aqui entra o
// texto de um CSV ou o que se copia de uma planilha (Excel e Google Planilhas
// colam com TAB), e sai a lista de cadastros para conferir antes de gravar.
//
// Colunas, nesta ordem se não houver cabeçalho: nome, responsável, endereço.
// Com cabeçalho, a ordem não importa e as colunas são reconhecidas pelo nome.

export type ImportRow = {
  student_name: string;
  guardian_name: string | null;
  address: string | null;
};

export type ImportLine = ImportRow & {
  /** Número da linha no texto colado (1 = primeira), para a pessoa achar. */
  line: number;
  status: "novo" | "repetido_no_cadastro" | "repetido_na_planilha";
};

type Field = keyof ImportRow;

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

// Palavras de cabeçalho, já sem acento. Os ramos usam nomes diferentes
// (paciente, cliente, tutor), então a lista cobre todos.
const HEADER_WORDS: Record<Field, string[]> = {
  student_name: ["nome", "aluno", "aluna", "paciente", "cliente", "pet", "nome do aluno", "nome do paciente", "nome do cliente",
    "name", "student", "patient", "client", "customer", "student name", "full name"],
  guardian_name: ["responsavel", "responsaveis", "tutor", "tutora", "mae", "pai", "nome do responsavel", "familia",
    "parent", "guardian", "owner", "mother", "father", "family", "parent name"],
  address: ["endereco", "rua", "local", "endereco completo", "address", "street", "location"],
};

function headerField(cell: string): Field | null {
  const c = norm(cell);
  for (const f of Object.keys(HEADER_WORDS) as Field[]) {
    if (HEADER_WORDS[f].includes(c)) return f;
  }
  return null;
}

/** O separador mais provável: TAB (colado de planilha), ponto e vírgula (CSV do Excel em português) ou vírgula. */
export function detectDelimiter(text: string): "\t" | ";" | "," {
  const sample = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
  const count = (d: string) => sample.reduce((n, l) => n + (l.split(d).length - 1), 0);
  if (count("\t") > 0) return "\t";
  return count(";") >= count(",") && count(";") > 0 ? ";" : ",";
}

/** Divide o texto em linhas e células, respeitando aspas ("Silva, Ana"). */
export function parseTable(text: string, delim = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true; cell = "";
    } else if (ch === delim) {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.map(r => r.map(c => c.trim()));
}

/**
 * Lê o texto e diz o que cada linha vai virar. `existing` são os cadastros que
 * já existem (nome + responsável): repetido não entra de novo.
 */
export function parseStudents(
  text: string,
  existing: { student_name: string; guardian_name: string | null }[],
): ImportLine[] {
  const table = parseTable(text);
  let start = 0;
  let columns: (Field | null)[] = ["student_name", "guardian_name", "address"];

  const firstNonEmpty = table.findIndex(r => r.some(c => c));
  if (firstNonEmpty >= 0) {
    const header = table[firstNonEmpty].map(headerField);
    if (header.includes("student_name")) {
      columns = header;
      start = firstNonEmpty + 1;
    }
  }

  const key = (n: string, g: string | null) => `${norm(n)}|${norm(g ?? "")}`;
  const known = new Set(existing.map(e => key(e.student_name, e.guardian_name)));
  const seen = new Set<string>();
  const out: ImportLine[] = [];

  for (let i = start; i < table.length; i++) {
    const r = table[i];
    const get = (f: Field) => {
      const idx = columns.indexOf(f);
      const v = idx >= 0 ? (r[idx] ?? "").trim().replace(/\s+/g, " ") : "";
      return v || null;
    };
    const name = get("student_name");
    if (!name) continue;
    const row: ImportRow = { student_name: name, guardian_name: get("guardian_name"), address: get("address") };
    const k = key(row.student_name, row.guardian_name);
    const status = known.has(k) ? "repetido_no_cadastro" : seen.has(k) ? "repetido_na_planilha" : "novo";
    seen.add(k);
    out.push({ ...row, line: i + 1, status });
  }
  return out;
}

/**
 * Instruções para colar numa IA (ChatGPT, Claude, Gemini) junto com os dados
 * do jeito que a pessoa tem (caderno, WhatsApp, planilha bagunçada). A IA
 * devolve o texto já no formato que `parseStudents` lê: cabeçalho fixo e
 * ponto e vírgula, porque endereço costuma ter vírgula.
 */
export function aiImportPrompt(words: { client: string; guardian: string }, en = false): string {
  if (en) return [
    `Convert the list of ${words.client}s I'll send below into this exact format, to import into Cronys:`,
    "",
    "Nome;Responsável;Endereço",
    "Anna Smith;Mary Smith;10 A Street, Springfield",
    "Ben Lee;;",
    "",
    "Rules:",
    `- One ${words.client} per line, always with that first header line, exactly as written.`,
    `- Columns separated by semicolon (;): name of the ${words.client}; ${words.guardian} (if any); address (if any).`,
    "- Leave a column empty when the information doesn't exist (e.g. \"Ben Lee;;\"). Never make anything up.",
    "- Don't use semicolons inside the values. Remove phone numbers, notes and anything that isn't name, " + words.guardian + " or address.",
    "- Write names with capital initials and don't repeat the same person.",
    "- Reply only with the result inside a code block, with nothing before or after.",
    "",
    "My data:",
    "",
  ].join("\n");
  return [
    `Converta a lista de ${words.client}s que vou mandar abaixo para este formato exato, para importar no Cronys:`,
    "",
    "Nome;Responsável;Endereço",
    "Ana Souza;Maria Souza;Rua A, 10 - Centro",
    "Bruno Lima;;",
    "",
    "Regras:",
    `- Um ${words.client} por linha, sempre com essa primeira linha de cabeçalho, escrita igual.`,
    `- Colunas separadas por ponto e vírgula (;): nome do ${words.client}; ${words.guardian} (se houver); endereço (se houver).`,
    "- Deixe a coluna vazia quando a informação não existir (ex.: \"Bruno Lima;;\"). Nunca invente nada.",
    `- Não use ponto e vírgula dentro dos valores. Tire telefones, observações e o que não for nome, ${words.guardian} ou endereço.`,
    "- Escreva os nomes com iniciais maiúsculas e não repita a mesma pessoa.",
    "- Responda só com o resultado dentro de um bloco de código, sem nada antes ou depois.",
    "",
    "Meus dados:",
    "",
  ].join("\n");
}

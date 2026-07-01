import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.32.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

interface StudentInput {
  id: string;
  name: string;
  observation: string;
}

function buildPrompt(students: StudentInput[], rows: number, cols: number): string {
  const totalSeats = rows * cols;
  const roster = students
    .map((s) => `- id: ${s.id} | nome: ${s.name}${s.observation ? ` | observação: ${s.observation}` : ""}`)
    .join("\n");

  return `Você é um assistente que organiza mapas de sala de aula.

Grade de carteiras: ${rows} linhas x ${cols} colunas (${totalSeats} assentos). Os assentos são numerados de 0 a ${totalSeats - 1}, em ordem de leitura (linha 0 = primeiras ${cols} carteiras, que ficam na FRENTE da sala, mais perto do professor/quadro).

Lista de alunos:
${roster}

Distribua todos os alunos listados nos assentos, respeitando com atenção as observações de cada um (ex: preferência por sentar na frente, perto da janela, longe de outro aluno, ao lado de colegas calmos, etc). Fora dessas restrições, misture os alunos o máximo possível, evitando padrões óbvios.

Responda APENAS com um JSON válido, sem nenhum texto antes ou depois, no formato exato:
{"assignments": [{"seatIndex": <número do assento, 0 a ${totalSeats - 1}>, "studentId": "<id do aluno>"}]}

Inclua uma entrada para cada aluno da lista, cada um em um assento diferente. Não inclua assentos vazios na lista.`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY não configurada no projeto Supabase" }, 500);

    const body = await req.json();
    const students: StudentInput[] = Array.isArray(body?.students) ? body.students : [];
    const rows = Number(body?.rows);
    const cols = Number(body?.cols);

    if (!students.length) return json({ error: "Nenhum aluno informado" }, 400);
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0) {
      return json({ error: "Grade inválida" }, 400);
    }
    if (students.length > rows * cols) {
      return json({ error: "Mais alunos do que assentos disponíveis" }, 400);
    }

    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: buildPrompt(students, rows, cols) }],
    });

    const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) return json({ error: "Resposta da IA sem conteúdo de texto" }, 502);

    let parsed: { assignments?: Array<{ seatIndex: number; studentId: string }> };
    try {
      parsed = extractJson(textBlock.text) as typeof parsed;
    } catch {
      return json({ error: "Não foi possível interpretar a resposta da IA" }, 502);
    }

    const assignments = Array.isArray(parsed?.assignments) ? parsed.assignments : null;
    if (!assignments) return json({ error: "Formato de resposta inesperado da IA" }, 502);

    const validStudentIds = new Set(students.map((s) => s.id));
    const totalSeats = rows * cols;
    const seatByStudent = new Map<string, number>();
    for (const entry of assignments) {
      if (
        typeof entry?.studentId !== "string" ||
        !validStudentIds.has(entry.studentId) ||
        !Number.isInteger(entry?.seatIndex) ||
        entry.seatIndex < 0 ||
        entry.seatIndex >= totalSeats ||
        seatByStudent.has(entry.studentId)
      ) {
        continue;
      }
      seatByStudent.set(entry.studentId, entry.seatIndex);
    }

    if (seatByStudent.size !== students.length) {
      return json({ error: "A IA não distribuiu todos os alunos corretamente" }, 502);
    }

    const studentIdBySeatIndex: (string | null)[] = Array.from({ length: totalSeats }, () => null);
    for (const [studentId, seatIndex] of seatByStudent) {
      studentIdBySeatIndex[seatIndex] = studentId;
    }

    return json({ studentIdBySeatIndex });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erro desconhecido" }, 500);
  }
});

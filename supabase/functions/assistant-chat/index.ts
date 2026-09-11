import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLAUDE_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOOL_ITERATIONS = 8;

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function teacherSlug(name: string) {
  return name
    .normalize("NFD").replace(DIACRITICS_RE, "")
    .toLowerCase().trim().replace(/\s+/g, "-");
}

// ---- Tool definitions (Claude Messages API tool schema - JSON Schema input_schema) ----
const tools = [
  {
    name: "find_students",
    description: "Busca alunos pelo nome (do aluno ou do responsável). Use antes de criar/editar uma aula quando o nome não for exato, para confirmar qual aluno é.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Parte do nome do aluno ou responsável" } },
      required: ["query"],
    },
  },
  {
    name: "list_teachers",
    description: "Lista os professores ativos. Retorna nome e o 'slug' que deve ser usado no campo teacher das outras ferramentas.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_lessons",
    description: "Lista aulas dentro de um período, opcionalmente filtrando por aluno, professor ou status.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Data/hora ISO 8601 inicial (inclusive)" },
        to: { type: "string", description: "Data/hora ISO 8601 final (exclusive)" },
        student_name: { type: "string" },
        teacher: { type: "string", description: "Slug do professor (ex: thiago, mayara)" },
        status: { type: "string", enum: ["agendada", "cancelada", "realizada"] },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "create_lesson",
    description: "Cria uma nova aula agendada. Um lançamento de débito na carteira do aluno/responsável é criado automaticamente. Antes de chamar, confirme com o usuário o resumo da aula (aluno, data/hora, professor, valor).",
    input_schema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string", description: "Nome do responsável, se houver (usado para agrupar a carteira)" },
        teacher: { type: "string", description: "Slug do professor (ex: thiago, mayara)" },
        start_at: { type: "string", description: "Data/hora ISO 8601 de início" },
        duration_minutes: { type: "number", description: "Em minutos. Se não especificado pelo usuário, use 60 (padrão)." },
        subject: { type: "string", description: "Ex: Matemática, Química, Ciências" },
        price: { type: "number", description: "Valor da aula POR HORA em reais (R$/h) — não é o total da aula, o débito na carteira é calculado como price × duração/60. Se não especificado pelo usuário, use 220 (padrão)." },
        package_type: { type: "string", enum: ["avulsa", "pacote"], description: "Padrão avulsa" },
        is_online: { type: "boolean", description: "Padrão false" },
        address: { type: "string", description: "Endereço da aula presencial (com complemento/apto se houver)" },
        notes: { type: "string" },
      },
      required: ["student_name", "teacher", "start_at"],
    },
  },
  {
    name: "update_lesson",
    description: "Edita uma aula existente. Envie apenas os campos que devem mudar. Confirme com o usuário antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        lesson_id: { type: "string" },
        student_name: { type: "string" },
        guardian_name: { type: "string" },
        teacher: { type: "string" },
        start_at: { type: "string" },
        duration_minutes: { type: "number" },
        subject: { type: "string" },
        price: { type: "number", description: "Valor POR HORA em reais (R$/h), não o total da aula" },
        is_online: { type: "boolean" },
        address: { type: "string" },
        status: { type: "string", enum: ["agendada", "cancelada", "realizada"] },
        notes: { type: "string" },
      },
      required: ["lesson_id"],
    },
  },
  {
    name: "delete_lesson",
    description: "Exclui definitivamente uma aula (e o lançamento de débito correspondente na carteira). Sempre confirme com o usuário antes de chamar - ação irreversível.",
    input_schema: {
      type: "object",
      properties: { lesson_id: { type: "string" } },
      required: ["lesson_id"],
    },
  },
  {
    name: "get_wallet_balance",
    description: "Consulta o saldo da carteira de um aluno/responsável e seus últimos lançamentos.",
    input_schema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string" },
      },
    },
  },
  {
    name: "add_wallet_credit",
    description: "Registra um pagamento/crédito na carteira (pacote de aulas ou ajuste manual). Confirme valor e conta com o usuário antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string" },
        amount: { type: "number", description: "Valor positivo em reais" },
        kind: { type: "string", enum: ["package", "adjustment"], description: "Padrão package" },
        description: { type: "string" },
      },
      required: ["student_name", "amount"],
    },
  },
  {
    name: "mark_lesson_paid",
    description: "Marca uma aula como paga. Se via_package=false (padrão), também credita o valor na carteira (pagamento avulso). Se via_package=true, apenas marca como paga sem mexer no saldo (porque já foi pago via pacote antes).",
    input_schema: {
      type: "object",
      properties: {
        lesson_id: { type: "string" },
        via_package: { type: "boolean", description: "Padrão false" },
      },
      required: ["lesson_id"],
    },
  },
  {
    name: "list_blocks",
    description: "Lista bloqueios de horário (indisponibilidade) de um professor.",
    input_schema: {
      type: "object",
      properties: { teacher: { type: "string", description: "Slug do professor" } },
    },
  },
  {
    name: "create_block",
    description: "Cria um bloqueio de horário (indisponibilidade). Recorrente (toda semana no mesmo dia/horário) ou pontual (uma data específica). Confirme com o usuário antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        teacher: { type: "string", description: "Slug do professor, ou 'both' para ambos" },
        title: { type: "string" },
        block_type: { type: "string", enum: ["recurring", "one_off"] },
        weekday: { type: "number", description: "0=domingo ... 6=sábado, obrigatório se recurring" },
        start_time: { type: "string", description: "HH:MM, obrigatório se recurring" },
        end_time: { type: "string", description: "HH:MM, obrigatório se recurring" },
        start_at: { type: "string", description: "ISO 8601, obrigatório se one_off" },
        end_at: { type: "string", description: "ISO 8601, obrigatório se one_off" },
      },
      required: ["teacher", "title", "block_type"],
    },
  },
  {
    name: "delete_block",
    description: "Remove um bloqueio de horário.",
    input_schema: {
      type: "object",
      properties: { block_id: { type: "string" } },
      required: ["block_id"],
    },
  },
];

async function executeTool(admin: ReturnType<typeof createClient>, name: string, input: any) {
  switch (name) {
    case "find_students": {
      const { data, error } = await admin
        .from("students")
        .select("id, student_name, guardian_name, address")
        .or(`student_name.ilike.%${input.query}%,guardian_name.ilike.%${input.query}%`)
        .limit(10);
      if (error) throw error;
      return data;
    }
    case "list_teachers": {
      const { data, error } = await admin.from("teachers").select("name, active").eq("active", true);
      if (error) throw error;
      return (data ?? []).map((t: any) => ({ name: t.name, slug: teacherSlug(t.name) }));
    }
    case "list_lessons": {
      let q = admin.from("lessons").select("*").gte("start_at", input.from).lt("start_at", input.to).order("start_at");
      if (input.student_name) q = q.ilike("student_name", `%${input.student_name}%`);
      if (input.teacher) q = q.eq("teacher", input.teacher);
      if (input.status) q = q.eq("status", input.status);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "create_lesson": {
      const { data, error } = await admin.from("lessons").insert({
        student_name: input.student_name,
        guardian_name: input.guardian_name ?? null,
        teacher: input.teacher,
        start_at: input.start_at,
        duration_minutes: input.duration_minutes ?? 60,
        subject: input.subject ?? null,
        price: input.price ?? 220,
        package_type: input.package_type ?? "avulsa",
        is_online: !!input.is_online,
        address: input.address ?? null,
        notes: input.notes ?? null,
      }).select().single();
      if (error) throw error;
      return data;
    }
    case "update_lesson": {
      const { lesson_id, ...fields } = input;
      const { data, error } = await admin.from("lessons").update(fields).eq("id", lesson_id).select().single();
      if (error) throw error;
      return data;
    }
    case "delete_lesson": {
      const { error } = await admin.from("lessons").delete().eq("id", input.lesson_id);
      if (error) throw error;
      return { ok: true };
    }
    case "get_wallet_balance": {
      let q = admin.from("wallet_transactions").select("*").order("created_at", { ascending: false });
      if (input.guardian_name) q = q.eq("guardian_name", input.guardian_name);
      else if (input.student_name) q = q.ilike("student_name", `%${input.student_name}%`);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      const balance = rows.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      return { balance, recent_transactions: rows.slice(0, 15) };
    }
    case "add_wallet_credit": {
      const { data, error } = await admin.from("wallet_transactions").insert({
        student_name: input.student_name,
        guardian_name: input.guardian_name ?? null,
        amount: Math.abs(input.amount),
        kind: input.kind ?? "package",
        description: input.description ?? null,
      }).select().single();
      if (error) throw error;
      return data;
    }
    case "mark_lesson_paid": {
      const { data: lesson, error: lErr } = await admin.from("lessons").select("*").eq("id", input.lesson_id).maybeSingle();
      if (lErr) throw lErr;
      if (!lesson) throw new Error("Aula não encontrada");
      const { error: uErr } = await admin.from("lessons").update({ payment_status: "pago" }).eq("id", input.lesson_id);
      if (uErr) throw uErr;
      if (!input.via_package) {
        const { error: cErr } = await admin.from("wallet_transactions").insert({
          guardian_name: lesson.guardian_name,
          student_name: lesson.student_name,
          amount: Math.abs(Number(lesson.price)),
          kind: "adjustment",
          lesson_id: lesson.id,
          description: `Pagamento — aula em ${lesson.start_at}`,
        });
        if (cErr) throw cErr;
      }
      return { ok: true };
    }
    case "list_blocks": {
      let q = admin.from("blocks").select("*");
      if (input.teacher) q = q.eq("teacher", input.teacher);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "create_block": {
      const { data, error } = await admin.from("blocks").insert({
        teacher: input.teacher,
        title: input.title,
        block_type: input.block_type,
        weekday: input.weekday ?? null,
        start_time: input.start_time ?? null,
        end_time: input.end_time ?? null,
        start_at: input.start_at ?? null,
        end_at: input.end_at ?? null,
      }).select().single();
      if (error) throw error;
      return data;
    }
    case "delete_block": {
      const { error } = await admin.from("blocks").delete().eq("id", input.block_id);
      if (error) throw error;
      return { ok: true };
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY não configurada nas secrets da função." }, 500);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, serviceKey);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "forbidden" }, 403);

    // `messages` in Claude's own wire format: [{ role: "user"|"assistant", content: [...blocks] }]
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) return json({ error: "messages obrigatório" }, 400);

    const nowSaoPaulo = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" });

    const systemPrompt = `Você é o assistente do app "Aulas", usado por um professor de matemática/química para gerenciar aulas, alunos e financeiro (carteira).

Data e hora atuais: ${nowSaoPaulo} (America/Sao_Paulo). Use isso para interpretar datas relativas como "amanhã", "quinta que vem", etc.

Regras importantes:
- Preço e duração padrão: toda aula custa R$220,00 por hora e dura 60 minutos, a menos que o usuário diga um valor ou duração diferente. Nunca invente um valor diferente de 220/hora por conta própria.
- Antes de criar, editar, excluir uma aula, marcar pagamento ou mexer no financeiro, explique em texto o que você vai fazer (resumo claro: aluno, data/hora, valor, etc.) e só chame a ferramenta depois que o usuário confirmar na conversa. Exceção: consultas (listar, buscar, ver saldo) pode fazer direto, sem confirmar.
- Se o nome de um aluno ou professor estiver ambíguo, use find_students / list_teachers para confirmar antes de agir.
- O campo "teacher" nas ferramentas é sempre o slug (ex: "thiago", "mayara"), nunca o nome com acento/maiúscula. Use list_teachers para descobrir o slug certo.
- Ao criar uma aula, um débito na carteira do aluno/responsável é criado automaticamente pelo valor da aula - não é preciso registrar isso manualmente.
- Seja direto e conciso nas respostas, em português do Brasil.`;

    let convo = [...messages];
    let finalText = "";

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          messages: convo,
          tools,
          output_config: { effort: "low" },
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        return json({ error: `Erro da API da Claude: ${resp.status} ${errBody}` }, 502);
      }

      const result = await resp.json();

      if (result.stop_reason === "refusal") {
        const reason = result.stop_details?.category ?? "desconhecido";
        return json({ error: `A Claude recusou a resposta (motivo: ${reason}). Tente reformular a mensagem.` }, 502);
      }

      const content = result.content ?? [];
      convo.push({ role: "assistant", content });

      const toolUses = content.filter((b: any) => b.type === "tool_use");
      if (result.stop_reason !== "tool_use" || toolUses.length === 0) {
        finalText = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        break;
      }

      const toolResults = [];
      for (const block of toolUses) {
        try {
          const output = await executeTool(admin, block.name, block.input ?? {});
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) });
        } catch (e: any) {
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify({ error: String(e?.message ?? e) }), is_error: true });
        }
      }
      convo.push({ role: "user", content: toolResults });
    }

    return json({ reply: finalText, messages: convo });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

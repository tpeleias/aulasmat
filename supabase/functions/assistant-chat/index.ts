import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_TOOL_ITERATIONS = 8;

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function teacherSlug(name: string) {
  return name
    .normalize("NFD").replace(DIACRITICS_RE, "")
    .toLowerCase().trim().replace(/\s+/g, "-");
}

// ---- Tool definitions (Gemini functionDeclarations schema - OpenAPI subset, UPPERCASE types) ----
const functionDeclarations = [
  {
    name: "find_students",
    description: "Busca alunos pelo nome (do aluno ou do responsável). Use antes de criar/editar uma aula quando o nome não for exato, para confirmar qual aluno é.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "Parte do nome do aluno ou responsável" } },
      required: ["query"],
    },
  },
  {
    name: "list_teachers",
    description: "Lista os professores ativos. Retorna nome e o 'slug' que deve ser usado no campo teacher das outras ferramentas.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "list_lessons",
    description: "Lista aulas dentro de um período, opcionalmente filtrando por aluno, professor ou status.",
    parameters: {
      type: "OBJECT",
      properties: {
        from: { type: "STRING", description: "Data/hora ISO 8601 inicial (inclusive)" },
        to: { type: "STRING", description: "Data/hora ISO 8601 final (exclusive)" },
        student_name: { type: "STRING" },
        teacher: { type: "STRING", description: "Slug do professor (ex: thiago, mayara)" },
        status: { type: "STRING", enum: ["agendada", "cancelada", "realizada"] },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "create_lesson",
    description: "Cria uma nova aula agendada. Um lançamento de débito na carteira do aluno/responsável é criado automaticamente. Antes de chamar, confirme com o usuário o resumo da aula (aluno, data/hora, professor, valor).",
    parameters: {
      type: "OBJECT",
      properties: {
        student_name: { type: "STRING" },
        guardian_name: { type: "STRING", description: "Nome do responsável, se houver (usado para agrupar a carteira)" },
        teacher: { type: "STRING", description: "Slug do professor (ex: thiago, mayara)" },
        start_at: { type: "STRING", description: "Data/hora ISO 8601 de início" },
        duration_minutes: { type: "NUMBER", description: "Padrão 60 se não especificado" },
        subject: { type: "STRING", description: "Ex: Matemática, Química, Ciências" },
        price: { type: "NUMBER", description: "Valor da aula em reais" },
        package_type: { type: "STRING", enum: ["avulsa", "pacote"], description: "Padrão avulsa" },
        is_online: { type: "BOOLEAN", description: "Padrão false" },
        address: { type: "STRING", description: "Endereço da aula presencial (com complemento/apto se houver)" },
        notes: { type: "STRING" },
      },
      required: ["student_name", "teacher", "start_at", "duration_minutes", "price"],
    },
  },
  {
    name: "update_lesson",
    description: "Edita uma aula existente. Envie apenas os campos que devem mudar. Confirme com o usuário antes de chamar.",
    parameters: {
      type: "OBJECT",
      properties: {
        lesson_id: { type: "STRING" },
        student_name: { type: "STRING" },
        guardian_name: { type: "STRING" },
        teacher: { type: "STRING" },
        start_at: { type: "STRING" },
        duration_minutes: { type: "NUMBER" },
        subject: { type: "STRING" },
        price: { type: "NUMBER" },
        is_online: { type: "BOOLEAN" },
        address: { type: "STRING" },
        status: { type: "STRING", enum: ["agendada", "cancelada", "realizada"] },
        notes: { type: "STRING" },
      },
      required: ["lesson_id"],
    },
  },
  {
    name: "delete_lesson",
    description: "Exclui definitivamente uma aula (e o lançamento de débito correspondente na carteira). Sempre confirme com o usuário antes de chamar - ação irreversível.",
    parameters: {
      type: "OBJECT",
      properties: { lesson_id: { type: "STRING" } },
      required: ["lesson_id"],
    },
  },
  {
    name: "get_wallet_balance",
    description: "Consulta o saldo da carteira de um aluno/responsável e seus últimos lançamentos.",
    parameters: {
      type: "OBJECT",
      properties: {
        student_name: { type: "STRING" },
        guardian_name: { type: "STRING" },
      },
    },
  },
  {
    name: "add_wallet_credit",
    description: "Registra um pagamento/crédito na carteira (pacote de aulas ou ajuste manual). Confirme valor e conta com o usuário antes de chamar.",
    parameters: {
      type: "OBJECT",
      properties: {
        student_name: { type: "STRING" },
        guardian_name: { type: "STRING" },
        amount: { type: "NUMBER", description: "Valor positivo em reais" },
        kind: { type: "STRING", enum: ["package", "adjustment"], description: "Padrão package" },
        description: { type: "STRING" },
      },
      required: ["student_name", "amount"],
    },
  },
  {
    name: "mark_lesson_paid",
    description: "Marca uma aula como paga. Se via_package=false (padrão), também credita o valor na carteira (pagamento avulso). Se via_package=true, apenas marca como paga sem mexer no saldo (porque já foi pago via pacote antes).",
    parameters: {
      type: "OBJECT",
      properties: {
        lesson_id: { type: "STRING" },
        via_package: { type: "BOOLEAN", description: "Padrão false" },
      },
      required: ["lesson_id"],
    },
  },
  {
    name: "list_blocks",
    description: "Lista bloqueios de horário (indisponibilidade) de um professor.",
    parameters: {
      type: "OBJECT",
      properties: { teacher: { type: "STRING", description: "Slug do professor" } },
    },
  },
  {
    name: "create_block",
    description: "Cria um bloqueio de horário (indisponibilidade). Recorrente (toda semana no mesmo dia/horário) ou pontual (uma data específica). Confirme com o usuário antes de chamar.",
    parameters: {
      type: "OBJECT",
      properties: {
        teacher: { type: "STRING", description: "Slug do professor, ou 'both' para ambos" },
        title: { type: "STRING" },
        block_type: { type: "STRING", enum: ["recurring", "one_off"] },
        weekday: { type: "NUMBER", description: "0=domingo ... 6=sábado, obrigatório se recurring" },
        start_time: { type: "STRING", description: "HH:MM, obrigatório se recurring" },
        end_time: { type: "STRING", description: "HH:MM, obrigatório se recurring" },
        start_at: { type: "STRING", description: "ISO 8601, obrigatório se one_off" },
        end_at: { type: "STRING", description: "ISO 8601, obrigatório se one_off" },
      },
      required: ["teacher", "title", "block_type"],
    },
  },
  {
    name: "delete_block",
    description: "Remove um bloqueio de horário.",
    parameters: {
      type: "OBJECT",
      properties: { block_id: { type: "STRING" } },
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
        duration_minutes: input.duration_minutes,
        subject: input.subject ?? null,
        price: input.price,
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
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiKey) return json({ error: "GEMINI_API_KEY não configurada nas secrets da função." }, 500);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, serviceKey);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "forbidden" }, 403);

    // `contents` in Gemini's own wire format: [{ role: "user"|"model"|"function", parts: [...] }]
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) return json({ error: "messages obrigatório" }, 400);

    const nowSaoPaulo = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" });

    const systemPrompt = `Você é o assistente do app "Aulas", usado por um professor de matemática/química para gerenciar aulas, alunos e financeiro (carteira).

Data e hora atuais: ${nowSaoPaulo} (America/Sao_Paulo). Use isso para interpretar datas relativas como "amanhã", "quinta que vem", etc.

Regras importantes:
- Antes de criar, editar, excluir uma aula, marcar pagamento ou mexer no financeiro, explique em texto o que você vai fazer (resumo claro: aluno, data/hora, valor, etc.) e só chame a ferramenta depois que o usuário confirmar na conversa. Exceção: consultas (listar, buscar, ver saldo) pode fazer direto, sem confirmar.
- Se o nome de um aluno ou professor estiver ambíguo, use find_students / list_teachers para confirmar antes de agir.
- O campo "teacher" nas ferramentas é sempre o slug (ex: "thiago", "mayara"), nunca o nome com acento/maiúscula. Use list_teachers para descobrir o slug certo.
- Ao criar uma aula, um débito na carteira do aluno/responsável é criado automaticamente pelo valor da aula - não é preciso registrar isso manualmente.
- Seja direto e conciso nas respostas, em português do Brasil.`;

    let convo = [...messages];
    let finalText = "";

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: convo,
            tools: [{ functionDeclarations }],
          }),
        },
      );

      if (!resp.ok) {
        const errBody = await resp.text();
        return json({ error: `Erro da API do Gemini: ${resp.status} ${errBody}` }, 502);
      }

      const result = await resp.json();
      const candidate = result.candidates?.[0];

      if (!candidate) {
        const reason = result.promptFeedback?.blockReason ?? "desconhecido";
        return json({ error: `O Gemini não retornou resposta (motivo: ${reason}). Tente reformular a mensagem.` }, 502);
      }

      const parts = candidate.content?.parts ?? [];
      if (candidate.finishReason && candidate.finishReason !== "STOP" && parts.length === 0) {
        return json({ error: `Resposta interrompida pelo Gemini (motivo: ${candidate.finishReason}). Tente reformular a mensagem.` }, 502);
      }
      convo.push({ role: "model", parts });

      const functionCalls = parts.filter((p: any) => p.functionCall);
      if (functionCalls.length === 0) {
        finalText = parts.filter((p: any) => typeof p.text === "string").map((p: any) => p.text).join("\n");
        break;
      }

      const functionResponseParts = [];
      for (const p of functionCalls) {
        const { name, args } = p.functionCall;
        try {
          const output = await executeTool(admin, name, args ?? {});
          functionResponseParts.push({ functionResponse: { name, response: { name, content: output } } });
        } catch (e: any) {
          functionResponseParts.push({ functionResponse: { name, response: { name, content: { error: String(e?.message ?? e) } } } });
        }
      }
      convo.push({ role: "function", parts: functionResponseParts });
    }

    return json({ reply: finalText, messages: convo });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

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
    description: "Busca alunos já cadastrados pelo nome (do aluno ou do responsável). OBRIGATÓRIO chamar antes de create_lesson ou de update_lesson que troque o aluno — nunca crie uma aula usando um nome digitado pelo usuário sem antes checar aqui se já existe um cadastro parecido.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Parte do nome do aluno ou responsável (ex: só o primeiro nome, para pegar variações/apelidos)" } },
      required: ["query"],
    },
  },
  {
    name: "create_student",
    description: "Cadastra um novo aluno. Só chame depois de já ter usado find_students e confirmado com o usuário que é de fato um aluno novo (não um cadastro existente com nome parecido).",
    input_schema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string", description: "Nome do responsável, se houver" },
        address: { type: "string" },
      },
      required: ["student_name"],
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
        price: { type: "number", description: "Valor da aula POR HORA em reais (R$/h) — não é o total da aula, o débito na carteira é calculado como price × duração/60. Use sempre 220, inclusive para aluno de pacote (o desconto do pacote entra como voucher no financeiro)." },
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
    description: "Registra dinheiro recebido de um responsável/aluno (Pix, pacote, etc.) e, se for o caso, o voucher de desconto junto. As aulas em aberto da conta são quitadas automaticamente, das mais antigas para as mais novas; o que sobrar fica como crédito. É a ÚNICA forma de marcar aulas como pagas. Confirme valor e conta com o usuário antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string" },
        amount: { type: "number", description: "Dinheiro recebido, valor positivo em reais. Use 0 para lançar só um voucher." },
        kind: { type: "string", enum: ["package", "adjustment"], description: "Padrão package" },
        description: { type: "string" },
        voucher_amount: { type: "number", description: "Voucher de desconto lançado junto, em reais (crédito, sempre positivo). Pacote de 10 aulas: 200. Pacote de 5 aulas: 50. Sem pacote: 0." },
        voucher_description: { type: "string", description: "Motivo do voucher, ex: 'Voucher pacote 10 aulas'" },
      },
      required: ["student_name", "amount"],
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

// A credit filed under the wrong guardian silently lands in a different wallet than the
// lesson debits, so always resolve a name to exactly one cadastro before touching money.
// Named for the student it resolves, not for accountId: "account" means the company
// everywhere else, and this runs with the service key, where confusing the two leaks data.
async function resolveStudent(
  admin: ReturnType<typeof createClient>,
  accountId: string,
  studentName?: string,
  guardianName?: string,
): Promise<{ student_name: string; guardian_name: string | null } | { error: string }> {
  if (!studentName && !guardianName) return { error: "Informe o aluno ou o responsável." };

  let q = admin.from("students").select("student_name, guardian_name").eq("account_id", accountId);
  if (studentName) q = q.ilike("student_name", `%${studentName.trim()}%`);
  if (guardianName) q = q.ilike("guardian_name", `%${guardianName.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;

  const matches = data ?? [];
  if (matches.length === 1) {
    return {
      student_name: matches[0].student_name,
      guardian_name: (matches[0].guardian_name ?? "").trim() || null,
    };
  }
  if (matches.length === 0) {
    return { error: `Nenhum aluno cadastrado corresponde a "${studentName ?? guardianName}". Confirme o nome com find_students.` };
  }
  return {
    error: `Mais de um cadastro corresponde a "${studentName ?? guardianName}": ${matches
      .map((m: any) => `${m.student_name} (resp.: ${m.guardian_name ?? "sem responsável"})`)
      .join("; ")}. Pergunte ao usuário qual é antes de prosseguir.`,
  };
}

// Todo acesso ao banco aqui usa a chave mestra, que ignora as regras de acesso do
// Postgres. Por isso cada consulta precisa dizer explicitamente de qual empresa é:
// o filtro que existe para o resto do app não vale para esta função.
async function executeTool(admin: ReturnType<typeof createClient>, accountId: string, name: string, input: any) {
  switch (name) {
    case "find_students": {
      const { data, error } = await admin
        .from("students")
        .select("id, student_name, guardian_name, address")
        .eq("account_id", accountId)
        .or(`student_name.ilike.%${input.query}%,guardian_name.ilike.%${input.query}%`)
        .limit(10);
      if (error) throw error;
      return data;
    }
    case "create_student": {
      const { data, error } = await admin.from("students").insert({
        account_id: accountId,
        student_name: (input.student_name ?? "").trim(),
        guardian_name: (input.guardian_name ?? "").trim() || null,
        address: (input.address ?? "").trim() || null,
      }).select().single();
      if (error) throw error;
      return data;
    }
    case "list_teachers": {
      const { data, error } = await admin.from("teachers").select("name, active")
        .eq("account_id", accountId).eq("active", true);
      if (error) throw error;
      return (data ?? []).map((t: any) => ({ name: t.name, slug: teacherSlug(t.name) }));
    }
    case "list_lessons": {
      let q = admin.from("lessons").select("*").eq("account_id", accountId)
        .gte("start_at", input.from).lt("start_at", input.to).order("start_at");
      if (input.student_name) q = q.ilike("student_name", `%${input.student_name}%`);
      if (input.teacher) q = q.eq("teacher", input.teacher);
      if (input.status) q = q.eq("status", input.status);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "create_lesson": {
      // Without the guardian the lesson lands in a separate wallet from the student's
      // other lessons, so fill it in from the cadastro whenever the name is unambiguous.
      let guardian = (input.guardian_name ?? "").trim() || null;
      if (!guardian) {
        const student = await resolveStudent(admin, accountId, input.student_name);
        if (!("error" in student)) guardian = student.guardian_name;
      }
      const { data, error } = await admin.from("lessons").insert({
        account_id: accountId,
        student_name: (input.student_name ?? "").trim(),
        guardian_name: guardian,
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
      // O filtro por empresa aqui não é redundante: o id vem da conversa, e sem ele
      // bastaria um id de outra empresa para editar a aula dela.
      const { lesson_id, ...fields } = input;
      const { data, error } = await admin.from("lessons").update(fields)
        .eq("id", lesson_id).eq("account_id", accountId).select().single();
      if (error) throw error;
      return data;
    }
    case "delete_lesson": {
      const { error } = await admin.from("lessons").delete()
        .eq("id", input.lesson_id).eq("account_id", accountId);
      if (error) throw error;
      return { ok: true };
    }
    case "get_wallet_balance": {
      const student = await resolveStudent(admin, accountId, input.student_name, input.guardian_name);
      if ("error" in student) return student;
      let q = admin.from("wallet_transactions").select("*")
        .eq("account_id", accountId)
        .eq("student_name", student.student_name)
        .order("created_at", { ascending: false });
      q = student.guardian_name ? q.eq("guardian_name", student.guardian_name) : q.is("guardian_name", null);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      const balance = rows.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
      return { account: student, balance, recent_transactions: rows.slice(0, 15) };
    }
    case "add_wallet_credit": {
      const student = await resolveStudent(admin, accountId, input.student_name, input.guardian_name);
      if ("error" in student) return student;
      const money = Math.abs(Number(input.amount ?? 0));
      const voucher = Math.abs(Number(input.voucher_amount ?? 0));
      if (money === 0 && voucher === 0) return { error: "Informe o valor recebido ou o valor do voucher." };
      // Money and voucher are written in one transaction so a package is never half-registered.
      const { data, error } = await admin.rpc("register_payment", {
        _account: accountId,
        _student: student.student_name,
        _guardian: student.guardian_name,
        _amount: money,
        _kind: input.kind ?? "package",
        _description: input.description ?? null,
        _voucher: voucher,
        _voucher_description: input.voucher_description ?? null,
      });
      if (error) throw error;
      return { account: student, received: money, voucher, ids: data };
    }
    case "list_blocks": {
      let q = admin.from("blocks").select("*").eq("account_id", accountId);
      if (input.teacher) q = q.eq("teacher", input.teacher);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }
    case "create_block": {
      const { data, error } = await admin.from("blocks").insert({
        account_id: accountId,
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
      const { error } = await admin.from("blocks").delete()
        .eq("id", input.block_id).eq("account_id", accountId);
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
    const { data: roleRow } = await admin.from("user_roles").select("role, account_id").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "forbidden" }, 403);

    // Sem empresa não há como limitar o que as ferramentas alcançam, e esta função
    // roda com a chave mestra. Recusar é a única resposta segura.
    const accountId = roleRow.account_id as string | null;
    if (!accountId) return json({ error: "Usuário sem empresa associada." }, 403);

    // `messages` in Claude's own wire format: [{ role: "user"|"assistant", content: [...blocks] }]
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) return json({ error: "messages obrigatório" }, 400);

    const nowSaoPaulo = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" });

    const systemPrompt = `Você é o assistente do app "Aulas", usado por um professor de matemática/química para gerenciar aulas, alunos e financeiro (carteira).

Data e hora atuais: ${nowSaoPaulo} (America/Sao_Paulo). Use isso para interpretar datas relativas como "amanhã", "quinta que vem", etc.

Regras importantes:
- Preço e duração padrão: TODA aula custa R$220,00 por hora e dura 60 minutos, a menos que o usuário diga um valor ou duração diferente. Isso vale inclusive para alunos de pacote — nunca lance uma aula com valor menor por causa de pacote.
- Antes de criar, editar, excluir uma aula, marcar pagamento ou mexer no financeiro, explique em texto o que você vai fazer (resumo claro: aluno, data/hora, valor, etc.) e só chame a ferramenta depois que o usuário confirmar na conversa. Exceção: consultas (listar, buscar, ver saldo) pode fazer direto, sem confirmar.
- O campo "teacher" nas ferramentas é sempre o slug (ex: "thiago", "mayara"), nunca o nome com acento/maiúscula. Use list_teachers para descobrir o slug certo.
- Financeiro: toda aula realizada vira uma cobrança automática pelo valor cheio. Para dar baixa, registre o dinheiro recebido com add_wallet_credit — o sistema quita as aulas mais antigas primeiro e o status "pago"/"pendente" de cada aula é calculado sozinho (não existe marcação manual). Use get_wallet_balance para saber quanto uma conta deve.
- Pacotes funcionam por VOUCHER, nunca por desconto no valor da aula. Pacote de 10 aulas: amount 2000 e voucher_amount 200 (10 x R$220 = R$2.200 = R$2.000 + R$200). Pacote de 5 aulas: amount 1050 e voucher_amount 50 (5 x R$220 = R$1.100 = R$1.050 + R$50). Assim a conta fecha exata e não sobra diferença.
- Voucher avulso (desconto ou cortesia combinada pelo professor): add_wallet_credit com amount 0 e voucher_amount igual ao desconto. Voucher é sempre crédito para o aluno, nunca cobrança.
- Seja direto e conciso nas respostas, em português do Brasil.

Protocolo OBRIGATÓRIO de identificação do aluno (nunca pule isso ao criar ou editar uma aula):
1. Sempre chame find_students com o nome (ou parte dele, ex: só o primeiro nome) que o usuário mencionou — mesmo que pareça óbvio ou exato. Nomes digitados por voz/mensagem frequentemente vêm incompletos ou abreviados (ex: usuário diz "Testinho", cadastro é "Testinho Jr").
2. Resultado com exatamente 1 aluno cujo nome bate (igual, abreviado ou variação clara do que foi dito): use o student_name e guardian_name EXATOS como estão cadastrados (não o texto que o usuário digitou). Mencione isso ao confirmar (ex: "vou marcar com o Testinho Jr, é esse?").
3. Resultado com 2 ou mais alunos que podem corresponder (ex: dois "Miguel"): PARE e pergunte ao usuário qual deles é, listando nome + responsável de cada opção. Não crie nem edite nada até a resposta.
4. Resultado vazio (nenhum cadastro parecido): avise o usuário que não achou esse aluno cadastrado e pergunte se é um aluno novo. Se ele confirmar que sim, colete os dados (nome completo, responsável se houver) e chame create_student antes de criar a aula. Nunca cadastre um aluno novo sem confirmação explícita — pode ser só um erro de digitação de um aluno que já existe.
5. Nunca chame create_lesson ou update_lesson (trocando aluno) usando um nome que não veio de find_students (já existente) ou de create_student (recém-criado).`;

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
          const output = await executeTool(admin, accountId, block.name, block.input ?? {});
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

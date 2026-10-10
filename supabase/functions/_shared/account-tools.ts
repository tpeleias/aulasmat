// Ferramentas do Cronys sobre UMA empresa: o assistente do app
// (assistant-chat) e o conector de IA (mcp) usam as mesmas.
//
// Rodam com a chave mestra, que ignora as regras de acesso do Postgres: cada
// consulta filtra pela empresa (accountId) de quem chamou. Quem chama já
// conferiu que a pessoa é administradora dessa empresa.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Sem os tipos gerados do banco: o cliente aceita qualquer tabela.
// deno-lint-ignore no-explicit-any
export type Admin = SupabaseClient<any, "public", any>;

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

export function teacherSlug(name: string) {
  return name
    .normalize("NFD").replace(DIACRITICS_RE, "")
    .toLowerCase().trim().replace(/\s+/g, "-");
}

// ---- Tool definitions (Claude Messages API tool schema - JSON Schema input_schema) ----
export const tools = [
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
        status: { type: "string", enum: ["solicitada", "agendada", "realizada", "recusada", "cancelada"] },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "create_lesson",
    description: "Cria uma nova aula JÁ AGENDADA (aula criada pelo professor não passa por aprovação; só o pedido feito pelo aluno no portal nasce como 'solicitada'). Um lançamento de débito na carteira do aluno/responsável é criado automaticamente. Antes de chamar, confirme com o usuário o resumo da aula (aluno, data/hora, professor, valor).",
    input_schema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string", description: "Nome do responsável, se houver (usado para agrupar a carteira)" },
        teacher: { type: "string", description: "Slug do professor (ex: thiago, mayara)" },
        start_at: { type: "string", description: "Data/hora ISO 8601 de início" },
        duration_minutes: { type: "number", description: "Em minutos. Se não especificado pelo usuário, use 60 (padrão)." },
        subject: { type: "string", description: "Ex: Matemática, Química, Ciências" },
        price: { type: "number", description: "Valor da aula POR HORA em reais (R$/h) — não é o total da aula, o débito na carteira é calculado como price × duração/60. OMITA este campo: sem ele o sistema usa o valor de aula configurado pela empresa. Só informe quando o professor pedir um valor diferente para esta aula específica. Nunca baixe o valor por causa de pacote ou de desconto — os dois entram como voucher no financeiro." },
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
        status: { type: "string", enum: ["solicitada", "agendada", "realizada", "recusada", "cancelada"], description: "Para responder um pedido do aluno: 'agendada' aprova, 'recusada' recusa e devolve o horário para a vitrine." },
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
    description: "Registra dinheiro recebido de um responsável/aluno (Pix, cartão, pagamento de um pacote já vendido) e, se for o caso, um voucher de desconto. As cobranças em aberto da conta são quitadas automaticamente, das mais antigas para as mais novas; o que sobrar fica como crédito. NÃO use para vender pacote: para isso existe sell_package. Confirme valor e conta com o usuário antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string" },
        amount: { type: "number", description: "Dinheiro recebido, valor positivo em reais. Use 0 para lançar só um voucher." },
        kind: { type: "string", enum: ["adjustment"], description: "Sempre adjustment (pacote se vende com sell_package)" },
        description: { type: "string" },
        voucher_amount: { type: "number", description: "Voucher de desconto lançado junto, em reais (crédito, sempre positivo). A partir do Cronys Start." },
        voucher_description: { type: "string", description: "Motivo do voucher, ex: 'Desconto combinado'" },
      },
      required: ["student_name", "amount"],
    },
  },
  {
    name: "sell_package",
    description: "Vende um pacote cadastrado (Configurações → Pacotes) para a conta: ela ganha N aulas, e cada aula realizada gasta uma (uma aula com o dobro da duração gasta duas), começando pelas que estão em aberto. O valor do pacote entra como cobrança; paid_amount é o que já foi recebido agora (0 se vai pagar depois). Confirme o pacote, a conta e o valor recebido com o usuário antes de chamar.",
    input_schema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string" },
        package_name: { type: "string", description: "Nome do pacote cadastrado, ex: 'Pacote 10 aulas'" },
        paid_amount: { type: "number", description: "Dinheiro recebido agora, em reais. 0 se ainda não pagou." },
      },
      required: ["student_name", "package_name"],
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

// A constraint lessons_sem_sobreposicao (23P01) impede duas aulas no mesmo horário do
// mesmo professor. A mensagem crua do Postgres não serve para o assistente repetir ao
// professor, então vira um texto que ele pode ler em voz alta.
function slotConflict(error: { code?: string; message?: string }): { error: string } | null {
  const conflito = error.code === "23P01" || (error.message ?? "").includes("lessons_sem_sobreposicao");
  if (!conflito) return null;
  return { error: "Esse horário já está ocupado para este professor. Escolha outro horário ou cancele a aula que já está lá." };
}

// A credit filed under the wrong guardian silently lands in a different wallet than the
// lesson debits, so always resolve a name to exactly one cadastro before touching money.
// Named for the student it resolves, not for accountId: "account" means the company
// everywhere else, and this runs with the service key, where confusing the two leaks data.
async function resolveStudent(
  admin: Admin,
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
export async function executeTool(admin: Admin, accountId: string, name: string, input: any) {
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
      // O limite de alunos do plano vem como erro do banco (23514). Devolver
      // como resultado deixa o assistente explicar em vez de estourar.
      if (error) return { error: error.message };
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
        // Sem preço, o banco preenche com o valor da empresa (gatilho
        // lessons_fill_price). Cravar 220 aqui carimbava o preço do Thiago
        // dentro da aula de qualquer outra empresa.
        ...(input.price != null ? { price: Number(input.price) } : {}),
        package_type: input.package_type ?? "avulsa",
        is_online: !!input.is_online,
        address: input.address ?? null,
        notes: input.notes ?? null,
      }).select().single();
      // O banco recusa duas aulas no mesmo horário do mesmo professor. Devolver
      // isso como resultado, e não como exceção, deixa o assistente explicar o
      // conflito ao professor em vez de estourar a conversa.
      if (error) return slotConflict(error) ?? { error: error.message };
      return data;
    }
    case "update_lesson": {
      // O filtro por empresa aqui não é redundante: o id vem da conversa, e sem ele
      // bastaria um id de outra empresa para editar a aula dela.
      const { lesson_id, ...fields } = input;
      const { data, error } = await admin.from("lessons").update(fields)
        .eq("id", lesson_id).eq("account_id", accountId).select().single();
      if (error) return slotConflict(error) ?? { error: error.message };
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
        _kind: "adjustment",
        _description: input.description ?? null,
        _voucher: voucher,
        _voucher_description: input.voucher_description ?? null,
      });
      // Pacote e voucher são do Cronys Pro: o banco recusa e a mensagem dele já
      // explica. Devolver como resultado deixa o assistente repassar isso.
      if (error) return { error: error.message };
      return { account: student, received: money, voucher, ids: data };
    }
    case "sell_package": {
      const student = await resolveStudent(admin, accountId, input.student_name, input.guardian_name);
      if ("error" in student) return student;
      const { data: pkgs } = await admin.from("lesson_packages").select("id, name, lessons, price, active").eq("account_id", accountId);
      const wanted = String(input.package_name ?? "").trim().toLowerCase();
      const pkg = (pkgs ?? []).find((p: any) => p.name.trim().toLowerCase() === wanted)
        ?? (pkgs ?? []).find((p: any) => p.active && p.name.toLowerCase().includes(wanted));
      if (!pkg) return { error: `Pacote "${input.package_name}" não encontrado. Pacotes cadastrados: ${(pkgs ?? []).map((p: any) => p.name).join(", ") || "nenhum"}.` };
      const { data, error } = await admin.rpc("sell_package", {
        _account: accountId,
        _student: student.student_name,
        _guardian: student.guardian_name,
        _package: pkg.id,
        _paid: Math.abs(Number(input.paid_amount ?? 0)),
      });
      if (error) return { error: error.message };
      return { account: student, package: pkg.name, lessons: pkg.lessons, price: pkg.price, paid: Number(input.paid_amount ?? 0), ids: data };
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
      // Bloqueio recorrente é do Cronys Pro; o banco recusa com a explicação.
      if (error) return { error: error.message };
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


// Conector de IA do Cronys (11/10): um servidor MCP para o Claude, o ChatGPT
// ou qualquer IA que aceite conector, falando com UMA empresa (ou com o
// painel do gestor).
//
// O endereço leva a chave criada em Configurações → Conectar IA:
//   https://<projeto>.supabase.co/functions/v1/mcp/crn_xxxx
// (ou a chave no cabeçalho Authorization: Bearer crn_xxxx). O banco só guarda
// o hash; ai_connector_resolve diz de quem é a chave e se ainda vale.
//
// Protocolo: MCP por HTTP ("Streamable HTTP"), sem sessão: cada POST traz uma
// mensagem JSON-RPC e a resposta vem em JSON. Não abre fluxo SSE (GET = 405),
// que o protocolo permite.
//
// Esta função não chama a API da Claude: quem pensa é a IA da pessoa, que
// paga a própria conta. Aqui só se executam as ferramentas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type Admin, executeTool, tools as accountTools } from "../_shared/account-tools.ts";
import { MONTHLY, type PaidPlanId } from "../_shared/plans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TZ = "America/Sao_Paulo";

type Conn = { id: string; scope: "account" | "platform"; account_id: string | null; read_only: boolean; user_id: string };
type ToolDef = {
  name: string; title: string; description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean };
};

// ---------------------------------------------------------------------------
// Ferramentas da empresa: as do assistente (menos as que apagam, que por um
// conector ficam de fora) e mais as que só fazem sentido aqui (resumo, quem
// deve, "Como foi?", materiais e tarefas).
// ---------------------------------------------------------------------------
const READ_TOOLS = new Set(["find_students", "list_teachers", "list_lessons", "get_wallet_balance", "list_blocks"]);
const LEFT_OUT = new Set(["delete_lesson", "delete_block"]);
const TITLES: Record<string, string> = {
  find_students: "Buscar clientes", create_student: "Cadastrar cliente", list_teachers: "Profissionais",
  list_lessons: "Agenda", create_lesson: "Marcar atendimento", update_lesson: "Editar atendimento",
  get_wallet_balance: "Saldo de uma conta", add_wallet_credit: "Registrar pagamento", sell_package: "Vender pacote",
  list_blocks: "Bloqueios de horário", create_block: "Bloquear horário",
};

const EXTRA_ACCOUNT_TOOLS: ToolDef[] = [
  {
    name: "account_summary",
    title: "Resumo da empresa",
    description: "Visão geral da empresa no Cronys: nome, plano, data e hora atuais no fuso dela, quantos clientes, atendimentos da semana e do mês por status, quanto entrou no mês, quanto está em aberto e quais atendimentos realizados nos últimos 14 dias estão sem \"Como foi?\". Bom ponto de partida para qualquer pedido.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "open_balances",
    title: "Quem está devendo",
    description: "Lista as contas (família ou cliente sozinho) com saldo negativo, da maior dívida para a menor, com os clientes de cada conta e a data do último lançamento. O saldo segue o financeiro do Cronys: atendimento realizado é cobrança, pagamento e voucher são crédito.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Quantas contas, padrão 50, no máximo 200" } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "set_lesson_summary",
    title: "Escrever o \"Como foi?\"",
    description: "Escreve o resumo do atendimento (o campo \"Como foi?\") de um atendimento já marcado. Ache o lesson_id com list_lessons antes. Se a empresa ligou o aviso por e-mail, a família recebe o resumo uns 10 minutos depois: por isso mostre o texto final ao usuário e só grave depois que ele confirmar. Escreva em português, em tom profissional e gentil, sem inventar nada que não esteja nas anotações.",
    inputSchema: {
      type: "object",
      properties: {
        lesson_id: { type: "string" },
        summary: { type: "string", description: "Texto do resumo, até 4000 caracteres" },
        mode: { type: "string", enum: ["replace", "append"], description: "replace troca o resumo que existir (padrão); append acrescenta no fim" },
      },
      required: ["lesson_id", "summary"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "list_student_materials",
    title: "Materiais e tarefas do aluno",
    description: "Lista os materiais (arquivo, link ou página) e as tarefas de um aluno, com prazo e situação. Use antes de mandar algo, para não repetir.",
    inputSchema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string", description: "Responsável, se houver mais de um aluno com o mesmo nome" },
      },
      required: ["student_name"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "send_material",
    title: "Mandar material ao aluno",
    description: "Põe um material na área do aluno no Cronys (ele vê no portal e no app). Mande UM destes: (1) content: o material escrito por você em Markdown, com fórmulas em LaTeX entre $...$ ou $$...$$ (listas de exercícios, resumos, gabaritos) - o aluno lê no portal e salva em PDF; é o jeito preferido; (2) url: um link (Google Drive, YouTube, site), que precisa estar aberto para quem tem o link; (3) file_base64 + file_name: um arquivo pequeno (PDF, imagem, Word, até 4 MB) em base64. Mostre ao usuário o título e um resumo do que vai mandar e espere a confirmação. Não invente gabarito sem conferir.",
    inputSchema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string" },
        title: { type: "string", description: "Título que o aluno vê, ex.: 'Lista 3 - Frações'" },
        content: { type: "string", description: "Markdown com fórmulas $...$ (até 30 mil caracteres)" },
        url: { type: "string", description: "Link https:// do material" },
        file_base64: { type: "string", description: "Arquivo em base64 (até 4 MB depois de decodificado)" },
        file_name: { type: "string", description: "Nome do arquivo com extensão, ex.: lista3.pdf" },
      },
      required: ["student_name", "title"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "add_task",
    title: "Passar tarefa ao aluno",
    description: "Cria uma tarefa para o aluno, com prazo. Ele recebe o aviso (e-mail e celular, se ligados) e entrega pelo portal. Se a tarefa usa um material, mande o material antes com send_material e passe o id dele em material_id: no portal, a tarefa abre o material. Confirme título, prazo e aluno com o usuário antes.",
    inputSchema: {
      type: "object",
      properties: {
        student_name: { type: "string" },
        guardian_name: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        deadline: { type: "string", description: "Prazo em ISO 8601 com -03:00, ex.: 2026-10-17T23:59:00-03:00" },
        material_id: { type: "string", description: "Opcional: id do material da tarefa (vem na resposta do send_material ou do list_student_materials)" },
      },
      required: ["student_name", "title", "deadline"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
];

function accountToolList(readOnly: boolean): ToolDef[] {
  const shared: ToolDef[] = accountTools
    .filter(t => !LEFT_OUT.has(t.name) && (!readOnly || READ_TOOLS.has(t.name)))
    .map(t => ({
      name: t.name,
      title: TITLES[t.name] ?? t.name,
      description: t.description,
      inputSchema: t.input_schema as Record<string, unknown>,
      annotations: READ_TOOLS.has(t.name)
        ? { readOnlyHint: true, openWorldHint: false }
        : { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }));
  const extra = EXTRA_ACCOUNT_TOOLS.filter(t => !readOnly || t.annotations.readOnlyHint);
  return [...extra, ...shared];
}

const ACCOUNT_INSTRUCTIONS = `Você está ligado ao Cronys, o app de agenda e financeiro de uma empresa de atendimentos (aulas particulares, consultas, sessões...). As ferramentas falam em professor/aula/aluno, mas a empresa pode usar outras palavras (médico/consulta/paciente etc.): fale com o usuário nas palavras dele.

Regras:
- Comece por account_summary quando precisar se situar (data de hoje, plano, números).
- Horários: a empresa está no fuso America/Sao_Paulo (-03:00). Mande datas ISO com esse fuso.
- Para achar um cliente, use find_students com parte do nome; se vier mais de um, pergunte qual é. Nunca cadastre cliente novo sem o usuário confirmar.
- Antes de marcar, editar, registrar pagamento, vender pacote, bloquear horário ou escrever um "Como foi?", mostre o que vai fazer e espere o usuário confirmar. Consultas podem ser feitas direto.
- O campo teacher é o slug do profissional (veja list_teachers).
- Não omita nem invente valores: sem price, o Cronys usa o valor configurado pela empresa. Pacote e desconto ficam no financeiro, nunca baixando o valor da aula.
- Materiais e tarefas: para mandar uma lista, um resumo ou um gabarito, escreva em Markdown com fórmulas $...$ e use send_material com content (o aluno lê e salva em PDF). Para tarefa com prazo, add_task. Confirme antes.
- Excluir atendimento, bloqueio, material ou tarefa não é possível por aqui: oriente o usuário a fazer pelo app.
- Os dados são de clientes reais da empresa: use só para o que o usuário pediu.`;

// ---------------------------------------------------------------------------
// Ferramentas do gestor: os números do painel, nunca dados de cliente.
// ---------------------------------------------------------------------------
const PLATFORM_TOOLS: ToolDef[] = [
  {
    name: "platform_overview",
    title: "Números do Cronys",
    description: "Números da plataforma Cronys para o gestor: empresas no total e ativas, por plano e por situação da assinatura, testes grátis acabando nos próximos 7 dias, empresas novas em 7 e 30 dias, receita mensal estimada (MRR, pelos preços mensais em real) e gasto do assistente de IA no mês. Só contagens: nenhum nome de cliente das empresas.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "platform_companies",
    title: "Empresas do Cronys",
    description: "Lista as empresas que usam o Cronys, com plano, situação da assinatura, fim do teste, ramo, criação, último atendimento marcado, quantidade de clientes, profissionais, atendimentos e logins, e uso do assistente no mês. Filtros opcionais por plano, situação ou parte do nome.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", enum: ["essencial", "start", "pro_solo", "pro"], description: "pro_solo é o Pro; pro é o Max" },
        billing_status: { type: "string", description: "Ex.: active, trialing, past_due, canceled, none" },
        search: { type: "string", description: "Parte do nome ou do código da empresa" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const PLATFORM_INSTRUCTIONS = `Você está ligado ao painel do gestor do Cronys (o app de agenda e financeiro para profissionais e empresas de atendimento). Aqui há só números e a lista das empresas assinantes, nunca dados dos clientes delas. Planos: essencial (grátis), start, pro_solo (vendido como "Pro") e pro (vendido como "Max"). Use os números para análises de negócio (crescimento, conversão de teste em assinatura, risco de cancelamento, prioridades de marketing e vendas) e deixe claro o que é estimativa.`;

// ---------------------------------------------------------------------------

function rpcResult(id: unknown, result: unknown) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id: unknown, code: number, message: string) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }
function text(obj: unknown, isError = false) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 1) }], ...(isError ? { isError: true } : {}) };
}

function tokenOf(req: Request): string | null {
  const seg = new URL(req.url).pathname.split("/").filter(Boolean).find(s => s.startsWith("crn_"));
  if (seg) return seg;
  const m = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(crn_[0-9a-f]+)$/i);
  return m ? m[1] : null;
}

const spDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

async function accountSummary(admin: Admin, accountId: string) {
  const now = new Date();
  const today = spDate(now);
  const monthStart = `${today.slice(0, 7)}-01T00:00:00-03:00`;
  const dow = new Date(`${today}T12:00:00-03:00`).getUTCDay();
  const weekStart = new Date(new Date(`${today}T00:00:00-03:00`).getTime() - ((dow + 6) % 7) * 86400000);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const nextMonth = new Date(`${today.slice(0, 7)}-01T00:00:00-03:00`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const since14 = new Date(now.getTime() - 14 * 86400000).toISOString();

  const [acct, students, monthLessons, weekLessons, payments, owed, noSummary] = await Promise.all([
    admin.from("accounts").select("name, slug, plan, billing_status, trial_ends_at, currency, business_model").eq("id", accountId).maybeSingle(),
    admin.from("students").select("id", { count: "exact", head: true }).eq("account_id", accountId),
    admin.from("lessons").select("status").eq("account_id", accountId).gte("start_at", monthStart).lt("start_at", nextMonth.toISOString()),
    admin.from("lessons").select("status").eq("account_id", accountId).gte("start_at", weekStart.toISOString()).lt("start_at", weekEnd.toISOString()),
    admin.from("wallet_transactions").select("amount").eq("account_id", accountId).in("kind", ["adjustment", "package"]).gt("amount", 0).gte("created_at", monthStart),
    admin.rpc("ai_open_balances", { _account: accountId }),
    admin.from("lessons").select("id, start_at, student_name, teacher").eq("account_id", accountId).eq("status", "realizada")
      .gte("start_at", since14).lte("start_at", now.toISOString()).or("class_summary.is.null,class_summary.eq.").order("start_at", { ascending: false }).limit(30),
  ]);
  const byStatus = (rows: { status: string }[] | null) =>
    (rows ?? []).reduce((m: Record<string, number>, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {});
  const sum = (rows: { amount: number }[] | null) => Math.round((rows ?? []).reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  const owedRows = (owed.data ?? []) as { saldo: number }[];
  return {
    empresa: acct.data?.name, codigo: acct.data?.slug, plano: acct.data?.plan, assinatura: acct.data?.billing_status,
    teste_ate: acct.data?.trial_ends_at, moeda: acct.data?.currency ?? "BRL", ramo: acct.data?.business_model,
    agora: now.toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "full", timeStyle: "short" }), fuso: TZ,
    clientes_cadastrados: students.count ?? 0,
    atendimentos_semana: byStatus(weekLessons.data as { status: string }[] | null),
    atendimentos_mes: byStatus(monthLessons.data as { status: string }[] | null),
    recebido_no_mes: sum(payments.data as { amount: number }[] | null),
    em_aberto: { contas: owedRows.length, total: Math.round(owedRows.reduce((s, r) => s - Number(r.saldo), 0) * 100) / 100 },
    realizados_sem_como_foi_14_dias: noSummary.data ?? [],
  };
}

// Acha UM aluno da empresa pelo nome (e responsável, se vier). Materiais e
// tarefas são do cadastro (students.id), não do nome.
async function findStudent(admin: Admin, accountId: string, input: Record<string, unknown>) {
  const name = String(input.student_name ?? "").trim();
  if (!name) return { error: "Informe o aluno." } as const;
  let q = admin.from("students").select("id, student_name, guardian_name").eq("account_id", accountId).ilike("student_name", `%${name}%`);
  const g = String(input.guardian_name ?? "").trim();
  if (g) q = q.ilike("guardian_name", `%${g}%`);
  const { data, error } = await q.limit(10);
  if (error) return { error: error.message } as const;
  const rows = (data ?? []) as { id: string; student_name: string; guardian_name: string | null }[];
  const exact = rows.filter(r => r.student_name.trim().toLowerCase() === name.toLowerCase());
  const pick = exact.length === 1 ? exact : rows;
  if (pick.length === 1) return { student: pick[0] } as const;
  if (pick.length === 0) return { error: `Nenhum aluno com o nome "${name}". Confira com find_students.` } as const;
  return { error: `Mais de um aluno corresponde a "${name}": ${pick.map(r => `${r.student_name} (resp.: ${r.guardian_name ?? "sem responsável"})`).join("; ")}. Pergunte qual é e mande guardian_name.` } as const;
}

const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", mp3: "audio/mpeg", m4a: "audio/mp4",
};
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function safeFileName(n: string) {
  return n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-80) || "arquivo";
}

async function sendMaterial(admin: Admin, conn: Conn, input: Record<string, unknown>) {
  const accountId = conn.account_id!;
  const found = await findStudent(admin, accountId, input);
  if ("error" in found) return text({ error: found.error }, true);
  const st = found.student;
  const title = String(input.title ?? "").trim().slice(0, 200);
  if (!title) return text({ error: "Dê um título ao material." }, true);
  const content = typeof input.content === "string" ? input.content.trim() : "";
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const b64 = typeof input.file_base64 === "string" ? input.file_base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";
  if ([content, url, b64].filter(Boolean).length !== 1) return text({ error: "Mande só um: content, url ou file_base64." }, true);

  const base = { account_id: accountId, student_id: st.id, title, uploaded_by: conn.user_id };
  let row: Record<string, unknown>;
  if (content) {
    if (content.length > 30000) return text({ error: "O texto passa de 30 mil caracteres. Divida em dois materiais." }, true);
    row = { ...base, kind: "page", content };
  } else if (url) {
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return text({ error: "O link precisa começar com https://." }, true);
    row = { ...base, kind: "link", url };
  } else {
    const name = safeFileName(String(input.file_name ?? "").trim() || `${title}.pdf`);
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const type = FILE_TYPES[ext];
    if (!type) return text({ error: `Tipo de arquivo não aceito (.${ext}). Aceitos: ${Object.keys(FILE_TYPES).join(", ")}.` }, true);
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch { return text({ error: "O base64 do arquivo veio quebrado." }, true); }
    if (bytes.length === 0) return text({ error: "O arquivo veio vazio." }, true);
    if (bytes.length > MAX_FILE_BYTES) return text({ error: "O arquivo passa de 4 MB. Mande como link (Google Drive) ou suba pelo app." }, true);
    const path = `${st.id}/${Date.now()}-${name}`;
    const { error: upErr } = await admin.storage.from("student-materials").upload(path, bytes, { contentType: type, upsert: false });
    if (upErr) return text({ error: `Não deu para guardar o arquivo: ${upErr.message}` }, true);
    row = { ...base, kind: "file", file_path: path, file_type: type };
  }
  const { data, error } = await admin.from("student_materials").insert(row).select("id, title, kind, created_at").single();
  if (error) return text({ error: error.message }, true);
  return text({ ok: true, aluno: st.student_name, material: data, onde_ver: "Portal do aluno → Materiais" });
}

async function addTask(admin: Admin, conn: Conn, input: Record<string, unknown>) {
  const accountId = conn.account_id!;
  const { data: on } = await admin.rpc("account_tasks_on", { _account: accountId });
  if (on === false) return text({ error: "As tarefas estão desligadas nesta empresa (Configurações → Portal)." }, true);
  const found = await findStudent(admin, accountId, input);
  if ("error" in found) return text({ error: found.error }, true);
  const title = String(input.title ?? "").trim().slice(0, 200);
  if (!title) return text({ error: "Dê um título à tarefa." }, true);
  const deadline = Date.parse(String(input.deadline ?? ""));
  if (!Number.isFinite(deadline)) return text({ error: "Informe o prazo em ISO 8601 (com -03:00)." }, true);
  const description = String(input.description ?? "").trim().slice(0, 4000) || null;
  let materialId: string | null = null;
  if (typeof input.material_id === "string" && input.material_id.trim()) {
    const { data: m } = await admin.from("student_materials").select("id")
      .eq("id", input.material_id.trim()).eq("student_id", found.student.id).eq("account_id", accountId).maybeSingle();
    if (!m) return text({ error: "Esse material não é deste aluno. Confira com list_student_materials." }, true);
    materialId = m.id;
  }
  const { data, error } = await admin.from("homework").insert({
    account_id: accountId, student_id: found.student.id, title, description,
    deadline: new Date(deadline).toISOString(), created_by: conn.user_id, material_id: materialId,
  }).select("id, title, deadline, status, material_id").single();
  if (error) return text({ error: error.message }, true);
  return text({ ok: true, aluno: found.student.student_name, tarefa: data });
}

async function listStudentMaterials(admin: Admin, conn: Conn, input: Record<string, unknown>) {
  const found = await findStudent(admin, conn.account_id!, input);
  if ("error" in found) return text({ error: found.error }, true);
  const [m, h] = await Promise.all([
    admin.from("student_materials").select("id, title, kind, url, created_at").eq("student_id", found.student.id).order("created_at", { ascending: false }).limit(50),
    admin.from("homework").select("id, title, description, deadline, status, material_id").eq("student_id", found.student.id).order("deadline", { ascending: false }).limit(50),
  ]);
  return text({ aluno: found.student.student_name, materiais: m.data ?? [], tarefas: h.data ?? [] });
}

async function callAccountTool(admin: Admin, conn: Conn, name: string, input: Record<string, unknown>) {
  const accountId = conn.account_id!;
  const allowed = accountToolList(conn.read_only).some(t => t.name === name);
  if (!allowed) return text({ error: conn.read_only ? "Esta conexão é só de leitura." : `Ferramenta desconhecida: ${name}` }, true);

  if (name === "account_summary") return text(await accountSummary(admin, accountId));

  if (name === "open_balances") {
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    const { data, error } = await admin.rpc("ai_open_balances", { _account: accountId });
    if (error) return text({ error: error.message }, true);
    return text((data ?? []).slice(0, limit));
  }

  if (name === "send_material") return await sendMaterial(admin, conn, input);
  if (name === "add_task") return await addTask(admin, conn, input);
  if (name === "list_student_materials") return await listStudentMaterials(admin, conn, input);

  if (name === "set_lesson_summary") {
    const summary = String(input.summary ?? "").trim();
    if (!summary) return text({ error: "O resumo está vazio." }, true);
    if (summary.length > 4000) return text({ error: "O resumo passa de 4000 caracteres. Encurte." }, true);
    const { data: lesson, error: e1 } = await admin.from("lessons").select("id, class_summary, student_name, start_at")
      .eq("id", String(input.lesson_id ?? "")).eq("account_id", accountId).maybeSingle();
    if (e1 || !lesson) return text({ error: "Atendimento não encontrado nesta empresa. Ache o lesson_id com list_lessons." }, true);
    const old = String(lesson.class_summary ?? "").trim();
    const next = input.mode === "append" && old ? `${old}\n\n${summary}` : summary;
    const { error } = await admin.from("lessons").update({ class_summary: next }).eq("id", lesson.id).eq("account_id", accountId);
    if (error) return text({ error: error.message }, true);
    return text({ ok: true, lesson_id: lesson.id, cliente: lesson.student_name, quando: lesson.start_at, como_foi: next });
  }

  if (name === "list_lessons") {
    const from = Date.parse(String(input.from ?? "")), to = Date.parse(String(input.to ?? ""));
    if (!Number.isFinite(from) || !Number.isFinite(to)) return text({ error: "Informe from e to em ISO 8601 (com -03:00)." }, true);
    if (to - from > 93 * 86400000) return text({ error: "Período longo demais: peça até 3 meses por vez." }, true);
  }

  try {
    const out = await executeTool(admin, accountId, name, input);
    const isErr = !!out && typeof out === "object" && !Array.isArray(out) && "error" in (out as Record<string, unknown>);
    return text(out, isErr);
  } catch (e) {
    return text({ error: String((e as Error)?.message ?? e) }, true);
  }
}

type OverviewRow = {
  name: string; slug: string; active: boolean; created_at: string; plan: string; billing_status: string | null;
  trial_ends_at: string | null; business_model: string | null; paid_until: string | null; past_due_since: string | null;
  alunos: number; professores: number; aulas: number; logins: number; ultima_aula: string | null;
  assistant: boolean; assistant_messages: number; assistant_cost_usd: number; tester_until: string | null;
};

async function callPlatformTool(admin: Admin, conn: Conn, name: string, input: Record<string, unknown>) {
  const { data, error } = await admin.rpc("ai_platform_overview", { _admin: conn.user_id });
  if (error) return text({ error: error.message }, true);
  const rows = (data ?? []) as OverviewRow[];
  const now = Date.now();

  if (name === "platform_overview") {
    const count = (f: (r: OverviewRow) => string) => rows.reduce((m: Record<string, number>, r) => { const k = f(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
    const paying = rows.filter(r => r.active && ["active", "past_due"].includes(r.billing_status ?? "") && r.plan in MONTHLY.BRL);
    const mrr = paying.reduce((s, r) => s + (MONTHLY.BRL[r.plan as PaidPlanId] ?? 0), 0);
    const days = (iso: string | null) => (iso ? (Date.parse(iso) - now) / 86400000 : NaN);
    return text({
      empresas: rows.length,
      ativas: rows.filter(r => r.active).length,
      por_plano: count(r => r.plan),
      por_assinatura: count(r => r.billing_status ?? "none"),
      pagantes: paying.length,
      mrr_estimado_brl: Math.round(mrr * 100) / 100,
      mrr_obs: "Estimativa pelos preços mensais em real, sem profissional extra, adicional de IA, cupons nem plano anual.",
      testes_acabando_7_dias: rows.filter(r => { const d = days(r.trial_ends_at); return d >= 0 && d <= 7; }).map(r => ({ empresa: r.name, fim: r.trial_ends_at })),
      novas_7_dias: rows.filter(r => now - Date.parse(r.created_at) <= 7 * 86400000).length,
      novas_30_dias: rows.filter(r => now - Date.parse(r.created_at) <= 30 * 86400000).length,
      assistente_mes: {
        empresas_com_ia: rows.filter(r => r.assistant).length,
        mensagens: rows.reduce((s, r) => s + Number(r.assistant_messages ?? 0), 0),
        gasto_usd: Math.round(rows.reduce((s, r) => s + Number(r.assistant_cost_usd ?? 0), 0) * 100) / 100,
      },
    });
  }

  if (name === "platform_companies") {
    const q = String(input.search ?? "").trim().toLowerCase();
    const list = rows
      .filter(r => !input.plan || r.plan === input.plan)
      .filter(r => !input.billing_status || (r.billing_status ?? "none") === input.billing_status)
      .filter(r => !q || r.name.toLowerCase().includes(q) || (r.slug ?? "").toLowerCase().includes(q))
      .map(r => ({
        empresa: r.name, codigo: r.slug, ativa: r.active, plano: r.plan, assinatura: r.billing_status ?? "none",
        teste_ate: r.trial_ends_at, testador_ate: r.tester_until, pago_ate: r.paid_until, atrasada_desde: r.past_due_since,
        ramo: r.business_model, criada_em: r.created_at, ultimo_atendimento: r.ultima_aula,
        clientes: Number(r.alunos), profissionais: Number(r.professores), atendimentos: Number(r.aulas), logins: Number(r.logins),
        ia: { ligada: r.assistant, mensagens_mes: r.assistant_messages, gasto_usd_mes: Number(r.assistant_cost_usd ?? 0) },
      }));
    return text(list);
  }
  return text({ error: `Ferramenta desconhecida: ${name}` }, true);
}

async function handle(admin: Admin, conn: Conn, msg: Record<string, unknown>) {
  const id = msg.id;
  const method = String(msg.method ?? "");
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const platform = conn.scope === "platform";

  switch (method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cronys", title: platform ? "Cronys (gestor)" : "Cronys", version: "1.0.0" },
        instructions: platform ? PLATFORM_INSTRUCTIONS : ACCOUNT_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: platform ? PLATFORM_TOOLS : accountToolList(conn.read_only) });
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const result = platform ? await callPlatformTool(admin, conn, name, args) : await callAccountTool(admin, conn, name, args);
      return rpcResult(id, result);
    }
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Método não suportado: ${method}`);
  }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json", ...extra } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(rpcError(null, -32000, "Use POST."), 405, { Allow: "POST, OPTIONS" });

  // Chave errada ou desligada responde 403, e não 401: com 401 o Claude
  // entende que o servidor pede login (OAuth), tenta se registrar e trava o
  // conector em "Não foi possível registrar no serviço de login" (11/10).
  // Falha momentânea do banco responde 503, para a IA tentar de novo, em vez
  // de parecer chave inválida - foi o que aconteceu às 17h11 do dia 10/10.
  const token = tokenOf(req);
  if (!token) return json(rpcError(null, -32001, "Falta a chave do Cronys no link. Crie um link em Configurações → Conectar IA."), 403);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) as Admin;
  let resolved = await admin.rpc("ai_connector_resolve", { _token: token });
  if (resolved.error) resolved = await admin.rpc("ai_connector_resolve", { _token: token });
  if (resolved.error) {
    console.error("ai_connector_resolve", resolved.error.message);
    return json(rpcError(null, -32002, "O Cronys não respondeu agora. Tente de novo em instantes."), 503, { "Retry-After": "2" });
  }
  const conn = resolved.data;
  if (!conn) {
    return json(rpcError(null, -32001, "Chave do Cronys inválida ou desligada. Crie outra em Configurações → Conectar IA."), 403);
  }
  // A chave vale, mas o plano da empresa não tem o conector (é do Max IA; no
  // teste grátis do Pro, só nos 3 primeiros dias). Ver ai_connector_resolve.
  if ((conn as { blocked?: string }).blocked === "plan") {
    return json(rpcError(null, -32003, "A conexão com IA é do plano Max IA. Assine o Max IA no Cronys (Configurações → Minha conta → Ver planos) para continuar usando."), 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json(rpcError(null, -32700, "JSON inválido."), 400); }

  const msgs = Array.isArray(body) ? body : [body];
  const out: unknown[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object") { out.push(rpcError(null, -32600, "Mensagem inválida.")); continue; }
    const msg = m as Record<string, unknown>;
    // Notificação (sem id) e resposta do cliente não pedem resposta.
    if (!("method" in msg) || msg.id === undefined || msg.id === null) continue;
    try {
      out.push(await handle(admin, conn as Conn, msg));
    } catch (e) {
      out.push(rpcError(msg.id, -32603, String((e as Error)?.message ?? e)));
    }
  }
  if (out.length === 0) return new Response(null, { status: 202, headers: corsHeaders });
  return json(Array.isArray(body) ? out : out[0]);
});

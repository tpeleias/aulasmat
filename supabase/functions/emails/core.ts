// O miolo da função "emails" (03/10): o visual, o envio, quem é quem e os
// textos da agenda. index.ts só roteia; billing.ts cuida da cobrança.
// Ver as migrations 20261003020000_email_notifications.sql e
// 20261003060000_email_billing.sql.
//
// Saem pelo Resend, de lembretes@cronys.com.br, com o nome da empresa como
// remetente e o "Responder" indo para o contato dela. A chave do Resend fica no
// cofre (resend_api_key), lida pela função email_secret.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
export const SITE = "https://cronys.com.br";
export const FROM_ADDRESS = "lembretes@cronys.com.br";
export const NOREPLY = "Cronys <nao-responda@cronys.com.br>";
export const TZ = "America/Sao_Paulo";
export const FAKE_DOMAIN = "@aluno.sistema.local";

export type Admin = SupabaseClient;
export type Lesson = {
  id: string; account_id: string; student_name: string; guardian_name: string | null; teacher: string;
  start_at: string; duration_minutes: number | null; status: string; address: string | null;
  is_online: boolean | null; subject: string | null; reschedule_of: string | null;
  /** Link da reunião da aula on-line (migration 20261005010000). */
  meeting_url?: string | null;
};

/** Só link http(s) vira botão: o banco já recusa o resto, aqui é a segunda trava. */
export const meetingLink = (l: Lesson) =>
  l.is_online && l.meeting_url && /^https?:\/\/[^\s"'<>]+$/i.test(l.meeting_url) ? l.meeting_url : null;
export type Ctx = {
  account: { id: string; name: string; locale: string; currency: string | null; business_model: string | null; vocabulary: Record<string, { s?: string; g?: string }> | null };
  prefs: Record<string, unknown>;
  contact: string | null;
  /** Para onde vai o "Responder": o contato da empresa ou, sem ele, o e-mail do admin. */
  replyTo: string | null;
  settings: Record<string, unknown>;
  /** Logo, cor e assinatura (Pro e Max); nulo = o visual padrão. */
  brand: Brand | null;
  /** Textos editados por tipo de e-mail (Max). */
  custom: Templates | null;
  /** Hora do lembrete da véspera e do dia (Max escolhe; o padrão é 18h e 7h). */
  hours: { eve: number; day: number };
  /** Tarefas ligadas na empresa (account_tasks_on, migration 20261004010000). */
  tasks: boolean;
};

export type Brand = { logo: string | null; color: string | null; signature: string | null };
export type Templates = Record<string, { subject?: string; message?: string }>;

/** Os e-mails que o Max pode reescrever (as mesmas chaves da tela). */
export const EDITABLE = ["booked", "changed", "cancelled", "eve", "day", "charge", "payment", "homework", "class_summary", "package"];

/** O tipo de aviso, para a pessoa poder parar de receber só um deles. */
export type Category = "agenda" | "lembretes" | "financeiro" | "tarefas" | "resumo";
export const CATEGORY_OF: Record<string, Category> = {
  booked: "agenda", changed: "agenda", cancelled: "agenda", requested: "agenda", approved: "agenda", declined: "agenda",
  eve: "lembretes", day: "lembretes", lesson_reminder: "lembretes",
  charge: "financeiro", statement: "financeiro", payment: "financeiro", package: "financeiro",
  homework: "tarefas", homework_due: "tarefas", class_summary: "resumo", agenda_tomorrow: "agenda",
};

export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

export const real = (e: string | null | undefined): string | null => {
  const v = (e ?? "").trim().toLowerCase();
  return v && v.includes("@") && !v.endsWith(FAKE_DOMAIN) ? v : null;
};

// ---------------------------------------------------------------------------
// Palavras do ramo
// ---------------------------------------------------------------------------
export const WORDS: Record<string, { pt: string; g: "f" | "m"; en: string }> = {
  aulas: { pt: "Aula", g: "f", en: "Lesson" },
  saude: { pt: "Consulta", g: "f", en: "Appointment" },
  psicologia: { pt: "Sessão", g: "f", en: "Session" },
  beleza: { pt: "Atendimento", g: "m", en: "Appointment" },
  pet: { pt: "Atendimento", g: "m", en: "Appointment" },
  esportes: { pt: "Treino", g: "m", en: "Session" },
  oficina: { pt: "Atendimento", g: "m", en: "Appointment" },
  outro: { pt: "Atendimento", g: "m", en: "Appointment" },
};
export function word(ctx: Ctx) {
  const base = WORDS[ctx.account.business_model ?? "outro"] ?? WORDS.outro;
  const custom = ctx.account.vocabulary?.appointment;
  const en = ctx.account.locale === "en";
  const s = (custom?.s || (en ? base.en : base.pt)).trim();
  const g = (custom?.g === "f" || custom?.g === "m" ? custom.g : base.g) as "f" | "m";
  // "marcada" / "marcado"
  const a = (fem: string, masc: string) => (g === "f" ? fem : masc);
  return { s, l: s.toLocaleLowerCase(en ? "en" : "pt-BR"), en, a };
}

/** A palavra das tarefas no ramo (a mesma de src/lib/vocabulary.ts), com a editada por cima. */
const TASK_WORDS: Record<string, { pt: [string, string]; g: "f" | "m"; en: [string, string] }> = {
  aulas: { pt: ["Tarefa", "Tarefas"], g: "f", en: ["Task", "Tasks"] },
  saude: { pt: ["Orientação", "Orientações"], g: "f", en: ["Home instruction", "Home instructions"] },
  psicologia: { pt: ["Atividade", "Atividades"], g: "f", en: ["Exercise", "Exercises"] },
  beleza: { pt: ["Cuidado", "Cuidados"], g: "m", en: ["Aftercare tip", "Aftercare tips"] },
  pet: { pt: ["Cuidado", "Cuidados"], g: "m", en: ["Home care", "Home care"] },
  esportes: { pt: ["Treino para casa", "Treinos para casa"], g: "m", en: ["Home workout", "Home workouts"] },
  oficina: { pt: ["Tarefa", "Tarefas"], g: "f", en: ["Task", "Tasks"] },
  outro: { pt: ["Tarefa", "Tarefas"], g: "f", en: ["Task", "Tasks"] },
};
export function taskWord(ctx: Ctx) {
  const en = ctx.account.locale === "en";
  const base = TASK_WORDS[ctx.account.business_model ?? "aulas"] ?? TASK_WORDS.aulas;
  const custom = ctx.account.vocabulary?.task as { s?: string; p?: string; g?: string } | undefined;
  const s = (custom?.s || (en ? base.en[0] : base.pt[0])).trim();
  const p = (custom?.p || (en ? base.en[1] : base.pt[1])).trim();
  const g = (custom?.g === "f" || custom?.g === "m" ? custom.g : base.g) as "f" | "m";
  const a = (fem: string, masc: string) => (g === "f" ? fem : masc);
  const low = (x: string) => x.toLocaleLowerCase(en ? "en" : "pt-BR");
  return { s, p, l: low(s), lp: low(p), en, a };
}

export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------
export async function secret(admin: Admin, name: string): Promise<string | null> {
  const { data } = await admin.rpc("email_secret", { _name: name });
  return typeof data === "string" && data ? data : null;
}

export async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
export const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

/**
 * Dois endereços: o do rodapé abre a página do site, que pergunta antes de
 * tirar da lista (o Thiago tocou sem querer em 03/10); o do cabeçalho
 * List-Unsubscribe é o "cancelar inscrição" do próprio Gmail, que manda um
 * POST direto para a função e não pode pedir confirmação.
 */
export async function unsubscribeLinks(admin: Admin, account: string, email: string) {
  const key = await secret(admin, "email_unsubscribe_secret");
  if (!key) return null;
  const q = `c=${account}&e=${b64(email)}&t=${await hmac(key, `${account}|${email}`)}`;
  return {
    page: `${SITE}/email/sair?${q}`,
    oneClick: `${Deno.env.get("SUPABASE_URL")}/functions/v1/emails/unsubscribe?${q}`,
  };
}

/** "thiago" -> "Thiago", "joão silva" -> "João Silva"; quem escreveu com maiúscula fica como está. */
export const displayName = (n: string) =>
  n && n === n.toLocaleLowerCase("pt-BR")
    ? n.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toLocaleUpperCase("pt-BR"))
    : n;

export type Tone = "ok" | "change" | "cancel" | "remind" | "info";
export const TONE: Record<Tone, string> = { ok: "#2f7d76", change: "#9a6a1f", cancel: "#a8433a", remind: "#8a6d2b", info: "#4a4d5c" };

export type Mail = {
  kicker?: string; tone?: Tone; title: string;
  /** Primeiro parágrafo, logo abaixo do título (já escapado). */
  lead?: string;
  rows?: [string, string][];      // rótulo, valor (o valor já vem escapado)
  /** Blocos prontos (tabela de itens, caixa do Pix), depois das linhas. */
  html?: string[];
  paragraphs?: string[];          // já escapados
  cta?: { href: string; label: string };
  /** Letra miúda no fim do cartão ("mensagem enviada automaticamente..."). */
  note?: string;
  /** Os campos que o texto editado (Max) pode usar: {nome}, {data}... */
  vars?: Record<string, string>;
};

const HEX = /^#[0-9a-f]{6}$/i;
/** Texto escuro ou claro sobre a cor da empresa, o que for mais legível. */
export function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#13141b" : "#ffffff";
}
const multilineEsc = (t: string) => esc(t.trim()).replace(/\r?\n/g, "<br>");

/**
 * O e-mail (03/10, refeito a pedido do Thiago): tabela simples, que todo
 * leitor de e-mail mostra igual, fundo claro fixo (o Gmail escuro inverte o
 * resto), o nome da empresa no topo, os dados em linhas com rótulo e o
 * "parar de receber" longe do texto, numa linha só dele.
 */
export function layout(m: Mail, foot: { from: string; unsubscribe?: string | null; en: boolean; brand?: Brand | null }) {
  const color = TONE[m.tone ?? "info"];
  const b = foot.brand;
  const accent = b?.color && HEX.test(b.color) ? b.color : null;
  const btn = accent ?? "#c9a24b";
  const btnInk = accent ? inkOn(accent) : "#13141b";
  const head = b?.logo
    ? `<img src="${esc(b.logo)}" alt="${esc(foot.from)}" height="44" style="display:block;height:auto;max-height:44px;max-width:200px;border:0">`
    : esc(foot.from);
  const rows = (m.rows ?? []).map(([k, v]) => `
<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#77756c;vertical-align:top;white-space:nowrap;width:84px">${esc(k)}</td>
<td style="padding:6px 0;font-size:16px;line-height:1.4;color:#1d1f27;vertical-align:top">${v}</td></tr>`).join("");
  const unsub = foot.unsubscribe
    ? `<tr><td style="padding:22px 8px 0;font-size:12px;line-height:1.6;color:#8b897f;text-align:center">
${foot.en ? "Don't want these emails?" : "Não quer mais estes e-mails?"}<br>
<a href="${foot.unsubscribe}" style="color:#5f5d55;text-decoration:underline">${foot.en ? "Unsubscribe" : "Cancelar o recebimento"}</a></td></tr>`
    : "";
  return `<!doctype html><html lang="${foot.en ? "en" : "pt-BR"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(m.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1f27">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">
<tr><td style="padding:0 6px 14px;font-size:15px;font-weight:bold;color:#13141b">${head}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e6e1d4;${accent ? `border-top:4px solid ${accent};` : ""}border-radius:16px;padding:26px 24px">
${m.kicker ? `<div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${color};margin:0 0 8px">${esc(m.kicker)}</div>` : ""}
<h1 style="font-size:22px;line-height:1.3;margin:0 0 18px;color:#13141b">${esc(m.title)}</h1>
${m.lead ? `<p style="font-size:15px;line-height:1.55;margin:0 0 16px;color:#3a3c46">${m.lead}</p>` : ""}
${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #eee9dd;border-bottom:1px solid #eee9dd;margin:0 0 18px"><tr><td style="padding:10px 0"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table></td></tr></table>` : ""}
${(m.html ?? []).join("\n")}
${(m.paragraphs ?? []).map(t => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px;color:#3a3c46">${t}</p>`).join("\n")}
${m.cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 2px"><tr><td style="background:${btn};border-radius:10px"><a href="${m.cta.href}" style="display:inline-block;padding:13px 20px;font-size:15px;font-weight:bold;color:${btnInk};text-decoration:none">${esc(m.cta.label)}</a></td></tr></table>` : ""}
${b?.signature ? `<p style="font-size:15px;line-height:1.55;margin:18px 0 0;color:#3a3c46">${multilineEsc(b.signature)}</p>` : ""}
${m.note ? `<p style="font-size:12px;line-height:1.5;margin:18px 0 0;color:#8b897f;font-style:italic">${esc(m.note)}</p>` : ""}
</td></tr>
${foot.from === "Cronys" ? "" : `<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:#8b897f;text-align:center">${foot.en
    ? `${esc(foot.from)} uses Cronys to manage its schedule.`
    : `${esc(foot.from)} usa o Cronys para cuidar da agenda.`}</td></tr>`}
${unsub}
</table></td></tr></table></body></html>`;
}

export type Attachment = { filename: string; content: string /* base64 */ };

/** Manda pelo Resend e devolve o id do e-mail (o webhook usa para dizer se chegou). */
export async function send(apiKey: string, msg: { from: string; to: string; subject: string; html: string; reply_to?: string | null; unsubscribe?: string | null; attachments?: Attachment[] }): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (msg.unsubscribe) {
    headers["List-Unsubscribe"] = `<${msg.unsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html,
      ...(msg.reply_to ? { reply_to: msg.reply_to } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
    }),
  });
  // O Resend aceita 2 por segundo no plano grátis.
  await new Promise(r => setTimeout(r, 550));
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json().catch(() => null)) as { id?: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Quem é quem
// ---------------------------------------------------------------------------
export const ctxCache = new Map<string, Ctx>();
export async function ctxFor(admin: Admin, account: string): Promise<Ctx | null> {
  if (ctxCache.has(account)) return ctxCache.get(account)!;
  const { data: a } = await admin.from("accounts").select("id, name, locale, currency, business_model, vocabulary, active").eq("id", account).maybeSingle();
  if (!a || a.active === false) return null;
  const { data: s } = await admin.from("settings").select("*").eq("account_id", account).maybeSingle();
  const contact = real(s?.contact_email as string | null);
  const prefs = (s?.email_notifications ?? {}) as Record<string, unknown>;
  const c: Ctx = {
    account: a as Ctx["account"], prefs, contact,
    replyTo: contact, settings: (s ?? {}) as Record<string, unknown>,
    brand: null, custom: null, hours: { eve: 18, day: 7 }, tasks: true,
  };
  c.tasks = (await admin.rpc("account_tasks_on", { _account: account })).data !== false;
  const can = async (f: string) => (await admin.rpc("account_can", { _capability: f, _account: account })).data === true;
  if (await can("email_branding")) c.brand = brandOf(prefs);
  if (await can("email_custom")) {
    c.custom = templatesOf(prefs);
    c.hours = { eve: hourIn(prefs.reminder_eve_hour, 12, 22, 18), day: hourIn(prefs.reminder_day_hour, 5, 11, 7) };
  }
  // Sem e-mail de contato, a resposta do cliente iria para lembretes@, que não
  // tem caixa: vai para o admin.
  if (!contact) c.replyTo = (await adminEmails(admin, c))[0] ?? null;
  ctxCache.set(account, c);
  return c;
}
const hourIn = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Só aceita logo do próprio bucket (nada de imagem de fora no e-mail). */
export function brandOf(p: Record<string, unknown>): Brand | null {
  const base = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/email-logos/`;
  const logo = typeof p.brand_logo === "string" && p.brand_logo.startsWith(base) ? p.brand_logo : null;
  const color = typeof p.brand_color === "string" && HEX.test(p.brand_color) ? p.brand_color : null;
  const signature = text(p.brand_signature, 300);
  return logo || color || signature ? { logo, color, signature } : null;
}
export function templatesOf(p: Record<string, unknown>): Templates | null {
  const t = p.templates;
  if (!t || typeof t !== "object") return null;
  const out: Templates = {};
  for (const k of EDITABLE) {
    const v = (t as Record<string, { subject?: unknown; message?: unknown }>)[k];
    const subject = text(v?.subject, 150);
    const message = text(v?.message, 1500);
    if (subject || message) out[k] = { ...(subject ? { subject } : {}), ...(message ? { message } : {}) };
  }
  return Object.keys(out).length ? out : null;
}

/** Troca {campo} pelo valor; campo desconhecido fica como está. */
export const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? vars[k] : all));

/** O texto do Max por cima do padrão: o assunto e a mensagem de abertura. */
export function applyCustom(ctx: Ctx, kind: string, m: Msg): Msg {
  const t = ctx.custom?.[kind];
  if (!t) return m;
  const vars = { empresa: ctx.account.name, ...(m.vars ?? {}) };
  const out = { ...m };
  if (t.subject) out.subject = fill(t.subject, vars).replace(/\s+/g, " ").slice(0, 200);
  if (t.message) { out.lead = multilineEsc(fill(t.message, vars)); out.paragraphs = []; }
  return out;
}

export function pref(ctx: Ctx, key: string) {
  const p = ctx.prefs;
  if (p.enabled !== true) return false;
  if (key in p) return p[key] === true;
  return key !== "reminder_day";
}

export async function authEmail(admin: Admin, userId: string | null | undefined) {
  if (!userId) return null;
  const { data } = await admin.auth.admin.getUserById(userId);
  return real(data?.user?.email);
}

/** O cliente e o responsável: e-mails do cadastro e dos logins de verdade. */
export async function clientEmails(admin: Admin, l: Lesson) {
  const { data } = await admin.from("students")
    .select("student_name, guardian_name, email, guardian_email, user_id")
    .eq("account_id", l.account_id);
  const norm = (x: string | null) => (x ?? "").trim().toLowerCase();
  const st = (data ?? []).find(s => norm(s.student_name) === norm(l.student_name) && norm(s.guardian_name) === norm(l.guardian_name))
    ?? (data ?? []).find(s => norm(s.student_name) === norm(l.student_name));
  const out = new Set<string>();
  for (const e of [real(st?.email), real(st?.guardian_email), await authEmail(admin, st?.user_id)]) if (e) out.add(e);
  return { emails: [...out], name: l.guardian_name || l.student_name };
}

export async function teacherInfo(admin: Admin, l: Lesson) {
  const { data } = await admin.from("teachers").select("id, name, user_id").eq("account_id", l.account_id);
  const slug = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, "-");
  const t = (data ?? []).find(x => slug(x.name) === l.teacher);
  if (!t) return { name: displayName(l.teacher), email: null as string | null };
  const { data: te } = await admin.from("teacher_emails").select("email").eq("teacher_id", t.id).maybeSingle();
  return { name: displayName(t.name), email: real(te?.email) ?? await authEmail(admin, t.user_id) };
}

export async function adminEmails(admin: Admin, ctx: Ctx) {
  const { data } = await admin.from("user_roles").select("user_id").eq("account_id", ctx.account.id).eq("role", "admin");
  const out = new Set<string>();
  for (const r of data ?? []) { const e = await authEmail(admin, r.user_id); if (e) out.add(e); }
  if (!out.size && ctx.contact) out.add(ctx.contact);
  return [...out];
}

export async function optedOut(admin: Admin, account: string, email: string, category?: Category) {
  const { data } = await admin.from("email_optouts").select("email").eq("account_id", account).eq("email", email).maybeSingle();
  if (data) return true;
  if (!category) return false;
  const { data: c } = await admin.from("email_optout_categories").select("email").eq("account_id", account).eq("email", email).eq("category", category).maybeSingle();
  return !!c;
}

/** Endereço que já voltou: não insiste (e o admin vê o aviso no cadastro). */
export async function bounced(admin: Admin, email: string) {
  const { data } = await admin.from("email_bounces").select("email").eq("email", email).eq("kind", "bounced").maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Os textos
// ---------------------------------------------------------------------------
export type Msg = Mail & { subject: string };

export const fmtDay = (iso: string, en: boolean) =>
  new Date(iso).toLocaleDateString(en ? "en-US" : "pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
export const fmtTime = (iso: string, en: boolean) =>
  new Date(iso).toLocaleTimeString(en ? "en-US" : "pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: en });

export function lessonRows(ctx: Ctx, l: Lesson, teacher: string): [string, string][] {
  const w = word(ctx);
  const end = l.duration_minutes ? new Date(new Date(l.start_at).getTime() + l.duration_minutes * 60000).toISOString() : null;
  const hora = `${fmtTime(l.start_at, w.en)}${end ? ` – ${fmtTime(end, w.en)}` : ""}`;
  const link = meetingLink(l);
  const where = l.is_online
    ? (link
      ? `${w.en ? "Online" : "On-line"} · <a href="${esc(link)}" style="color:#1d1f27;text-decoration:underline;font-weight:bold">${w.en ? "Join" : "Entrar"}</a>`
      : (w.en ? "Online" : "On-line"))
    : l.address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}" style="color:#1d1f27;text-decoration:underline">${esc(l.address)}</a>` : null;
  const rows: [string, string][] = [
    [w.en ? "Date" : "Data", `<b>${esc(cap1(fmtDay(l.start_at, w.en)))}</b>`],
    [w.en ? "Time" : "Horário", esc(hora)],
    [w.en ? "With" : "Com", esc(teacher)],
  ];
  if (l.subject) rows.push([w.en ? "Subject" : "Assunto", esc(l.subject)]);
  if (where) rows.push([w.en ? "Where" : "Local", where]);
  return rows;
}
export const cap1 = (s: string) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
export const beforeRow = (old: string, en: boolean): [string, string] =>
  [en ? "Before" : "Antes", `<s style="color:#8b897f">${esc(cap1(fmtDay(old, en)))}, ${esc(fmtTime(old, en))}</s>`];

export function clientMsg(kind: string, ctx: Ctx, l: Lesson, teacher: string, oldStart: string | null): Msg | null {
  const m = clientMsgBase(kind, ctx, l, teacher, oldStart);
  const en = ctx.account.locale === "en";
  return m && { ...m, vars: { nome: l.student_name, responsavel: l.guardian_name || l.student_name, data: fmtDay(l.start_at, en), hora: fmtTime(l.start_at, en), profissional: teacher, link: meetingLink(l) ?? "" } };
}

function clientMsgBase(kind: string, ctx: Ctx, l: Lesson, teacher: string, oldStart: string | null): Msg | null {
  const w = word(ctx);
  const rows = lessonRows(ctx, l, teacher);
  const when = `${fmtDay(l.start_at, w.en)}, ${fmtTime(l.start_at, w.en)}`;
  const reply = w.en ? "Questions? Just reply to this email." : "Alguma dúvida? É só responder este e-mail.";
  switch (kind) {
    case "booked":
    case "approved":
      return {
        subject: w.en ? `${w.s} booked: ${when}` : `${w.s} ${w.a("marcada", "marcado")}: ${when}`,
        kicker: w.en ? `${w.s} booked` : `${w.s} ${w.a("marcada", "marcado")}`, tone: "ok",
        title: w.en ? `See you ${fmtDay(l.start_at, true)}!` : `Até ${fmtDay(l.start_at, false)}!`,
        rows, paragraphs: [esc(reply)],
      };
    case "changed":
      return {
        subject: w.en ? `${w.s} moved: ${when}` : `${w.s} ${w.a("remarcada", "remarcado")}: ${when}`,
        kicker: w.en ? "New time" : "Horário alterado", tone: "change",
        title: w.en ? `Your ${w.l} has a new time` : `${w.a("Sua", "Seu")} ${w.l} mudou de horário`,
        rows: [...(oldStart ? [beforeRow(oldStart, w.en)] : []), ...rows], paragraphs: [esc(reply)],
      };
    case "cancelled":
      return {
        subject: w.en ? `${w.s} canceled: ${when}` : `${w.s} ${w.a("cancelada", "cancelado")}: ${when}`,
        kicker: w.en ? `${w.s} canceled` : `${w.s} ${w.a("cancelada", "cancelado")}`, tone: "cancel",
        title: w.en ? `Your ${w.l} was canceled` : `${w.a("Sua", "Seu")} ${w.l} foi ${w.a("cancelada", "cancelado")}`,
        rows, paragraphs: [esc(reply)],
      };
    case "requested":
      return {
        subject: w.en ? `Request received: ${when}` : `Pedido recebido: ${when}`,
        kicker: w.en ? "Request received" : "Pedido recebido", tone: "info",
        title: w.en ? "We got your request" : "Recebemos seu pedido",
        rows: [...(oldStart ? [beforeRow(oldStart, w.en)] : []), ...rows],
        paragraphs: [esc(w.en ? `${ctx.account.name} will reply soon, and you'll get another email.` : `${ctx.account.name} vai responder em breve, e você recebe outro e-mail.`)],
      };
    case "declined":
      return {
        subject: w.en ? `Request not approved: ${when}` : `Pedido não aprovado: ${when}`,
        kicker: w.en ? "Request not approved" : "Pedido não aprovado", tone: "cancel",
        title: w.en ? "Your request was not approved" : "Seu pedido não foi aprovado",
        rows, paragraphs: [esc(w.en ? "You can request another time in the portal." : "Você pode pedir outro horário pelo portal.")],
        cta: { href: `${SITE}/aluno/agendar`, label: w.en ? "Request another time" : "Pedir outro horário" },
      };
    case "eve":
    case "day":
      return {
        subject: w.en
          ? `Reminder: ${w.l} ${kind === "eve" ? "tomorrow" : "today"} at ${fmtTime(l.start_at, true)}`
          : `Lembrete: ${w.l} ${kind === "eve" ? "amanhã" : "hoje"} às ${fmtTime(l.start_at, false)}`,
        kicker: w.en ? "Reminder" : "Lembrete", tone: "remind",
        title: w.en ? `Your ${w.l} is ${kind === "eve" ? "tomorrow" : "today"}` : `${w.a("Sua", "Seu")} ${w.l} é ${kind === "eve" ? "amanhã" : "hoje"}`,
        rows, paragraphs: [esc(w.en ? "Can't make it? Reply to this email." : "Não vai conseguir? É só responder este e-mail.")],
        // On-line: o botão já é a entrada na sala.
        ...(meetingLink(l) ? { cta: { href: meetingLink(l)!, label: w.en ? `Join the ${w.l}` : `Entrar ${w.a("na", "no")} ${w.l}` } } : {}),
      };
  }
  return null;
}

export function staffMsg(kind: string, ctx: Ctx, l: Lesson, teacher: string, oldStart: string | null, forAdmin: boolean): Msg | null {
  const w = word(ctx);
  const who = l.student_name;
  const rows: [string, string][] = [[w.en ? "Client" : "Cliente", esc(who)], ...lessonRows(ctx, l, teacher)];
  const when = `${fmtDay(l.start_at, w.en)}, ${fmtTime(l.start_at, w.en)}`;
  const open = { href: `${SITE}/admin`, label: w.en ? "Open Cronys" : "Abrir o Cronys" };
  if (forAdmin && kind === "requested") {
    return {
      subject: w.en ? `New request: ${who} · ${when}` : `Novo pedido: ${who} · ${when}`,
      kicker: w.en ? "New request" : "Pedido novo", tone: "info",
      title: w.en ? `${who} requested a ${w.l}` : `${who} pediu ${w.a("uma", "um")} ${w.l}`,
      rows: [...(oldStart ? [beforeRow(oldStart, w.en)] : []), ...rows],
      paragraphs: [esc(w.en ? "The slot stays on hold until you answer." : "O horário fica reservado até você responder.")],
      cta: open,
    };
  }
  const verb: Record<string, [string, string, string, Tone]> = {
    booked: ["marcada", "marcado", "booked", "ok"], approved: ["marcada", "marcado", "booked", "ok"],
    changed: ["remarcada", "remarcado", "moved", "change"], cancelled: ["cancelada", "cancelado", "canceled", "cancel"],
  };
  const v = verb[kind];
  if (!v) return null;
  return {
    subject: w.en ? `Calendar: ${who} ${v[2]} · ${when}` : `Agenda: ${w.l} de ${who} ${w.a(v[0], v[1])} · ${when}`,
    kicker: w.en ? `${w.s} ${v[2]}` : `${w.s} ${w.a(v[0], v[1])}`, tone: v[3],
    title: w.en ? `${who}'s ${w.l} was ${v[2]}` : `${cap1(w.l)} de ${who} ${w.a(v[0], v[1])}`,
    rows: [...(kind === "changed" && oldStart ? [beforeRow(oldStart, w.en)] : []), ...rows],
    cta: open,
  };
}

export type DeliverOpts = {
  kind: string;
  staff?: boolean;
  student?: string | null;
  guardian?: string | null;
  /** Quem mandou na mão; nulo = automático. */
  sentBy?: string | null;
  attachments?: Attachment[];
};

/**
 * Manda um aviso e anota no histórico (email_log). Pula quem saiu da lista
 * (tudo, ou só aquele tipo) e endereço que já voltou. Devolve se saiu.
 */
export async function deliver(admin: Admin, apiKey: string, ctx: Ctx, to: string, m: Msg, opts: DeliverOpts | boolean = false): Promise<boolean> {
  const o: DeliverOpts = typeof opts === "boolean" ? { kind: "aviso", staff: opts } : opts;
  m = o.staff ? m : applyCustom(ctx, o.kind, m);
  const category = CATEGORY_OF[o.kind];
  if (await optedOut(admin, ctx.account.id, to, category)) return false;
  if (await bounced(admin, to)) return false;
  const en = ctx.account.locale === "en";
  const links = await unsubscribeLinks(admin, ctx.account.id, to);
  const log = { account_id: ctx.account.id, to_email: to, kind: o.kind, subject: m.subject.slice(0, 300),
    student_name: o.student ?? null, guardian_name: o.guardian ?? null, sent_by: o.sentBy ?? null };
  try {
    const id = await send(apiKey, {
      from: `${ctx.account.name.replace(/[<>"]/g, "")} <${FROM_ADDRESS}>`,
      to, subject: m.subject, html: layout(m, { from: ctx.account.name, unsubscribe: links?.page, en, brand: ctx.brand }),
      reply_to: o.staff ? null : ctx.replyTo, unsubscribe: links?.oneClick, attachments: o.attachments,
    });
    await admin.from("email_log").insert({ ...log, resend_id: id });
    return true;
  } catch (e) {
    await admin.from("email_log").insert({ ...log, status: "failed", error: String(e).slice(0, 300) });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Hora de Brasília
// ---------------------------------------------------------------------------
export function localParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
/** 00:00 de uma data local (YYYY-MM-DD) em Brasília, como instante UTC (Brasília não tem mais horário de verão: -03:00). */
export const localMidnight = (date: string) => new Date(`${date}T00:00:00-03:00`);

// E-mails automáticos (03/10). Ver a migration 20261003020000_email_notifications.sql.
//
//   POST /cron {mode: "outbox" | "reminders"} + x-cron-secret   <- o pg_cron, pelo pg_net
//   POST {action: "password_reset", email, locale?}              <- "Esqueci a senha" (sem login)
//   POST {action: "unsubscribe", c, e, t}                        <- link "não quero mais receber"
//   POST {action: "test"}                                         <- admin: um e-mail de teste para si
//
// Saem pelo Resend, de lembretes@cronys.com.br, com o nome da empresa como
// remetente e o "Responder" indo para o contato dela. A chave do Resend fica no
// cofre (resend_api_key), lida pela função email_secret.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SITE = "https://cronys.com.br";
const FROM_ADDRESS = "lembretes@cronys.com.br";
const NOREPLY = "Cronys <nao-responda@cronys.com.br>";
const TZ = "America/Sao_Paulo";
const FAKE_DOMAIN = "@aluno.sistema.local";

type Admin = SupabaseClient;
type Lesson = {
  id: string; account_id: string; student_name: string; guardian_name: string | null; teacher: string;
  start_at: string; duration_minutes: number | null; status: string; address: string | null;
  is_online: boolean | null; subject: string | null; reschedule_of: string | null;
};
type Ctx = {
  account: { id: string; name: string; locale: string; business_model: string | null; vocabulary: Record<string, { s?: string; g?: string }> | null };
  prefs: Record<string, unknown>;
  contact: string | null;
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

const real = (e: string | null | undefined): string | null => {
  const v = (e ?? "").trim().toLowerCase();
  return v && v.includes("@") && !v.endsWith(FAKE_DOMAIN) ? v : null;
};

// ---------------------------------------------------------------------------
// Palavras do ramo
// ---------------------------------------------------------------------------
const WORDS: Record<string, { pt: string; g: "f" | "m"; en: string }> = {
  aulas: { pt: "Aula", g: "f", en: "Lesson" },
  saude: { pt: "Consulta", g: "f", en: "Appointment" },
  psicologia: { pt: "Sessão", g: "f", en: "Session" },
  beleza: { pt: "Atendimento", g: "m", en: "Appointment" },
  pet: { pt: "Atendimento", g: "m", en: "Appointment" },
  esportes: { pt: "Treino", g: "m", en: "Session" },
  oficina: { pt: "Atendimento", g: "m", en: "Appointment" },
  outro: { pt: "Atendimento", g: "m", en: "Appointment" },
};
function word(ctx: Ctx) {
  const base = WORDS[ctx.account.business_model ?? "outro"] ?? WORDS.outro;
  const custom = ctx.account.vocabulary?.appointment;
  const en = ctx.account.locale === "en";
  const s = (custom?.s || (en ? base.en : base.pt)).trim();
  const g = (custom?.g === "f" || custom?.g === "m" ? custom.g : base.g) as "f" | "m";
  // "marcada" / "marcado"
  const a = (fem: string, masc: string) => (g === "f" ? fem : masc);
  return { s, l: s.toLocaleLowerCase(en ? "en" : "pt-BR"), en, a };
}

const fmtWhen = (iso: string, en: boolean) =>
  new Date(iso).toLocaleString(en ? "en-US" : "pt-BR", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: en,
  });

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------
async function secret(admin: Admin, name: string): Promise<string | null> {
  const { data } = await admin.rpc("email_secret", { _name: name });
  return typeof data === "string" && data ? data : null;
}

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

async function unsubscribeUrl(admin: Admin, account: string, email: string) {
  const key = await secret(admin, "email_unsubscribe_secret");
  if (!key) return null;
  const t = await hmac(key, `${account}|${email}`);
  return `${SITE}/email/sair?c=${account}&e=${b64(email)}&t=${t}`;
}

function layout(title: string, lines: string[], footer: string, en: boolean, cta?: { href: string; label: string }) {
  return `<!doctype html><html lang="${en ? "en" : "pt-BR"}"><body style="margin:0;background:#f6f4ef;font-family:Arial,Helvetica,sans-serif;color:#1d1f27">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border:1px solid #e7e3d8;border-radius:16px;padding:24px">
<h1 style="font-size:18px;margin:0 0 16px">${esc(title)}</h1>
${lines.map(l => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${l}</p>`).join("\n")}
${cta ? `<p style="margin:20px 0 4px"><a href="${cta.href}" style="background:#c9a24b;color:#13141b;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px;display:inline-block">${esc(cta.label)}</a></p>` : ""}
</div>
<p style="font-size:12px;color:#77756c;line-height:1.5;margin:16px 4px">${footer}</p>
</div></body></html>`;
}

async function send(apiKey: string, msg: { from: string; to: string; subject: string; html: string; reply_to?: string | null; unsubscribe?: string | null }) {
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
    }),
  });
  // O Resend aceita 2 por segundo no plano grátis.
  await new Promise(r => setTimeout(r, 550));
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Quem é quem
// ---------------------------------------------------------------------------
const ctxCache = new Map<string, Ctx>();
async function ctxFor(admin: Admin, account: string): Promise<Ctx | null> {
  if (ctxCache.has(account)) return ctxCache.get(account)!;
  const { data: a } = await admin.from("accounts").select("id, name, locale, business_model, vocabulary, active").eq("id", account).maybeSingle();
  if (!a || a.active === false) return null;
  const { data: s } = await admin.from("settings").select("email_notifications, contact_email").eq("account_id", account).maybeSingle();
  const c: Ctx = { account: a as Ctx["account"], prefs: (s?.email_notifications ?? {}) as Record<string, unknown>, contact: real(s?.contact_email) };
  ctxCache.set(account, c);
  return c;
}
function pref(ctx: Ctx, key: string) {
  const p = ctx.prefs;
  if (p.enabled !== true) return false;
  if (key in p) return p[key] === true;
  return key !== "reminder_day";
}

async function authEmail(admin: Admin, userId: string | null | undefined) {
  if (!userId) return null;
  const { data } = await admin.auth.admin.getUserById(userId);
  return real(data?.user?.email);
}

/** O cliente e o responsável: e-mails do cadastro e dos logins de verdade. */
async function clientEmails(admin: Admin, l: Lesson) {
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

async function teacherInfo(admin: Admin, l: Lesson) {
  const { data } = await admin.from("teachers").select("id, name, user_id").eq("account_id", l.account_id);
  const slug = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, "-");
  const t = (data ?? []).find(x => slug(x.name) === l.teacher);
  if (!t) return { name: l.teacher, email: null as string | null };
  const { data: te } = await admin.from("teacher_emails").select("email").eq("teacher_id", t.id).maybeSingle();
  return { name: t.name, email: real(te?.email) ?? await authEmail(admin, t.user_id) };
}

async function adminEmails(admin: Admin, ctx: Ctx) {
  const { data } = await admin.from("user_roles").select("user_id").eq("account_id", ctx.account.id).eq("role", "admin");
  const out = new Set<string>();
  for (const r of data ?? []) { const e = await authEmail(admin, r.user_id); if (e) out.add(e); }
  if (!out.size && ctx.contact) out.add(ctx.contact);
  return [...out];
}

async function optedOut(admin: Admin, account: string, email: string) {
  const { data } = await admin.from("email_optouts").select("email").eq("account_id", account).eq("email", email).maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Os textos
// ---------------------------------------------------------------------------
type Msg = { subject: string; title: string; lines: string[]; cta?: { href: string; label: string } };

function lessonLines(ctx: Ctx, l: Lesson, teacher: string) {
  const w = word(ctx);
  const where = l.is_online ? (w.en ? "Online" : "On-line") : (l.address ? esc(l.address) : null);
  return [
    `<b>${esc(fmtWhen(l.start_at, w.en))}</b>${l.duration_minutes ? ` · ${l.duration_minutes} min` : ""}`,
    `${w.en ? "With" : "Com"} ${esc(teacher)}${l.subject ? ` · ${esc(l.subject)}` : ""}`,
    ...(where ? [where] : []),
  ];
}

function clientMsg(kind: string, ctx: Ctx, l: Lesson, teacher: string, oldStart: string | null): Msg | null {
  const w = word(ctx);
  const biz = esc(ctx.account.name);
  const info = lessonLines(ctx, l, teacher);
  const when = fmtWhen(l.start_at, w.en);
  switch (kind) {
    case "booked":
    case "approved":
      return {
        subject: w.en ? `${w.s} booked: ${when}` : `${w.s} ${w.a("marcada", "marcado")}: ${when}`,
        title: w.en ? `Your ${w.l} is booked` : `${w.a("Sua", "Seu")} ${w.l} está ${w.a("marcada", "marcado")}`,
        lines: [...info, w.en ? `See you there! — ${biz}` : `Até lá! — ${biz}`],
      };
    case "changed":
      return {
        subject: w.en ? `${w.s} moved: ${when}` : `${w.s} ${w.a("remarcada", "remarcado")}: ${when}`,
        title: w.en ? `Your ${w.l} has a new time` : `${w.a("Sua", "Seu")} ${w.l} mudou de horário`,
        lines: [
          ...(oldStart ? [(w.en ? "Before: " : "Antes: ") + `<s>${esc(fmtWhen(oldStart, w.en))}</s>`] : []),
          ...(w.en ? ["Now:"] : ["Agora:"]), ...info, `— ${biz}`,
        ],
      };
    case "cancelled":
      return {
        subject: w.en ? `${w.s} canceled: ${when}` : `${w.s} ${w.a("cancelada", "cancelado")}: ${when}`,
        title: w.en ? `Your ${w.l} was canceled` : `${w.a("Sua", "Seu")} ${w.l} foi ${w.a("cancelada", "cancelado")}`,
        lines: [...info, w.en ? `Questions? Just reply to this email. — ${biz}` : `Alguma dúvida? É só responder este e-mail. — ${biz}`],
      };
    case "requested":
      return {
        subject: w.en ? `Request received: ${when}` : `Pedido recebido: ${when}`,
        title: w.en ? `We got your request` : `Recebemos seu pedido`,
        lines: [...info, w.en ? `${biz} will reply soon, and you'll get another email.` : `${biz} vai responder em breve, e você recebe outro e-mail.`],
      };
    case "declined":
      return {
        subject: w.en ? `Request not approved: ${when}` : `Pedido não aprovado: ${when}`,
        title: w.en ? `Your request was not approved` : `Seu pedido não foi aprovado`,
        lines: [...info, w.en ? `You can request another time in the portal. — ${biz}` : `Você pode pedir outro horário pelo portal. — ${biz}`],
        cta: { href: `${SITE}/aluno/agendar`, label: w.en ? "Request another time" : "Pedir outro horário" },
      };
    case "eve":
    case "day":
      return {
        subject: w.en
          ? `Reminder: ${w.l} ${kind === "eve" ? "tomorrow" : "today"} · ${when}`
          : `Lembrete: ${w.l} ${kind === "eve" ? "amanhã" : "hoje"} · ${when}`,
        title: w.en ? `Reminder: your ${w.l} is ${kind === "eve" ? "tomorrow" : "today"}` : `Lembrete: ${w.a("sua", "seu")} ${w.l} é ${kind === "eve" ? "amanhã" : "hoje"}`,
        lines: [...info, w.en ? `Can't make it? Reply to this email. — ${biz}` : `Não vai conseguir? É só responder este e-mail. — ${biz}`],
      };
  }
  return null;
}

function staffMsg(kind: string, ctx: Ctx, l: Lesson, teacher: string, oldStart: string | null, forAdmin: boolean): Msg | null {
  const w = word(ctx);
  const who = esc(l.student_name);
  const info = lessonLines(ctx, l, teacher);
  const when = fmtWhen(l.start_at, w.en);
  const open = { href: `${SITE}/admin`, label: w.en ? "Open Cronys" : "Abrir o Cronys" };
  if (forAdmin && kind === "requested") {
    return {
      subject: w.en ? `New request: ${l.student_name} · ${when}` : `Novo pedido: ${l.student_name} · ${when}`,
      title: w.en ? `${who} requested a ${w.l}` : `${who} pediu ${w.a("uma", "um")} ${w.l}`,
      lines: [...info, w.en ? "The slot stays on hold until you answer." : "O horário fica reservado até você responder."],
      cta: open,
    };
  }
  const verb: Record<string, [string, string, string]> = {
    booked: ["marcada", "marcado", "booked"], approved: ["marcada", "marcado", "booked"],
    changed: ["remarcada", "remarcado", "moved"], cancelled: ["cancelada", "cancelado", "canceled"],
  };
  const v = verb[kind];
  if (!v) return null;
  return {
    subject: w.en ? `Calendar: ${l.student_name} ${v[2]} · ${when}` : `Agenda: ${w.l} de ${l.student_name} ${w.a(v[0], v[1])} · ${when}`,
    title: w.en ? `${who}'s ${w.l} was ${v[2]}` : `${w.s} de ${who} ${w.a(v[0], v[1])}`,
    lines: [
      ...(kind === "changed" && oldStart ? [(w.en ? "Before: " : "Antes: ") + `<s>${esc(fmtWhen(oldStart, w.en))}</s>`] : []),
      ...info,
    ],
    cta: open,
  };
}

async function deliver(admin: Admin, apiKey: string, ctx: Ctx, to: string, m: Msg, staff = false) {
  if (await optedOut(admin, ctx.account.id, to)) return;
  const en = ctx.account.locale === "en";
  const unsub = await unsubscribeUrl(admin, ctx.account.id, to);
  const footer = (en
    ? `${esc(ctx.account.name)} uses Cronys to manage its schedule.`
    : `${esc(ctx.account.name)} usa o Cronys para cuidar da agenda.`)
    + (unsub ? ` <a href="${unsub}" style="color:#77756c">${en ? "Stop these emails" : "Não quero mais receber"}</a>` : "");
  await send(apiKey, {
    from: `${ctx.account.name.replace(/[<>"]/g, "")} <${FROM_ADDRESS}>`,
    to, subject: m.subject, html: layout(m.title, m.lines, footer, en, m.cta),
    reply_to: staff ? null : ctx.contact, unsubscribe: unsub,
  });
}

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------
async function processOutbox(admin: Admin, apiKey: string) {
  const { data: rows } = await admin.from("email_outbox")
    .select("id, account_id, kind, lesson_id, old_start, attempts")
    .is("sent_at", null).lt("attempts", 5).lte("process_after", new Date().toISOString())
    .order("created_at").limit(40);
  let sent = 0;
  for (const r of rows ?? []) {
    try {
      const ctx = await ctxFor(admin, r.account_id);
      const { data: l } = await admin.from("lessons").select("*").eq("id", r.lesson_id).maybeSingle();
      let kind = r.kind as string;
      let oldStart = r.old_start as string | null;
      let skip = !ctx || !l;
      if (!skip && kind === "cancelled") {
        // Cancelada por uma troca aprovada: o e-mail certo é o "horário alterado" da nova.
        const { data: repl } = await admin.from("lessons").select("id").eq("reschedule_of", l.id).in("status", ["agendada", "solicitada"]).limit(1);
        if (repl && repl.length) skip = true;
      }
      if (!skip && kind === "approved" && l.reschedule_of) {
        const { data: orig } = await admin.from("lessons").select("start_at").eq("id", l.reschedule_of).maybeSingle();
        kind = "changed"; oldStart = orig?.start_at ?? null;
      }
      if (!skip && kind === "requested" && l.reschedule_of) {
        const { data: orig } = await admin.from("lessons").select("start_at").eq("id", l.reschedule_of).maybeSingle();
        oldStart = orig?.start_at ?? null;
      }
      if (!skip) {
        const t = await teacherInfo(admin, l);
        const clientKey = { booked: "client_booked", changed: "client_changed", cancelled: "client_cancelled",
          requested: "client_requests", approved: "client_requests", declined: "client_requests" }[kind];
        if (clientKey && pref(ctx!, clientKey)) {
          const m = clientMsg(kind === "approved" ? "booked" : kind, ctx!, l, t.name, oldStart);
          const { emails } = await clientEmails(admin, l);
          if (m) for (const e of emails) { await deliver(admin, apiKey, ctx!, e, m); sent++; }
        }
        if (["booked", "approved", "changed", "cancelled"].includes(kind) && pref(ctx!, "teacher_changes") && t.email) {
          const m = staffMsg(kind, ctx!, l, t.name, oldStart, false);
          if (m) { await deliver(admin, apiKey, ctx!, t.email, m, true); sent++; }
        }
        if (kind === "requested" && pref(ctx!, "admin_requests")) {
          const m = staffMsg(kind, ctx!, l, t.name, oldStart, true);
          if (m) for (const e of await adminEmails(admin, ctx!)) { await deliver(admin, apiKey, ctx!, e, m, true); sent++; }
        }
      }
      await admin.from("email_outbox").update({ sent_at: new Date().toISOString(), attempts: r.attempts + 1, last_error: null }).eq("id", r.id);
    } catch (e) {
      await admin.from("email_outbox").update({ attempts: r.attempts + 1, last_error: String(e).slice(0, 500),
        process_after: new Date(Date.now() + (r.attempts + 1) * 5 * 60000).toISOString() }).eq("id", r.id);
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Lembretes: 18h a véspera, 7h o próprio dia (hora de Brasília)
// ---------------------------------------------------------------------------
function localParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
/** 00:00 de uma data local (YYYY-MM-DD) em Brasília, como instante UTC (Brasília não tem mais horário de verão: -03:00). */
const localMidnight = (date: string) => new Date(`${date}T00:00:00-03:00`);

async function processReminders(admin: Admin, apiKey: string, force?: "eve" | "day") {
  const now = new Date();
  const { date, hour } = localParts(now);
  const kind = force ?? (hour === 18 ? "eve" : hour === 7 ? "day" : null);
  if (!kind) return 0;
  const today = localMidnight(date);
  const from = kind === "eve" ? new Date(today.getTime() + 86400000) : new Date(Math.max(today.getTime(), now.getTime() + 30 * 60000));
  const to = new Date(today.getTime() + (kind === "eve" ? 2 : 1) * 86400000);
  const { data: lessons } = await admin.from("lessons").select("*").eq("status", "agendada")
    .gte("start_at", from.toISOString()).lt("start_at", to.toISOString()).limit(500);
  let sent = 0;
  for (const l of (lessons ?? []) as Lesson[]) {
    const ctx = await ctxFor(admin, l.account_id);
    if (!ctx || !pref(ctx, kind === "eve" ? "reminder_eve" : "reminder_day")) continue;
    const { data: mark } = await admin.from("email_reminders_sent")
      .upsert({ lesson_id: l.id, kind, start_at: l.start_at }, { onConflict: "lesson_id,kind,start_at", ignoreDuplicates: true })
      .select("lesson_id");
    if (!mark || !mark.length) continue;
    try {
      const t = await teacherInfo(admin, l);
      const m = clientMsg(kind, ctx, l, t.name, null);
      const { emails } = await clientEmails(admin, l);
      if (m) for (const e of emails) { await deliver(admin, apiKey, ctx, e, m); sent++; }
    } catch (e) { console.error("reminder", l.id, String(e)); }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Esqueci a senha
// ---------------------------------------------------------------------------
async function passwordReset(admin: Admin, apiKey: string, rawEmail: string, locale: string) {
  const email = real(rawEmail);
  if (!email) return;
  // No máximo 3 por hora para o mesmo e-mail.
  const since = new Date(Date.now() - 3600000).toISOString();
  const { count } = await admin.from("password_reset_requests").select("email", { count: "exact", head: true }).eq("email", email).gte("requested_at", since);
  if ((count ?? 0) >= 3) return;
  await admin.from("password_reset_requests").insert({ email });
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${SITE}/nova-senha` } });
  if (error || !data?.properties?.action_link) return; // e-mail sem conta: não diz nada a quem pediu
  const en = locale === "en";
  await send(apiKey, {
    from: NOREPLY, to: email,
    subject: en ? "Reset your Cronys password" : "Criar uma senha nova no Cronys",
    html: layout(
      en ? "Reset your password" : "Criar uma senha nova",
      [en ? "Someone asked to reset the password of your Cronys account. If it was you, tap the button below. The link works for one hour." :
            "Alguém pediu para trocar a senha da sua conta no Cronys. Se foi você, toque no botão abaixo. O link vale por uma hora.",
       en ? "If it wasn't you, just ignore this email: your password stays the same." : "Se não foi você, é só ignorar este e-mail: a senha continua a mesma."],
      en ? "Sent by Cronys." : "Enviado pelo Cronys.", en,
      { href: data.properties.action_link, label: en ? "Create a new password" : "Criar senha nova" }),
  });
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  ctxCache.clear();
  const apiKey = await secret(admin, "resend_api_key");
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({})) as Record<string, string>;

  if (url.pathname.endsWith("/cron")) {
    const expected = await secret(admin, "emails_cron_secret");
    if (!expected || req.headers.get("x-cron-secret") !== expected) return json({ error: "forbidden" }, 403);
    if (!apiKey) return json({ ok: false, error: "not configured" });
    const sent = body.mode === "reminders" ? await processReminders(admin, apiKey) : await processOutbox(admin, apiKey);
    return json({ ok: true, sent });
  }

  if (body.action === "password_reset") {
    if (apiKey) await passwordReset(admin, apiKey, String(body.email ?? ""), String(body.locale ?? "pt-BR")).catch(e => console.error("reset", String(e)));
    // Sempre a mesma resposta: ninguém descobre se um e-mail tem conta.
    return json({ ok: true });
  }

  if (body.action === "unsubscribe") {
    const key = await secret(admin, "email_unsubscribe_secret");
    const account = String(body.c ?? "");
    let email = "";
    try { email = unb64(String(body.e ?? "")); } catch { /* inválido */ }
    if (!key || !account || !email || (await hmac(key, `${account}|${email}`)) !== String(body.t ?? "")) return json({ ok: false }, 400);
    await admin.from("email_optouts").upsert({ account_id: account, email }, { onConflict: "account_id,email", ignoreDuplicates: true });
    const { data: a } = await admin.from("accounts").select("name").eq("id", account).maybeSingle();
    return json({ ok: true, account: a?.name ?? null });
  }

  if (body.action === "test") {
    const auth = req.headers.get("authorization") ?? "";
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u } = await user.auth.getUser();
    const { data: role } = await admin.from("user_roles").select("account_id").eq("user_id", u?.user?.id ?? "").eq("role", "admin").maybeSingle();
    const to = real(u?.user?.email);
    if (!role || !to) return json({ ok: false, error: "no_email" }, 400);
    if (!apiKey) return json({ ok: false, error: "not configured" }, 503);
    const ctx = await ctxFor(admin, role.account_id);
    if (!ctx) return json({ ok: false }, 400);
    const w = word(ctx);
    const fake: Lesson = { id: "teste", account_id: ctx.account.id, student_name: w.en ? "Sample client" : "Cliente de exemplo", guardian_name: null,
      teacher: "", start_at: new Date(Date.now() + 86400000).toISOString(), duration_minutes: 60, status: "agendada",
      address: null, is_online: true, subject: null, reschedule_of: null };
    const m = clientMsg("eve", ctx, fake, w.en ? "your team" : "a sua equipe", null)!;
    await send(apiKey, {
      from: `${ctx.account.name.replace(/[<>"]/g, "")} <${FROM_ADDRESS}>`, to,
      subject: (w.en ? "[Test] " : "[Teste] ") + m.subject,
      html: layout(m.title, m.lines, w.en ? "This is how reminders look for your clients." : "É assim que os lembretes chegam aos seus clientes.", w.en),
      reply_to: ctx.contact,
    });
    return json({ ok: true, to });
  }

  return json({ error: "unknown action" }, 400);
});

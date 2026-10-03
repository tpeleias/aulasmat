// E-mails automáticos (03/10). O miolo (visual, envio, textos da agenda) está
// em core.ts; a cobrança, o recibo e o histórico, em billing.ts; tarefas,
// resumo, pacote e a agenda de amanhã, em events.ts.
//
//   POST /cron {mode: "outbox" | "reminders"} + x-cron-secret   <- o pg_cron, pelo pg_net
//   POST /webhook                                                <- o Resend: entregue, voltou, spam
//   POST /auth-hook                                              <- Supabase Auth: e-mails de login (auth.ts)
//   POST {action: "password_reset", email, locale?}              <- "Esqueci a senha" (sem login)
//   POST {action: "unsubscribe_check" | "unsubscribe" | "resubscribe", c, e, t, category?}  <- /email/sair
//   POST /unsubscribe?c&e&t                                      <- "cancelar inscrição" do Gmail (um clique)
//   POST {action: "test"}                                        <- admin: um e-mail de teste para si
//   POST {action: "send_charge" | "send_statement", student, guardian}  <- admin: Financeiro
//   POST {action: "charge_all"}                                  <- admin: "Cobrar todos por e-mail"
//   POST {action: "remind_lesson", lesson_id}                    <- admin/profissional: "Lembrar por e-mail"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  adminEmails, applyCustom, CATEGORY_OF, clientEmails, clientMsg, corsHeaders, ctxCache, ctxFor, deliver, esc, FROM_ADDRESS, hmac,
  json, layout, localMidnight, localParts, NOREPLY, pref, real, secret, send, SITE, staffMsg, teacherInfo, unb64, word,
  type Admin, type Lesson, type Msg,
} from "./core.ts";
import { chargeAll, processCharges, processPayments, remindLesson, sendCharge, statementFor } from "./billing.ts";
import { handleAuthHook } from "./auth.ts";
import { homeworkBlock, homeworkDueMail, pendingHomework, processAgenda, processEvents } from "./events.ts";

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
          const k = kind === "approved" ? "booked" : kind;
          if (m) for (const e of emails) { if (await deliver(admin, apiKey, ctx!, e, m, { kind: k, student: l.student_name, guardian: l.guardian_name })) sent++; }
        }
        if (["booked", "approved", "changed", "cancelled"].includes(kind) && pref(ctx!, "teacher_changes") && t.email) {
          const m = staffMsg(kind, ctx!, l, t.name, oldStart, false);
          if (m && await deliver(admin, apiKey, ctx!, t.email, m, { kind, staff: true, student: l.student_name, guardian: l.guardian_name })) sent++;
        }
        if (kind === "requested" && pref(ctx!, "admin_requests")) {
          const m = staffMsg(kind, ctx!, l, t.name, oldStart, true);
          if (m) for (const e of await adminEmails(admin, ctx!)) { if (await deliver(admin, apiKey, ctx!, e, m, { kind, staff: true, student: l.student_name, guardian: l.guardian_name })) sent++; }
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
// Lembretes: a véspera às 18h e o próprio dia às 7h (hora de Brasília); no
// Max, cada empresa escolhe as horas (Ctx.hours).
// ---------------------------------------------------------------------------
async function processReminders(admin: Admin, apiKey: string) {
  const now = new Date();
  const { date, hour } = localParts(now);
  const today = localMidnight(date);
  let sent = 0;
  for (const kind of ["eve", "day"] as const) {
    const from = kind === "eve" ? new Date(today.getTime() + 86400000) : new Date(Math.max(today.getTime(), now.getTime() + 30 * 60000));
    const to = new Date(today.getTime() + (kind === "eve" ? 2 : 1) * 86400000);
    if (from >= to) continue;
    const { data: lessons } = await admin.from("lessons").select("*").eq("status", "agendada")
      .gte("start_at", from.toISOString()).lt("start_at", to.toISOString()).limit(500);
    for (const l of (lessons ?? []) as Lesson[]) {
      const ctx = await ctxFor(admin, l.account_id);
      if (!ctx || ctx.hours[kind] !== hour) continue;
      const remind = pref(ctx, kind === "eve" ? "reminder_eve" : "reminder_day");
      // Na véspera, as tarefas pendentes vão junto do lembrete; sem o lembrete,
      // num e-mail só delas.
      const homework = kind === "eve" && ctx.tasks && pref(ctx, "homework_due");
      if (!remind && !homework) continue;
      const markKind = remind ? kind : "homework";
      const { data: mark } = await admin.from("email_reminders_sent")
        .upsert({ lesson_id: l.id, kind: markKind, start_at: l.start_at }, { onConflict: "lesson_id,kind,start_at", ignoreDuplicates: true })
        .select("lesson_id");
      if (!mark || !mark.length) continue;
      try {
        const pending = homework ? await pendingHomework(admin, l) : [];
        let m: Msg | null = null;
        let k: string = kind;
        if (remind) {
          const t = await teacherInfo(admin, l);
          m = clientMsg(kind, ctx, l, t.name, null);
          if (m && pending.length) m = { ...m, html: [...(m.html ?? []), homeworkBlock(ctx, pending)] };
        } else if (pending.length) {
          m = homeworkDueMail(ctx, l, pending);
          k = "homework_due";
        }
        const { emails } = m ? await clientEmails(admin, l) : { emails: [] as string[] };
        if (m) for (const e of emails) { if (await deliver(admin, apiKey, ctx, e, m, { kind: k, student: l.student_name, guardian: l.guardian_name })) sent++; }
      } catch (e) { console.error("reminder", l.id, String(e)); }
    }
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
    html: layout({
      kicker: en ? "Password" : "Senha", tone: "info",
      title: en ? "Create a new password" : "Criar uma senha nova",
      paragraphs: [
        en ? "Someone asked to reset the password of your Cronys account. If it was you, tap the button below. The link works for one hour." :
             "Alguém pediu para trocar a senha da sua conta no Cronys. Se foi você, toque no botão abaixo. O link vale por uma hora.",
        en ? "If it wasn't you, just ignore this email: your password stays the same." : "Se não foi você, é só ignorar este e-mail: a senha continua a mesma.",
      ],
      cta: { href: data.properties.action_link, label: en ? "Create a new password" : "Criar senha nova" },
    }, { from: "Cronys", en }),
  });
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Webhook do Resend: entregue, voltou, spam (assinatura Svix)
// ---------------------------------------------------------------------------
async function svixValid(secretB64: string, id: string, ts: string, raw: string, header: string) {
  if (!id || !ts || !header || Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
  const keyBytes = Uint8Array.from(atob(secretB64.replace(/^whsec_/, "")), c => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  const mine = btoa(String.fromCharCode(...sig));
  return header.split(" ").some(p => p.split(",")[1] === mine);
}

async function handleWebhook(admin: Admin, req: Request, raw: string) {
  const wh = await secret(admin, "resend_webhook_secret");
  if (!wh || !(await svixValid(wh, req.headers.get("svix-id") ?? "", req.headers.get("svix-timestamp") ?? "", raw, req.headers.get("svix-signature") ?? ""))) {
    return json({ error: "forbidden" }, 403);
  }
  const ev = JSON.parse(raw) as { type?: string; data?: { email_id?: string; to?: string[]; bounce?: { message?: string; type?: string } } };
  const status = { "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained" }[ev.type ?? ""];
  if (!status || !ev.data?.email_id) return json({ ok: true, ignored: ev.type ?? null });
  await admin.from("email_log").update({ status, updated_at: new Date().toISOString() }).eq("resend_id", ev.data.email_id);
  if (status !== "delivered") {
    for (const to of ev.data.to ?? []) {
      const email = real(to);
      if (email) await admin.from("email_bounces").upsert({ email, kind: status, reason: (ev.data.bounce?.message ?? ev.data.bounce?.type ?? "").slice(0, 300) || null });
    }
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Quem está pedindo (ações na mão)
// ---------------------------------------------------------------------------
async function caller(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await user.auth.getUser();
  return u?.user ?? null;
}
async function roleOf(admin: Admin, userId: string) {
  const { data } = await admin.from("user_roles").select("account_id, role").eq("user_id", userId);
  const rows = (data ?? []).filter(r => r.account_id);
  return rows.find(r => r.role === "admin") ?? rows.find(r => r.role === "teacher") ?? null;
}

const CATEGORIES = ["agenda", "lembretes", "financeiro", "tarefas", "resumo"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  ctxCache.clear();
  const url = new URL(req.url);
  const raw = await req.text().catch(() => "");
  if (url.pathname.endsWith("/webhook")) return handleWebhook(admin, req, raw);
  const apiKey = await secret(admin, "resend_api_key");
  if (url.pathname.endsWith("/auth-hook")) return handleAuthHook(admin, req, raw, apiKey);
  let body: Record<string, string> = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* corpo do um-clique do Gmail não é JSON */ }

  if (url.pathname.endsWith("/cron")) {
    const expected = await secret(admin, "emails_cron_secret");
    if (!expected || req.headers.get("x-cron-secret") !== expected) return json({ error: "forbidden" }, 403);
    if (!apiKey) return json({ ok: false, error: "not configured" });
    const sent = body.mode === "reminders"
      ? (await processReminders(admin, apiKey)) + (await processCharges(admin, apiKey)) + (await processAgenda(admin, apiKey))
      : (await processOutbox(admin, apiKey)) + (await processPayments(admin, apiKey)) + (await processEvents(admin, apiKey));
    return json({ ok: true, sent });
  }

  if (body.action === "password_reset") {
    if (apiKey) await passwordReset(admin, apiKey, String(body.email ?? ""), String(body.locale ?? "pt-BR")).catch(e => console.error("reset", String(e)));
    // Sempre a mesma resposta: ninguém descobre se um e-mail tem conta.
    return json({ ok: true });
  }

  // Descadastro. O link do rodapé abre a página do site, que primeiro só
  // pergunta (check) e depois confirma; dá para sair de um tipo só (category)
  // ou de tudo, e voltar (resubscribe). O POST em /unsubscribe é o um-clique
  // do Gmail, que tira de tudo.
  const oneClick = url.pathname.endsWith("/unsubscribe") && req.method === "POST";
  if (oneClick || ["unsubscribe_check", "unsubscribe", "resubscribe"].includes(body.action)) {
    const src = oneClick ? Object.fromEntries(url.searchParams) : body;
    const key = await secret(admin, "email_unsubscribe_secret");
    const account = String(src.c ?? "");
    let email = "";
    try { email = unb64(String(src.e ?? "")); } catch { /* inválido */ }
    if (!key || !account || !email || (await hmac(key, `${account}|${email}`)) !== String(src.t ?? "")) return json({ ok: false }, 400);
    const category = CATEGORIES.includes(String(body.category)) ? String(body.category) : null;
    if (oneClick || body.action === "unsubscribe") {
      if (category) await admin.from("email_optout_categories").upsert({ account_id: account, email, category }, { onConflict: "account_id,email,category", ignoreDuplicates: true });
      else await admin.from("email_optouts").upsert({ account_id: account, email }, { onConflict: "account_id,email", ignoreDuplicates: true });
    } else if (body.action === "resubscribe") {
      if (category) await admin.from("email_optout_categories").delete().eq("account_id", account).eq("email", email).eq("category", category);
      else {
        await admin.from("email_optouts").delete().eq("account_id", account).eq("email", email);
        await admin.from("email_optout_categories").delete().eq("account_id", account).eq("email", email);
      }
    }
    const { data: a } = await admin.from("accounts").select("name").eq("id", account).maybeSingle();
    const { data: all } = await admin.from("email_optouts").select("email").eq("account_id", account).eq("email", email).maybeSingle();
    const { data: cats } = await admin.from("email_optout_categories").select("category").eq("account_id", account).eq("email", email);
    return json({ ok: true, account: a?.name ?? null, email, out: !!all, categories: (cats ?? []).map(c => c.category) });
  }

  // Daqui para baixo, só com login.
  const user = await caller(req);
  if (!user) return json({ ok: false, error: "no_auth" }, 401);
  const role = await roleOf(admin, user.id);
  if (!role) return json({ ok: false, error: "forbidden" }, 403);
  const ctx = await ctxFor(admin, role.account_id);
  if (!ctx) return json({ ok: false }, 400);
  if (!apiKey) return json({ ok: false, error: "not configured" }, 503);
  const isAdmin = role.role === "admin";

  if (body.action === "test") {
    const to = real(user.email);
    if (!isAdmin || !to) return json({ ok: false, error: "no_email" }, 400);
    const w = word(ctx);
    const fake: Lesson = { id: "teste", account_id: ctx.account.id, student_name: w.en ? "Sample client" : "Cliente de exemplo", guardian_name: null,
      teacher: "", start_at: new Date(Date.now() + 86400000).toISOString(), duration_minutes: 60, status: "agendada",
      address: null, is_online: true, subject: null, reschedule_of: null };
    const base = clientMsg("eve", ctx, fake, w.en ? "your team" : "a sua equipe", null)!;
    // Com o visual e o texto da empresa (Pro e Max), para ela ver como fica.
    const m = applyCustom(ctx, "eve", { ...base, paragraphs: [esc(w.en ? "This is how reminders reach your clients." : "É assim que os lembretes chegam aos seus clientes.")] });
    await send(apiKey, {
      from: `${ctx.account.name.replace(/[<>"]/g, "")} <${FROM_ADDRESS}>`, to,
      subject: (w.en ? "[Test] " : "[Teste] ") + m.subject,
      html: layout(m, { from: ctx.account.name, en: w.en, brand: ctx.brand }),
      reply_to: ctx.replyTo,
    });
    return json({ ok: true, to });
  }

  if (body.action === "send_charge" || body.action === "send_statement") {
    if (!isAdmin) return json({ ok: false, error: "forbidden" }, 403);
    const st = await statementFor(admin, ctx, String(body.student ?? ""), (body.guardian ?? null) as string | null);
    if (!st) return json({ ok: false, error: "no_account" }, 404);
    if (body.action === "send_charge" && st.owed <= 0) return json({ ok: false, error: "nothing_owed" }, 400);
    const r = await sendCharge(admin, apiKey, ctx, st, { auto: false, statement: body.action === "send_statement", sentBy: user.id });
    if (!r.hadEmail) return json({ ok: false, error: "no_email" }, 400);
    return json({ ok: true, to: r.to });
  }

  if (body.action === "charge_all") {
    if (!isAdmin) return json({ ok: false, error: "forbidden" }, 403);
    return json({ ok: true, ...(await chargeAll(admin, apiKey, ctx, user.id)) });
  }

  if (body.action === "remind_lesson") {
    const r = await remindLesson(admin, apiKey, ctx, String(body.lesson_id ?? ""), user.id, isAdmin ? null : user.id);
    if (!r.hadEmail) return json({ ok: false, error: "no_email" }, 400);
    return json({ ok: true, to: r.to });
  }

  return json({ error: "unknown action" }, 400);
});

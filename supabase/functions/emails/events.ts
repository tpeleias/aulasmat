// E-mails da etapa 2 (03/10): tarefa nova, tarefas pendentes na véspera,
// resumo do atendimento, pacote acabando e a agenda de amanhã da equipe.
// Ver a migration 20261003070000_email_events.sql.
//
// Os três primeiros (tarefa, resumo, pacote) nascem de gatilhos no banco e
// passam pela fila email_event_outbox; a agenda de amanhã e as tarefas da
// véspera saem às 18h, no cron de hora em hora.
import {
  adminEmails, authEmail, cap1, clientEmails, ctxFor, deliver, esc, fmtDay, fmtTime, lessonRows, localMidnight, localParts,
  pref, real, SITE, taskWord, teacherInfo, word, type Admin, type Ctx, type Lesson, type Msg,
} from "./core.ts";
import { billingRecipients, money, statementFor } from "./billing.ts";

type StudentRow = { id: string; student_name: string; guardian_name: string | null; email: string | null; guardian_email: string | null; user_id: string | null };
type Homework = { id: string; student_id: string; title: string; description: string | null; deadline: string; status: string };

const norm = (x: string | null | undefined) => (x ?? "").trim().toLowerCase();

/** Para quem vai a tarefa: o aluno (e-mail dele), o responsável e o login da família. */
async function homeworkRecipients(admin: Admin, s: StudentRow) {
  const out = new Map<string, string>();
  const child = !!norm(s.guardian_name);
  const portal = `${SITE}/aluno/tarefas`;
  const own = real(s.email);
  if (own) out.set(own, child ? `${SITE}/meu-painel/tarefas` : portal);
  for (const e of [real(s.guardian_email), await authEmail(admin, s.user_id)]) if (e && !out.has(e)) out.set(e, portal);
  return out;
}

async function studentFor(admin: Admin, account: string, student: string, guardian: string | null): Promise<StudentRow | null> {
  const { data } = await admin.from("students").select("id, student_name, guardian_name, email, guardian_email, user_id").eq("account_id", account);
  const rows = (data ?? []) as StudentRow[];
  return rows.find(s => norm(s.student_name) === norm(student) && norm(s.guardian_name) === norm(guardian))
    ?? rows.find(s => norm(s.student_name) === norm(student)) ?? null;
}

const deadlineText = (iso: string, en: boolean) => `${cap1(fmtDay(iso, en))}, ${fmtTime(iso, en)}`;
const multiline = (t: string) => esc(t.trim()).replace(/\r?\n/g, "<br>");

/** A lista de tarefas, em bloco, para o lembrete da véspera e o e-mail só de tarefas. */
export function homeworkBlock(ctx: Ctx, list: Homework[]) {
  const en = ctx.account.locale === "en";
  const t = taskWord(ctx);
  const items = list.map(h => `<tr><td style="padding:8px 0;border-top:1px solid #eee9dd">
<div style="font-size:15px;color:#1d1f27;font-weight:bold">${esc(h.title)}</div>
<div style="font-size:13px;color:#77756c">${esc(en ? "Due" : "Prazo")}: ${esc(deadlineText(h.deadline, en))}</div></td></tr>`).join("");
  return `<p style="font-size:13px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;color:#77756c;margin:4px 0 4px">${esc(en ? `Pending ${t.lp}` : `${t.p} pendentes`)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;border-bottom:1px solid #eee9dd">${items}</table>`;
}

/** As tarefas ainda não entregues de quem tem atendimento. */
export async function pendingHomework(admin: Admin, l: Lesson): Promise<Homework[]> {
  const s = await studentFor(admin, l.account_id, l.student_name, l.guardian_name);
  if (!s) return [];
  const { data } = await admin.from("homework").select("id, student_id, title, description, deadline, status")
    .eq("student_id", s.id).neq("status", "entregue").order("deadline").limit(10);
  return (data ?? []) as Homework[];
}

// ---------------------------------------------------------------------------
// Os textos
// ---------------------------------------------------------------------------
export function homeworkMail(ctx: Ctx, h: Homework, s: StudentRow, link: string): Msg {
  const en = ctx.account.locale === "en";
  const t = taskWord(ctx);
  const novo = en ? `New ${t.l}` : `${t.a("Nova", "Novo")} ${t.l}`;
  const rows: [string, string][] = [
    [en ? "For" : "Para", esc(s.student_name)],
    [en ? "Due" : "Prazo", `<b>${esc(deadlineText(h.deadline, en))}</b>`],
  ];
  return {
    subject: `${novo}: ${h.title}`,
    kicker: novo, tone: "info",
    title: h.title,
    rows,
    paragraphs: h.description?.trim() ? [multiline(h.description)] : [],
    cta: { href: link, label: en ? `See the ${t.l}` : `Ver ${t.a("a", "o")} ${t.l}` },
    vars: { nome: s.student_name, tarefa: h.title, prazo: deadlineText(h.deadline, en) },
  };
}

export function summaryMail(ctx: Ctx, l: Lesson & { class_summary: string }, teacher: string, pending: Homework[]): Msg {
  const w = word(ctx);
  const rows = lessonRows(ctx, l, teacher).filter(([k]) => !["Local", "Where", "Horário", "Time"].includes(k));
  return {
    subject: w.en ? `How the ${w.l} went: ${fmtDay(l.start_at, true)}` : `Como foi ${w.a("a", "o")} ${w.l} de ${fmtDay(l.start_at, false)}`,
    kicker: w.en ? `${w.s} summary` : `Resumo d${w.a("a", "o")} ${w.l}`, tone: "ok",
    title: w.en ? `How ${l.student_name}'s ${w.l} went` : `Como foi ${w.a("a", "o")} ${w.l} de ${l.student_name}`,
    rows,
    html: [
      `<div style="font-size:15px;line-height:1.6;color:#1d1f27;background:#faf8f3;border-left:3px solid #2f7d76;border-radius:6px;padding:12px 14px;margin:0 0 16px">${multiline(l.class_summary)}</div>`,
      ...(pending.length ? [homeworkBlock(ctx, pending)] : []),
    ],
    paragraphs: [esc(w.en ? "Questions? Just reply to this email." : "Alguma dúvida? É só responder este e-mail.")],
    vars: { nome: l.student_name, data: fmtDay(l.start_at, w.en), profissional: teacher },
  };
}

export function packageMail(ctx: Ctx, payer: string, balance: number, out: boolean, sessionsLeft?: number): Msg {
  const w = word(ctx);
  const first = payer.split(/\s+/)[0];
  // Pacote por aulas (08/10): o aviso fala em aulas, não em dinheiro.
  if (sessionsLeft != null) {
    const n = String(Math.round(sessionsLeft * 100) / 100).replace(".", w.en ? "." : ",");
    // Só o número: o plural da palavra do ramo ("sessões") não sai de um "s" no fim.
    const left = n;
    const vars = { nome: first, responsavel: payer, saldo: left };
    return out ? {
      vars,
      subject: w.en ? `Your package has been used up · ${ctx.account.name}` : `O pacote acabou · ${ctx.account.name}`,
      kicker: w.en ? "Package used up" : "Pacote encerrado", tone: "remind",
      title: w.en ? `${first}, your package has been used up` : `${first}, o pacote acabou`,
      rows: balance < 0 ? [[w.en ? "Open" : "Em aberto", `<b>${money(ctx, -balance)}</b>`]] : [],
      paragraphs: [esc(w.en
        ? `The last ${w.l} used the last one in the package. To keep going with a new package, just reply to this email.`
        : `${w.a("A última", "O último")} ${w.l} usou ${w.a("a última", "o último")} do pacote. Para seguir com um pacote novo, é só responder este e-mail.`)],
    } : {
      vars,
      subject: w.en ? `Your package is running out · ${ctx.account.name}` : `Seu pacote está acabando · ${ctx.account.name}`,
      kicker: w.en ? "Package running out" : "Pacote acabando", tone: "remind",
      title: w.en ? `${first}, your package is running out` : `${first}, seu pacote está acabando`,
      rows: [[w.en ? "Left in the package" : "Restam no pacote", `<b>${esc(left)}</b>`]],
      paragraphs: [esc(w.en ? `To renew, just reply to this email.` : `Para renovar, é só responder este e-mail.`)],
    };
  }
  const vars = { nome: first, responsavel: payer, saldo: money(ctx, Math.max(0, balance)) };
  return out ? {
    vars,
    subject: w.en ? `Your package has been used up · ${ctx.account.name}` : `Os créditos do pacote acabaram · ${ctx.account.name}`,
    kicker: w.en ? "Package used up" : "Pacote encerrado", tone: "remind",
    title: w.en ? `${first}, your package has been used up` : `${first}, os créditos do pacote acabaram`,
    rows: balance < 0 ? [[w.en ? "Open" : "Em aberto", `<b>${money(ctx, -balance)}</b>`]] : [],
    paragraphs: [esc(w.en
      ? `The last ${w.l} used the remaining credit. To keep going with a new package, just reply to this email.`
      : `${w.a("A última", "O último")} ${w.l} usou o crédito que faltava. Para seguir com um pacote novo, é só responder este e-mail.`)],
  } : {
    vars,
    subject: w.en ? `Your package is running out · ${ctx.account.name}` : `Seu pacote está acabando · ${ctx.account.name}`,
    kicker: w.en ? "Package running out" : "Pacote acabando", tone: "remind",
    title: w.en ? `${first}, your package is running out` : `${first}, seu pacote está acabando`,
    rows: [[w.en ? "Credit left" : "Crédito restante", `<b>${money(ctx, balance)}</b>`]],
    paragraphs: [esc(w.en
      ? `What's left doesn't cover another full ${w.l}. To renew, just reply to this email.`
      : `O que sobrou não cobre ${w.a("outra", "outro")} ${w.l} inteir${w.a("a", "o")}. Para renovar, é só responder este e-mail.`)],
  };
}

export function agendaMail(ctx: Ctx, date: string, lessons: (Lesson & { teacherName: string })[], forAdmin: boolean): Msg {
  const w = word(ctx);
  const day = cap1(fmtDay(`${date}T12:00:00-03:00`, w.en));
  const rows = lessons.map(l => {
    const where = l.is_online ? (w.en ? "Online" : "On-line") : l.address ?? "";
    const extra = [l.subject, forAdmin ? l.teacherName : null, where].filter(Boolean).map(x => esc(String(x))).join(" · ");
    return `<tr><td style="padding:9px 12px 9px 0;border-top:1px solid #eee9dd;font-size:15px;font-weight:bold;color:#1d1f27;white-space:nowrap;vertical-align:top;width:56px">${esc(fmtTime(l.start_at, w.en))}</td>
<td style="padding:9px 0;border-top:1px solid #eee9dd;vertical-align:top"><div style="font-size:15px;color:#1d1f27">${esc(l.student_name)}</div>${extra ? `<div style="font-size:13px;color:#77756c">${extra}</div>` : ""}</td></tr>`;
  }).join("");
  const n = lessons.length;
  return {
    subject: w.en ? `Tomorrow: ${n} ${n === 1 ? w.l : `${w.l}s`} · ${day}` : `Amanhã: ${n} ${n === 1 ? w.l : `${w.l}s`} · ${day}`,
    kicker: w.en ? "Tomorrow's schedule" : "Agenda de amanhã", tone: "info",
    title: day,
    html: [`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;border-bottom:1px solid #eee9dd">${rows}</table>`],
    cta: { href: `${SITE}/admin`, label: w.en ? "Open Cronys" : "Abrir o Cronys" },
  };
}

// ---------------------------------------------------------------------------
// A fila (tarefa, resumo, pacote)
// ---------------------------------------------------------------------------
export async function processEvents(admin: Admin, apiKey: string) {
  const { data: rows } = await admin.from("email_event_outbox").select("id, account_id, kind, ref_id, attempts")
    .is("sent_at", null).lt("attempts", 5).lte("process_after", new Date().toISOString()).order("created_at").limit(30);
  let sent = 0;
  for (const r of rows ?? []) {
    try {
      const ctx = await ctxFor(admin, r.account_id);
      if (ctx && r.kind === "homework") sent += await sendHomework(admin, apiKey, ctx, r.ref_id);
      if (ctx && r.kind === "summary") sent += await sendSummary(admin, apiKey, ctx, r.ref_id);
      if (ctx && r.kind === "package") sent += await sendPackage(admin, apiKey, ctx, r.ref_id);
      await admin.from("email_event_outbox").update({ sent_at: new Date().toISOString(), attempts: r.attempts + 1, last_error: null }).eq("id", r.id);
    } catch (e) {
      await admin.from("email_event_outbox").update({ attempts: r.attempts + 1, last_error: String(e).slice(0, 500),
        process_after: new Date(Date.now() + (r.attempts + 1) * 5 * 60000).toISOString() }).eq("id", r.id);
    }
  }
  return sent;
}

async function sendHomework(admin: Admin, apiKey: string, ctx: Ctx, id: string) {
  if (!ctx.tasks || !pref(ctx, "homework_new")) return 0;
  const { data: h } = await admin.from("homework").select("id, student_id, title, description, deadline, status").eq("id", id).maybeSingle();
  if (!h || h.status === "entregue") return 0;
  const { data: s } = await admin.from("students").select("id, student_name, guardian_name, email, guardian_email, user_id")
    .eq("id", h.student_id).eq("account_id", ctx.account.id).maybeSingle();
  if (!s) return 0;
  let sent = 0;
  for (const [e, link] of await homeworkRecipients(admin, s as StudentRow)) {
    if (await deliver(admin, apiKey, ctx, e, homeworkMail(ctx, h as Homework, s as StudentRow, link), { kind: "homework", student: s.student_name, guardian: s.guardian_name })) sent++;
  }
  return sent;
}

async function sendSummary(admin: Admin, apiKey: string, ctx: Ctx, lessonId: string) {
  if (!pref(ctx, "class_summary")) return 0;
  const { data: l } = await admin.from("lessons").select("*").eq("id", lessonId).eq("account_id", ctx.account.id).maybeSingle();
  if (!l || !String(l.class_summary ?? "").trim() || l.status === "cancelada") return 0;
  const lesson = l as Lesson & { class_summary: string };
  const t = await teacherInfo(admin, lesson);
  const pending = ctx.tasks && pref(ctx, "homework_due") ? await pendingHomework(admin, lesson) : [];
  const m = summaryMail(ctx, lesson, t.name, pending);
  const { emails } = await clientEmails(admin, lesson);
  let sent = 0;
  for (const e of emails) if (await deliver(admin, apiKey, ctx, e, m, { kind: "class_summary", student: lesson.student_name, guardian: lesson.guardian_name })) sent++;
  return sent;
}

const accountKeyOf = (t: { guardian_name: string | null; student_name: string }) =>
  (t.guardian_name ?? "").trim() ? `g:${t.guardian_name!.trim().toLowerCase()}` : `s:${t.student_name.trim().toLowerCase()}`;

/**
 * Depois do débito de um atendimento, de quem já comprou pacote: avisa uma
 * vez quando o crédito não cobre mais um atendimento igual, e uma vez quando
 * acaba. "Uma vez" vale por pacote comprado (a chave leva o último pacote).
 */
async function sendPackage(admin: Admin, apiKey: string, ctx: Ctx, txId: string) {
  if (!pref(ctx, "package_low")) return 0;
  const { data: tx } = await admin.from("wallet_transactions").select("id, guardian_name, student_name, amount, lesson_id").eq("id", txId).maybeSingle();
  if (!tx || !tx.lesson_id) return 0;
  const payerOf = (t: { guardian_name: string | null; student_name: string }) => (t.guardian_name ?? "").trim() || t.student_name;

  // Pacote por aulas (08/10): se esta aula gastou pacote, o aviso conta aulas.
  const { data: used } = await admin.from("package_uses").select("purchase_id").eq("lesson_id", tx.lesson_id);
  if (used?.length) {
    const { data: buys } = await admin.from("package_purchases").select("id, sessions, student_name, guardian_name, created_at")
      .eq("account_id", ctx.account.id).order("created_at");
    const mine = (buys ?? []).filter(p => accountKeyOf(p) === accountKeyOf(tx));
    if (!mine.length) return 0;
    const { data: allUses } = await admin.from("package_uses").select("purchase_id, sessions").in("purchase_id", mine.map(p => p.id));
    const usedBy = new Map<string, number>();
    for (const u of allUses ?? []) usedBy.set(u.purchase_id, (usedBy.get(u.purchase_id) ?? 0) + Number(u.sessions));
    const left = Math.round(mine.reduce((s, p) => s + Math.max(0, Number(p.sessions) - (usedBy.get(p.id) ?? 0)), 0) * 100) / 100;
    const state = left <= 0.004 ? "out" : left <= 1.004 ? "low" : null;
    if (!state) return 0;
    const last = used[used.length - 1].purchase_id;
    const { data: mark } = await admin.from("email_event_sent")
      .upsert({ account_id: ctx.account.id, key: `pkgs:${last}:${state}` }, { onConflict: "account_id,key", ignoreDuplicates: true }).select("key");
    if (!mark?.length) return 0;
    const st = await statementFor(admin, ctx, tx.student_name, tx.guardian_name);
    const m = packageMail(ctx, payerOf(tx), st?.balance ?? 0, state === "out", left);
    let sent = 0;
    for (const e of await billingRecipients(admin, ctx, { guardian: (tx.guardian_name ?? "").trim() || null, student: tx.student_name })) {
      if (await deliver(admin, apiKey, ctx, e, m, { kind: "package", student: tx.student_name, guardian: tx.guardian_name })) sent++;
    }
    return sent;
  }

  const st = await statementFor(admin, ctx, tx.student_name, tx.guardian_name);
  if (!st) return 0;
  const { data: vouchers } = await admin.from("wallet_transactions").select("amount").eq("lesson_id", tx.lesson_id).eq("kind", "voucher");
  const cost = Math.max(0, -Number(tx.amount) - (vouchers ?? []).reduce((s, v) => s + Number(v.amount), 0));
  if (cost <= 0) return 0;
  // O saldo de agora já tem este débito; antes dele havia saldo + custo.
  const after = st.balance, before = after + cost;
  const state = after <= 0.004 && before > 0.004 ? "out" : after > 0.004 && after < cost - 0.004 ? "low" : null;
  if (!state) return 0;
  const key = (tx.guardian_name ?? "").trim() ? `g:${tx.guardian_name.trim().toLowerCase()}` : `s:${tx.student_name.trim().toLowerCase()}`;
  const { data: pkg } = await admin.from("wallet_transactions").select("id, guardian_name, student_name").eq("account_id", ctx.account.id)
    .eq("kind", "package").order("created_at", { ascending: false }).limit(200);
  const last = (pkg ?? []).find(p => ((p.guardian_name ?? "").trim() ? `g:${p.guardian_name.trim().toLowerCase()}` : `s:${p.student_name.trim().toLowerCase()}`) === key);
  if (!last) return 0;
  const { data: mark } = await admin.from("email_event_sent")
    .upsert({ account_id: ctx.account.id, key: `pkg:${last.id}:${state}` }, { onConflict: "account_id,key", ignoreDuplicates: true }).select("key");
  if (!mark?.length) return 0;
  const payer = (tx.guardian_name ?? "").trim() || tx.student_name;
  const m = packageMail(ctx, payer, after, state === "out");
  let sent = 0;
  for (const e of await billingRecipients(admin, ctx, { guardian: (tx.guardian_name ?? "").trim() || null, student: tx.student_name })) {
    if (await deliver(admin, apiKey, ctx, e, m, { kind: "package", student: tx.student_name, guardian: tx.guardian_name })) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// 18h: a agenda de amanhã, para cada profissional e para os admins
// ---------------------------------------------------------------------------
export async function processAgenda(admin: Admin, apiKey: string, now = new Date()) {
  const { date, hour } = localParts(now);
  if (hour !== 18) return 0;
  const start = new Date(localMidnight(date).getTime() + 86400000);
  const tomorrow = localParts(new Date(start.getTime() + 12 * 3600000)).date;
  const { data: lessons } = await admin.from("lessons").select("*").eq("status", "agendada")
    .gte("start_at", start.toISOString()).lt("start_at", new Date(start.getTime() + 86400000).toISOString()).order("start_at").limit(1000);
  const byAccount = new Map<string, Lesson[]>();
  for (const l of (lessons ?? []) as Lesson[]) byAccount.set(l.account_id, [...(byAccount.get(l.account_id) ?? []), l]);
  let sent = 0;
  for (const [account, list] of byAccount) {
    const ctx = await ctxFor(admin, account);
    if (!ctx || !pref(ctx, "agenda_tomorrow")) continue;
    try {
      const withNames: (Lesson & { teacherName: string; teacherEmail: string | null })[] = [];
      for (const l of list) { const t = await teacherInfo(admin, l); withNames.push({ ...l, teacherName: t.name, teacherEmail: t.email }); }
      const admins = await adminEmails(admin, ctx);
      const targets = new Map<string, { list: typeof withNames; forAdmin: boolean }>();
      // O admin vê tudo; quem é admin e também atende não recebe dois.
      for (const e of admins) targets.set(e, { list: withNames, forAdmin: new Set(withNames.map(l => l.teacher)).size > 1 });
      for (const l of withNames) {
        if (!l.teacherEmail || admins.includes(l.teacherEmail)) continue;
        const cur = targets.get(l.teacherEmail) ?? { list: [], forAdmin: false };
        cur.list.push(l);
        targets.set(l.teacherEmail, cur);
      }
      for (const [e, t] of targets) {
        const { data: mark } = await admin.from("email_event_sent")
          .upsert({ account_id: account, key: `agenda:${tomorrow}:${e}` }, { onConflict: "account_id,key", ignoreDuplicates: true }).select("key");
        if (!mark?.length) continue;
        if (await deliver(admin, apiKey, ctx, e, agendaMail(ctx, tomorrow, t.list, t.forAdmin), { kind: "agenda_tomorrow", staff: true })) sent++;
      }
    } catch (e) { console.error("agenda", account, String(e)); }
  }
  return sent;
}

/** Só as tarefas, na véspera, para quem desligou o lembrete mas quer as tarefas. */
export function homeworkDueMail(ctx: Ctx, l: Lesson, list: Homework[]): Msg {
  const w = word(ctx);
  const t = taskWord(ctx);
  return {
    subject: w.en ? `${t.p} for tomorrow's ${w.l}` : `${t.p} para ${w.a("a", "o")} ${w.l} de amanhã`,
    kicker: t.p, tone: "remind",
    title: w.en ? `${l.student_name} has pending ${t.lp}` : `${l.student_name} tem ${t.lp} pendentes`,
    rows: [[w.en ? "Next" : "Próxim" + w.a("a", "o"), esc(`${cap1(fmtDay(l.start_at, w.en))}, ${fmtTime(l.start_at, w.en)}`)]],
    html: [homeworkBlock(ctx, list)],
    cta: { href: `${SITE}/aluno/tarefas`, label: w.en ? `See the ${t.lp}` : `Ver ${t.a("as", "os")} ${t.lp}` },
  };
}

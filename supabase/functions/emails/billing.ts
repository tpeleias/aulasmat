// Cobrança por e-mail, "pagamento recebido" com recibo e lembrete manual
// (03/10). O valor sai da mesma conta do Financeiro (_shared/statements.ts) e
// o Pix copia e cola do mesmo código do WhatsApp (_shared/pix.ts).
//
// Automática (cada empresa escolhe uma ou mais, em Configurações):
//   billing_daily    19h, para quem teve atendimento realizado no dia
//   billing_weekly   segunda, 9h
//   billing_monthly  dia billing_month_day (1 a 28), 9h
// Só vai para quem tem saldo em aberto, e no máximo uma vez por período
// (email_charge_sent). Precisa do plano com email_billing (Start, Pro e Max).
import { jsPDF } from "npm:jspdf@4.2.1";
import { computeStatementsCore, type AccountStatement, type LedgerLesson, type LedgerTx, type OpenItem } from "../_shared/statements.ts";
import { buildPixPayload } from "../_shared/pix.ts";
import { amountInWordsFor } from "../_shared/extenso.ts";
import {
  authEmail, cap1, clientEmails, clientMsg, ctxFor, deliver, esc, fmtDay, fmtTime, localMidnight, localParts, pref,
  real, teacherInfo, word, type Admin, type Ctx, type Lesson, type Msg,
} from "./core.ts";

const NOTE_AUTO_PT = "Mensagem enviada automaticamente. Caso o pagamento já tenha sido realizado, por favor, desconsidere este aviso.";
const NOTE_AUTO_EN = "This message was sent automatically. If you have already made the payment, please disregard this notice.";
const NOTE_PT = "Caso o pagamento já tenha sido realizado, por favor, desconsidere este aviso.";
const NOTE_EN = "If you have already made the payment, please disregard this notice.";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function money(ctx: Ctx, v: number) {
  const en = ctx.account.locale === "en";
  return new Intl.NumberFormat(en ? "en-US" : "pt-BR", { style: "currency", currency: ctx.account.currency || "BRL" })
    .format(v).replace(/ /g, " ");
}

const shortDay = (iso: string, en: boolean) =>
  cap1(new Date(iso).toLocaleDateString(en ? "en-US" : "pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", ""));

// ---------------------------------------------------------------------------
// Extratos
// ---------------------------------------------------------------------------
export async function loadStatements(admin: Admin, ctx: Ctx): Promise<AccountStatement[]> {
  const { data: txs } = await admin.from("wallet_transactions")
    .select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at")
    .eq("account_id", ctx.account.id).order("created_at").limit(20000);
  const ids = [...new Set((txs ?? []).map(t => t.lesson_id).filter(Boolean))] as string[];
  const lessons: LedgerLesson[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("lessons").select("id, student_name, start_at, duration_minutes, subject, teacher").in("id", ids.slice(i, i + 200));
    lessons.push(...((data ?? []) as LedgerLesson[]));
  }
  const en = ctx.account.locale === "en";
  return computeStatementsCore((txs ?? []) as LedgerTx[], lessons, {
    appointment: word(ctx).s,
    entry: en ? "Entry" : "Lançamento",
    accountLabel: t => (t.guardian_name ?? "").trim() || t.student_name,
  });
}

export async function statementFor(admin: Admin, ctx: Ctx, student: string, guardian: string | null) {
  const key = (guardian ?? "").trim() ? `g:${guardian!.trim().toLowerCase()}` : `s:${student.trim().toLowerCase()}`;
  return (await loadStatements(admin, ctx)).find(s => s.key === key) ?? null;
}

/**
 * Para quem vai a cobrança: com responsável, o e-mail do responsável e o do
 * login da família (nunca o do aluno - não se cobra uma criança); sem
 * responsável, o do cliente.
 */
export async function billingRecipients(admin: Admin, ctx: Ctx, st: Pick<AccountStatement, "guardian" | "student">) {
  const { data } = await admin.from("students").select("student_name, guardian_name, email, guardian_email, user_id").eq("account_id", ctx.account.id);
  const norm = (x: string | null | undefined) => (x ?? "").trim().toLowerCase();
  const out = new Set<string>();
  const rows = (data ?? []).filter(s => st.guardian
    ? norm(s.guardian_name) === norm(st.guardian)
    : norm(s.student_name) === norm(st.student) && !norm(s.guardian_name));
  for (const s of rows) {
    for (const e of [st.guardian ? real(s.guardian_email) : real(s.email), await authEmail(admin, s.user_id)]) if (e) out.add(e);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Os textos
// ---------------------------------------------------------------------------
function itemsTable(ctx: Ctx, items: OpenItem[]) {
  const en = ctx.account.locale === "en";
  const several = new Set(items.map(i => i.student.trim().toLowerCase())).size > 1;
  const rows = items.map(i => {
    const what = `${esc(i.detail.replace(/ \((\d+) min\)$/, " · $1 min"))}${several ? ` · ${esc(i.student)}` : ""}`;
    const disc = i.discount ? `<div style="font-size:12px;color:#2f7d76">${en ? "Discount" : "Desconto"}: − ${money(ctx, i.discount.amount)}</div>` : "";
    const part = i.partial ? `<div style="font-size:12px;color:#8b897f">${en ? "Partly paid" : "Parte já paga"}</div>` : "";
    return `<tr><td style="padding:8px 8px 8px 0;border-bottom:1px solid #f0ece2;font-size:14px;color:#1d1f27;vertical-align:top;white-space:nowrap">${esc(shortDay(i.date, en))}</td>
<td style="padding:8px 8px;border-bottom:1px solid #f0ece2;font-size:14px;color:#3a3c46;vertical-align:top">${what}${disc}${part}</td>
<td style="padding:8px 0 8px 8px;border-bottom:1px solid #f0ece2;font-size:14px;color:#1d1f27;vertical-align:top;text-align:right;white-space:nowrap">${money(ctx, i.amount)}</td></tr>`;
  }).join("");
  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px">${rows}
<tr><td colspan="2" style="padding:12px 8px 0 0;font-size:15px;font-weight:bold;color:#13141b">${en ? "Total due" : "Total a pagar"}</td>
<td style="padding:12px 0 0 8px;font-size:17px;font-weight:bold;color:#13141b;text-align:right;white-space:nowrap">${money(ctx, total)}</td></tr></table>`;
}

function payBlock(ctx: Ctx, total: number) {
  const en = ctx.account.locale === "en";
  const s = ctx.settings;
  const key = String(s.pix_key ?? "").trim();
  const link = String(s.payment_link ?? "").trim();
  const blocks: string[] = [];
  if (key && total > 0) {
    const code = buildPixPayload({ key, name: String(s.pix_receiver_name ?? ""), city: String(s.pix_city ?? ""), amount: total });
    blocks.push(`<div style="background:#f7f5ef;border:1px solid #e6e1d4;border-radius:12px;padding:14px 16px;margin:0 0 14px">
<div style="font-size:13px;font-weight:bold;color:#13141b;margin:0 0 6px">Pix</div>
<div style="font-size:14px;color:#3a3c46;margin:0 0 ${code ? "10px" : "0"}">${en ? "Key" : "Chave"}: <b>${esc(key)}</b></div>
${code ? `<div style="font-size:12px;color:#77756c;margin:0 0 4px">${en ? "Pix copy and paste, with the amount already filled in:" : "Pix copia e cola, já com o valor:"}</div>
<div style="font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.5;color:#1d1f27;background:#ffffff;border:1px dashed #d9d3c3;border-radius:8px;padding:10px;word-break:break-all">${esc(code)}</div>` : ""}
</div>`);
  }
  return { blocks, link: link ? { href: link, label: String(s.payment_link_label ?? "").trim() || (en ? "Pay online" : "Pagar on-line") } : undefined, note: String(s.payment_link_note ?? "").trim() };
}

export function chargeMail(ctx: Ctx, st: AccountStatement, o: { auto: boolean; statement?: boolean }): Msg {
  const en = ctx.account.locale === "en";
  const name = (st.guardian ?? st.student).trim().split(/\s+/)[0];
  if (st.owed <= 0) {
    // Extrato de quem está em dia (só na mão: a automática nem chega aqui).
    return {
      subject: en ? `Your statement · ${ctx.account.name}` : `Seu extrato · ${ctx.account.name}`,
      kicker: en ? "Statement" : "Extrato", tone: "ok",
      title: en ? `All set, ${name}!` : `Tudo em dia, ${name}!`,
      paragraphs: [esc(st.credits > 0
        ? (en ? `There's nothing to pay, and you have ${money(ctx, st.credits)} in credit.` : `Não há nada em aberto, e você tem ${money(ctx, st.credits)} de crédito.`)
        : (en ? "There's nothing to pay right now." : "Não há nada em aberto no momento."))],
    };
  }
  const pay = payBlock(ctx, st.owed);
  const intro = o.statement
    ? (en ? `Here is your statement with ${ctx.account.name}.` : `Segue o seu extrato com ${ctx.account.name}.`)
    : (en ? `This is a reminder of the open balance with ${ctx.account.name}.` : `Este é um lembrete do valor em aberto com ${ctx.account.name}.`);
  const p = (t: string) => `<p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#3a3c46">${esc(t)}</p>`;
  const button = pay.link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 14px"><tr><td style="background:#c9a24b;border-radius:10px"><a href="${esc(pay.link.href)}" style="display:inline-block;padding:13px 20px;font-size:15px;font-weight:bold;color:#13141b;text-decoration:none">${esc(pay.link.label)}</a></td></tr></table>`
    : "";
  return {
    subject: en ? `Payment due: ${money(ctx, st.owed)} · ${ctx.account.name}` : `Pagamento em aberto: ${money(ctx, st.owed)} · ${ctx.account.name}`,
    kicker: en ? "Payment" : "Pagamento", tone: "change",
    title: en ? `Hi ${name}, here's what's open` : `Olá, ${name}! Veja o que está em aberto`,
    html: [p(intro), itemsTable(ctx, st.items), ...pay.blocks, button,
      ...(pay.note ? [`<p style="font-size:13px;color:#77756c;margin:0 0 14px">${esc(pay.note)}</p>`] : [])],
    paragraphs: [esc(en ? "Any questions? Just reply to this email." : "Alguma dúvida? É só responder este e-mail.")],
    note: o.auto ? (en ? NOTE_AUTO_EN : NOTE_AUTO_PT) : (en ? NOTE_EN : NOTE_PT),
  };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------
export async function sendCharge(admin: Admin, apiKey: string, ctx: Ctx, st: AccountStatement,
  o: { auto: boolean; statement?: boolean; sentBy?: string | null }) {
  const to = await billingRecipients(admin, ctx, st);
  const m = chargeMail(ctx, st, o);
  const sent: string[] = [];
  for (const e of to) {
    if (await deliver(admin, apiKey, ctx, e, m, { kind: o.statement ? "statement" : "charge", student: st.student, guardian: st.guardian, sentBy: o.sentBy })) sent.push(e);
  }
  return { to: sent, hadEmail: to.length > 0 };
}

/** "Cobrar todos por e-mail": todo mundo com saldo em aberto e e-mail. */
export async function chargeAll(admin: Admin, apiKey: string, ctx: Ctx, sentBy: string) {
  let accounts = 0, emails = 0, noEmail = 0;
  for (const st of (await loadStatements(admin, ctx)).filter(s => s.owed > 0)) {
    const r = await sendCharge(admin, apiKey, ctx, st, { auto: false, sentBy });
    if (!r.hadEmail) noEmail++;
    if (r.to.length) { accounts++; emails += r.to.length; }
  }
  return { accounts, emails, noEmail };
}

/** A cobrança automática, chamada de hora em hora junto com os lembretes. */
export async function processCharges(admin: Admin, apiKey: string, now = new Date()) {
  const { date, hour } = localParts(now);
  if (hour !== 19 && hour !== 9) return 0;
  const weekday = new Date(`${date}T12:00:00-03:00`).getUTCDay();
  const dayOfMonth = Number(date.slice(8, 10));
  const { data: rows } = await admin.from("settings").select("account_id, email_notifications").eq("email_notifications->>enabled", "true");
  let sent = 0;
  for (const r of rows ?? []) {
    const p = (r.email_notifications ?? {}) as Record<string, unknown>;
    const periods: { key: string; daily: boolean }[] = [];
    if (hour === 19 && p.billing_daily === true) periods.push({ key: `d:${date}`, daily: true });
    if (hour === 9 && p.billing_weekly === true && weekday === 1) periods.push({ key: `w:${date}`, daily: false });
    const md = Math.min(28, Math.max(1, Number(p.billing_month_day) || 1));
    if (hour === 9 && p.billing_monthly === true && dayOfMonth === md) periods.push({ key: `m:${date.slice(0, 7)}`, daily: false });
    if (!periods.length) continue;
    const { data: can } = await admin.rpc("account_can", { _capability: "email_billing", _account: r.account_id });
    if (can !== true) continue;
    const ctx = await ctxFor(admin, r.account_id);
    if (!ctx) continue;
    const statements = (await loadStatements(admin, ctx)).filter(s => s.owed > 0);
    if (!statements.length) continue;

    // No resumo do dia, só quem teve atendimento realizado hoje.
    let today: Set<string> | null = null;
    if (periods.some(x => x.daily)) {
      const start = localMidnight(date);
      const { data: ls } = await admin.from("lessons").select("student_name, guardian_name").eq("account_id", ctx.account.id).eq("status", "realizada")
        .gte("start_at", start.toISOString()).lt("start_at", new Date(start.getTime() + 86400000).toISOString());
      today = new Set((ls ?? []).map(l => ((l.guardian_name ?? "").trim() ? `g:${l.guardian_name.trim().toLowerCase()}` : `s:${l.student_name.trim().toLowerCase()}`)));
    }
    for (const period of periods) {
      for (const st of statements) {
        if (period.daily && !today!.has(st.key)) continue;
        const { data: mark } = await admin.from("email_charge_sent")
          .upsert({ account_id: ctx.account.id, account_key: st.key, period_key: period.key }, { onConflict: "account_id,account_key,period_key", ignoreDuplicates: true })
          .select("account_key");
        if (!mark?.length) continue;
        try { sent += (await sendCharge(admin, apiKey, ctx, st, { auto: true })).to.length; }
        catch (e) { console.error("charge", st.key, String(e)); }
      }
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Pagamento recebido, com recibo
// ---------------------------------------------------------------------------
function receiptPdf(ctx: Ctx, d: { payer: string; amount: number; date: string; description: string; balanceLine: string }): string {
  const en = ctx.account.locale === "en";
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 20;
  let y = 28;
  const s = ctx.settings;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text(ctx.account.name, W / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  for (const line of [s.issuer_document, ctx.contact].filter(Boolean) as string[]) { y += 6; doc.text(String(line), W / 2, y, { align: "center" }); }
  y += 14; doc.line(M, y, W - M, y); y += 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(en ? "PAYMENT RECEIPT" : "RECIBO DE PAGAMENTO", W / 2, y, { align: "center" });
  doc.setFontSize(12); doc.text(money(ctx, d.amount), W - M, y, { align: "right" });
  y += 14;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  const words = amountInWordsFor(d.amount, en, ctx.account.currency || "BRL").toLowerCase();
  const body = en
    ? `Received from ${d.payer} the amount of ${money(ctx, d.amount)} (${words}), on ${d.date}, for: ${d.description}.`
    : `Recebi de ${d.payer} a quantia de ${money(ctx, d.amount)} (${words}), em ${d.date}, referente a: ${d.description}.`;
  const wrapped = doc.splitTextToSize(body, W - 2 * M);
  doc.text(wrapped, M, y); y += wrapped.length * 6 + 6;
  doc.setFontSize(10); doc.text(d.balanceLine, M, y);
  y = 230;
  doc.text(`${en ? "Issued on" : "Emitido em"} ${d.date}`, W - M, y - 18, { align: "right" });
  doc.line(W / 2 - 40, y, W / 2 + 40, y);
  doc.text(ctx.account.name, W / 2, y + 6, { align: "center" });
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function processPayments(admin: Admin, apiKey: string) {
  const { data: rows } = await admin.from("email_payment_outbox").select("id, account_id, tx_id, attempts")
    .is("sent_at", null).lt("attempts", 5).lte("process_after", new Date().toISOString()).order("created_at").limit(30);
  let sent = 0;
  for (const r of rows ?? []) {
    try {
      const ctx = await ctxFor(admin, r.account_id);
      const { data: tx } = await admin.from("wallet_transactions").select("id, guardian_name, student_name, amount, kind, description, created_at").eq("id", r.tx_id).maybeSingle();
      if (ctx && tx && Number(tx.amount) > 0 && pref(ctx, "payment_received")) {
        const en = ctx.account.locale === "en";
        const st = await statementFor(admin, ctx, tx.student_name, tx.guardian_name);
        const payer = (tx.guardian_name ?? "").trim() || tx.student_name;
        const date = new Date(tx.created_at).toLocaleDateString(en ? "en-US" : "pt-BR", { timeZone: "America/Sao_Paulo" });
        const description = (tx.description ?? "").trim() || (en ? "payment" : "pagamento");
        const balanceLine = !st ? "" : st.owed > 0
          ? (en ? `Still open: ${money(ctx, st.owed)}.` : `Ainda em aberto: ${money(ctx, st.owed)}.`)
          : st.credits > 0 ? (en ? `Credit available: ${money(ctx, st.credits)}.` : `Crédito disponível: ${money(ctx, st.credits)}.`)
          : (en ? "Everything is paid up." : "Tudo em dia.");
        const m: Msg = {
          subject: en ? `Payment received: ${money(ctx, Number(tx.amount))} · ${ctx.account.name}` : `Pagamento recebido: ${money(ctx, Number(tx.amount))} · ${ctx.account.name}`,
          kicker: en ? "Payment received" : "Pagamento recebido", tone: "ok",
          title: en ? `Thank you, ${payer.split(/\s+/)[0]}!` : `Obrigado, ${payer.split(/\s+/)[0]}!`,
          rows: [
            [en ? "Amount" : "Valor", `<b>${money(ctx, Number(tx.amount))}</b>`],
            [en ? "Date" : "Data", esc(date)],
            [en ? "For" : "Referente a", esc(description)],
            ...(balanceLine ? [[en ? "Balance" : "Situação", esc(balanceLine)] as [string, string]] : []),
          ],
          paragraphs: [esc(en ? "The receipt is attached as a PDF." : "O recibo vai em anexo, em PDF.")],
        };
        // Sem o PDF (se a biblioteca falhar), o aviso sai do mesmo jeito.
        let attachments: { filename: string; content: string }[] = [];
        try {
          attachments = [{ filename: `${en ? "receipt" : "recibo"}-${date.replace(/\//g, "-")}.pdf`, content: receiptPdf(ctx, { payer, amount: Number(tx.amount), date, description, balanceLine }) }];
        } catch (e) { console.error("receipt pdf", String(e)); m.paragraphs = []; }
        for (const e of await billingRecipients(admin, ctx, { guardian: (tx.guardian_name ?? "").trim() || null, student: tx.student_name })) {
          if (await deliver(admin, apiKey, ctx, e, m, { kind: "payment", student: tx.student_name, guardian: tx.guardian_name, attachments })) sent++;
        }
      }
      await admin.from("email_payment_outbox").update({ sent_at: new Date().toISOString(), attempts: r.attempts + 1, last_error: null }).eq("id", r.id);
    } catch (e) {
      await admin.from("email_payment_outbox").update({ attempts: r.attempts + 1, last_error: String(e).slice(0, 500),
        process_after: new Date(Date.now() + (r.attempts + 1) * 5 * 60000).toISOString() }).eq("id", r.id);
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Lembrete de atendimento, na mão
// ---------------------------------------------------------------------------
export async function remindLesson(admin: Admin, apiKey: string, ctx: Ctx, lessonId: string, sentBy: string, teacherUserId: string | null) {
  const { data: l } = await admin.from("lessons").select("*").eq("id", lessonId).eq("account_id", ctx.account.id).maybeSingle();
  if (!l) return { to: [] as string[], hadEmail: false };
  const lesson = l as Lesson;
  // O profissional só lembra os próprios atendimentos.
  if (teacherUserId) {
    const { data: t } = await admin.from("teachers").select("name").eq("account_id", ctx.account.id).eq("user_id", teacherUserId).maybeSingle();
    const slug = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, "-");
    if (!t || slug(t.name) !== lesson.teacher) return { to: [] as string[], hadEmail: false };
  }
  const t = await teacherInfo(admin, lesson);
  const { date } = localParts(new Date());
  const kind = localParts(new Date(lesson.start_at)).date === date ? "day" : "eve";
  const base = clientMsg(kind, ctx, lesson, t.name, null)!;
  const en = ctx.account.locale === "en";
  // Na mão pode ser para qualquer dia: o título não diz "amanhã" se não for.
  const m: Msg = kind === "day" ? base : {
    ...base,
    subject: en ? `Reminder: ${word(ctx).l} on ${fmtDay(lesson.start_at, true)} at ${fmtTime(lesson.start_at, true)}`
      : `Lembrete: ${word(ctx).l} ${fmtDay(lesson.start_at, false)} às ${fmtTime(lesson.start_at, false)}`,
    title: en ? `Reminder: your ${word(ctx).l}` : `Lembrete: ${word(ctx).a("sua", "seu")} ${word(ctx).l}`,
  };
  const { emails } = await clientEmails(admin, lesson);
  const sent: string[] = [];
  for (const e of emails) if (await deliver(admin, apiKey, ctx, e, m, { kind: "lesson_reminder", student: lesson.student_name, guardian: lesson.guardian_name, sentBy })) sent.push(e);
  return { to: sent, hadEmail: emails.length > 0 };
}


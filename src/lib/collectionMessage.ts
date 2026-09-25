import { format } from "date-fns";
import { fmtMoney } from "@/lib/balance";
import type { OpenItem } from "@/lib/billing";
import { buildPixPayload } from "@/lib/pix";
import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";
import { fillTemplate, templateFor, type MessageTemplates } from "@/lib/messageTemplates";

import { dateLocale, L, isEnglish } from "@/lib/i18n";
// Tudo por empresa (settings): antes "InfinitePay ... 12x" era texto fixo e
// saía na cobrança de qualquer escola.
export type PaymentInfo = {
  pixKey: string | null;
  paymentLink: string | null;
  linkLabel?: string | null;
  linkNote?: string | null;
  pixName?: string | null;
  pixCity?: string | null;
};

export function paymentInfoFromSettings(s: Record<string, unknown> | null | undefined): PaymentInfo {
  const str = (k: string) => ((s?.[k] as string | null | undefined) ?? null);
  return {
    pixKey: str("pix_key"), paymentLink: str("payment_link"),
    linkLabel: str("payment_link_label"), linkNote: str("payment_link_note"),
    pixName: str("pix_receiver_name"), pixCity: str("pix_city"),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// "sexta-feira" → "Sexta". O WhatsApp não alinha colunas (a fonte não é
// monoespaçada), então cada aula vira um bloco curto em vez de uma linha longa.
function dayLabel(iso: string) {
  const d = new Date(iso);
  const weekday = format(d, "EEEE", { locale: dateLocale() }).replace("-feira", "").slice(0, isEnglish() ? 3 : undefined);
  return `${weekday[0].toUpperCase()}${weekday.slice(1)}, ${format(d, L("dd/MM", "MMM d"))}`;
}

// billing.ts monta "Matemática (60 min)"; aqui vira "Matemática · 60 min".
function detailLabel(detail: string) {
  const m = detail.match(/^(.*) \((\d+) min\)$/);
  return m ? `${m[1]} · ${m[2]} min` : detail;
}

// O rótulo do banco é "Desconto de 10% - Aula em 20/08 15:00 (60 min)"; a
// data já está no cabeçalho do bloco, então só a regra interessa.
function discountRule(label: string) {
  return label.split(";")[0].split(" - ")[0].trim() || L("Desconto", "Discount");
}

function pixLine(key: string) {
  const digits = key.replace(/\D/g, "");
  const kind = key.includes("@") ? "e-mail"
    : /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(key) ? "CPF"
    : digits.length === 14 && !/[a-z]/i.test(key) ? "CNPJ"
    : null;
  return kind ? `Chave (${kind}): ${key}` : `Chave: ${key}`;
}

export function buildCollectionMessage(items: OpenItem[], payment: PaymentInfo, v: Vocabulary = DEFAULT_VOCABULARY, templates?: MessageTemplates | null) {
  const ap = v.appointment;
  const students = new Set(items.map(i => i.student.trim().toLowerCase()));
  const single = students.size === 1 ? items[0]?.student : null;

  let gross = 0;
  let discounts = 0;
  let paid = 0;

  const blocks = items.map(i => {
    const full = i.discount?.gross ?? round2(i.amount);
    const disc = i.discount?.amount ?? 0;
    const alreadyPaid = round2(full - disc - i.amount);
    gross += full;
    discounts += disc;
    paid += Math.max(alreadyPaid, 0);

    const when = `📅 *${dayLabel(i.date)}* ${L("às", "at")} ${format(new Date(i.date), "HH:mm")}`;
    const what = single ? detailLabel(i.detail) : `${detailLabel(i.detail)} · ${i.student}`;
    const lines = [when, what];

    if (disc > 0) {
      lines.push(`💰 ~${fmtMoney(full)}~ → *${fmtMoney(round2(full - disc))}*`);
      lines.push(L(`🎁 _${discountRule(i.discount!.label)}: você economiza ${fmtMoney(disc)}_`, `🎁 _${discountRule(i.discount!.label)}: you save ${fmtMoney(disc)}_`));
    } else {
      lines.push(`💰 ${fmtMoney(full)}`);
    }
    if (alreadyPaid > 0) {
      lines.push(L(`✅ _Já recebemos ${fmtMoney(alreadyPaid)} d${ap.este} ${ap.l}; falta *${fmtMoney(i.amount)}*_`, `✅ _We already received ${fmtMoney(alreadyPaid)} for this ${ap.l}; *${fmtMoney(i.amount)}* left_`));
    }
    return lines.join("\n");
  });

  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  const rule = "━━━━━━━━━━━━━━";
  const summary = discounts > 0 || paid > 0
    ? [
        rule,
        `${ap.p}: ${fmtMoney(round2(gross))}`,
        discounts > 0 && `🎁 ${L("Descontos", "Discounts")}: − ${fmtMoney(round2(discounts))}`,
        paid > 0 && `✅ ${L("Já pago", "Already paid")}: − ${fmtMoney(round2(paid))}`,
        `*${L("Total a pagar", "Total due")}: ${fmtMoney(total)}*`,
        rule,
      ].filter(Boolean).join("\n")
    : `${rule}\n*${L("Total a pagar", "Total due")}: ${fmtMoney(total)}*\n${rule}`;

  const savings = discounts > 0
    ? L(`\n\n💚 Com o seu desconto, você está economizando *${fmtMoney(round2(discounts))}* n${ap.pick("estes", "estas")} ${ap.lp}.`, `\n\n💚 With your discount, you're saving *${fmtMoney(round2(discounts))}* on these ${ap.lp}.`)
    : "";

  const pix = payment.pixKey?.trim();
  const link = payment.paymentLink?.trim();
  // Com nome e cidade de quem recebe, vai junto o Pix "copia e cola" já com o
  // total - a família cola no app do banco e não digita valor nenhum.
  const pixCode = pix && total > 0
    ? buildPixPayload({ key: pix, name: payment.pixName ?? "", city: payment.pixCity ?? "", amount: total })
    : null;
  const label = payment.linkLabel?.trim() || L("Link de pagamento", "Payment link");
  const note = payment.linkNote?.trim();
  const ways = [
    pix && [
      `💠 *Pix*\n${pixLine(pix)}`,
      pixCode && `Ou use o *Pix copia e cola*, que já vai com o valor de ${fmtMoney(total)}:\n${pixCode}`,
    ].filter(Boolean).join("\n\n"),
    link && `🔗 *${label}*\n${link}${note ? `\n${note}` : ""}`,
  ].filter(Boolean) as string[];
  const howToPay = ways.length ? L(`\n\n*Como pagar* (do jeito mais fácil pra você):\n\n${ways.join("\n\n")}`, `\n\n*How to pay*:\n\n${ways.join("\n\n")}`) : "";

  // O texto em volta é o modelo da empresa (Mensagens); a lista, o resumo e o
  // "como pagar" continuam montados aqui, com as contas certas.
  return fillTemplate(templateFor("cobranca", v, templates), {
    de_aluno: single ? L(` de *${single.trim()}*`, ` for *${single.trim()}*`) : "",
    aluno: single?.trim() ?? "",
    lista: blocks.join("\n\n"),
    resumo: `${summary}${savings}`,
    total: fmtMoney(total),
    como_pagar: howToPay,
  });
}

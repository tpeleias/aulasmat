// O razão de uma conta, para a tela (08/10): cada pagamento ou pacote e as
// aulas que ele abateu, e cada aula com o que a pagou.
//
// A regra é a mesma de computeStatementsCore (supabase/functions/_shared/
// statements.ts): o voucher de uma aula (desconto fixo) abate a própria aula;
// todo o resto do crédito paga as cobranças mais antigas primeiro. Aqui o
// crédito deixa de ser um bolo só: cada entrada (pacote, pagamento, voucher)
// paga, na ordem em que entrou, as cobranças na ordem da data da aula. O que
// fica em aberto sai idêntico ao do extrato (src/test/ledger.test.ts confere).
//
// A data de uma cobrança é a da aula, não a do lançamento: a carteira lança
// quando a aula é marcada como realizada, às vezes semanas depois, e por isso
// a lista antiga saía fora de ordem.

import type { LedgerLesson, LedgerTx } from "@shared/statements";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "package": a aula foi coberta inteira por um pacote (não custou dinheiro). */
export type ChargeStatus = "paid" | "partial" | "open" | "package";

/** Compra de pacote por aulas (tabela package_purchases, 08/10). */
export type PackagePurchase = {
  id: string; name: string; sessions: number; minutes: number; price: number;
  created_at: string; converted?: boolean;
};
export type PackageUse = { purchase_id: string; lesson_id: string; sessions: number };

export type LedgerPackage = PackagePurchase & {
  used: number;
  left: number;
  /** As aulas que gastaram este pacote, em ordem de data. */
  lessons: { chargeId: string; sessions: number; from: number; to: number }[];
  /** A cobrança do pacote (o valor dele), se houver. */
  saleChargeId: string | null;
};

export type LedgerCharge = {
  /** Id do lançamento da cobrança. */
  id: string;
  lessonId: string | null;
  /** Data da aula (ou do lançamento, num ajuste manual). */
  date: string;
  student: string;
  detail: string;
  /** Valor cheio. */
  gross: number;
  /** Desconto da própria aula (desconto fixo da conta). */
  discount: number;
  discountLabel: string | null;
  /** O que a aula custa depois do desconto. */
  net: number;
  paid: number;
  open: number;
  status: ChargeStatus;
  paidBy: { sourceId: string; amount: number }[];
  /** Ajuste manual negativo (sem aula). */
  manual: boolean;
  txId: string;
  /** O que esta aula gastou de pacote: "aula 3 de 10". */
  packageUses: { purchaseId: string; label: string; sessions: number; from: number; to: number; total: number }[];
  /** Valor cheio de uma aula coberta por pacote (só para mostrar). */
  fullValue: number | null;
  /** Esta cobrança é a venda de um pacote (id da compra). */
  packageSale: string | null;
};

export type SourceKind = "package" | "payment" | "voucher" | "leftover";

export type LedgerSource = {
  /** Id do primeiro lançamento do grupo. */
  id: string;
  /** Os lançamentos que formam esta entrada: pacote + o voucher dele saem juntos. */
  txIds: string[];
  date: string;
  kind: SourceKind;
  label: string;
  /** Dinheiro que entrou. */
  money: number;
  /** Crédito sem dinheiro (voucher, desconto do pacote). */
  voucher: number;
  total: number;
  used: number;
  left: number;
  covers: { chargeId: string; amount: number; partial: boolean }[];
  /** "10 aulas" do nome do pacote, quando dá para saber. */
  packageSize: number | null;
};

export type LedgerEntry = {
  id: string;
  date: string;
  kind: "lesson" | "package" | "payment" | "voucher" | "adjustment";
  label: string;
  /** Detalhe embaixo (matéria, voucher do pacote...). */
  detail: string | null;
  amount: number;
  /** Saldo da conta depois desta linha, em ordem de data. */
  balance: number;
  lessonId: string | null;
  txIds: string[];
};

export type AccountLedger = {
  charges: LedgerCharge[];
  sources: LedgerSource[];
  entries: LedgerEntry[];
  packages: LedgerPackage[];
};

export type LedgerOptions = {
  /** Os pacotes cadastrados (para achar o tamanho dos pacotes antigos, por valor). */
  catalog?: { name: string; lessons: number }[];
  purchases?: PackagePurchase[];
  uses?: PackageUse[];
};

export type LedgerLabels = {
  appointment: string;
  entry: string;
  payment: string;
  package: string;
  voucher: string;
  leftover: string;
  adjustment: string;
};

/** Quantas aulas o pacote tem: pelo nome cadastrado, ou pelo número no texto ("Pacote 10 aulas"). */
export function packageSizeFrom(label: string, packages: { name: string; lessons: number }[] = []): number | null {
  const name = label.trim().toLowerCase();
  const hit = packages.find(p => p.name.trim().toLowerCase() === name);
  if (hit) return hit.lessons;
  const m = name.match(/\b(\d{1,3})\b/);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 && n <= 200 ? n : null;
}

/**
 * O razão de UMA conta: `txs` já filtrados para ela, `lessons` as realizadas.
 */
export function buildLedger(txs: LedgerTx[], lessons: LedgerLesson[], labels: LedgerLabels, opts: LedgerOptions = {}): AccountLedger {
  const packages = opts.catalog ?? [];
  const purchases = [...(opts.purchases ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const purchaseIds = new Set(purchases.map(p => p.id));
  const uses = (opts.uses ?? []).filter(u => purchaseIds.has(u.purchase_id));
  const lessonById = new Map(lessons.map(l => [l.id, l]));
  const charges: LedgerCharge[] = [];
  const lessonVouchers = new Map<string, LedgerTx[]>();
  const credits: LedgerTx[] = [];

  for (const t of txs) {
    const amount = Number(t.amount);
    // A aula coberta inteira por pacote fica com débito zero, mas continua aula.
    const coveredLesson = t.kind === "lesson" && amount === 0 && !!t.lesson_id;
    if (amount >= 0 && !coveredLesson) {
      if (t.kind === "voucher" && t.lesson_id) {
        lessonVouchers.set(t.lesson_id, [...(lessonVouchers.get(t.lesson_id) ?? []), t]);
      } else if (amount > 0) {
        credits.push(t);
      }
      continue;
    }
    const lesson = t.lesson_id ? lessonById.get(t.lesson_id) : undefined;
    charges.push({
      id: t.id, txId: t.id, lessonId: t.lesson_id,
      date: lesson?.start_at ?? t.created_at,
      student: lesson?.student_name ?? t.student_name,
      detail: lesson ? `${lesson.subject ?? labels.appointment} (${lesson.duration_minutes} min)` : (t.description ?? labels.entry),
      gross: -amount || 0, discount: 0, discountLabel: null, net: -amount || 0,
      paid: 0, open: -amount || 0, status: "open", paidBy: [],
      manual: !t.lesson_id && !(t as LedgerTx & { package_purchase_id?: string | null }).package_purchase_id,
      packageUses: [], fullValue: null,
      packageSale: t.lesson_id ? null : ((t as LedgerTx & { package_purchase_id?: string | null }).package_purchase_id ?? null),
    });
  }

  // Sobras de voucher de aula (maior que a aula, ou sem a cobrança dela)
  // entram no crédito geral, como em computeStatementsCore.
  const leftovers: { tx: LedgerTx; amount: number }[] = [];
  for (const c of charges) {
    const vs = c.lessonId ? lessonVouchers.get(c.lessonId) : undefined;
    if (!vs?.length) continue;
    lessonVouchers.delete(c.lessonId!);
    const total = round2(vs.reduce((s, v) => s + Number(v.amount), 0));
    const applied = Math.min(total, c.gross);
    if (applied > 0) {
      c.discount = applied;
      c.discountLabel = vs.map(v => v.description).filter((d): d is string => !!d).join("; ") || null;
      c.net = round2(c.gross - applied);
      c.open = c.net;
    }
    if (total - applied > 0) leftovers.push({ tx: vs[0], amount: round2(total - applied) });
  }
  for (const vs of lessonVouchers.values()) {
    const total = round2(vs.reduce((s, v) => s + Number(v.amount), 0));
    if (total > 0) leftovers.push({ tx: vs[0], amount: total });
  }

  // Um pacote é o dinheiro + o voucher do desconto, lançados juntos (mesma
  // transação no banco, mesmo created_at): na tela é uma coisa só.
  const groups = new Map<string, LedgerTx[]>();
  for (const t of credits) groups.set(t.created_at, [...(groups.get(t.created_at) ?? []), t]);
  const sources: LedgerSource[] = [];
  for (const group of groups.values()) {
    const money = round2(group.filter(t => t.kind !== "voucher").reduce((s, t) => s + Number(t.amount), 0));
    const voucher = round2(group.filter(t => t.kind === "voucher").reduce((s, t) => s + Number(t.amount), 0));
    const pkg = group.find(t => t.kind === "package");
    const main = pkg ?? group.find(t => t.kind !== "voucher") ?? group[0];
    const kind: SourceKind = pkg ? "package" : money > 0 ? "payment" : "voucher";
    const label = main.description?.trim() || (kind === "package" ? labels.package : kind === "payment" ? labels.payment : labels.voucher);
    sources.push({
      id: main.id, txIds: group.map(t => t.id), date: main.created_at, kind, label,
      money, voucher, total: round2(money + voucher), used: 0, left: round2(money + voucher), covers: [],
      packageSize: kind === "package" ? packageSizeFrom(label, packages) : null,
    });
  }
  for (const l of leftovers) {
    sources.push({
      id: `left:${l.tx.id}`, txIds: [], date: l.tx.created_at, kind: "leftover", label: labels.leftover,
      money: 0, voucher: l.amount, total: l.amount, used: 0, left: l.amount, covers: [], packageSize: null,
    });
  }
  sources.sort((a, b) => a.date.localeCompare(b.date));

  // Crédito mais antigo paga a aula mais antiga.
  const byDate = [...charges].sort((a, b) => a.date.localeCompare(b.date));
  let si = 0;
  for (const c of byDate) {
    while (c.open > 0 && si < sources.length) {
      const s = sources[si];
      if (s.left <= 0) { si++; continue; }
      const take = round2(Math.min(s.left, c.open));
      s.left = round2(s.left - take);
      s.used = round2(s.used + take);
      c.open = round2(c.open - take);
      c.paid = round2(c.paid + take);
      c.paidBy.push({ sourceId: s.id, amount: take });
      s.covers.push({ chargeId: c.id, amount: take, partial: c.open > 0 });
    }
    c.status = c.open <= 0 ? "paid" : c.paid > 0 ? "partial" : "open";
  }

  // Pacotes por aulas: cada uso vira "aula N de T" na aula, e cada compra
  // sabe quanto gastou e em quais aulas.
  const chargeByLesson = new Map(charges.filter(c => c.lessonId).map(c => [c.lessonId!, c]));
  const ledgerPackages: LedgerPackage[] = purchases.map(p => {
    const mine = uses.filter(u => u.purchase_id === p.id && chargeByLesson.has(u.lesson_id))
      .map(u => ({ u, c: chargeByLesson.get(u.lesson_id)! }))
      .sort((a, b) => a.c.date.localeCompare(b.c.date));
    let acc = 0;
    const list = mine.map(({ u, c }) => {
      const from = acc;
      acc = Math.round((acc + Number(u.sessions)) * 10000) / 10000;
      c.packageUses.push({ purchaseId: p.id, label: p.name, sessions: Number(u.sessions), from, to: acc, total: Number(p.sessions) });
      return { chargeId: c.id, sessions: Number(u.sessions), from, to: acc };
    });
    const sale = charges.find(c => c.packageSale === p.id) ?? null;
    return {
      ...p, sessions: Number(p.sessions), minutes: Number(p.minutes), price: Number(p.price),
      used: acc, left: Math.max(0, Math.round((Number(p.sessions) - acc) * 10000) / 10000),
      lessons: list, saleChargeId: sale?.id ?? null,
    };
  });
  for (const c of charges) {
    if (!c.packageUses.length || !c.lessonId) continue;
    const l = lessonById.get(c.lessonId) as (LedgerLesson & { price?: number | null }) | undefined;
    if (l?.price != null) c.fullValue = Math.round(Number(l.price) * l.duration_minutes / 60 * 100) / 100;
    if (c.gross === 0) c.status = "package";
  }
  // "partial" no pacote quer dizer que ele pagou só parte daquela aula.
  for (const s of sources) {
    for (const cv of s.covers) {
      const c = charges.find(x => x.id === cv.chargeId)!;
      cv.partial = round2(cv.amount) < round2(c.net);
    }
  }

  // Extrato: tudo na ordem da data da aula / do lançamento, com o saldo.
  type Raw = Omit<LedgerEntry, "balance">;
  const raw: Raw[] = [];
  for (const c of charges) {
    raw.push({
      id: c.id, date: c.date, kind: c.packageSale ? "package" : c.manual ? "adjustment" : "lesson",
      label: c.manual ? (c.detail || labels.adjustment) : c.detail, detail: null,
      amount: -c.gross, lessonId: c.lessonId, txIds: [c.txId],
    });
    if (c.discount > 0) {
      raw.push({
        id: `${c.id}:d`, date: c.date, kind: "voucher", label: c.discountLabel ?? labels.voucher, detail: null,
        amount: c.discount, lessonId: c.lessonId, txIds: [],
      });
    }
  }
  for (const s of sources) {
    raw.push({
      id: s.id, date: s.date, kind: s.kind === "leftover" ? "voucher" : s.kind, label: s.label,
      detail: null,
      amount: s.total, lessonId: null, txIds: s.txIds,
    });
  }
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
  let bal = 0;
  const entries = raw.map(e => { bal = round2(bal + e.amount); return { ...e, balance: bal }; });

  return { charges: byDate, sources, entries, packages: ledgerPackages };
}

/**
 * Quantas aulas ainda cabem no que sobrou: pelo valor de uma aula do pacote
 * (total / tamanho), ou, sem o tamanho, pelo valor da última aula.
 */
export function lessonsLeftIn(source: LedgerSource, charges: LedgerCharge[]): number | null {
  if (source.left <= 0) return 0;
  const unit = source.packageSize ? source.total / source.packageSize
    : [...charges].reverse().find(c => !c.manual && c.net > 0)?.net;
  if (!unit) return null;
  return Math.floor(source.left / unit + 1e-9);
}

/** O pacote antigo (por valor) que está em uso agora: o mais recente que ainda tem saldo. */
export function currentPackage(sources: LedgerSource[]): LedgerSource | null {
  return [...sources].reverse().find(s => s.kind === "package" && s.left > 0) ?? null;
}

/** O pacote por aulas em uso: o mais antigo que ainda tem aula (é o que a próxima aula vai gastar). */
export function currentPurchase(packages: LedgerPackage[]): LedgerPackage | null {
  return packages.find(p => p.left > 0) ?? null;
}

/** Que aula(s) do pacote esta aula gastou: 3 de 10, ou 3 a 4 de 10. */
export function packageSlots(u: { from: number; to: number }): { first: number; last: number } {
  return { first: Math.floor(u.from + 1e-6) + 1, last: Math.max(Math.floor(u.from + 1e-6) + 1, Math.ceil(u.to - 1e-6)) };
}

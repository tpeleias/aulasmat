import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { format, isFuture } from "date-fns";
import { Plus, ChevronDown, ChevronRight, CalendarClock, Wallet, Info, Percent, Copy, Mail, History, Search, MoreHorizontal, Send, Package, Check, CreditCard } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import AccountLedger from "@/components/AccountLedger";
import { buildLedger, currentPackage, currentPurchase, lessonsLeftIn, type AccountLedger as Ledger, type PackagePurchase, type PackageUse } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import { payAction, payErrorText, useOnlinePayments } from "@/lib/onlinePayments";
import { toast } from "sonner";
import { LessonDialog } from "@/components/LessonDialog";
import { accountKey, accountLabel, fmtMoney, capitalize } from "@/lib/balance";
import { computeStatements, daysOpen, isOverdue, sortAccounts, ACCOUNT_SORTS, type AccountSort, type LedgerTx, type LedgerLesson, type AccountStatement } from "@/lib/billing";
import { discountOn, discountOnItems, isValidDiscount, describeDiscount, parseDiscountValue, type Discount, type DiscountKind } from "@/lib/discount";
import { useLessonPrice } from "@/hooks/useLessonPrice";
import { usePlan } from "@/hooks/usePlan";
import { ProUpsell } from "@/components/ProUpsell";
import { haptics } from "@/lib/haptics";
import { buildCollectionMessage, paymentInfoFromSettings, type PaymentInfo } from "@/lib/collectionMessage";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { buildPixPayload } from "@/lib/pix";
import { syncBillingWidget } from "@/lib/widgetSync";
import { emailAction, emailErrorText } from "@/lib/emailActions";
import { EmailHistoryDialog } from "@/components/EmailHistoryDialog";
import ListSkeleton from "@/components/ListSkeleton";
import EmptyState from "@/components/EmptyState";
import PullToRefresh from "@/components/PullToRefresh";
import SortMenu, { useSortPreference } from "@/components/SortMenu";
import PeriodSummary from "@/components/PeriodSummary";
import { useWords } from "@/hooks/useVocabulary";
import { dbErrorMessage } from "@/lib/dbErrors";
import { cap, type Vocabulary } from "@/lib/vocabulary";
import { packageMinutes, type LessonPackage } from "@/lib/packages";
import { useServices, type Service } from "@/hooks/useServices";

import { dateLocale, L, currencySymbol } from "@/lib/i18n";
import { useTeacherName } from "@/hooks/useTeacherName";
type Tx = LedgerTx & { kind: "package" | "lesson" | "adjustment" | "voucher" };
type StudentRow = { id: string; student_name: string; guardian_name: string | null };
type LessonRow = LedgerLesson & { status: string; guardian_name: string | null; price: number | null };
type PurchaseRow = PackagePurchase & { student_name: string; guardian_name: string | null };
type DiscountRow = { student_name: string; guardian_name: string | null; kind: DiscountKind; value: number };

type Account = AccountStatement & { txs: Tx[]; nextLesson: LessonRow | null; discount: Discount | null; ledger: Ledger };
type AccountFilter = "all" | "owed" | "credit" | "overdue";

type QuickOption = {
  key: string;
  label: string;
  amount?: number;
  kind: "package" | "adjustment" | "voucher";
  hint?: string;
  /** Pacote por aulas (08/10): vender cria a compra com N aulas. */
  packageId?: string;
  sessions?: number;
  minutes?: number;
};

// Os pacotes são os que a empresa cadastrou em Configurações → Pacotes
// (tabela lesson_packages). Desde 08/10 o pacote abate AULAS: vender cria uma
// compra com N aulas (sell_package) e cada aula realizada gasta uma.
const quickOptions = (listPrice: number, v: Vocabulary, packages: LessonPackage[], services: Service[]): QuickOption[] => [
  { key: "all", label: L("Quitar tudo", "Pay everything"), kind: "adjustment" },
  ...packages.filter(p => p.active).map((p): QuickOption => {
    const minutes = packageMinutes(p, services);
    return {
      key: `pkg:${p.id}`, label: p.name, amount: Number(p.price), kind: "package", packageId: p.id, sessions: p.lessons, minutes,
      hint: `${p.lessons} × ${minutes} min · ${fmtMoney(Number(p.price))}`,
    };
  }),
  { key: "single", label: L(`1 ${v.appointment.l} ${v.appointment.pick("avulso", "avulsa")}`, `1 single ${v.appointment.l}`), amount: listPrice, kind: "adjustment" },
  { key: "voucher", label: L("Voucher (desconto)", "Voucher (discount)"), kind: "voucher", hint: L("crédito sem dinheiro", "credit, no money") },
  { key: "custom", label: L("Outro valor", "Other amount"), kind: "adjustment" },
];

// Onde o desconto pega. "always" é o desconto fixo da família, que o banco
// recalcula sozinho a cada aula; os outros dois são um abatimento pontual,
// que entra como voucher e fica parado onde está.
type DiscountScope = "lesson" | "open" | "always";

export default function BillingPage() {
  const teacherName = useTeacherName();
  const { price: listPrice } = useLessonPrice();
  const { templates } = useMessageTemplates();
  // Pacote, voucher e desconto sao a mesma familia - abatimento combinado
  // com a familia - e ficam juntos no Pro. Registrar o dinheiro que entrou
  // continua no Essencial: cobrar e o minimo que o app precisa fazer.
  const { plan } = usePlan();
  const v = useWords();
  const ap = v.appointment;
  const g = v.payer;
  const [packages, setPackages] = useState<LessonPackage[]>([]);
  useEffect(() => {
    // Sem a tabela (front antes da migration 20260925040000) fica sem pacotes.
    supabase.from("lesson_packages" as never).select("*").order("sort_order").order("created_at")
      .then(({ data, error }) => { if (!error) setPackages((data ?? []) as unknown as LessonPackage[]); });
  }, []);
  const { services } = useServices(false);
  const QUICK = useMemo(() => quickOptions(listPrice, v, packages, services ?? []), [listPrice, v, packages, services]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [uses, setUses] = useState<PackageUse[]>([]);
  const [payment, setPayment] = useState<PaymentInfo>({ pixKey: null, paymentLink: null });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useSortPreference<AccountSort>("billing", ACCOUNT_SORTS, "owed");

  const [payFor, setPayFor] = useState<Account | null>(null);
  const [quick, setQuick] = useState("all");
  const [amount, setAmount] = useState<string>("");
  const [desc, setDesc] = useState("");
  const [allowNegative, setAllowNegative] = useState(false);

  const [editingTx, setEditingTx] = useState<Tx | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editingLesson, setEditingLesson] = useState<any | null>(null);
  const [lessonDlgOpen, setLessonDlgOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [discountFor, setDiscountFor] = useState<Account | null>(null);
  const [dKind, setDKind] = useState<DiscountKind>("percent");
  const [dValue, setDValue] = useState("");
  const [dScope, setDScope] = useState<DiscountScope>("always");
  const [dItemId, setDItemId] = useState("");

  const load = async () => {
    const [tx, st, ls, dc, cfg, pp, pu] = await Promise.all([
      supabase.from("wallet_transactions").select("*").order("created_at", { ascending: false }),
      supabase.from("students").select("id, student_name, guardian_name").order("student_name"),
      supabase.from("lessons").select("id, student_name, guardian_name, start_at, duration_minutes, subject, teacher, status, price"),
      supabase.from("account_discounts").select("student_name, guardian_name, kind, value"),
      // "*" e não a lista: as colunas de pagamento por empresa vêm da migration
      // 20260924010000, e pedir coluna que não existe derrubaria a consulta.
      supabase.from("settings").select("*").maybeSingle(),
      // Pacotes por aulas (migration 20261008010000); sem a tabela, fica vazio.
      supabase.from("package_purchases" as never).select("*"),
      supabase.from("package_uses" as never).select("purchase_id, lesson_id, sessions"),
    ]);
    setPurchases(pp.error ? [] : ((pp.data ?? []) as unknown as PurchaseRow[]));
    setUses(pu.error ? [] : ((pu.data ?? []) as unknown as PackageUse[]));
    setPayment(paymentInfoFromSettings(cfg.data as Record<string, unknown> | null));
    setTxs((tx.data ?? []) as Tx[]);
    setStudents((st.data ?? []) as StudentRow[]);
    setLessons((ls.data ?? []) as LessonRow[]);
    setDiscounts((dc.data ?? []) as DiscountRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const accounts = useMemo<Account[]>(() => {
    const done = lessons.filter(l => l.status === "realizada");
    const byKey = new Map(computeStatements(txs, done, v).map(s => [s.key, s]));

    // Students with no ledger activity yet still get a card, so nobody "disappears".
    for (const s of students) {
      const k = accountKey(s);
      if (!byKey.has(k)) {
        byKey.set(k, {
          key: k, label: accountLabel(s, v), student: s.student_name,
          guardian: (s.guardian_name ?? "").trim() || null,
          balance: 0, credits: 0, owed: 0, items: [], oldestOpenDate: null,
        });
      }
    }

    const txsByKey = new Map<string, Tx[]>();
    for (const t of txs) (txsByKey.get(accountKey(t)) ?? txsByKey.set(accountKey(t), []).get(accountKey(t))!).push(t);

    const nextByKey = new Map<string, LessonRow>();
    for (const l of lessons) {
      if (l.status !== "agendada" || !isFuture(new Date(l.start_at))) continue;
      const k = accountKey(l);
      const cur = nextByKey.get(k);
      if (!cur || l.start_at < cur.start_at) nextByKey.set(k, l);
    }

    // O desconto é da conta, e conta com responsável é do responsável - dois
    // irmãos caem na mesma. accountKey é a mesma regra que o banco usa em
    // public.account_key.
    const discountByKey = new Map<string, Discount>();
    for (const d of discounts) {
      discountByKey.set(accountKey(d), { kind: d.kind, value: Number(d.value) });
    }

    const doneByKey = new Map<string, LessonRow[]>();
    for (const l of done) (doneByKey.get(accountKey(l)) ?? doneByKey.set(accountKey(l), []).get(accountKey(l))!).push(l);
    const ledgerLabels = {
      appointment: v.appointment.s, entry: L("Lançamento", "Entry"), payment: L("Pagamento", "Payment"),
      package: L("Pacote", "Package"), voucher: "Voucher", leftover: L("Sobra de desconto", "Leftover discount"), adjustment: L("Ajuste", "Adjustment"),
    };

    const merged = [...byKey.values()].map(s => {
      const own = txsByKey.get(s.key) ?? [];
      return {
        ...s,
        txs: own,
        nextLesson: nextByKey.get(s.key) ?? null,
        discount: discountByKey.get(s.key) ?? null,
        // Mesma ordem que computeStatements recebeu: o empate entre aulas na
        // mesma hora fica igual nos dois, e o "em aberto" bate.
        ledger: buildLedger(own, doneByKey.get(s.key) ?? [], ledgerLabels, {
          catalog: packages,
          purchases: purchases.filter(p => accountKey(p) === s.key),
          uses,
        }),
      };
    });
    return sortAccounts(merged, sort);
  }, [txs, students, lessons, discounts, sort, v, packages, purchases, uses]);

  // O widget de cobrança do Android lê daqui (e da tela Hoje): quem acabou de
  // registrar um pagamento vê o widget já sem aquela dívida.
  useEffect(() => {
    if (loading) return;
    const debtors = accounts.filter(a => a.owed > 0).sort((a, b) => b.owed - a.owed);
    syncBillingWidget({
      totalOwed: debtors.reduce((s, a) => s + a.owed, 0),
      accounts: debtors.map(a => ({ label: a.label, owed: a.owed })),
    });
  }, [loading, accounts]);

  // Só o código Pix, com o valor em aberto: vai como segunda mensagem no
  // WhatsApp, que a família copia com um toque (dentro do texto longo, ela
  // teria de selecionar à mão).
  const pixFor = (a: Account) => payment.pixKey
    ? buildPixPayload({ key: payment.pixKey, name: payment.pixName ?? "", city: payment.pixCity ?? "", amount: a.owed })
    : null;
  const copyPix = (a: Account) => {
    const code = pixFor(a);
    if (!code) return;
    navigator.clipboard.writeText(code);
    haptics.success();
    toast.success(L(`Pix de ${fmtMoney(a.owed)} copiado`, `Pix of ${fmtMoney(a.owed)} copied`));
  };

  // Pagamento on-line pelo Stripe da empresa (09/10): conectado, a mensagem
  // leva o link "pagar com cartão ou Pix" no lugar do link fixo.
  const online = useOnlinePayments();
  const payLinkFor = async (a: Account) => {
    const r = await payAction<{ url: string }>({ action: "link", student: a.student, guardian: a.guardian });
    if (!r.ok) { toast.error(payErrorText(r.error)); return null; }
    return r.data.url;
  };
  const copyCollection = async (a: Account) => {
    let info = payment;
    if (online.connected) {
      const url = await payLinkFor(a);
      if (url) info = { ...payment, paymentLink: url, linkLabel: L("Pagar com cartão ou Pix", "Pay by card or Pix"), linkNote: null };
    }
    try { await navigator.clipboard.writeText(buildCollectionMessage(a.items, info, v, templates)); }
    catch { toast.error(L("Não deu para copiar. Tente de novo.", "Couldn't copy. Try again.")); return; }
    haptics.success();
    toast.success(L(`Mensagem de cobrança de ${a.label} copiada`, `Payment request for ${a.label} copied`));
  };
  const copyPayLink = async (a: Account) => {
    const url = await payLinkFor(a);
    if (!url) return;
    try { await navigator.clipboard.writeText(url); } catch { toast.error(L("Não deu para copiar.", "Couldn't copy.")); return; }
    haptics.success();
    toast.success(L(`Link de pagamento de ${a.label} copiado (cobra sempre o valor em aberto do dia)`, `Payment link for ${a.label} copied (always charges the current open amount)`));
  };

  // ---- E-mail (03/10): cobrança, extrato e "cobrar todos" ----
  const [mailing, setMailing] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<Account | null>(null);
  const emailCharge = async (a: Account, statement = false) => {
    setMailing(a.key + (statement ? ":s" : ""));
    const r = await emailAction<{ to: string[] }>({ action: statement ? "send_statement" : "send_charge", student: a.student, guardian: a.guardian });
    setMailing(null);
    if (!r.ok) { haptics.warning(); toast.error(emailErrorText(r.error)); return; }
    haptics.success();
    if (!r.data.to.length) toast.message(L("Ninguém recebeu: os e-mails desta conta saíram da lista ou voltaram.", "No one got it: this account's emails unsubscribed or bounced."));
    else toast.success(L(`${statement ? "Extrato" : "Cobrança"} enviado para ${r.data.to.join(", ")}`, `${statement ? "Statement" : "Payment reminder"} sent to ${r.data.to.join(", ")}`));
  };
  const chargeAllEmail = async () => {
    const n = accounts.filter(a => a.owed > 0).length;
    if (!confirm(L(`Mandar a cobrança por e-mail para as ${n} contas com valor em aberto?`, `Email a payment reminder to the ${n} accounts with an open balance?`))) return;
    setMailing("all");
    const r = await emailAction<{ accounts: number; emails: number; noEmail: number }>({ action: "charge_all" });
    setMailing(null);
    if (!r.ok) { haptics.warning(); toast.error(emailErrorText(r.error)); return; }
    haptics.success();
    toast.success(L(`Cobrança enviada para ${r.data.accounts} conta${r.data.accounts === 1 ? "" : "s"}`, `Reminder sent to ${r.data.accounts} account${r.data.accounts === 1 ? "" : "s"}`)
      + (r.data.noEmail ? L(` · ${r.data.noEmail} sem e-mail no cadastro`, ` · ${r.data.noEmail} without email`) : ""));
  };

  // ---- Busca e filtro (08/10) ----
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const FILTERS: { key: AccountFilter; label: string }[] = [
    { key: "all", label: L("Todas", "All") },
    { key: "owed", label: L("A receber", "To receive") },
    { key: "credit", label: L("Com crédito", "With credit") },
    { key: "overdue", label: L("Em atraso", "Overdue") },
  ];
  const matches = (a: Account, f: AccountFilter) =>
    f === "all" || (f === "owed" ? a.owed > 0 : f === "credit" ? a.owed <= 0 && a.balance > 0 : isOverdue(a));
  const counts = useMemo(() => Object.fromEntries((["all", "owed", "credit", "overdue"] as AccountFilter[])
    .map(f => [f, accounts.filter(a => matches(a, f)).length])) as Record<AccountFilter, number>, [accounts]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const norm = (x: string | null) => (x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return accounts.filter(a => matches(a, filter) && (!q || norm(a.label).includes(q) || norm(a.student).includes(q) || norm(a.guardian).includes(q)));
  }, [accounts, filter, query]);

  // ---- Register payment ----
  const quickOption = QUICK.find(x => x.key === quick) ?? QUICK[0];
  const isVoucherOnly = quickOption.kind === "voucher";
  const isPackage = !!quickOption.packageId;
  const rawValue = Number(String(amount).replace(",", "."));
  const payValue = isVoucherOnly ? 0 : (Number.isFinite(rawValue) ? rawValue : 0);
  const voucherValue = isVoucherOnly ? (Number.isFinite(rawValue) ? rawValue : 0) : 0;
  const creditValue = Math.round((payValue + voucherValue) * 100) / 100;
  const leftover = payFor ? Math.round((creditValue - payFor.owed) * 100) / 100 : 0;
  // O que este pagamento quita, da mais antiga para a mais nova - a mesma
  // regra do extrato, para quem registra ver antes onde o dinheiro vai cair.
  // Pacote: as aulas em aberto que ele vai cobrir (até acabar), por duração.
  const packagePreview = (() => {
    if (!payFor || !isPackage) return [];
    let left = quickOption.sessions ?? 0;
    const out: { id: string; date: string; detail: string; sessions: number; partial: boolean }[] = [];
    for (const c of payFor.ledger.charges) {
      if (left <= 0 || !c.lessonId || c.open <= 0) continue;
      const l = lessons.find(x => x.id === c.lessonId);
      const need = l ? (l.duration_minutes / (quickOption.minutes ?? 60)) * (c.open / (c.net || c.open)) : 1;
      const take = Math.min(left, need);
      left -= take;
      out.push({ id: c.id, date: c.date, detail: c.detail, sessions: Math.round(take * 100) / 100, partial: take < need - 1e-6 });
    }
    return out;
  })();
  const payPreview = (() => {
    if (!payFor || !(creditValue > 0) || isPackage) return [];
    let pool = creditValue;
    return payFor.items.map(i => {
      const take = Math.round(Math.min(pool, i.amount) * 100) / 100;
      pool = Math.round((pool - take) * 100) / 100;
      return { ...i, take };
    }).filter(i => i.take > 0);
  })();

  const openPay = (a: Account) => {
    haptics.tap();
    setPayFor(a);
    const firstPkg = plan.packages ? QUICK.find(q => q.kind === "package") : undefined;
    const q = a.owed > 0 ? QUICK[0] : firstPkg ?? QUICK.find(x => x.key === "custom")!;
    setQuick(q.key);
    setAmount(q.key === "all" ? String(a.owed) : q.amount != null ? String(q.amount) : "");
    setDesc(q.key === "all" ? L("Pagamento", "Payment") : q.kind === "package" ? q.label : "");
    setAllowNegative(false);
  };

  const chooseQuick = (key: string) => {
    if (!payFor) return;
    setQuick(key);
    const q = QUICK.find(x => x.key === key)!;
    if (key === "all") { setAmount(String(payFor.owed)); setDesc("Pagamento"); }
    else if (key === "custom" || key === "voucher") { setAmount(""); setDesc(key === "voucher" ? "Voucher" : ""); }
    else { setAmount(String(q.amount)); setDesc(q.label); }
  };

  const submitPay = async () => {
    if (!payFor) return;
    const q = quickOption;
    const value = payValue;

    if (isPackage) {
      if (!Number.isFinite(value) || value < 0) { toast.error(L("Informe quanto recebeu agora (ou 0)", "Enter how much you received now (or 0)")); return; }
      setBusy(true);
      const { error } = await supabase.rpc("sell_package" as never, {
        _student: payFor.student, _guardian: payFor.guardian, _package: q.packageId, _paid: value,
        _paid_description: desc.trim() && desc.trim() !== q.label ? desc.trim() : null,
      } as never);
      setBusy(false);
      if (error) { haptics.warning(); toast.error(dbErrorMessage(error, v)); return; }
      haptics.success();
      toast.success(L(`${q.label} vendido: ${q.sessions} ${ap.lp} para ${payFor.label}`, `${q.label} sold: ${q.sessions} ${ap.lp} for ${payFor.label}`));
      setPayFor(null);
      load();
      return;
    }
    if (isVoucherOnly) {
      if (!(voucherValue > 0)) { toast.error(L("Informe o valor do voucher", "Enter the voucher amount")); return; }
    } else {
      if (!Number.isFinite(value) || value === 0 || (value < 0 && !allowNegative)) { toast.error(L("Informe um valor válido", "Enter a valid amount")); return; }
      if (voucherValue < 0) { toast.error(L("Voucher inválido", "Invalid voucher")); return; }
    }

    setBusy(true);
    const { error } = await supabase.rpc("register_payment", {
      _student: payFor.student,
      _guardian: payFor.guardian,
      _amount: value,
      _kind: isVoucherOnly ? "voucher" : q.kind,
      _description: desc.trim() || (value < 0 ? L("Ajuste", "Adjustment") : L("Pagamento", "Payment")),
      _voucher: voucherValue,
      _voucher_description: isVoucherOnly ? (desc.trim() || "Voucher") : `Voucher ${q.label.toLowerCase()}`,
    });
    setBusy(false);
    if (error) { haptics.warning(); toast.error(error.message); return; }
    haptics.success();
    toast.success(isVoucherOnly ? L("Voucher lançado", "Voucher added") : value < 0 ? L("Ajuste registrado", "Adjustment recorded") : L("Pagamento registrado", "Payment recorded"));
    setPayFor(null);
    load();
  };

  // ---- Discounts ----
  const dNumber = parseDiscountValue(dValue);
  const dOk = isValidDiscount(dKind, dNumber);
  const dDiscount: Discount = { kind: dKind, value: dNumber };
  const dItem = discountFor?.items.find(i => i.id === dItemId) ?? null;
  // Quanto sai, de verdade, com o que está preenchido agora. Sai da mesma
  // conta que o banco faz (src/lib/discount.ts espelha public.lesson_discount),
  // então o número mostrado aqui é o que a carteira vai lançar.
  const dPreview = !dOk ? 0
    : dScope === "lesson" ? (dItem ? discountOn(dItem.amount, dDiscount) : 0)
      : dScope === "open" ? discountOnItems(discountFor?.items ?? [], dDiscount)
        : discountOnItems(discountFor?.items ?? [], dDiscount);

  const openDiscount = (a: Account) => {
    haptics.tap();
    setDiscountFor(a);
    setDKind(a.discount?.kind ?? "percent");
    setDValue(a.discount ? String(a.discount.value) : "");
    setDScope("always");
    setDItemId(a.items[0]?.id ?? "");
  };

  const submitDiscount = async () => {
    if (!discountFor) return;
    if (!dOk) {
      toast.error(dKind === "percent" ? L("Informe uma porcentagem entre 0 e 100", "Enter a percentage between 0 and 100") : L("Informe um valor em reais", "Enter an amount"));
      return;
    }
    if (dScope === "lesson" && !dItem) { toast.error(L(`Escolha ${ap.o} ${ap.l}`, `Choose the ${ap.l}`)); return; }
    if (dScope !== "always" && !(dPreview > 0)) { toast.error(L("Não há nada em aberto para abater", "Nothing outstanding to discount")); return; }

    setBusy(true);
    const rotulo = describeDiscount(dDiscount);

    if (dScope === "always") {
      // O banco guarda a regra e recalcula o crédito de cada aula realizada.
      const { error } = await supabase.rpc("set_account_discount", {
        _student: discountFor.student,
        _guardian: discountFor.guardian,
        _kind: dKind,
        _value: dNumber,
      });
      setBusy(false);
      if (error) { haptics.warning(); toast.error(error.message); return; }
      haptics.success();
      toast.success(L(`Desconto de ${rotulo} valendo para ${ap.os} ${ap.lp} de ${discountFor.label}`, `${rotulo} discount now applies to ${discountFor.label}'s ${ap.lp}`));
    } else {
      // Abatimento pontual: entra como voucher solto (sem aula vinculada), e
      // por isso o desconto fixo nunca o recalcula nem o apaga.
      const descricao = dScope === "lesson"
        ? L(`Desconto de ${rotulo} - ${dItem!.detail} de ${format(new Date(dItem!.date), "dd/MM", { locale: dateLocale() })}`, `${rotulo} discount - ${dItem!.detail} on ${format(new Date(dItem!.date), "MMM d", { locale: dateLocale() })}`)
        : L(`Desconto de ${rotulo} em ${discountFor.items.length} cobrança${discountFor.items.length > 1 ? "s" : ""} em aberto`, `${rotulo} discount on ${discountFor.items.length} outstanding charge${discountFor.items.length > 1 ? "s" : ""}`);
      const { error } = await supabase.rpc("register_payment", {
        _student: discountFor.student,
        _guardian: discountFor.guardian,
        _amount: 0,
        _kind: "voucher",
        _description: descricao,
        _voucher: dPreview,
        _voucher_description: descricao,
      });
      setBusy(false);
      if (error) { haptics.warning(); toast.error(error.message); return; }
      haptics.success();
      toast.success(L(`Desconto de ${fmtMoney(dPreview)} lançado`, `${fmtMoney(dPreview)} discount added`));
    }
    setDiscountFor(null);
    load();
  };

  const removeDiscount = async () => {
    if (!discountFor?.discount) return;
    if (!confirm(
      L(`Tirar o desconto fixo de ${discountFor.label}?\n\nOs créditos que ele já lançou ${ap.pick("nos", "nas")} ${ap.lp} ${ap.pick("realizados", "realizadas")} também saem, e o que ${g.o} ${g.l} deve volta ao valor cheio. Abatimentos pontuais lançados à mão não são afetados.`,
        `Remove ${discountFor.label}'s standing discount?\n\nThe credits it already added to past ${ap.lp} are removed too, and what the ${g.l} owes goes back to full price. One-off discounts added by hand are not affected.`)
    )) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_account_discount", {
      _student: discountFor.student,
      _guardian: discountFor.guardian,
      _kind: null,
      _value: null,
    });
    setBusy(false);
    if (error) { haptics.warning(); toast.error(error.message); return; }
    haptics.success();
    toast.success(L("Desconto fixo removido", "Standing discount removed"));
    setDiscountFor(null);
    load();
  };

  // ---- Edit / remove manual entries ----
  const openEdit = (t: Tx) => { setEditingTx(t); setEditAmount(String(t.amount)); setEditDesc(t.description ?? ""); };
  const submitEdit = async () => {
    if (!editingTx) return;
    const value = Number(String(editAmount).replace(",", "."));
    if (!Number.isFinite(value) || value === 0) { toast.error(L("Valor inválido", "Invalid amount")); return; }
    setBusy(true);
    const { error } = await supabase.from("wallet_transactions").update({ amount: value, description: editDesc || editingTx.description }).eq("id", editingTx.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { haptics.success(); toast.success(L("Lançamento atualizado", "Entry updated")); setEditingTx(null); load(); }
  };
  const removeTx = async (t: Tx) => {
    if (!confirm(L(`Remover este lançamento de ${fmtMoney(Number(t.amount))}? Essa ação não pode ser desfeita.`, `Remove this ${fmtMoney(Number(t.amount))} entry? This can't be undone.`))) return;
    const { error } = await supabase.from("wallet_transactions").delete().eq("id", t.id);
    if (error) toast.error(error.message); else { haptics.success(); toast.success(L("Lançamento removido", "Entry removed")); load(); }
  };

  // ---- Pacote por aulas: excluir a compra ----
  const removePurchase = async (id: string) => {
    const p = purchases.find(x => x.id === id);
    if (!p) return;
    if (!confirm(L(`Excluir a compra "${p.name}"?\n\n${cap(ap.os)} ${ap.lp} que ela cobriu voltam a ser ${ap.pick("cobrados", "cobradas")} pelo valor cheio e a cobrança do pacote sai. Um pagamento já registrado continua como crédito.`,
      `Delete the purchase "${p.name}"?\n\nThe ${ap.lp} it covered go back to full price and the package charge is removed. A payment already recorded stays as credit.`))) return;
    const { error } = await supabase.from("package_purchases" as never).delete().eq("id", id);
    if (error) { toast.error(dbErrorMessage(error, v)); return; }
    haptics.success();
    toast.success(L("Compra do pacote excluída", "Package purchase deleted"));
    load();
  };

  // ---- Lessons behind a charge ----
  const openLessonEdit = async (lessonId: string) => {
    const { data, error } = await supabase.from("lessons").select("*").eq("id", lessonId).maybeSingle();
    if (error || !data) { toast.error(L(`${ap.s} não ${ap.pick("encontrado", "encontrada")}`, `${ap.s} not found`)); return; }
    setEditingLesson({ ...data, start_at: format(new Date(data.start_at), "yyyy-MM-dd'T'HH:mm") });
    setLessonDlgOpen(true);
  };
  const removeLesson = async (lessonId: string) => {
    if (!confirm(L(`Excluir ${ap.este} ${ap.l}? O lançamento na carteira também será removido.`, `Delete this ${ap.l}? Its billing entry is removed too.`))) return;
    const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
    if (error) toast.error(error.message); else { haptics.success(); toast.success(L(`${ap.s} ${ap.pick("excluído", "excluída")}`, `${ap.s} deleted`)); load(); }
  };


  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{L("Financeiro", "Billing")}</h1>
          <p className="text-sm text-muted-foreground">
            {L(`Cada ${ap.l} ${ap.pick("realizado", "realizada")} vira uma cobrança. Registre o que recebeu e ${ap.os} ${ap.lp} mais ${ap.pick("antigos", "antigas")} são ${ap.pick("quitados", "quitadas")} ${ap.pick("sozinhos", "sozinhas")}.`,
               `Each completed ${ap.l} becomes a charge. Record what you receive and the oldest ${ap.lp} are paid off automatically.`)}
          </p>
        </div>

        {!loading && <PeriodSummary lessons={lessons} txs={txs} statements={accounts} />}
        {!loading && accounts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={L("Buscar pelo nome", "Search by name")}
                  aria-label={L("Buscar conta", "Search account")} className="h-10 rounded-xl pl-9" />
              </div>
              <SortMenu value={sort} options={ACCOUNT_SORTS} onChange={setSort} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map(f => (
                <button key={f.key} type="button" onClick={() => { haptics.tap(); setFilter(f.key); }}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
                    f.key === "overdue" && filter !== f.key && counts.overdue > 0 && "text-destructive")}>
                  {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
                </button>
              ))}
              {accounts.some(a => a.owed > 0) && (
                <Button size="sm" variant="ghost" className="ml-auto h-8 gap-1 rounded-xl text-xs" disabled={mailing === "all"} onClick={chargeAllEmail}>
                  <Mail className="h-3.5 w-3.5" /> {L("Cobrar todos por e-mail", "Email all reminders")}
                </Button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <ListSkeleton rows={4} />
        ) : accounts.length === 0 ? (
          <EmptyState icon={Wallet} title={L("Nenhuma conta ainda", "No accounts yet")} description={L(`As contas aparecem aqui assim que houver ${v.client.lp} ou ${ap.lp}.`, `Accounts show up here once you have ${v.client.lp} or ${ap.lp}.`)} />
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{L("Nenhuma conta com esse filtro.", "No accounts match this filter.")}</p>
        ) : (
          <div className="space-y-3">
            {visible.map(a => {
              const isExp = !!expanded[a.key];
              const overdue = isOverdue(a);
              const credit = a.balance > 0 ? a.balance : 0;
              const purchase = currentPurchase(a.ledger.packages);
              const pkg = purchase ? null : currentPackage(a.ledger.sources);
              const pkgLeft = pkg ? lessonsLeftIn(pkg, a.ledger.charges) : null;
              const toggle = () => { haptics.tap(); setExpanded(e => ({ ...e, [a.key]: !isExp })); };
              return (
                <Card key={a.key} className={cn("rounded-2xl p-4 md:p-5", overdue && "border-destructive/40")}>
                  <div className="flex items-start justify-between gap-3">
                    <button className="flex min-w-0 items-start gap-2 text-left" onClick={toggle} aria-expanded={isExp}>
                      {isExp ? <ChevronDown className="mt-1 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0" />}
                      <div className="min-w-0">
                        <div className="truncate text-lg font-semibold">{a.label}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {a.guardian ? `${v.client.s}: ${a.student} · ` : ""}
                          {a.items.length > 0 ? `${a.items.length} ${a.items.length > 1 ? ap.lp : ap.l} ${L("em aberto", "outstanding")}` : L("em dia", "up to date")}
                        </div>
                      </div>
                    </button>
                    <div className="shrink-0 text-right">
                      {a.owed > 0 ? (
                        <>
                          <div className={`text-[10px] uppercase tracking-wide ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
                            {overdue ? L(`Em atraso · ${daysOpen(a.oldestOpenDate)} dias`, `Overdue · ${daysOpen(a.oldestOpenDate)} days`) : L("A receber", "To receive")}
                          </div>
                          <div className={`text-xl font-bold tabular-nums ${overdue ? "text-destructive" : ""}`}>{fmtMoney(a.owed)}</div>
                        </>
                      ) : credit > 0 ? (
                        <>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{L("Crédito", "Credit")}</div>
                          <div className="text-xl font-bold tabular-nums text-success">{fmtMoney(credit)}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{L("Situação", "Status")}</div>
                          <div className="text-base font-medium text-muted-foreground">{L("Em dia", "Up to date")}</div>
                        </>
                      )}
                    </div>
                  </div>

                  {(purchase || pkg || a.discount) && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                      {purchase && (
                        <Badge className="gap-1 border-transparent bg-primary/15 text-[11px] font-medium text-primary hover:bg-primary/15">
                          <Package className="h-3 w-3" />
                          {purchase.name}: {L(`restam ${String(purchase.left).replace(".", ",")} de ${purchase.sessions}`, `${purchase.left} of ${purchase.sessions} left`)}
                        </Badge>
                      )}
                      {pkg && (
                        <Badge variant="outline" className="gap-1 border-primary/30 text-[11px] font-normal">
                          <Package className="h-3 w-3 text-primary" />
                          {pkg.label}: {L(`sobra ${fmtMoney(pkg.left)}`, `${fmtMoney(pkg.left)} left`)}
                          {pkgLeft ? L(` (${pkgLeft} ${pkgLeft === 1 ? ap.l : ap.lp})`, ` (${pkgLeft} ${pkgLeft === 1 ? ap.l : ap.lp})`) : ""}
                        </Badge>
                      )}
                      {a.discount && (
                        <Badge variant="outline" className="gap-1 text-[11px] font-normal">
                          <Percent className="h-3 w-3" />
                          {L("Desconto fixo de", "Standing discount of")} {describeDiscount(a.discount)}
                        </Badge>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
                    <Button size="sm" className="h-9 gap-1 rounded-xl" onClick={() => openPay(a)}>
                      <Plus className="h-4 w-4" /> {L("Pagamento", "Payment")}
                    </Button>
                    {a.owed > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" className="h-9 gap-1 rounded-xl" onClick={() => haptics.tap()}>
                            <Send className="h-3.5 w-3.5" /> {L("Cobrar", "Request")} <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="rounded-xl">
                          <DropdownMenuItem onClick={() => copyCollection(a)}><Copy className="mr-2 h-4 w-4" /> {L("Copiar mensagem (WhatsApp)", "Copy message")}</DropdownMenuItem>
                          {online.connected && <DropdownMenuItem onClick={() => copyPayLink(a)}><CreditCard className="mr-2 h-4 w-4" /> {L("Copiar link de pagamento (cartão/Pix)", "Copy payment link (card/Pix)")}</DropdownMenuItem>}
                          {pixFor(a) && <DropdownMenuItem onClick={() => copyPix(a)}><Copy className="mr-2 h-4 w-4" /> {L(`Copiar Pix de ${fmtMoney(a.owed)}`, `Copy Pix of ${fmtMoney(a.owed)}`)}</DropdownMenuItem>}
                          <DropdownMenuItem disabled={mailing === a.key} onClick={() => emailCharge(a)}><Mail className="mr-2 h-4 w-4" /> {L("Enviar cobrança por e-mail", "Email reminder")}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-9 w-9 rounded-xl" aria-label={L("Mais opções", "More options")} onClick={() => haptics.tap()}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="rounded-xl">
                        {plan.packages && <DropdownMenuItem onClick={() => openDiscount(a)}><Percent className="mr-2 h-4 w-4" /> {L("Desconto", "Discount")}</DropdownMenuItem>}
                        <DropdownMenuItem disabled={mailing === a.key + ":s"} onClick={() => emailCharge(a, true)}><Mail className="mr-2 h-4 w-4" /> {L("Enviar extrato por e-mail", "Email statement")}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setHistoryFor(a)}><History className="mr-2 h-4 w-4" /> {L("E-mails enviados", "Emails sent")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {!isExp && (
                      <button type="button" onClick={toggle} className="ml-auto text-xs font-medium text-primary">
                        {L("Ver detalhes", "Details")}
                      </button>
                    )}
                  </div>

                  {isExp && (
                    <div className="mt-4 space-y-3 border-t border-border pt-3">
                      {a.nextLesson && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <CalendarClock className="h-3.5 w-3.5" />
                          {L(`${ap.proximo} ${ap.l}`, `Next ${ap.l}`)}: <span className="capitalize text-foreground">{format(new Date(a.nextLesson.start_at), L("EEE dd/MM 'às' HH:mm", "EEE, MMM d 'at' h:mm a"), { locale: dateLocale() })}</span>
                          · {a.nextLesson.subject ?? ap.s} ({teacherName(a.nextLesson.teacher)})
                        </div>
                      )}
                      <AccountLedger ledger={a.ledger} defaultTab={a.owed > 0 || a.ledger.sources.length === 0 ? "lessons" : "payments"} actions={{
                        onEditLesson: openLessonEdit,
                        onDeleteLesson: removeLesson,
                        onEditTx: id => { const t = txs.find(x => x.id === id); if (t) openEdit(t); },
                        onDeleteTx: id => { const t = txs.find(x => x.id === id); if (t) removeTx(t); },
                        txInfo: id => { const t = txs.find(x => x.id === id); return t && { amount: Number(t.amount), kind: t.kind, description: t.description }; },
                        onDeletePurchase: removePurchase,
                      }} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!payFor} onOpenChange={v => !v && setPayFor(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{L("Registrar pagamento", "Record payment")}</DialogTitle>
            <DialogDescription>{payFor?.label}{payFor && payFor.owed > 0 ? ` · ${L("em aberto", "outstanding")} ${fmtMoney(payFor.owed)}` : L(" · em dia", " · up to date")}</DialogDescription>
          </DialogHeader>
          {payFor && (
            <div className="space-y-4">
              {!plan.packages && (
                <ProUpsell titulo={L("Pacotes e vouchers são a partir do Cronys Start", "Packages and vouchers come with Cronys Start and up")} compacto>
                  {L("aqui você registra o que recebeu. Vender pacote com desconto e dar voucher ficam nos planos pagos.", "here you record what you received. Selling discounted packages and giving vouchers are on paid plans.")}
                </ProUpsell>
              )}
              <div className="grid grid-cols-2 gap-2">
                {QUICK
                  .filter(q => q.key !== "all" || payFor.owed > 0)
                  .filter(q => plan.packages || q.kind === "adjustment")
                  .map(q => (
                  <button key={q.key} type="button" onClick={() => chooseQuick(q.key)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${quick === q.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}>
                    <div className="font-medium">{q.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {q.key === "all" ? fmtMoney(payFor.owed)
                        : q.hint ? q.hint
                          : q.key === "custom" ? L("digite abaixo", "type below") : fmtMoney(q.amount!)}
                    </div>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_2fr] gap-3">
                <div>
                  <Label>{isVoucherOnly ? `Voucher (${currencySymbol()})` : isPackage ? `${L("Recebido agora", "Received now")} (${currencySymbol()})` : `${L("Valor", "Amount")} (${currencySymbol()})`}</Label>
                  <Input type="number" step="0.01" inputMode="decimal" className="h-11 rounded-xl" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <div>
                  <Label>{L("Descrição", "Description")}</Label>
                  <Input className="h-11 rounded-xl" value={desc} onChange={e => setDesc(e.target.value)} placeholder={isVoucherOnly ? L("Ex.: desconto combinado", "E.g. agreed discount") : L("Ex.: Pix de setembro", "E.g. September transfer")} />
                </div>
              </div>
              {isPackage && (
                <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <Package className="h-4 w-4" /> {L(`${quickOption.sessions} ${ap.lp} de ${quickOption.minutes} min`, `${quickOption.sessions} ${ap.lp} of ${quickOption.minutes} min`)}
                  </div>
                  <p className="text-muted-foreground">
                    {L(`Cada ${ap.l} ${ap.pick("realizado", "realizada")} gasta 1 ${ap.l} do pacote (${ap.um} ${ap.l} de ${(quickOption.minutes ?? 60) * 2} min gasta 2). O valor do pacote entra como cobrança; o que você recebeu agora a paga.`,
                       `Each completed ${ap.l} uses 1 from the package (a ${(quickOption.minutes ?? 60) * 2}-min ${ap.l} uses 2). The package price is charged; what you received now pays it.`)}
                  </p>
                  {packagePreview.length > 0 && (
                    <div>
                      <div className="mb-0.5 font-medium">{L(`Já cobre ${packagePreview.length} ${packagePreview.length === 1 ? ap.l : ap.lp} em aberto:`, `Already covers ${packagePreview.length} open ${packagePreview.length === 1 ? ap.l : ap.lp}:`)}</div>
                      <ul className="space-y-0.5">
                        {packagePreview.slice(0, 5).map(i => (
                          <li key={i.id} className="flex justify-between gap-2">
                            <span className="min-w-0 truncate"><Check className="mr-1 inline h-3 w-3 text-primary" /><span className="capitalize">{format(new Date(i.date), L("EEE dd/MM", "EEE MMM d"), { locale: dateLocale() })}</span> <span className="text-muted-foreground">· {i.detail}</span></span>
                            {i.sessions !== 1 && <span className="shrink-0 tabular-nums">{String(i.sessions).replace(".", ",")}</span>}
                          </li>
                        ))}
                        {packagePreview.length > 5 && <li className="text-muted-foreground">+ {packagePreview.length - 5}</li>}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {creditValue > 0 && !isPackage && (
                <div className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {voucherValue > 0 && payValue > 0
                      ? L(`${fmtMoney(payValue)} recebidos + ${fmtMoney(voucherValue)} de voucher = ${fmtMoney(creditValue)} de crédito. `, `${fmtMoney(payValue)} received + ${fmtMoney(voucherValue)} voucher = ${fmtMoney(creditValue)} credit. `)
                      : voucherValue > 0
                        ? L(`${fmtMoney(voucherValue)} de crédito, sem entrada de dinheiro. `, `${fmtMoney(voucherValue)} credit, with no money in. `)
                        : ""}
                    {payFor.owed <= 0
                      ? L(`Fica como crédito para ${ap.os} ${ap.pick("próximos", "próximas")} ${ap.lp}.`, `It stays as credit for upcoming ${ap.lp}.`)
                      : leftover >= 0
                        ? L(`Quita ${ap.pick("todos", "todas")} ${ap.os} ${ap.lp} em aberto${leftover > 0 ? ` e sobra ${fmtMoney(leftover)} de crédito` : ""}.`, `Pays off all outstanding ${ap.lp}${leftover > 0 ? ` with ${fmtMoney(leftover)} credit left over` : ""}.`)
                        : L(`Quita ${ap.os} ${ap.lp} mais ${ap.pick("antigos", "antigas")}; ficam ${fmtMoney(-leftover)} em aberto.`, `Pays off the oldest ${ap.lp}; ${fmtMoney(-leftover)} stays outstanding.`)}
                  </span>
                </div>
              )}
              {payPreview.length > 0 && (
                <div className="rounded-xl border border-border p-2.5">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{L("Vai quitar", "Will pay off")}</div>
                  <ul className="space-y-0.5 text-xs">
                    {payPreview.slice(0, 5).map(i => (
                      <li key={i.id} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <Check className={cn("mr-1 inline h-3 w-3", i.take < i.amount ? "text-warning" : "text-success")} />
                          <span className="capitalize">{format(new Date(i.date), L("EEE dd/MM", "EEE MMM d"), { locale: dateLocale() })}</span>
                          <span className="text-muted-foreground"> · {i.detail}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{i.take < i.amount ? L(`${fmtMoney(i.take)} de ${fmtMoney(i.amount)}`, `${fmtMoney(i.take)} of ${fmtMoney(i.amount)}`) : fmtMoney(i.amount)}</span>
                      </li>
                    ))}
                    {payPreview.length > 5 && <li className="text-muted-foreground">{L(`+ ${payPreview.length - 5} ${ap.lp}`, `+ ${payPreview.length - 5} more`)}</li>}
                  </ul>
                </div>
              )}
              {!isVoucherOnly && !isPackage && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={allowNegative} onCheckedChange={v => setAllowNegative(v === true)} />
                  {L("Ajuste ou estorno (permitir valor negativo)", "Adjustment or refund (allow negative amount)")}
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setPayFor(null)}>{L("Cancelar", "Cancel")}</Button>
            <Button className="rounded-xl" onClick={submitPay} disabled={busy}>{L("Registrar", "Record")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!discountFor} onOpenChange={v => !v && setDiscountFor(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>{L("Aplicar desconto", "Apply discount")}</DialogTitle>
            <DialogDescription>
              {discountFor?.label}
              {discountFor?.discount && L(` · hoje com desconto fixo de ${describeDiscount(discountFor.discount)}`, ` · currently with a standing discount of ${describeDiscount(discountFor.discount)}`)}
            </DialogDescription>
          </DialogHeader>
          {discountFor && (
            <div className="space-y-4">
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <div>
                  <Label>{L("Em", "In")}</Label>
                  <div className="mt-1 flex rounded-xl border border-border p-0.5">
                    {(["percent", "amount"] as DiscountKind[]).map(k => (
                      <button key={k} type="button" onClick={() => setDKind(k)}
                        className={`h-10 w-14 rounded-lg text-sm font-medium transition-colors ${dKind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                        {k === "percent" ? "%" : currencySymbol()}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>{dKind === "percent" ? L("Porcentagem", "Percentage") : L(`Valor por ${ap.l} (${currencySymbol()})`, `Amount per ${ap.l} (${currencySymbol()})`)}</Label>
                  <Input
                    type="number" step="0.01" inputMode="decimal" className="h-11 rounded-xl"
                    value={dValue} onChange={e => setDValue(e.target.value)}
                    placeholder={dKind === "percent" ? L("Ex.: 10", "E.g. 10") : L("Ex.: 30", "E.g. 30")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{L("Aplicar em", "Apply to")}</Label>
                {([
                  {
                    key: "always" as const,
                    title: L(`${cap(ap.pick("todos", "todas"))} ${ap.os} ${ap.lp} d${g.este} ${g.l}, sempre`, `All of this ${g.l}'s ${ap.lp}, always`),
                    body: L(`Vale para ${ap.os} ${ap.lp} que já aconteceram e para ${ap.os} ${ap.pick("próximos", "próximas")}, sozinho. Mudar ou tirar depois recalcula tudo.`, `Applies to past and upcoming ${ap.lp}, automatically. Changing or removing it later recalculates everything.`),
                  },
                  {
                    key: "open" as const,
                    title: L(`Só o que está em aberto agora${discountFor.items.length ? ` (${discountFor.items.length})` : ""}`, `Only what is outstanding now${discountFor.items.length ? ` (${discountFor.items.length})` : ""}`),
                    body: L(`Um abatimento de uma vez, sobre cada cobrança em aberto. Não vale para ${ap.os} ${ap.pick("próximos", "próximas")} ${ap.lp}.`, `A one-off discount on each outstanding charge. It doesn't apply to upcoming ${ap.lp}.`),
                    disabled: discountFor.items.length === 0,
                  },
                  {
                    key: "lesson" as const,
                    title: L(`Só ${ap.um} ${ap.l}`, `Just one ${ap.l}`),
                    body: L(`Um abatimento de uma vez, ${ap.no} ${ap.l} ${ap.pick("escolhido", "escolhida")}.`, `A one-off discount on the chosen ${ap.l}.`),
                    disabled: discountFor.items.length === 0,
                  },
                ]).map(o => (
                  <button
                    key={o.key} type="button" disabled={o.disabled}
                    onClick={() => setDScope(o.key)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dScope === o.key ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                  >
                    <div className={`text-sm font-medium ${dScope === o.key ? "text-primary" : ""}`}>{o.title}</div>
                    <div className="text-xs text-muted-foreground">{o.body}</div>
                  </button>
                ))}
              </div>

              {dScope === "lesson" && (
                <div>
                  <Label>{L(`Qual ${ap.l}`, `Which ${ap.l}`)}</Label>
                  <select
                    className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
                    value={dItemId} onChange={e => setDItemId(e.target.value)}
                  >
                    {discountFor.items.map(i => (
                      <option key={i.id} value={i.id}>
                        {format(new Date(i.date), L("dd/MM HH:mm", "MMM d, h:mm a"), { locale: dateLocale() })} · {i.detail} · {fmtMoney(i.amount)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {!dOk ? (
                    dKind === "percent"
                      ? L("Informe uma porcentagem entre 0 e 100.", "Enter a percentage between 0 and 100.")
                      : L(`Informe quanto sai de cada ${ap.l}, em reais.`, `Enter how much comes off each ${ap.l}.`)
                  ) : dScope === "always" ? (
                    <>
                      {L(`Cada ${ap.l} continua valendo o preço cheio e o desconto entra como crédito na carteira — é isso que mantém o extrato fechando.`,
                         `Each ${ap.l} keeps its full price and the discount goes in as credit — that keeps the statement balanced.`)}
                      {discountFor.items.length > 0
                        ? L(` Nas ${discountFor.items.length} cobrança(s) em aberto de hoje, isso dá ${fmtMoney(dPreview)}.`, ` On today's ${discountFor.items.length} outstanding charge(s), that's ${fmtMoney(dPreview)}.`)
                        : L(` Ainda não há ${ap.lp} em aberto, então o efeito aparece ${ap.no} ${ap.pick("próximo", "próxima")} ${ap.l} ${ap.pick("realizado", "realizada")}.`, ` There are no outstanding ${ap.lp} yet, so it shows up on the next completed ${ap.l}.`)}
                    </>
                  ) : dScope === "lesson" ? (
                    dItem
                      ? L(`Entra um crédito de ${fmtMoney(dPreview)} na carteira ${g.do} ${g.l}. ${cap(ap.os)} ${ap.pick("próximos", "próximas")} ${ap.lp} seguem pelo valor cheio.`, `A ${fmtMoney(dPreview)} credit goes to the ${g.l}'s balance. Upcoming ${ap.lp} stay at full price.`)
                      : L(`Escolha ${ap.o} ${ap.l}.`, `Choose the ${ap.l}.`)
                  ) : (
                    L(`Entra um crédito de ${fmtMoney(dPreview)}, somando o abatimento de cada uma das ${discountFor.items.length} cobrança(s) em aberto. ${cap(ap.os)} ${ap.pick("próximos", "próximas")} ${ap.lp} seguem pelo valor cheio.`,
                      `A ${fmtMoney(dPreview)} credit goes in, adding up the discount on each of the ${discountFor.items.length} outstanding charge(s). Upcoming ${ap.lp} stay at full price.`)
                  )}
                </span>
              </div>

              {dKind === "amount" && dScope !== "lesson" && (
                <p className="text-[11px] text-muted-foreground">
                  {L(<>Em reais o valor sai de <strong className="text-foreground">cada</strong> {ap.l},
                  não do total, e nunca passa do que {ap.o} {ap.pick("próprio", "própria")} {ap.l} custa.</>,
                  <>A fixed amount comes off <strong className="text-foreground">each</strong> {ap.l}, not the total, and never exceeds what the {ap.l} itself costs.</>)}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {discountFor?.discount ? (
              <Button variant="destructive" className="rounded-xl" onClick={removeDiscount} disabled={busy}>
                {L("Tirar desconto fixo", "Remove standing discount")}
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setDiscountFor(null)}>{L("Cancelar", "Cancel")}</Button>
              <Button className="rounded-xl" onClick={submitDiscount} disabled={busy}>{L("Aplicar", "Apply")}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTx} onOpenChange={v => !v && setEditingTx(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>{L("Editar lançamento", "Edit entry")}</DialogTitle></DialogHeader>
          {editingTx && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{L("Conta", "Account")}: <strong className="text-foreground">{accountLabel(editingTx, v)}</strong></div>
              <div><Label>{L(`Valor (${currencySymbol()}) — negativo para estorno`, `Amount (${currencySymbol()}) — negative for a refund`)}</Label><Input type="number" step="0.01" className="h-11 rounded-xl" value={editAmount} onChange={e => setEditAmount(e.target.value)} /></div>
              <div><Label>{L("Descrição", "Description")}</Label><Input className="h-11 rounded-xl" value={editDesc} onChange={e => setEditDesc(e.target.value)} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setEditingTx(null)}>{L("Cancelar", "Cancel")}</Button>
            <Button className="rounded-xl" onClick={submitEdit} disabled={busy}>{L("Salvar", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LessonDialog
        open={lessonDlgOpen}
        onOpenChange={(v) => { setLessonDlgOpen(v); if (!v) setEditingLesson(null); }}
        lesson={editingLesson}
        onSaved={load}
      />
      <EmailHistoryDialog open={!!historyFor} onOpenChange={v => { if (!v) setHistoryFor(null); }}
        account={historyFor ? { student: historyFor.student, guardian: historyFor.guardian, label: historyFor.label } : undefined} />
    </PullToRefresh>
  );
}

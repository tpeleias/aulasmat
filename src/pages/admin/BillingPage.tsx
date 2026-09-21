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
import { ptBR } from "date-fns/locale";
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2, CalendarClock, Wallet, ArrowDownLeft, ArrowUpRight, Info, Percent } from "lucide-react";
import { toast } from "sonner";
import { LessonDialog } from "@/components/LessonDialog";
import { accountKey, accountLabel, fmtMoney, capitalize } from "@/lib/balance";
import { computeStatements, daysOpen, isOverdue, sortAccounts, ACCOUNT_SORTS, type AccountSort, type LedgerTx, type LedgerLesson, type AccountStatement } from "@/lib/billing";
import { discountOn, discountOnItems, isValidDiscount, describeDiscount, parseDiscountValue, type Discount, type DiscountKind } from "@/lib/discount";
import { useLessonPrice } from "@/hooks/useLessonPrice";
import { usePlan } from "@/hooks/usePlan";
import { ProUpsell } from "@/components/ProUpsell";
import { haptics } from "@/lib/haptics";
import ListSkeleton from "@/components/ListSkeleton";
import EmptyState from "@/components/EmptyState";
import PullToRefresh from "@/components/PullToRefresh";
import SortMenu, { useSortPreference } from "@/components/SortMenu";

type Tx = LedgerTx & { kind: "package" | "lesson" | "adjustment" | "voucher" };
type StudentRow = { id: string; student_name: string; guardian_name: string | null };
type LessonRow = LedgerLesson & { status: string; guardian_name: string | null };
type DiscountRow = { student_name: string; guardian_name: string | null; kind: DiscountKind; value: number };

type Account = AccountStatement & { txs: Tx[]; nextLesson: LessonRow | null; discount: Discount | null };

// Lessons are always charged at the list price. A package is the money received
// plus a voucher for the discount, so 10 lessons close at exactly zero.
type QuickOption = {
  key: string;
  label: string;
  amount?: number;
  voucher?: number;
  kind: "package" | "adjustment" | "voucher";
  hint?: string;
};

// Os valores de pacote continuam fixos: são um preço negociado, não uma conta
// a partir do valor da hora. Quando o valor da aula mudar nas Configurações,
// eles precisam ser revistos à mão - a caixa de aviso do diálogo mostra
// quanto sobra em aberto se não fecharem.
const quickOptions = (listPrice: number): QuickOption[] => [
  { key: "all", label: "Quitar tudo", kind: "adjustment" },
  { key: "pack10", label: "Pacote 10 aulas", amount: 2000, voucher: 200, kind: "package", hint: "R$ 2.000 + voucher R$ 200" },
  { key: "pack5", label: "Pacote 5 aulas", amount: 1050, voucher: 50, kind: "package", hint: "R$ 1.050 + voucher R$ 50" },
  { key: "single", label: "1 aula avulsa", amount: listPrice, kind: "adjustment" },
  { key: "voucher", label: "Voucher (desconto)", kind: "voucher", hint: "crédito sem dinheiro" },
  { key: "custom", label: "Outro valor", kind: "adjustment" },
];

// Onde o desconto pega. "always" é o desconto fixo da família, que o banco
// recalcula sozinho a cada aula; os outros dois são um abatimento pontual,
// que entra como voucher e fica parado onde está.
type DiscountScope = "lesson" | "open" | "always";

const kindLabel = (t: Tx) =>
  t.kind === "lesson" ? "Aula"
    : t.kind === "package" ? "Pacote"
      : t.kind === "voucher" ? "Voucher"
        : Number(t.amount) >= 0 ? "Pagamento" : "Ajuste";

export default function BillingPage() {
  const { price: listPrice } = useLessonPrice();
  // Pacote, voucher e desconto sao a mesma familia - abatimento combinado
  // com a familia - e ficam juntos no Pro. Registrar o dinheiro que entrou
  // continua no Essencial: cobrar e o minimo que o app precisa fazer.
  const { plan } = usePlan();
  const QUICK = useMemo(() => quickOptions(listPrice), [listPrice]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useSortPreference<AccountSort>("billing", ACCOUNT_SORTS, "owed");

  const [payFor, setPayFor] = useState<Account | null>(null);
  const [quick, setQuick] = useState("all");
  const [amount, setAmount] = useState<string>("");
  const [desc, setDesc] = useState("");
  const [voucher, setVoucher] = useState("");
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
    const [tx, st, ls, dc] = await Promise.all([
      supabase.from("wallet_transactions").select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at").order("created_at", { ascending: false }),
      supabase.from("students").select("id, student_name, guardian_name").order("student_name"),
      supabase.from("lessons").select("id, student_name, guardian_name, start_at, duration_minutes, subject, teacher, status"),
      supabase.from("account_discounts").select("student_name, guardian_name, kind, value"),
    ]);
    setTxs((tx.data ?? []) as Tx[]);
    setStudents((st.data ?? []) as StudentRow[]);
    setLessons((ls.data ?? []) as LessonRow[]);
    setDiscounts((dc.data ?? []) as DiscountRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const accounts = useMemo<Account[]>(() => {
    const done = lessons.filter(l => l.status === "realizada");
    const byKey = new Map(computeStatements(txs, done).map(s => [s.key, s]));

    // Students with no ledger activity yet still get a card, so nobody "disappears".
    for (const s of students) {
      const k = accountKey(s);
      if (!byKey.has(k)) {
        byKey.set(k, {
          key: k, label: accountLabel(s), student: s.student_name,
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

    const merged = [...byKey.values()].map(s => ({
      ...s,
      txs: txsByKey.get(s.key) ?? [],
      nextLesson: nextByKey.get(s.key) ?? null,
      discount: discountByKey.get(s.key) ?? null,
    }));
    return sortAccounts(merged, sort);
  }, [txs, students, lessons, discounts, sort]);

  const totals = useMemo(() => ({
    received: txs.reduce((s, t) => s + (Number(t.amount) > 0 ? Number(t.amount) : 0), 0),
    owed: accounts.reduce((s, a) => s + a.owed, 0),
    overdue: accounts.filter(isOverdue).length,
  }), [txs, accounts]);

  // ---- Register payment ----
  const quickOption = QUICK.find(x => x.key === quick) ?? QUICK[0];
  const isVoucherOnly = quickOption.kind === "voucher";
  const rawValue = Number(String(amount).replace(",", "."));
  const payValue = isVoucherOnly ? 0 : (Number.isFinite(rawValue) ? rawValue : 0);
  const voucherValue = isVoucherOnly
    ? (Number.isFinite(rawValue) ? rawValue : 0)
    : Number(String(voucher || "0").replace(",", ".")) || 0;
  const creditValue = Math.round((payValue + voucherValue) * 100) / 100;
  const leftover = payFor ? Math.round((creditValue - payFor.owed) * 100) / 100 : 0;

  const openPay = (a: Account) => {
    haptics.tap();
    setPayFor(a);
    const first = a.owed > 0 ? "all" : "pack10";
    setQuick(first);
    setAmount(String(first === "all" ? a.owed : 2000));
    setDesc(first === "all" ? "Pagamento" : "Pacote 10 aulas");
    setVoucher(first === "all" ? "" : "200");
    setAllowNegative(false);
  };

  const chooseQuick = (key: string) => {
    if (!payFor) return;
    setQuick(key);
    const q = QUICK.find(x => x.key === key)!;
    setVoucher(q.voucher ? String(q.voucher) : "");
    if (key === "all") { setAmount(String(payFor.owed)); setDesc("Pagamento"); }
    else if (key === "custom" || key === "voucher") { setAmount(""); setDesc(key === "voucher" ? "Voucher" : ""); }
    else { setAmount(String(q.amount)); setDesc(q.label); }
  };

  const submitPay = async () => {
    if (!payFor) return;
    const q = quickOption;
    const value = payValue;

    if (isVoucherOnly) {
      if (!(voucherValue > 0)) { toast.error("Informe o valor do voucher"); return; }
    } else {
      if (!Number.isFinite(value) || value === 0 || (value < 0 && !allowNegative)) { toast.error("Informe um valor válido"); return; }
      if (voucherValue < 0) { toast.error("Voucher inválido"); return; }
    }

    setBusy(true);
    const { error } = await supabase.rpc("register_payment", {
      _student: payFor.student,
      _guardian: payFor.guardian,
      _amount: value,
      _kind: isVoucherOnly ? "voucher" : q.kind,
      _description: desc.trim() || (value < 0 ? "Ajuste" : "Pagamento"),
      _voucher: voucherValue,
      _voucher_description: isVoucherOnly ? (desc.trim() || "Voucher") : `Voucher ${q.label.toLowerCase()}`,
    });
    setBusy(false);
    if (error) { haptics.warning(); toast.error(error.message); return; }
    haptics.success();
    toast.success(isVoucherOnly ? "Voucher lançado" : value < 0 ? "Ajuste registrado" : "Pagamento registrado");
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
      toast.error(dKind === "percent" ? "Informe uma porcentagem entre 0 e 100" : "Informe um valor em reais");
      return;
    }
    if (dScope === "lesson" && !dItem) { toast.error("Escolha a aula"); return; }
    if (dScope !== "always" && !(dPreview > 0)) { toast.error("Não há nada em aberto para abater"); return; }

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
      toast.success(`Desconto de ${rotulo} valendo para as aulas de ${discountFor.label}`);
    } else {
      // Abatimento pontual: entra como voucher solto (sem aula vinculada), e
      // por isso o desconto fixo nunca o recalcula nem o apaga.
      const descricao = dScope === "lesson"
        ? `Desconto de ${rotulo} - ${dItem!.detail} de ${format(new Date(dItem!.date), "dd/MM", { locale: ptBR })}`
        : `Desconto de ${rotulo} em ${discountFor.items.length} cobrança${discountFor.items.length > 1 ? "s" : ""} em aberto`;
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
      toast.success(`Desconto de ${fmtMoney(dPreview)} lançado`);
    }
    setDiscountFor(null);
    load();
  };

  const removeDiscount = async () => {
    if (!discountFor?.discount) return;
    if (!confirm(
      `Tirar o desconto fixo de ${discountFor.label}?\n\nOs créditos que ele já lançou nas aulas realizadas também saem, e o que a família deve volta ao valor cheio. Abatimentos pontuais lançados à mão não são afetados.`
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
    toast.success("Desconto fixo removido");
    setDiscountFor(null);
    load();
  };

  // ---- Edit / remove manual entries ----
  const openEdit = (t: Tx) => { setEditingTx(t); setEditAmount(String(t.amount)); setEditDesc(t.description ?? ""); };
  const submitEdit = async () => {
    if (!editingTx) return;
    const value = Number(String(editAmount).replace(",", "."));
    if (!Number.isFinite(value) || value === 0) { toast.error("Valor inválido"); return; }
    setBusy(true);
    const { error } = await supabase.from("wallet_transactions").update({ amount: value, description: editDesc || editingTx.description }).eq("id", editingTx.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { haptics.success(); toast.success("Lançamento atualizado"); setEditingTx(null); load(); }
  };
  const removeTx = async (t: Tx) => {
    if (!confirm(`Remover este lançamento de ${fmtMoney(Number(t.amount))}? Essa ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("wallet_transactions").delete().eq("id", t.id);
    if (error) toast.error(error.message); else { haptics.success(); toast.success("Lançamento removido"); load(); }
  };

  // ---- Lessons behind a charge ----
  const openLessonEdit = async (lessonId: string) => {
    const { data, error } = await supabase.from("lessons").select("*").eq("id", lessonId).maybeSingle();
    if (error || !data) { toast.error("Aula não encontrada"); return; }
    setEditingLesson({ ...data, start_at: format(new Date(data.start_at), "yyyy-MM-dd'T'HH:mm") });
    setLessonDlgOpen(true);
  };
  const removeLesson = async (lessonId: string) => {
    if (!confirm("Excluir esta aula? O lançamento na carteira também será removido.")) return;
    const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
    if (error) toast.error(error.message); else { haptics.success(); toast.success("Aula excluída"); load(); }
  };


  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cobrança</h1>
          <p className="text-sm text-muted-foreground">
            Cada aula realizada vira uma cobrança. Registre o que recebeu e as aulas mais antigas são quitadas sozinhas.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <Card className="rounded-2xl p-4 md:p-5">
            <div className="text-xs text-muted-foreground uppercase">Recebido</div>
            <div className="mt-1 text-2xl md:text-3xl font-bold tabular-nums text-success">{fmtMoney(totals.received)}</div>
          </Card>
          <Card className="rounded-2xl p-4 md:p-5">
            <div className="text-xs text-muted-foreground uppercase">A receber</div>
            <div className="mt-1 text-2xl md:text-3xl font-bold tabular-nums">{fmtMoney(totals.owed)}</div>
            {totals.overdue > 0 && <div className="text-xs text-destructive">{totals.overdue} conta{totals.overdue > 1 ? "s" : ""} em atraso</div>}
          </Card>
        </div>

        {!loading && accounts.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {accounts.length} conta{accounts.length > 1 ? "s" : ""}
            </span>
            <SortMenu value={sort} options={ACCOUNT_SORTS} onChange={setSort} />
          </div>
        )}

        {loading ? (
          <ListSkeleton rows={4} />
        ) : accounts.length === 0 ? (
          <EmptyState icon={Wallet} title="Nenhuma conta ainda" description="As contas aparecem aqui assim que houver alunos ou aulas." />
        ) : (
          <div className="space-y-3">
            {accounts.map(a => {
              const isExp = !!expanded[a.key];
              const overdue = isOverdue(a);
              const credit = a.balance > 0 ? a.balance : 0;
              return (
                <Card key={a.key} className="rounded-2xl p-4 md:p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <button className="flex items-center gap-2 text-left min-w-0" onClick={() => { haptics.tap(); setExpanded(e => ({ ...e, [a.key]: !isExp })); }}>
                      {isExp ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                      <div className="min-w-0">
                        <div className="font-semibold text-lg truncate">{a.label}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          Aluno: {a.student}
                          {a.items.length > 0 ? ` · ${a.items.length} aula${a.items.length > 1 ? "s" : ""} em aberto` : " · em dia"}
                        </div>
                        {a.discount && (
                          <Badge variant="outline" className="mt-1 gap-1 text-[10px] font-normal">
                            <Percent className="h-2.5 w-2.5" />
                            Desconto fixo de {describeDiscount(a.discount)}
                          </Badge>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center gap-3 ml-auto">
                      <div className="text-right">
                        {credit > 0 ? (
                          <>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Crédito</div>
                            <div className="text-xl font-bold tabular-nums text-success">{fmtMoney(credit)}</div>
                          </>
                        ) : a.owed > 0 ? (
                          <>
                            <div className={`text-[10px] uppercase tracking-wide ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
                              {overdue ? `Em atraso · ${daysOpen(a.oldestOpenDate)} dias` : "A receber"}
                            </div>
                            <div className={`text-xl font-bold tabular-nums ${overdue ? "text-destructive" : ""}`}>{fmtMoney(a.owed)}</div>
                          </>
                        ) : (
                          <>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Situação</div>
                            <div className="text-base font-medium text-muted-foreground">Em dia</div>
                          </>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Button size="sm" className="h-9 gap-1 rounded-xl" onClick={() => openPay(a)}>
                          <Plus className="w-4 h-4" /> Pagamento
                        </Button>
                        {plan.packages && (
                          <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl text-xs" onClick={() => openDiscount(a)}>
                            <Percent className="w-3.5 h-3.5" /> Desconto
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isExp && (
                    <div className="mt-4 border-t border-border pt-3 space-y-4">
                      {a.nextLesson && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <CalendarClock className="w-3.5 h-3.5" />
                          Próxima aula: <span className="text-foreground capitalize">{format(new Date(a.nextLesson.start_at), "EEE dd/MM 'às' HH:mm", { locale: ptBR })}</span>
                          · {a.nextLesson.subject ?? "Aula"} ({capitalize(a.nextLesson.teacher)})
                        </div>
                      )}

                      <div>
                        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Em aberto</div>
                        {a.items.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhuma aula em aberto.</p>
                        ) : (
                          <ul className="divide-y divide-border rounded-xl border border-border">
                            {a.items.map(i => (
                              <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                                <span className="min-w-0 truncate">
                                  <span className="capitalize">{format(new Date(i.date), "EEE dd/MM 'às' HH:mm", { locale: ptBR })}</span>
                                  <span className="text-muted-foreground"> · {i.detail}</span>
                                </span>
                                <span className="shrink-0 font-medium tabular-nums">
                                  {fmtMoney(i.amount)}{i.partial && <span className="text-xs font-normal text-muted-foreground"> restante</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Extrato</div>
                        {a.txs.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
                        ) : (
                          <ul className="space-y-1">
                            {a.txs.map(t => {
                              const v = Number(t.amount);
                              const manual = t.kind !== "lesson";
                              return (
                                <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {v >= 0 ? <ArrowDownLeft className="w-3.5 h-3.5 shrink-0 text-success" /> : <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                                    <Badge variant="outline" className="shrink-0 text-[10px]">{kindLabel(t)}</Badge>
                                    <span className="truncate text-muted-foreground">{t.description ?? "—"}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(t.created_at), "dd/MM", { locale: ptBR })}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className={`font-medium tabular-nums whitespace-nowrap ${v >= 0 ? "text-success" : ""}`}>{v > 0 ? "+" : ""}{fmtMoney(v)}</span>
                                    {manual ? (
                                      <>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)} title="Editar"><Pencil className="w-3 h-3" /></Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeTx(t)} title="Remover"><Trash2 className="w-3 h-3" /></Button>
                                      </>
                                    ) : t.lesson_id ? (
                                      <>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openLessonEdit(t.lesson_id!)} title="Editar aula"><Pencil className="w-3 h-3" /></Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeLesson(t.lesson_id!)} title="Excluir aula"><Trash2 className="w-3 h-3" /></Button>
                                      </>
                                    ) : null}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
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
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>{payFor?.label}{payFor && payFor.owed > 0 ? ` · em aberto ${fmtMoney(payFor.owed)}` : " · em dia"}</DialogDescription>
          </DialogHeader>
          {payFor && (
            <div className="space-y-4">
              {!plan.packages && (
                <ProUpsell titulo="Pacotes e vouchers sao do Cronys Pro" compacto>
                  aqui voce registra o que recebeu. Vender pacote com desconto e
                  dar voucher ficam no Pro.
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
                          : q.key === "custom" ? "digite abaixo" : fmtMoney(q.amount!)}
                    </div>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_2fr] gap-3">
                <div>
                  <Label>{isVoucherOnly ? "Voucher (R$)" : "Valor (R$)"}</Label>
                  <Input type="number" step="0.01" inputMode="decimal" className="h-11 rounded-xl" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Input className="h-11 rounded-xl" value={desc} onChange={e => setDesc(e.target.value)} placeholder={isVoucherOnly ? "Ex.: desconto combinado" : "Ex.: Pix de setembro"} />
                </div>
              </div>
              {!isVoucherOnly && plan.packages && (
                <div>
                  <Label>Voucher junto (R$)</Label>
                  <Input type="number" step="0.01" inputMode="decimal" className="h-11 rounded-xl" value={voucher} onChange={e => setVoucher(e.target.value)} placeholder="0" />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Desconto do pacote em crédito, já que as aulas entram a {fmtMoney(listPrice)}/h.
                    Os botões de pacote acima trazem R$ 200 e R$ 50, que são os valores
                    combinados para a aula a R$ 220/h — se você mudou o valor da aula,
                    confira no aviso abaixo quanto sobra em aberto.
                  </p>
                </div>
              )}
              {creditValue > 0 && (
                <div className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {voucherValue > 0 && payValue > 0
                      ? `${fmtMoney(payValue)} recebidos + ${fmtMoney(voucherValue)} de voucher = ${fmtMoney(creditValue)} de crédito. `
                      : voucherValue > 0
                        ? `${fmtMoney(voucherValue)} de crédito, sem entrada de dinheiro. `
                        : ""}
                    {payFor.owed <= 0
                      ? `Fica como crédito para as próximas aulas.`
                      : leftover >= 0
                        ? `Quita todas as aulas em aberto${leftover > 0 ? ` e sobra ${fmtMoney(leftover)} de crédito` : ""}.`
                        : `Quita as aulas mais antigas; ficam ${fmtMoney(-leftover)} em aberto.`}
                  </span>
                </div>
              )}
              {!isVoucherOnly && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={allowNegative} onCheckedChange={v => setAllowNegative(v === true)} />
                  Ajuste ou estorno (permitir valor negativo)
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setPayFor(null)}>Cancelar</Button>
            <Button className="rounded-xl" onClick={submitPay} disabled={busy}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!discountFor} onOpenChange={v => !v && setDiscountFor(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Aplicar desconto</DialogTitle>
            <DialogDescription>
              {discountFor?.label}
              {discountFor?.discount && ` · hoje com desconto fixo de ${describeDiscount(discountFor.discount)}`}
            </DialogDescription>
          </DialogHeader>
          {discountFor && (
            <div className="space-y-4">
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <div>
                  <Label>Em</Label>
                  <div className="mt-1 flex rounded-xl border border-border p-0.5">
                    {(["percent", "amount"] as DiscountKind[]).map(k => (
                      <button key={k} type="button" onClick={() => setDKind(k)}
                        className={`h-10 w-14 rounded-lg text-sm font-medium transition-colors ${dKind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                        {k === "percent" ? "%" : "R$"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>{dKind === "percent" ? "Porcentagem" : "Valor por aula (R$)"}</Label>
                  <Input
                    type="number" step="0.01" inputMode="decimal" className="h-11 rounded-xl"
                    value={dValue} onChange={e => setDValue(e.target.value)}
                    placeholder={dKind === "percent" ? "Ex.: 10" : "Ex.: 30"}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Aplicar em</Label>
                {([
                  {
                    key: "always" as const,
                    title: "Todas as aulas desta família, sempre",
                    body: "Vale para as aulas que já aconteceram e para as próximas, sozinho. Mudar ou tirar depois recalcula tudo.",
                  },
                  {
                    key: "open" as const,
                    title: `Só o que está em aberto agora${discountFor.items.length ? ` (${discountFor.items.length})` : ""}`,
                    body: "Um abatimento de uma vez, sobre cada cobrança em aberto. Não vale para as próximas aulas.",
                    disabled: discountFor.items.length === 0,
                  },
                  {
                    key: "lesson" as const,
                    title: "Só uma aula",
                    body: "Um abatimento de uma vez, na aula escolhida.",
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
                  <Label>Qual aula</Label>
                  <select
                    className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
                    value={dItemId} onChange={e => setDItemId(e.target.value)}
                  >
                    {discountFor.items.map(i => (
                      <option key={i.id} value={i.id}>
                        {format(new Date(i.date), "dd/MM HH:mm", { locale: ptBR })} · {i.detail} · {fmtMoney(i.amount)}
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
                      ? "Informe uma porcentagem entre 0 e 100."
                      : "Informe quanto sai de cada aula, em reais."
                  ) : dScope === "always" ? (
                    <>
                      Cada aula continua valendo o preço cheio e o desconto entra como
                      crédito na carteira — é isso que mantém o extrato fechando.
                      {discountFor.items.length > 0
                        ? ` Nas ${discountFor.items.length} cobrança(s) em aberto de hoje, isso dá ${fmtMoney(dPreview)}.`
                        : " Ainda não há aulas em aberto, então o efeito aparece na próxima aula realizada."}
                    </>
                  ) : dScope === "lesson" ? (
                    dItem
                      ? `Entra um crédito de ${fmtMoney(dPreview)} na carteira da família. As próximas aulas seguem pelo valor cheio.`
                      : "Escolha a aula."
                  ) : (
                    `Entra um crédito de ${fmtMoney(dPreview)}, somando o abatimento de cada uma das ${discountFor.items.length} cobrança(s) em aberto. As próximas aulas seguem pelo valor cheio.`
                  )}
                </span>
              </div>

              {dKind === "amount" && dScope !== "lesson" && (
                <p className="text-[11px] text-muted-foreground">
                  Em reais o valor sai de <strong className="text-foreground">cada</strong> aula,
                  não do total, e nunca passa do que a própria aula custa.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {discountFor?.discount ? (
              <Button variant="destructive" className="rounded-xl" onClick={removeDiscount} disabled={busy}>
                Tirar desconto fixo
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setDiscountFor(null)}>Cancelar</Button>
              <Button className="rounded-xl" onClick={submitDiscount} disabled={busy}>Aplicar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTx} onOpenChange={v => !v && setEditingTx(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>Editar lançamento</DialogTitle></DialogHeader>
          {editingTx && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">Conta: <strong className="text-foreground">{accountLabel(editingTx)}</strong></div>
              <div><Label>Valor (R$) — negativo para estorno</Label><Input type="number" step="0.01" className="h-11 rounded-xl" value={editAmount} onChange={e => setEditAmount(e.target.value)} /></div>
              <div><Label>Descrição</Label><Input className="h-11 rounded-xl" value={editDesc} onChange={e => setEditDesc(e.target.value)} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setEditingTx(null)}>Cancelar</Button>
            <Button className="rounded-xl" onClick={submitEdit} disabled={busy}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LessonDialog
        open={lessonDlgOpen}
        onOpenChange={(v) => { setLessonDlgOpen(v); if (!v) setEditingLesson(null); }}
        lesson={editingLesson}
        onSaved={load}
      />
    </PullToRefresh>
  );
}

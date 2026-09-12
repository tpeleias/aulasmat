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
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2, CalendarClock, Wallet, ArrowDownLeft, ArrowUpRight, Info } from "lucide-react";
import { toast } from "sonner";
import { LessonDialog } from "@/components/LessonDialog";
import { accountKey, accountLabel, fmtMoney, capitalize } from "@/lib/balance";
import { computeStatements, daysOpen, isOverdue, type LedgerTx, type LedgerLesson, type AccountStatement } from "@/lib/billing";
import { haptics } from "@/lib/haptics";
import ListSkeleton from "@/components/ListSkeleton";
import EmptyState from "@/components/EmptyState";
import PullToRefresh from "@/components/PullToRefresh";

type Tx = LedgerTx & { kind: "package" | "lesson" | "adjustment" | "voucher" };
type StudentRow = { id: string; student_name: string; guardian_name: string | null };
type LessonRow = LedgerLesson & { status: string; guardian_name: string | null };

type Account = AccountStatement & { txs: Tx[]; nextLesson: LessonRow | null };

// Lessons are always charged at the list price (R$220/h). A package is the money received
// plus a voucher for the discount, so 10 x R$220 = R$2.200 is closed by R$2.000 + R$200.
const LIST_PRICE = 220;

type QuickOption = {
  key: string;
  label: string;
  amount?: number;
  voucher?: number;
  kind: "package" | "adjustment" | "voucher";
  hint?: string;
};

const QUICK: QuickOption[] = [
  { key: "all", label: "Quitar tudo", kind: "adjustment" },
  { key: "pack10", label: "Pacote 10 aulas", amount: 2000, voucher: 200, kind: "package", hint: "R$ 2.000 + voucher R$ 200" },
  { key: "pack5", label: "Pacote 5 aulas", amount: 1050, voucher: 50, kind: "package", hint: "R$ 1.050 + voucher R$ 50" },
  { key: "single", label: "1 aula avulsa", amount: LIST_PRICE, kind: "adjustment" },
  { key: "voucher", label: "Voucher (desconto)", kind: "voucher", hint: "crédito sem dinheiro" },
  { key: "custom", label: "Outro valor", kind: "adjustment" },
];

const kindLabel = (t: Tx) =>
  t.kind === "lesson" ? "Aula"
    : t.kind === "package" ? "Pacote"
      : t.kind === "voucher" ? "Voucher"
        : Number(t.amount) >= 0 ? "Pagamento" : "Ajuste";

export default function BillingPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const load = async () => {
    const [tx, st, ls] = await Promise.all([
      supabase.from("wallet_transactions").select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at").order("created_at", { ascending: false }),
      supabase.from("students").select("id, student_name, guardian_name").order("student_name"),
      supabase.from("lessons").select("id, student_name, guardian_name, start_at, duration_minutes, subject, teacher, status"),
    ]);
    setTxs((tx.data ?? []) as Tx[]);
    setStudents((st.data ?? []) as StudentRow[]);
    setLessons((ls.data ?? []) as LessonRow[]);
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

    return [...byKey.values()]
      .map(s => ({ ...s, txs: txsByKey.get(s.key) ?? [], nextLesson: nextByKey.get(s.key) ?? null }))
      .sort((a, b) => b.owed - a.owed || a.label.localeCompare(b.label));
  }, [txs, students, lessons]);

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
      _voucher: isVoucherOnly ? 0 : voucherValue,
      _voucher_description: isVoucherOnly ? (desc.trim() || "Voucher") : `Voucher ${q.label.toLowerCase()}`,
    });
    setBusy(false);
    if (error) { haptics.warning(); toast.error(error.message); return; }
    haptics.success();
    toast.success(isVoucherOnly ? "Voucher lançado" : value < 0 ? "Ajuste registrado" : "Pagamento registrado");
    setPayFor(null);
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
                      <Button size="sm" className="h-9 gap-1 rounded-xl" onClick={() => openPay(a)}>
                        <Plus className="w-4 h-4" /> Pagamento
                      </Button>
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
              <div className="grid grid-cols-2 gap-2">
                {QUICK.filter(q => q.key !== "all" || payFor.owed > 0).map(q => (
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
              {!isVoucherOnly && (
                <div>
                  <Label>Voucher junto (R$)</Label>
                  <Input type="number" step="0.01" inputMode="decimal" className="h-11 rounded-xl" value={voucher} onChange={e => setVoucher(e.target.value)} placeholder="0" />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Desconto do pacote em crédito, já que as aulas entram a R$ {LIST_PRICE}/h.
                    Pacote de 10 → R$ 200. Pacote de 5 → R$ 50.
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

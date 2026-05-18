import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Plus, Wallet, ChevronDown, ChevronRight, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { LessonDialog } from "@/components/LessonDialog";

type Tx = {
  id: string;
  guardian_name: string | null;
  student_name: string;
  amount: number;
  kind: "package" | "lesson" | "adjustment";
  lesson_id: string | null;
  description: string | null;
  created_at: string;
};

const PACKAGES = [
  { key: "pack10", label: "Pacote 10 aulas — R$ 2.000,00", value: 2000 },
  { key: "pack5", label: "Pacote 5 aulas — R$ 1.050,00", value: 1050 },
  { key: "single", label: "Aula avulsa — R$ 220,00", value: 220 },
  { key: "custom", label: "Valor personalizado", value: 0 },
];

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function accountKey(t: { guardian_name: string | null; student_name: string }) {
  const g = (t.guardian_name ?? "").trim();
  return g ? `g:${g.toLowerCase()}` : `s:${t.student_name.toLowerCase()}`;
}
function accountLabel(t: { guardian_name: string | null; student_name: string }) {
  const g = (t.guardian_name ?? "").trim();
  return g || `Aluno: ${t.student_name}`;
}

type StudentRow = { id: string; student_name: string; guardian_name: string | null };

export default function BillingPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [lessonPay, setLessonPay] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [creditFor, setCreditFor] = useState<{ guardian: string | null; student: string } | null>(null);
  const [editingTx, setEditingTx] = useState<Tx | null>(null);
  const [editingLesson, setEditingLesson] = useState<any | null>(null);
  const [lessonDlgOpen, setLessonDlgOpen] = useState(false);
  const [pkg, setPkg] = useState("pack10");
  const [customValue, setCustomValue] = useState<number>(0);
  const [customDesc, setCustomDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [tx, st, ls] = await Promise.all([
      supabase.from("wallet_transactions").select("*").order("created_at", { ascending: false }),
      supabase.from("students").select("id, student_name, guardian_name").order("student_name"),
      supabase.from("lessons").select("id, payment_status"),
    ]);
    setTxs((tx.data ?? []) as Tx[]);
    setStudents((st.data ?? []) as StudentRow[]);
    const map: Record<string, string> = {};
    for (const l of (ls.data ?? []) as { id: string; payment_status: string }[]) map[l.id] = l.payment_status;
    setLessonPay(map);
  };
  useEffect(() => { load(); }, []);

  const accounts = useMemo(() => {
    const map = new Map<string, { key: string; label: string; guardian: string | null; student: string; balance: number; txs: Tx[] }>();
    // Seed with all known students so they remain visible even without transactions
    for (const s of students) {
      const k = accountKey(s);
      if (!map.has(k)) {
        map.set(k, {
          key: k, label: accountLabel(s),
          guardian: (s.guardian_name ?? "").trim() || null,
          student: s.student_name,
          balance: 0, txs: [],
        });
      }
    }
    for (const t of txs) {
      const k = accountKey(t);
      const cur = map.get(k) ?? {
        key: k, label: accountLabel(t),
        guardian: (t.guardian_name ?? "").trim() || null,
        student: t.student_name,
        balance: 0, txs: [],
      };
      cur.balance += Number(t.amount);
      cur.txs.push(t);
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => a.balance - b.balance);
  }, [txs, students]);

  const totals = useMemo(() => {
    let received = 0, negative = 0;
    for (const t of txs) {
      const amt = Number(t.amount);
      if ((t.kind === "package" || t.kind === "adjustment") && amt > 0) received += amt;
    }
    for (const a of accounts) {
      if (a.balance < 0) negative += a.balance;
    }
    return { received, negative };
  }, [txs, accounts]);

  const openCredit = (a: { guardian: string | null; student: string }) => {
    setCreditFor({ guardian: a.guardian, student: a.student });
    setPkg("pack10"); setCustomValue(0); setCustomDesc("");
  };

  const submitCredit = async () => {
    if (!creditFor) return;
    const def = PACKAGES.find(p => p.key === pkg)!;
    const amount = pkg === "custom" ? customValue : def.value;
    if (!amount || amount <= 0) { toast.error("Valor inválido"); return; }
    setBusy(true);
    const { error } = await supabase.from("wallet_transactions").insert({
      guardian_name: creditFor.guardian,
      student_name: creditFor.student,
      amount,
      kind: pkg === "custom" ? "adjustment" : "package",
      description: pkg === "custom" ? (customDesc || "Ajuste de crédito") : def.label,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Pagamento registrado"); setCreditFor(null); load(); }
  };

  const openEdit = (t: Tx) => {
    setEditingTx(t);
    setCustomValue(Number(t.amount));
    setCustomDesc(t.description ?? "");
  };

  const submitEdit = async () => {
    if (!editingTx) return;
    if (!customValue || customValue === 0) { toast.error("Valor inválido"); return; }
    setBusy(true);
    const { error } = await supabase.from("wallet_transactions")
      .update({ amount: customValue, description: customDesc || editingTx.description })
      .eq("id", editingTx.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Lançamento atualizado"); setEditingTx(null); load(); }
  };

  const removeTx = async (t: Tx) => {
    if (!confirm(`Remover este lançamento de ${fmt(Number(t.amount))}? Essa ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("wallet_transactions").delete().eq("id", t.id);
    if (error) toast.error(error.message);
    else { toast.success("Lançamento removido"); load(); }
  };

  const openLessonEdit = async (lessonId: string) => {
    const { data, error } = await supabase.from("lessons").select("*").eq("id", lessonId).maybeSingle();
    if (error || !data) { toast.error("Aula não encontrada"); return; }
    setEditingLesson({ ...data, start_at: format(new Date(data.start_at), "yyyy-MM-dd'T'HH:mm") });
    setLessonDlgOpen(true);
  };

  const removeLesson = async (lessonId: string) => {
    if (!confirm("Excluir esta aula? O lançamento na carteira também será removido.")) return;
    await supabase.from("wallet_transactions").delete().eq("lesson_id", lessonId);
    const { error } = await supabase.from("lessons").delete().eq("id", lessonId);
    if (error) toast.error(error.message);
    else { toast.success("Aula excluída"); load(); }
  };

  const markLessonPaidPackage = async (t: Tx) => {
    if (!t.lesson_id) return;
    setBusy(true);
    const { error } = await supabase.from("lessons").update({ payment_status: "pago" }).eq("id", t.lesson_id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Aula marcada como paga via pacote"); load(); }
  };

  const markLessonPaid = async (t: Tx) => {
    if (!t.lesson_id) return;
    const price = Math.abs(Number(t.amount));
    setBusy(true);
    const { error: e1 } = await supabase.from("lessons").update({ payment_status: "pago" }).eq("id", t.lesson_id);
    if (e1) { setBusy(false); toast.error(e1.message); return; }
    const { error: e2 } = await supabase.from("wallet_transactions").insert({
      guardian_name: t.guardian_name,
      student_name: t.student_name,
      amount: price,
      kind: "adjustment",
      lesson_id: t.lesson_id,
      description: `Pagamento — ${t.description ?? "aula"}`,
    });
    setBusy(false);
    if (e2) toast.error(e2.message);
    else { toast.success("Aula marcada como paga"); load(); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Carteira & Cobrança</h1>
        <p className="text-sm text-muted-foreground">Saldo de cada responsável/aluno. Pacotes adicionam crédito; aulas descontam.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground uppercase">Total recebido</div>
          <div className="text-3xl font-bold text-success mt-1">{fmt(totals.received)}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground uppercase">A cobrar (saldo negativo)</div>
          <div className="text-3xl font-bold text-destructive mt-1">{fmt(Math.abs(totals.negative))}</div>
        </Card>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Saldos por responsável</h2>
        {accounts.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">Nenhum lançamento ainda.</Card>
        )}
        <div className="space-y-3">
          {accounts.map(a => {
            const isExp = !!expanded[a.key];
            const balanceClass = a.balance < 0 ? "text-destructive" : a.balance > 0 ? "text-success" : "text-muted-foreground";
            return (
              <Card key={a.key} className="p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <button
                    className="flex items-center gap-2 text-left"
                    onClick={() => setExpanded(e => ({ ...e, [a.key]: !isExp }))}
                  >
                    {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <div>
                      <div className="font-semibold text-lg">{a.label}</div>
                      <div className="text-xs text-muted-foreground">Aluno: {a.student} · {a.txs.length} lançamento(s)</div>
                    </div>
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground uppercase">Saldo</div>
                      <div className={`text-2xl font-bold ${balanceClass}`}>{fmt(a.balance)}</div>
                    </div>
                    <Button size="sm" onClick={() => openCredit(a)}>
                      <Plus className="w-3 h-3 mr-1" /> Adicionar Pacote/Pagamento
                    </Button>
                  </div>
                </div>
                {isExp && (
                  <div className="mt-4 border-t border-border pt-3 space-y-1.5">
                    {a.txs.map(t => {
                      const isLesson = t.kind === "lesson";
                      const editable = !isLesson;
                      return (
                        <div key={t.id} className="flex items-center justify-between text-sm gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Wallet className="w-3 h-3 text-muted-foreground shrink-0" />
                            <Badge variant="outline" className="text-[10px] capitalize">{t.kind === "package" ? "pacote" : isLesson ? "aula" : "ajuste"}</Badge>
                            <span className="truncate text-muted-foreground">{t.description ?? "—"}</span>
                            <span className="text-muted-foreground text-xs whitespace-nowrap">{format(new Date(t.created_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`font-semibold ${Number(t.amount) < 0 ? "text-destructive" : "text-success"}`}>
                              {Number(t.amount) > 0 ? "+" : ""}{fmt(Number(t.amount))}
                            </span>
                            {editable ? (
                              <>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)} title="Editar"><Pencil className="w-3 h-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeTx(t)} title="Remover"><Trash2 className="w-3 h-3" /></Button>
                              </>
                            ) : t.lesson_id ? (
                              <>
                                {lessonPay[t.lesson_id] !== "pago" && (
                                  <Button size="sm" variant="outline" className="h-7 text-success border-success/40 hover:bg-success/10" onClick={() => markLessonPaid(t)} disabled={busy} title="Marcar aula como paga">
                                    <CheckCircle2 className="w-3 h-3 mr-1" /> Marcar paga
                                  </Button>
                                )}
                                {lessonPay[t.lesson_id] === "pago" && (
                                  <Badge variant="outline" className="text-[10px] text-success border-success/40">paga</Badge>
                                )}
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openLessonEdit(t.lesson_id!)} title="Editar aula"><Pencil className="w-3 h-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeLesson(t.lesson_id!)} title="Excluir aula"><Trash2 className="w-3 h-3" /></Button>
                              </>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic w-[60px] text-right">via aula</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={!!creditFor} onOpenChange={v => !v && setCreditFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Pacote/Pagamento</DialogTitle>
          </DialogHeader>
          {creditFor && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Conta: <strong className="text-foreground">{creditFor.guardian || `Aluno: ${creditFor.student}`}</strong>
              </div>
              <div>
                <Label>Tipo de crédito</Label>
                <Select value={pkg} onValueChange={setPkg}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PACKAGES.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {pkg === "custom" && (
                <>
                  <div>
                    <Label>Valor (R$)</Label>
                    <Input type="number" step="0.01" value={customValue} onChange={e => setCustomValue(Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>Descrição</Label>
                    <Input value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder="Ex.: Estorno, ajuste manual…" />
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditFor(null)}>Cancelar</Button>
            <Button onClick={submitCredit} disabled={busy}>Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTx} onOpenChange={v => !v && setEditingTx(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar lançamento</DialogTitle></DialogHeader>
          {editingTx && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Conta: <strong className="text-foreground">{editingTx.guardian_name || `Aluno: ${editingTx.student_name}`}</strong>
              </div>
              <div>
                <Label>Valor (R$) — use negativo para débito</Label>
                <Input type="number" step="0.01" value={customValue} onChange={e => setCustomValue(Number(e.target.value))} />
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={customDesc} onChange={e => setCustomDesc(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTx(null)}>Cancelar</Button>
            <Button onClick={submitEdit} disabled={busy}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LessonDialog
        open={lessonDlgOpen}
        onOpenChange={(v) => { setLessonDlgOpen(v); if (!v) setEditingLesson(null); }}
        lesson={editingLesson}
        onSaved={load}
      />
    </div>
  );
}

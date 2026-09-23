import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Printer, FileText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { accountKey, accountLabel, fmtMoney } from "@/lib/balance";
import type { LedgerTx } from "@/lib/billing";
import { summarizeIncome, toCsv, MESES, yearsWithData } from "@/lib/reports";
import { valorPorExtenso } from "@/lib/extenso";
import ListSkeleton from "@/components/ListSkeleton";
import EmptyState from "@/components/EmptyState";

type StudentRow = { id: string; student_name: string; guardian_name: string | null };
type SettingsRow = { contact_email: string | null; issuer_document: string | null };

const TODO_ANO = "todo-ano";

export default function ReportsPage() {
  const [txs, setTxs] = useState<LedgerTx[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [accountName, setAccountName] = useState("");
  const [settings, setSettings] = useState<SettingsRow>({ contact_email: null, issuer_document: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // accounts e issuer_document não existem em types.ts (desatualizado -
      // ver docs/proximos-passos.md, "types.ts está desatualizado"), daí o
      // `any`: o mesmo contorno já usado em settings pelo resto do app.
      const [tx, st, acc, se] = await Promise.all([
        supabase.from("wallet_transactions").select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at"),
        supabase.from("students").select("id, student_name, guardian_name").order("student_name"),
        (supabase.from("accounts" as any).select("name").maybeSingle()) as any,
        supabase.from("settings").select("*").maybeSingle(),
      ]);
      setTxs((tx.data ?? []) as LedgerTx[]);
      setStudents((st.data ?? []) as StudentRow[]);
      if (acc.data?.name) setAccountName(acc.data.name);
      if (se.data) setSettings(se.data as unknown as SettingsRow);
      setLoading(false);
    })();
  }, []);

  const now = new Date();
  const years = useMemo(() => yearsWithData(txs), [txs]);

  // ---- Resumo / IR ----
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | null>(null);
  const summary = useMemo(() => summarizeIncome(txs, year, month), [txs, year, month]);

  const exportCsv = () => {
    const csv = toCsv(
      ["Data", "Família", "Descrição", "Valor"],
      summary.rows.map(r => [format(new Date(r.date), "dd/MM/yyyy"), r.accountLabel, r.description, r.amount.toFixed(2).replace(".", ",")]),
    );
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recebido-${year}${month !== null ? `-${String(month + 1).padStart(2, "0")}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Recibo ----
  const accounts = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) map.set(accountKey(s), accountLabel(s));
    for (const t of txs) if (!map.has(accountKey(t))) map.set(accountKey(t), accountLabel(t));
    return [...map.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [students, txs]);

  const [receiptAccount, setReceiptAccount] = useState("");
  const [receiptYear, setReceiptYear] = useState(now.getFullYear());
  const [receiptMonth, setReceiptMonth] = useState(now.getMonth());

  const receiptSummary = useMemo(() => summarizeIncome(txs, receiptYear, receiptMonth), [txs, receiptYear, receiptMonth]);
  const receiptRows = useMemo(() => receiptSummary.rows.filter(r => r.accountKey === receiptAccount), [receiptSummary, receiptAccount]);
  const receiptTotal = useMemo(() => Math.round(receiptRows.reduce((s, r) => s + r.amount, 0) * 100) / 100, [receiptRows]);
  const receiptLabel = accounts.find(a => a.key === receiptAccount)?.label ?? "";

  if (loading) return <ListSkeleton rows={4} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Resumo do que entrou, pra imposto de renda, e recibo pra família.</p>
      </div>

      <Card className="rounded-2xl p-4 md:p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Resumo do período</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Só o que é dinheiro de verdade (pacote e pagamento) - aula em aberto e desconto não entram aqui.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-28 h-9 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={month === null ? TODO_ANO : String(month)} onValueChange={v => setMonth(v === TODO_ANO ? null : Number(v))}>
            <SelectTrigger className="w-40 h-9 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODO_ANO}>Ano inteiro</SelectItem>
              {MESES.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl ml-auto" onClick={exportCsv} disabled={summary.rows.length === 0}>
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </Button>
        </div>

        {summary.byAccount.length === 0 ? (
          <EmptyState icon={FileText} title="Nada recebido no período" description="Mude o ano ou o mês para ver outro período." />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {summary.byAccount.map(a => (
                <li key={a.label} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate">{a.label}</span>
                  <span className="shrink-0 font-medium tabular-nums">{fmtMoney(a.total)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between px-1 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{fmtMoney(summary.total)}</span>
            </div>
          </>
        )}
      </Card>

      <Card className="rounded-2xl p-4 md:p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Recibo</h2>
          <p className="text-xs text-muted-foreground mt-1">Escolha a família e o período; o recibo soma o que ela pagou nele.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={receiptAccount} onValueChange={setReceiptAccount}>
            <SelectTrigger className="w-56 h-9 rounded-xl"><SelectValue placeholder="Escolha a família" /></SelectTrigger>
            <SelectContent>{accounts.map(a => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(receiptYear)} onValueChange={v => setReceiptYear(Number(v))}>
            <SelectTrigger className="w-28 h-9 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(receiptMonth)} onValueChange={v => setReceiptMonth(Number(v))}>
            <SelectTrigger className="w-40 h-9 rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>{MESES.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {!receiptAccount ? (
          <p className="text-sm text-muted-foreground">Escolha uma família para montar o recibo.</p>
        ) : receiptRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{receiptLabel} não pagou nada em {MESES[receiptMonth]} de {receiptYear}.</p>
        ) : (
          <>
            <div id="recibo-print" className="rounded-xl border border-border p-5 space-y-4 bg-card text-sm">
              <div className="text-center space-y-0.5">
                <div className="font-bold text-base">{accountName || "Recibo"}</div>
                {settings.issuer_document && <div className="text-xs text-muted-foreground">{settings.issuer_document}</div>}
                {settings.contact_email && <div className="text-xs text-muted-foreground">{settings.contact_email}</div>}
              </div>
              <div className="text-center font-semibold uppercase tracking-wide text-xs text-muted-foreground">Recibo de pagamento</div>
              <p>
                Recebi de <strong>{receiptLabel}</strong> a quantia de <strong>{fmtMoney(receiptTotal)}</strong>
                {" "}({valorPorExtenso(receiptTotal)}), referente a:
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {receiptRows.map(r => (
                  <li key={r.date + r.description}>
                    {format(new Date(r.date), "dd/MM/yyyy", { locale: ptBR })} — {r.description} ({fmtMoney(r.amount)})
                  </li>
                ))}
              </ul>
              <p className="text-right text-xs text-muted-foreground pt-2">
                Emitido em {format(new Date(), "dd/MM/yyyy", { locale: ptBR })}
              </p>
              <div className="pt-6 text-center">
                <div className="mx-auto w-56 border-t border-foreground/40" />
                <div className="mt-1 text-xs">{accountName || "Assinatura"}</div>
              </div>
            </div>
            <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={() => window.print()}>
              <Printer className="w-3.5 h-3.5" /> Imprimir / Salvar PDF
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

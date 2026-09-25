import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Share2, FileText } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { accountKey, accountLabel, fmtMoney } from "@/lib/balance";
import type { LedgerTx } from "@/lib/billing";
import { summarizeIncome, summarizeByService, toCsv, MESES, yearsWithData, type ServiceLesson } from "@/lib/reports";
import { colorOf } from "@/lib/teacherColors";
import { valorPorExtenso } from "@/lib/extenso";
import { saveOrShareFile, canOnlyShare } from "@/lib/saveFile";
import { buildReceiptPdf } from "@/lib/receiptPdf";
import ListSkeleton from "@/components/ListSkeleton";
import EmptyState from "@/components/EmptyState";
import { useWords } from "@/hooks/useVocabulary";

import { dateLocale, L } from "@/lib/i18n";
type StudentRow = { id: string; student_name: string; guardian_name: string | null };
type SettingsRow = { contact_email: string | null; issuer_document: string | null };

const TODO_ANO = "todo-ano";

export default function ReportsPage() {
  const w = useWords();
  const [txs, setTxs] = useState<LedgerTx[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [accountName, setAccountName] = useState("");
  const [settings, setSettings] = useState<SettingsRow>({ contact_email: null, issuer_document: null });
  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<ServiceLesson[]>([]);
  const [services, setServices] = useState<{ id: string; name: string; color: string | null }[]>([]);

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
      // Por serviço: as realizadas e a lista de serviços (a tabela pode não
      // existir num app publicado antes da migration 20260925110000).
      const [ls, sv] = await Promise.all([
        supabase.from("lessons").select("*").eq("status", "realizada"),
        supabase.from("services" as never).select("id, name, color"),
      ]);
      setLessons((ls.data ?? []) as unknown as ServiceLesson[]);
      if (!sv.error) setServices((sv.data ?? []) as unknown as { id: string; name: string; color: string | null }[]);
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

  const byService = useMemo(
    () => summarizeByService(lessons, services, year, month, `Sem ${w.topic.l}`),
    [lessons, services, year, month, w],
  );

  const [busy, setBusy] = useState(false);
  const shareOnly = canOnlyShare();

  const exportCsv = () => {
    const csv = toCsv(
      ["Data", "Família", "Descrição", "Valor"],
      summary.rows.map(r => [format(new Date(r.date), L("dd/MM/yyyy", "MMM d, yyyy")), r.accountLabel, r.description, r.amount.toFixed(2).replace(".", ",")]),
    );
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const name = `recebido-${year}${month !== null ? `-${String(month + 1).padStart(2, "0")}` : ""}.csv`;
    saveOrShareFile(name, blob, "Recebido no período").catch(e => toast.error(`Não foi possível exportar: ${e?.message ?? e}`));
  };

  // ---- Recibo ----
  // `payer` é quem pagou: o responsável, ou o próprio aluno quando não há
  // um. accountLabel serve pra lista ("Aluno: Ana"), não pro recibo.
  const accounts = useMemo(() => {
    const map = new Map<string, { label: string; payer: string }>();
    const add = (r: { student_name: string; guardian_name: string | null }) => {
      const k = accountKey(r);
      if (!map.has(k)) map.set(k, { label: accountLabel(r, w), payer: (r.guardian_name ?? "").trim() || r.student_name });
    };
    students.forEach(add);
    txs.forEach(add);
    return [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [students, txs, w]);

  const [receiptAccount, setReceiptAccount] = useState("");
  const [receiptYear, setReceiptYear] = useState(now.getFullYear());
  const [receiptMonth, setReceiptMonth] = useState(now.getMonth());

  const receiptSummary = useMemo(() => summarizeIncome(txs, receiptYear, receiptMonth), [txs, receiptYear, receiptMonth]);
  const receiptRows = useMemo(() => receiptSummary.rows.filter(r => r.accountKey === receiptAccount), [receiptSummary, receiptAccount]);
  const receiptTotal = useMemo(() => Math.round(receiptRows.reduce((s, r) => s + r.amount, 0) * 100) / 100, [receiptRows]);
  const receiptAcc = accounts.find(a => a.key === receiptAccount);
  const receiptLabel = receiptAcc?.label ?? "";

  const downloadReceipt = async () => {
    if (!receiptAcc || receiptRows.length === 0) return;
    setBusy(true);
    try {
      const pdf = await buildReceiptPdf({
        issuer: accountName,
        issuerDocument: settings.issuer_document?.trim() || null,
        issuerEmail: settings.contact_email?.trim() || null,
        payer: receiptAcc.payer,
        period: `${MESES[receiptMonth].toLowerCase()} de ${receiptYear}`,
        servicePlural: w.appointment.lp,
        rows: receiptRows.map(r => ({ date: format(new Date(r.date), L("dd/MM/yyyy", "MMM d, yyyy")), description: r.description, amount: r.amount })),
        total: receiptTotal,
        issuedAt: format(new Date(), L("dd/MM/yyyy", "MMM d, yyyy")),
      });
      const slug = receiptAcc.payer.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
      await saveOrShareFile(`recibo-${slug}-${receiptYear}-${String(receiptMonth + 1).padStart(2, "0")}.pdf`, pdf, `Recibo - ${receiptAcc.payer}`);
    } catch (e) {
      toast.error(`Não foi possível gerar o recibo: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

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
            Só o que é dinheiro de verdade (pacote e pagamento) - {w.appointment.l} em aberto e desconto não entram aqui.
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
          <h2 className="font-semibold">Por {w.topic.l}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {w.appointment.pick("Realizados", "Realizadas")} em {month === null ? year : `${MESES[month].toLowerCase()} de ${year}`} (o mesmo período acima),
            pelo preço cheio - sem os descontos por família.
          </p>
        </div>
        {byService.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{w.appointment.nenhum} {w.appointment.l} {w.appointment.pick("realizado", "realizada")} no período.</p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {byService.rows.map(r => {
                const c = colorOf(r.color);
                return (
                  <li key={r.key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c ? c.dot : "border border-border"}`} />
                      <span className="truncate">{r.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {r.count}× · {r.minutes % 60 === 0 ? `${r.minutes / 60}h` : `${Math.floor(r.minutes / 60)}h${String(r.minutes % 60).padStart(2, "0")}`}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{fmtMoney(r.total)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between px-1 text-sm font-semibold">
              <span>Total ({byService.count})</span>
              <span className="tabular-nums">{fmtMoney(byService.total)}</span>
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
            <div className="rounded-xl border border-border p-5 space-y-4 bg-card text-sm">
              <div className="text-center space-y-0.5">
                <div className="font-bold text-base">{accountName || "Recibo"}</div>
                {settings.issuer_document && <div className="text-xs text-muted-foreground">{settings.issuer_document}</div>}
                {settings.contact_email && <div className="text-xs text-muted-foreground">{settings.contact_email}</div>}
              </div>
              <div className="text-center font-semibold uppercase tracking-wide text-xs text-muted-foreground">Recibo de pagamento</div>
              <p>
                Recebi de <strong>{receiptAcc?.payer}</strong> a quantia de <strong>{fmtMoney(receiptTotal)}</strong>
                {" "}({valorPorExtenso(receiptTotal)}), referente a:
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {receiptRows.map((r, i) => (
                  <li key={i}>
                    {format(new Date(r.date), L("dd/MM/yyyy", "MMM d, yyyy"), { locale: dateLocale() })} — {r.description} ({fmtMoney(r.amount)})
                  </li>
                ))}
              </ul>
              <p className="text-right text-xs text-muted-foreground pt-2">
                Emitido em {format(new Date(), L("dd/MM/yyyy", "MMM d, yyyy"), { locale: dateLocale() })}
              </p>
              <div className="pt-6 text-center">
                <div className="mx-auto w-56 border-t border-foreground/40" />
                <div className="mt-1 text-xs">{accountName || "Assinatura"}</div>
              </div>
            </div>
            <Button size="sm" className="h-9 gap-1.5 rounded-xl" onClick={downloadReceipt} disabled={busy}>
              {shareOnly ? <Share2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
              {shareOnly ? "Compartilhar recibo (PDF)" : "Baixar recibo (PDF)"}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

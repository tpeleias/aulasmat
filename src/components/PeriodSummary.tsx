import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight, Info } from "lucide-react";
import { fmtMoney, capitalize } from "@/lib/balance";
import type { AccountStatement, LedgerTx } from "@/lib/billing";
import { change, periodRange, summarizePeriod, type PeriodKind, type SummaryLesson } from "@/lib/periodSummary";

type Props = {
  lessons: SummaryLesson[];
  txs: LedgerTx[];
  statements: AccountStatement[];
  // Versão curta para a tela Hoje: só o mês atual e três números.
  compact?: boolean;
};

// Variação com seta E texto - nunca só a cor dizendo se subiu ou desceu.
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const pct = change(now, before);
  if (pct === null) return null;
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="mt-0.5 flex items-center gap-0.5 text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3" /> {up ? "+" : ""}{pct}% vs {label}
    </div>
  );
}

// Número nunca quebra no meio ("R$ 10.100,0" / "0" lê como outro valor): a
// fonte já é pequena o bastante para caber num celular de 360 px.
function Tile({ label, value, hint, className = "", children }: { label: string; value: string; hint?: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={`min-w-0 rounded-2xl bg-muted/50 px-3 py-2.5 ${className}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 whitespace-nowrap text-[15px] font-bold tabular-nums leading-tight sm:text-lg md:text-xl">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      {children}
    </div>
  );
}

export default function PeriodSummary({ lessons, txs, statements, compact = false }: Props) {
  const [kind, setKind] = useState<PeriodKind>("month");
  const [offset, setOffset] = useState(0);
  const now = useMemo(() => new Date(), []);
  const range = periodRange(compact ? "month" : kind, now, compact ? 0 : offset);
  const prev = periodRange(compact ? "month" : kind, now, (compact ? 0 : offset) - 1);
  const s = useMemo(() => summarizePeriod({ lessons, txs, statements, range, now }), [lessons, txs, statements, range.start.getTime(), now]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = useMemo(() => summarizePeriod({ lessons, txs, statements, range: prev, now }), [lessons, txs, statements, prev.start.getTime(), now]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevLabel = kind === "week" && !compact ? "semana anterior" : prev.label.split(" ")[0];

  if (compact) {
    return (
      <Link to="/admin/financeiro" className="block">
        <Card className="rounded-2xl p-4 transition-colors hover:bg-muted/40">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="uppercase tracking-wide">Resumo de {range.label.split(" ")[0]}</span>
            <ChevronRight className="h-4 w-4" />
          </div>
          <dl className="divide-y divide-border text-sm">
            {[
              ["Recebido no mês", fmtMoney(s.recebido)],
              ["Aulas dadas", `${s.aulasDadas} · ${s.horas.toLocaleString("pt-BR")} h`],
              ["Em aberto (total)", fmtMoney(s.emAbertoGeral)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="whitespace-nowrap font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </Link>
    );
  }

  return (
    <Card className="rounded-2xl p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOffset(o => o - 1)} aria-label="Período anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[9rem] text-center text-sm font-semibold first-letter:uppercase">{range.label}</div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} aria-label="Próximo período"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex rounded-xl bg-muted p-0.5 text-xs">
          {(["week", "month"] as const).map(k => (
            <button key={k} onClick={() => { setKind(k); setOffset(0); }}
              className={`rounded-lg px-3 py-1 ${kind === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>
              {k === "week" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Recebido" value={fmtMoney(s.recebido)} hint="dinheiro que entrou">
          <Delta now={s.recebido} before={p.recebido} label={prevLabel} />
        </Tile>
        <Tile label="Valor das aulas" value={fmtMoney(s.liquido)}
          hint={s.descontos > 0 ? `${fmtMoney(s.valorCheio)} − ${fmtMoney(s.descontos)} de desconto` : "o que deveria entrar"}>
          <Delta now={s.liquido} before={p.liquido} label={prevLabel} />
        </Tile>
        <Tile label="Falta receber" value={fmtMoney(s.emAbertoDoPeriodo)} hint={`destas aulas · ${fmtMoney(s.emAbertoGeral)} no total`} />
        <Tile label="Previsto" value={fmtMoney(s.previsto)}
          hint={offset >= 0 ? `${s.aindaMarcadas} aula${s.aindaMarcadas === 1 ? "" : "s"} ainda marcada${s.aindaMarcadas === 1 ? "" : "s"}` : "período encerrado"} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Tile className="flex-1 basis-[7.5rem]" label="Aulas dadas" value={String(s.aulasDadas)} hint={`${s.horas.toLocaleString("pt-BR")} h`}>
          <Delta now={s.aulasDadas} before={p.aulasDadas} label={prevLabel} />
        </Tile>
        <Tile className="flex-1 basis-[7.5rem]" label="Canceladas" value={String(s.canceladas)} />
        <Tile className="flex-1 basis-[7.5rem]" label="Recusadas" value={String(s.recusadas)} hint="pedidos" />
      </div>

      {s.porProfessor.length > 1 && (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {s.porProfessor.map(t => (
            <li key={t.teacher} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="capitalize">{capitalize(t.teacher)}</span>
              <span className="tabular-nums text-muted-foreground">{t.aulas} aula{t.aulas === 1 ? "" : "s"} · <span className="text-foreground">{fmtMoney(t.valor)}</span></span>
            </li>
          ))}
        </ul>
      )}

      <p className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        "Recebido" conta pela data do pagamento; "valor das aulas", pela data da aula. Os dois não precisam bater:
        um pacote pago no mês anterior cobre aulas deste. "Previsto" é o valor cheio das aulas ainda marcadas, sem descontos.
      </p>
    </Card>
  );
}

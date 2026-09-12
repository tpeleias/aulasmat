import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw, Copy, MapPin, CalendarDays, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, capitalize } from "@/lib/balance";
import { computeStatements, daysOpen, isOverdue, type LedgerTx, type LedgerLesson, type OpenItem } from "@/lib/billing";
import { syncBillingWidget } from "@/lib/widgetSync";
import { haptics } from "@/lib/haptics";
import EmptyState from "@/components/EmptyState";
import ListSkeleton from "@/components/ListSkeleton";
import PullToRefresh from "@/components/PullToRefresh";

type UpcomingLesson = {
  id: string; student_name: string; start_at: string; duration_minutes: number;
  teacher: string; subject: string | null; address: string | null; is_online: boolean;
};

function openWaze(address: string) {
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, "_blank", "noopener,noreferrer");
}

type PaymentInfo = { pixKey: string | null; paymentLink: string | null };

// The Pix key and the payment link come from Configurações, so changing them there
// changes every message. Whatever is missing simply drops out, leaving no empty block.
function buildCollectionMessage(items: OpenItem[], totalOwed: number, payment: PaymentInfo) {
  const lines = items
    .map(i =>
      `• ${format(new Date(i.date), "EEE dd/MM 'às' HH:mm", { locale: ptBR })} — ${i.student} — ${i.detail} — ${fmtMoney(i.amount)}${i.partial ? " (saldo restante)" : ""}`
    ).join("\n");

  const pix = payment.pixKey?.trim();
  const link = payment.paymentLink?.trim();
  const ways = [
    pix && `💠 Pix — chave CPF ${pix}`,
    link && `🔗 InfinitePay — ${link}\nNa loja dá pra pagar com Google Pay, cartão de crédito ou Pix, e no cartão aceitamos parcelamento em até 12x.`,
  ].filter(Boolean) as string[];

  const howToPay = ways.length
    ? `\nVocê pode pagar do jeito que for mais fácil pra você:\n\n${ways.join("\n\n")}\n`
    : "";

  return `Oi! Tudo bem? 😊

Passando pra fechar as aulas já realizadas que ainda estão em aberto:

${lines}

Total em aberto: ${fmtMoney(totalOwed)}
${howToPay}
Depois é só mandar o comprovante que a gente dá baixa por aqui. Qualquer problema, nos avise! Estamos à disposição pra conversar. Obrigado! 🤓`;
}

export default function OrganizationPage() {
  const [txs, setTxs] = useState<LedgerTx[]>([]);
  const [lessonInfo, setLessonInfo] = useState<LedgerLesson[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [payment, setPayment] = useState<PaymentInfo>({ pixKey: null, paymentLink: null });

  const load = async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const weekAheadIso = addDays(new Date(), 7).toISOString();
    const [tx, done, up, cfg] = await Promise.all([
      supabase.from("wallet_transactions").select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at"),
      supabase.from("lessons").select("id, student_name, start_at, duration_minutes, subject, teacher").eq("status", "realizada"),
      supabase.from("lessons")
        .select("id, student_name, start_at, duration_minutes, teacher, subject, address, is_online")
        .eq("status", "agendada")
        .gte("start_at", nowIso).lte("start_at", weekAheadIso)
        .order("start_at"),
      supabase.from("settings").select("pix_key, payment_link").maybeSingle(),
    ]);
    setTxs((tx.data ?? []) as LedgerTx[]);
    setLessonInfo((done.data ?? []) as LedgerLesson[]);
    setUpcoming((up.data ?? []) as UpcomingLesson[]);
    setPayment({ pixKey: cfg.data?.pix_key ?? null, paymentLink: cfg.data?.payment_link ?? null });
    setLoading(false);
    setLastUpdated(new Date());
  };
  useEffect(() => { load(); }, []);

  const pending = useMemo(() => computeStatements(txs, lessonInfo).filter(s => s.owed > 0), [txs, lessonInfo]);
  const totalOwed = useMemo(() => pending.reduce((s, a) => s + a.owed, 0), [pending]);

  useEffect(() => {
    if (!loading) syncBillingWidget({ totalOwed, accounts: pending.map(p => ({ label: p.label, owed: p.owed })) });
  }, [loading, totalOwed, pending]);

  const upcomingByDay = useMemo(() => {
    const map = new Map<string, UpcomingLesson[]>();
    for (const l of upcoming) {
      const day = format(new Date(l.start_at), "yyyy-MM-dd");
      (map.get(day) ?? map.set(day, []).get(day)!).push(l);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [upcoming]);

  const copyMessage = (acc: { label: string; owed: number; items: OpenItem[] }) => {
    navigator.clipboard.writeText(buildCollectionMessage(acc.items, acc.owed, payment));
    haptics.success();
    toast.success(`Mensagem de cobrança de ${acc.label} copiada`);
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Organização semanal</h1>
            <p className="text-sm text-muted-foreground">
              Pendências pra cobrar e as próximas aulas marcadas, num só lugar.
              {lastUpdated && <> Atualizado às {format(lastUpdated, "HH:mm")}.</>}
            </p>
          </div>
          <Button onClick={load} disabled={loading} variant="outline" size="sm" className="gap-2 rounded-xl">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>

        <div>
          <h2 className="font-semibold mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-primary" /> Pendências de pagamento</span>
            {!loading && pending.length > 0 && <span className="text-sm font-normal text-muted-foreground">{fmtMoney(totalOwed)} no total</span>}
          </h2>
          {loading ? (
            <ListSkeleton rows={3} tall />
          ) : pending.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nenhuma pendência" description="Tudo em dia 🎉" />
          ) : (
            <div className="space-y-3">
              {pending.map(acc => {
                const overdue = isOverdue(acc);
                return (
                  <Card key={acc.key} className="rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="font-semibold text-lg flex items-center gap-2">
                          {acc.label}
                          {overdue && <Badge variant="destructive" className="rounded-full text-[10px]">há {daysOpen(acc.oldestOpenDate)} dias</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{acc.items.length} lançamento(s) em aberto</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground uppercase">Em aberto</div>
                          <div className={`text-2xl font-bold tabular-nums ${overdue ? "text-destructive" : ""}`}>{fmtMoney(acc.owed)}</div>
                        </div>
                        <Button size="sm" onClick={() => copyMessage(acc)} className="gap-2 rounded-xl">
                          <Copy className="w-3.5 h-3.5" /> Copiar cobrança
                        </Button>
                      </div>
                    </div>
                    <ul className="mt-3 border-t border-border pt-3 space-y-1">
                      {acc.items.map(i => (
                        <li key={i.id} className="flex items-center justify-between text-sm gap-2">
                          <span className="text-muted-foreground">
                            {format(new Date(i.date), "EEE dd/MM 'às' HH:mm", { locale: ptBR })}
                            <span className="text-foreground"> · {i.student}</span>
                            <span> · {i.detail}</span>
                          </span>
                          <span className="font-medium shrink-0 tabular-nums">
                            {fmtMoney(i.amount)}
                            {i.partial && <span className="text-xs text-muted-foreground font-normal"> restante</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Próximos 7 dias
          </h2>
          {loading ? (
            <ListSkeleton rows={2} tall />
          ) : upcomingByDay.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nenhuma aula marcada" description="Nada nos próximos 7 dias." />
          ) : (
            <div className="space-y-3">
              {upcomingByDay.map(([day, lessons]) => (
                <Card key={day} className="rounded-2xl p-4">
                  <div className="text-sm font-semibold mb-2 capitalize">
                    {format(new Date(day + "T12:00:00"), "EEEE, dd/MM", { locale: ptBR })}
                  </div>
                  <ul className="space-y-1.5">
                    {lessons.map(l => (
                      <li key={l.id} className="flex items-center justify-between text-sm gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-medium tabular-nums shrink-0">{format(new Date(l.start_at), "HH:mm")}</span>
                          <span className="truncate">{l.student_name}{l.subject ? ` · ${l.subject}` : ""}</span>
                          <Badge variant="outline" className="text-[10px] capitalize shrink-0">{capitalize(l.teacher)}</Badge>
                        </span>
                        {!l.is_online && l.address && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 rounded-full" onClick={() => { haptics.tap(); openWaze(l.address!); }} title="Abrir rota">
                            <MapPin className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </PullToRefresh>
  );
}

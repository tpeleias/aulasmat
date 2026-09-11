import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw, Copy, MapPin, CalendarDays, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, accountKey, accountLabel, lessonAmount, capitalize } from "@/lib/balance";

type Tx = { guardian_name: string | null; student_name: string; amount: number };

type PendingLesson = {
  id: string; student_name: string; guardian_name: string | null;
  start_at: string; duration_minutes: number; price: number; subject: string | null; teacher: string;
};

type UpcomingLesson = {
  id: string; student_name: string; start_at: string; duration_minutes: number;
  teacher: string; subject: string | null; address: string | null; is_online: boolean;
};

function openWaze(address: string) {
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, "_blank", "noopener,noreferrer");
}

function buildCollectionMessage(label: string, lessons: PendingLesson[], totalOwed: number) {
  const lines = lessons
    .slice()
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map(l =>
      `• ${format(new Date(l.start_at), "EEE dd/MM 'às' HH:mm", { locale: ptBR })} — ${l.student_name} — ${l.subject ?? "Aula"} (${l.duration_minutes} min) — ${fmtMoney(lessonAmount(l.price, l.duration_minutes))}`
    ).join("\n");
  return `Oi! Tudo bem? 😊

Passando pra fechar as aulas já realizadas que ainda estão em aberto:

${lines}

Total em aberto: ${fmtMoney(totalOwed)}

Pode ser via Pix quando for possível? Qualquer dúvida me chama. Obrigado! 🙏`;
}

export default function OrganizationPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [pendingLessons, setPendingLessons] = useState<PendingLesson[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingLesson[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const weekAheadIso = addDays(new Date(), 7).toISOString();
    const [tx, pend, up] = await Promise.all([
      supabase.from("wallet_transactions").select("guardian_name, student_name, amount"),
      supabase.from("lessons")
        .select("id, student_name, guardian_name, start_at, duration_minutes, price, subject, teacher")
        .eq("status", "realizada").eq("payment_status", "pendente")
        .order("start_at"),
      supabase.from("lessons")
        .select("id, student_name, start_at, duration_minutes, teacher, subject, address, is_online")
        .eq("status", "agendada")
        .gte("start_at", nowIso).lte("start_at", weekAheadIso)
        .order("start_at"),
    ]);
    setTxs((tx.data ?? []) as Tx[]);
    setPendingLessons((pend.data ?? []) as PendingLesson[]);
    setUpcoming((up.data ?? []) as UpcomingLesson[]);
    setLoading(false);
    setLastUpdated(new Date());
  };
  useEffect(() => { load(); }, []);

  // Balances mirror BillingPage's logic — the wallet ledger is the source of truth for how much is owed.
  const balances = useMemo(() => {
    const map = new Map<string, { key: string; label: string; balance: number }>();
    for (const t of txs) {
      const k = accountKey(t);
      const cur = map.get(k) ?? { key: k, label: accountLabel(t), balance: 0 };
      cur.balance += Number(t.amount);
      map.set(k, cur);
    }
    return map;
  }, [txs]);

  const pendingByAccount = useMemo(() => {
    const map = new Map<string, { key: string; label: string; owed: number; lessons: PendingLesson[] }>();
    for (const l of pendingLessons) {
      const k = accountKey(l);
      const bal = balances.get(k);
      if (!bal || bal.balance >= 0) continue; // only flag accounts that actually owe money overall
      const cur = map.get(k) ?? { key: k, label: accountLabel(l), owed: -bal.balance, lessons: [] };
      cur.lessons.push(l);
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.owed - a.owed);
  }, [pendingLessons, balances]);

  const upcomingByDay = useMemo(() => {
    const map = new Map<string, UpcomingLesson[]>();
    for (const l of upcoming) {
      const day = format(new Date(l.start_at), "yyyy-MM-dd");
      (map.get(day) ?? map.set(day, []).get(day)!).push(l);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [upcoming]);

  const copyMessage = (acc: { label: string; owed: number; lessons: PendingLesson[] }) => {
    const msg = buildCollectionMessage(acc.label, acc.lessons, acc.owed);
    navigator.clipboard.writeText(msg);
    toast.success(`Mensagem de cobrança de ${acc.label} copiada`);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Organização semanal</h1>
          <p className="text-sm text-muted-foreground">
            Pendências pra cobrar e as próximas aulas marcadas, num só lugar.
            {lastUpdated && <> Atualizado às {format(lastUpdated, "HH:mm")}.</>}
          </p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm" className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <div>
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-destructive" /> Pendências de pagamento
        </h2>
        {pendingByAccount.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground text-sm">Nenhuma pendência — tudo em dia 🎉</Card>
        ) : (
          <div className="space-y-3">
            {pendingByAccount.map(acc => (
              <Card key={acc.key} className="p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold text-lg">{acc.label}</div>
                    <div className="text-xs text-muted-foreground">{acc.lessons.length} aula(s) realizada(s) sem pagamento registrado</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground uppercase">Em aberto</div>
                      <div className="text-2xl font-bold text-destructive">{fmtMoney(acc.owed)}</div>
                    </div>
                    <Button size="sm" onClick={() => copyMessage(acc)} className="gap-2">
                      <Copy className="w-3.5 h-3.5" /> Copiar cobrança
                    </Button>
                  </div>
                </div>
                <ul className="mt-3 border-t border-border pt-3 space-y-1">
                  {acc.lessons.map(l => (
                    <li key={l.id} className="flex items-center justify-between text-sm gap-2">
                      <span className="text-muted-foreground">
                        {format(new Date(l.start_at), "EEE dd/MM 'às' HH:mm", { locale: ptBR })}
                        <span className="text-foreground"> · {l.student_name}</span>
                        {l.subject && <span> · {l.subject}</span>}
                      </span>
                      <span className="font-medium shrink-0">{fmtMoney(lessonAmount(l.price, l.duration_minutes))}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary" /> Próximos 7 dias
        </h2>
        {upcomingByDay.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground text-sm">Nenhuma aula marcada nos próximos 7 dias.</Card>
        ) : (
          <div className="space-y-3">
            {upcomingByDay.map(([day, lessons]) => (
              <Card key={day} className="p-4">
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
                        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => openWaze(l.address!)} title="Abrir rota">
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
  );
}

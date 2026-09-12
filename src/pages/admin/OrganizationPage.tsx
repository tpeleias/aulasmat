import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw, Copy, MapPin, CalendarDays, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, accountKey, accountLabel, capitalize } from "@/lib/balance";

type Tx = {
  id: string; guardian_name: string | null; student_name: string; amount: number;
  kind: string; lesson_id: string | null; description: string | null; created_at: string;
};

type LessonInfo = {
  id: string; student_name: string; start_at: string;
  duration_minutes: number; subject: string | null; teacher: string;
};

// One outstanding charge: a lesson (or a manual debit) with the part still unpaid.
type OpenItem = { id: string; date: string; student: string; detail: string; amount: number; partial: boolean };

type UpcomingLesson = {
  id: string; student_name: string; start_at: string; duration_minutes: number;
  teacher: string; subject: string | null; address: string | null; is_online: boolean;
};

function openWaze(address: string) {
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`, "_blank", "noopener,noreferrer");
}

function buildCollectionMessage(label: string, items: OpenItem[], totalOwed: number) {
  const lines = items
    .map(i =>
      `• ${format(new Date(i.date), "EEE dd/MM 'às' HH:mm", { locale: ptBR })} — ${i.student} — ${i.detail} — ${fmtMoney(i.amount)}${i.partial ? " (saldo restante)" : ""}`
    ).join("\n");
  return `Oi! Tudo bem? 😊

Passando pra fechar as aulas já realizadas que ainda estão em aberto:

${lines}

Total em aberto: ${fmtMoney(totalOwed)}

Pode ser via Pix quando for possível? Qualquer dúvida me chama. Obrigado! 🙏`;
}

export default function OrganizationPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [lessonInfo, setLessonInfo] = useState<LessonInfo[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingLesson[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const nowIso = new Date().toISOString();
    const weekAheadIso = addDays(new Date(), 7).toISOString();
    const [tx, pend, up] = await Promise.all([
      supabase.from("wallet_transactions")
        .select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at"),
      supabase.from("lessons")
        .select("id, student_name, start_at, duration_minutes, subject, teacher")
        .eq("status", "realizada"),
      supabase.from("lessons")
        .select("id, student_name, start_at, duration_minutes, teacher, subject, address, is_online")
        .eq("status", "agendada")
        .gte("start_at", nowIso).lte("start_at", weekAheadIso)
        .order("start_at"),
    ]);
    setTxs((tx.data ?? []) as Tx[]);
    setLessonInfo((pend.data ?? []) as LessonInfo[]);
    setUpcoming((up.data ?? []) as UpcomingLesson[]);
    setLoading(false);
    setLastUpdated(new Date());
  };
  useEffect(() => { load(); }, []);

  // The wallet ledger is the single source of truth. Credits pay off the oldest charges
  // first, so what's listed always adds up to exactly what the balance says is owed —
  // lessons.payment_status is a separate flag that can disagree and is deliberately ignored here.
  const pendingByAccount = useMemo(() => {
    const lessonById = new Map(lessonInfo.map(l => [l.id, l]));
    const accounts = new Map<string, { key: string; label: string; credits: number; charges: OpenItem[] }>();

    for (const t of txs) {
      const k = accountKey(t);
      const acc = accounts.get(k) ?? { key: k, label: accountLabel(t), credits: 0, charges: [] };
      const amount = Number(t.amount);
      if (amount >= 0) {
        acc.credits += amount;
      } else {
        const lesson = t.lesson_id ? lessonById.get(t.lesson_id) : undefined;
        acc.charges.push({
          id: t.id,
          date: lesson?.start_at ?? t.created_at,
          student: lesson?.student_name ?? t.student_name,
          detail: lesson
            ? `${lesson.subject ?? "Aula"} (${lesson.duration_minutes} min)`
            : (t.description ?? "Lançamento"),
          amount: -amount,
          partial: false,
        });
      }
      accounts.set(k, acc);
    }

    const result: { key: string; label: string; owed: number; items: OpenItem[] }[] = [];
    for (const acc of accounts.values()) {
      let pool = acc.credits;
      const items: OpenItem[] = [];
      for (const charge of acc.charges.sort((a, b) => a.date.localeCompare(b.date))) {
        const covered = Math.min(pool, charge.amount);
        pool -= covered;
        const remaining = Math.round((charge.amount - covered) * 100) / 100;
        if (remaining > 0) items.push({ ...charge, amount: remaining, partial: covered > 0 });
      }
      const owed = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
      if (owed > 0) result.push({ key: acc.key, label: acc.label, owed, items });
    }
    return result.sort((a, b) => b.owed - a.owed);
  }, [txs, lessonInfo]);

  const upcomingByDay = useMemo(() => {
    const map = new Map<string, UpcomingLesson[]>();
    for (const l of upcoming) {
      const day = format(new Date(l.start_at), "yyyy-MM-dd");
      (map.get(day) ?? map.set(day, []).get(day)!).push(l);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [upcoming]);

  const copyMessage = (acc: { label: string; owed: number; items: OpenItem[] }) => {
    const msg = buildCollectionMessage(acc.label, acc.items, acc.owed);
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
                    <div className="text-xs text-muted-foreground">{acc.items.length} lançamento(s) em aberto</div>
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
                  {acc.items.map(i => (
                    <li key={i.id} className="flex items-center justify-between text-sm gap-2">
                      <span className="text-muted-foreground">
                        {format(new Date(i.date), "EEE dd/MM 'às' HH:mm", { locale: ptBR })}
                        <span className="text-foreground"> · {i.student}</span>
                        <span> · {i.detail}</span>
                      </span>
                      <span className="font-medium shrink-0">
                        {fmtMoney(i.amount)}
                        {i.partial && <span className="text-xs text-muted-foreground font-normal"> restante</span>}
                      </span>
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

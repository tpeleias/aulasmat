import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Clock } from "lucide-react";
import { toast } from "sonner";

type Lesson = { id: string; student_name: string; guardian_name: string | null; subject: string | null; start_at: string; duration_minutes: number; price: number; payment_status: string };

export default function BillingPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);

  const load = async () => {
    const { data } = await supabase.from("lessons").select("*").order("start_at", { ascending: false });
    setLessons((data ?? []) as Lesson[]);
  };
  useEffect(() => { load(); }, []);

  const togglePaid = async (l: Lesson) => {
    const next = l.payment_status === "pago" ? "pendente" : "pago";
    const { error } = await supabase.from("lessons").update({ payment_status: next }).eq("id", l.id);
    if (error) toast.error(error.message); else load();
  };

  const grouped = useMemo(() => {
    const pending = lessons.filter(l => l.payment_status === "pendente");
    const map = new Map<string, { name: string; lessons: Lesson[]; total: number }>();
    for (const l of pending) {
      const key = (l.guardian_name?.trim() || `Aluno: ${l.student_name}`);
      const cur = map.get(key) ?? { name: key, lessons: [], total: 0 };
      cur.lessons.push(l); cur.total += Number(l.price);
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [lessons]);

  const totals = useMemo(() => {
    const pend = lessons.filter(l => l.payment_status === "pendente").reduce((s, l) => s + Number(l.price), 0);
    const paid = lessons.filter(l => l.payment_status === "pago").reduce((s, l) => s + Number(l.price), 0);
    return { pend, paid };
  }, [lessons]);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Cobrança</h1><p className="text-sm text-muted-foreground">Quem ainda precisa ser cobrado.</p></div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5"><div className="text-xs text-muted-foreground uppercase">A receber</div><div className="text-3xl font-bold text-warning mt-1">{fmt(totals.pend)}</div></Card>
        <Card className="p-5"><div className="text-xs text-muted-foreground uppercase">Recebido (total)</div><div className="text-3xl font-bold text-success mt-1">{fmt(totals.paid)}</div></Card>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Pendências por responsável</h2>
        {grouped.length === 0 && <Card className="p-8 text-center text-muted-foreground">Nenhuma pendência. Tudo em dia! 🎉</Card>}
        <div className="space-y-3">
          {grouped.map(g => (
            <Card key={g.name} className="p-5">
              <div className="flex items-start justify-between mb-3 gap-3">
                <div><div className="font-semibold text-lg">{g.name}</div><div className="text-sm text-muted-foreground">{g.lessons.length} aula(s) pendente(s)</div></div>
                <div className="text-right"><Badge variant="destructive" className="text-base">{fmt(g.total)}</Badge></div>
              </div>
              <div className="space-y-2 border-t border-border pt-3">
                {g.lessons.map(l => (
                  <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2"><Clock className="w-3 h-3 text-muted-foreground" /><span className="font-medium">{l.student_name}</span><span className="text-muted-foreground">· {format(new Date(l.start_at), "dd/MM HH:mm", { locale: ptBR })}</span></div>
                    <div className="flex items-center gap-3"><span className="text-muted-foreground">{fmt(Number(l.price))}</span>
                      <Button size="sm" variant="outline" onClick={() => togglePaid(l)}><Check className="w-3 h-3 mr-1" />Marcar pago</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

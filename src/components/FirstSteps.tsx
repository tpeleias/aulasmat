import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, ChevronRight, Rocket, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWords } from "@/hooks/useVocabulary";
import { firstSteps, type FirstStepsData } from "@/lib/firstSteps";

const HIDDEN_KEY = "cronys-first-steps-hidden";

function readHidden() {
  try { return localStorage.getItem(HIDDEN_KEY) === "1"; } catch { return false; }
}

/**
 * Lista de primeiros passos da empresa nova, na tela Hoje (só para o admin).
 * Some sozinha quando tudo está feito; o "x" esconde neste aparelho.
 */
export default function FirstSteps({ refreshKey = 0 }: { refreshKey?: number }) {
  const w = useWords();
  const [data, setData] = useState<FirstStepsData | null>(null);
  const [hidden, setHidden] = useState(readHidden);

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    // O banco devolve só o que é da própria empresa; aqui só se contam linhas.
    Promise.all([
      supabase.from("settings").select("pix_key, payment_link").maybeSingle(),
      supabase.from("students").select("id", { count: "exact", head: true }),
      supabase.from("lessons").select("id", { count: "exact", head: true }).neq("status", "solicitada"),
      supabase.from("students").select("id", { count: "exact", head: true })
        .or("user_id.not.is.null,child_user_id.not.is.null"),
    ]).then(([s, st, le, po]) => {
      if (!alive) return;
      // Uma consulta que falhou não pode virar "falta fazer": sem resposta, não mostra.
      if (s.error || st.error || le.error || po.error) return;
      const cfg = s.data as { pix_key?: string | null; payment_link?: string | null } | null;
      setData({
        hasPayment: !!(cfg?.pix_key?.trim() || cfg?.payment_link?.trim()),
        students: st.count ?? 0,
        lessons: le.count ?? 0,
        portalLogins: po.count ?? 0,
      });
    });
    return () => { alive = false; };
  }, [hidden, refreshKey]);

  const steps = useMemo(() => (data ? firstSteps(data, w) : []), [data, w]);
  const doneCount = steps.filter(s => s.done).length;

  if (hidden || !data || doneCount === steps.length) return null;

  const hide = () => {
    try { localStorage.setItem(HIDDEN_KEY, "1"); } catch { /* sem storage: some só agora */ }
    setHidden(true);
  };

  return (
    <Card className="rounded-2xl p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Rocket className="h-4 w-4 text-primary" /> Primeiros passos</h2>
          <p className="text-xs text-muted-foreground">{doneCount} de {steps.length} feitos</p>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={hide} title="Esconder a lista">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ul className="space-y-1">
        {steps.map(s => (
          <li key={s.key}>
            <Link to={s.to} className="flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60">
              {s.done
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${s.done ? "text-muted-foreground line-through" : ""}`}>{s.title}</div>
                {!s.done && <p className="text-xs text-muted-foreground">{s.hint}</p>}
              </div>
              {!s.done && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

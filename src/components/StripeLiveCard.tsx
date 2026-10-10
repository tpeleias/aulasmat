import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Assinaturas do Cronys no Stripe (10/10, painel do gestor). Mostra em que
 * modo está (teste ou real) e liga o modo real: o gestor cola a chave secreta
 * real e a função "billing" cria preços, cupons, portal e webhook (golive.ts).
 * A chave vai para o cofre do banco e não volta para a tela.
 */
type Status = { mode: "none" | "test" | "live"; account: { name: string | null; charges_enabled: boolean; details_submitted: boolean } | null; webhook: boolean | null };
type Result = { ok: boolean; error?: string; charges_enabled?: boolean; details_submitted?: boolean; prices?: string[]; coupons?: string[]; dropped?: string[] };

const ERRORS: Record<string, string> = {
  not_live: "Essa não é a chave real. Ela começa com sk_live_ (a de teste começa com sk_test_).",
  invalid_key: "O Stripe recusou a chave. Confira se copiou inteira.",
  store_failed: "Não deu para guardar a chave. Tente de novo.",
};

export default function StripeLiveCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = async () => {
    const { data } = await supabase.functions.invoke("billing", { body: { action: "stripe_status" } });
    if (data && (data as Status).mode) setStatus(data as Status);
  };
  useEffect(() => { load(); }, []);

  const goLive = async () => {
    setBusy(true); setResult(null);
    const { data, error } = await supabase.functions.invoke("billing", { body: { action: "go_live", key } });
    setBusy(false);
    const r = (data ?? { ok: false, error: error?.message }) as Result;
    setResult(r);
    if (r.ok) { setKey(""); toast.success("Modo real ligado"); load(); }
    else toast.error(ERRORS[r.error ?? ""] ?? "Não deu certo. Tente de novo.");
  };

  const live = status?.mode === "live";
  return (
    <Card className="space-y-3 rounded-xl p-3">
      <div className="flex items-center gap-3">
        <CreditCard className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Assinaturas do Cronys (Stripe)</p>
          <p className="text-xs text-muted-foreground">
            {!status ? "Carregando…"
              : live ? `Modo real${status.account?.name ? ` · ${status.account.name}` : ""}${status.account && !status.account.charges_enabled ? " · conta ainda não liberada para cobrar" : ""}${status.webhook === false ? " · webhook faltando" : ""}`
              : status.mode === "test" ? "Modo de teste: cartões de verdade não são cobrados." : "Sem chave do Stripe."}
          </p>
        </div>
        {status && <Badge variant={live ? "default" : "outline"}>{live ? "Real" : "Teste"}</Badge>}
      </div>

      {status && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {live ? "Para trocar a chave real (ou refazer preços, cupons, portal e webhook), cole de novo e toque em Ligar."
              : "No Stripe, desligue o \"Modo de teste\", vá em Desenvolvedores → Chaves de API e copie a Chave secreta (sk_live_…). Cole aqui: o Cronys cria os preços, os cupons (só o LANCAMENTO ativo), o portal do cliente e o webhook no modo real."}
          </p>
          <div className="flex gap-2">
            <Input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="sk_live_…" aria-label="Chave secreta real do Stripe" className="h-9" />
            <Button size="sm" className="h-9 rounded-xl" disabled={busy || key.trim().length < 20} onClick={goLive}>
              {busy ? "Ligando…" : live ? "Refazer" : "Ligar o modo real"}
            </Button>
          </div>
          {result?.ok && (
            <p className="text-xs text-muted-foreground">
              Pronto. {result.prices?.length ? `${result.prices.length} preço(s) criado(s). ` : ""}
              {result.coupons?.length ? `${result.coupons.length} cupom(ns)/código(s) criado(s). ` : ""}
              {result.dropped?.length ? `Assinatura de teste solta de: ${result.dropped.join(", ")} (o plano não mudou). ` : ""}
              {!result.charges_enabled ? "Atenção: o Stripe ainda não liberou a conta para cobrar (falta terminar o cadastro lá)." : ""}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

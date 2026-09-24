import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CronysWordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { forgetPlan, type Plan } from "@/hooks/usePlan";
import { PLANS, EXTRA_TEACHER, EQUIPE_INCLUDED, ASSISTANT_ADDON, brl, canSellHere, tierName, type Interval, type Tier } from "@/lib/subscription";

/**
 * Assinar o Cronys - só no SITE. O pagamento é no Checkout do Stripe; quem
 * muda o plano no banco é o webhook, quando o Stripe confirma (por isso a
 * volta com ?ok=1 espera o plano mudar em vez de mudá-lo).
 */
export default function Subscribe() {
  const { session, isAdmin, loading } = useAuth();
  const [params] = useSearchParams();
  const ok = params.get("ok") === "1";
  const [interval, setInterval_] = useState<Interval>("month");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // O adicional do assistente: só aparece quando o banco diz que está à venda.
  const [withAssistant, setWithAssistant] = useState(false);

  useEffect(() => { document.title = "Assinar — Cronys"; }, []);

  // Voltando do pagamento o webhook pode levar uns segundos: relê algumas vezes.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    let tries = 0;
    const load = async () => {
      const { data } = await supabase.rpc("my_plan");
      if (!alive) return;
      const p = data as Plan | null;
      setPlan(p);
      if (ok && p?.billing_status !== "active" && ++tries < 10) setTimeout(load, 3000);
      if (ok && p?.billing_status === "active") forgetPlan();
    };
    load();
    return () => { alive = false; };
  }, [session, ok]);

  if (!canSellHere()) return <Navigate to="/admin/configuracoes" replace />;

  const onSale = plan?.assistant_on_sale === true;

  const toggleAssistant = async (on: boolean) => {
    setBusy("assistant");
    const { data, error } = await supabase.functions.invoke("billing", { body: { action: "assistant", assistant: on } });
    setBusy(null);
    if (error || (data as { error?: string } | null)?.error) {
      toast.error((data as { error?: string } | null)?.error ?? "Não foi possível mudar o Assistente agora.");
      return;
    }
    toast.success(on ? "Assistente adicionado. Ele fica disponível em instantes." : "Assistente removido da assinatura.");
  };

  const go = async (action: "checkout" | "portal", tier?: Tier) => {
    setBusy(tier ?? action);
    const { data, error } = await supabase.functions.invoke("billing", {
      body: { action, tier, interval, assistant: onSale && withAssistant },
    });
    const url = (data as { url?: string } | null)?.url;
    if (error || !url) {
      setBusy(null);
      toast.error((data as { error?: string } | null)?.error ?? "Não foi possível abrir o pagamento. Tente de novo em instantes.");
      return;
    }
    window.location.href = url;
  };

  const subscribed = plan?.billing_status === "active" || plan?.billing_status === "past_due";
  const paid = PLANS.filter(p => p.tier !== "essencial");

  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-10">
        <Link to="/" className="mb-8 inline-flex"><CronysWordmark tamanho="1.25rem" className="text-foreground" /></Link>

        <h1 className="text-3xl font-bold tracking-tight">Assinar o Cronys</h1>
        <p className="mt-2 text-muted-foreground">
          Sem fidelidade: cancela quando quiser, e o que você cadastrou continua lá no plano gratuito.
        </p>

        {ok && (
          <Card className="mt-6 border-primary/40 bg-primary/5 p-4 text-sm">
            {plan?.billing_status === "active"
              ? <>Pagamento confirmado. Sua conta está no <b>{tierName(plan.tier)}</b>. <Link className="text-primary underline" to="/admin">Abrir o app</Link></>
              : <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Pagamento recebido, confirmando com o banco…</span>}
          </Card>
        )}

        {!loading && session && !isAdmin && (
          <Card className="mt-6 p-4 text-sm">Só o administrador da empresa pode assinar.</Card>
        )}

        {subscribed && plan && (
          <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <div className="font-medium">{tierName(plan.tier)} {plan.billing_interval === "year" ? "(anual)" : "(mensal)"}</div>
              {plan.billing_status === "past_due"
                ? <p className="text-destructive">
                    Pagamento em atraso{plan.grace_until ? ` - a conta passa para o Essencial em ${format(new Date(plan.grace_until), "dd/MM")} se não for acertado` : ""}.
                  </p>
                : plan.paid_until && <p className="text-muted-foreground">Renova em {format(new Date(plan.paid_until), "dd/MM/yyyy")}.</p>}
            </div>
            {onSale && isAdmin && plan.billing_status === "active" && (
              <Button variant="outline" disabled={!!busy} onClick={() => toggleAssistant(!plan.assistant_billed)}>
                {plan.assistant_billed ? "Tirar o Assistente" : `Adicionar o Assistente (+${brl(ASSISTANT_ADDON.mensal)}/mês)`}
              </Button>
            )}
            <Button onClick={() => go("portal")} disabled={!!busy}>
              {busy === "portal" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Gerenciar assinatura
            </Button>
          </Card>
        )}

        <div className="mt-8 inline-flex rounded-xl border border-border p-1 text-sm">
          {(["month", "year"] as Interval[]).map(i => (
            <button key={i} onClick={() => setInterval_(i)}
              className={`rounded-lg px-4 py-1.5 ${interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              {i === "month" ? "Mensal" : "Anual · 2 meses grátis"}
            </button>
          ))}
        </div>

        {onSale && !subscribed && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={withAssistant} onChange={e => setWithAssistant(e.target.checked)} />
            <span>
              Incluir o <b>Assistente</b> (+{brl(interval === "month" ? ASSISTANT_ADDON.mensal : ASSISTANT_ADDON.anual)}/{interval === "month" ? "mês" : "ano"}):
              marque, remarque e consulte o financeiro conversando, com limite mensal de uso.
            </span>
          </label>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {paid.map(p => {
            const current = subscribed && plan?.tier === p.tier;
            const price = interval === "month" ? p.mensal : p.anual;
            return (
              <Card key={p.tier} className={`flex flex-col p-6 ${p.tier === "pro" ? "border-primary/50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold">{p.nome}</h2>
                  {current && <Badge>seu plano</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{p.resumo}</p>
                <div className="mt-4">
                  <span className="text-3xl font-bold">{brl(price)}</span>
                  <span className="text-muted-foreground">/{interval === "month" ? "mês" : "ano"}</span>
                </div>
                {p.tier === "pro" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {EQUIPE_INCLUDED} profissionais incluídos; cada um a mais,{" "}
                    {brl(interval === "month" ? EXTRA_TEACHER.mensal : EXTRA_TEACHER.anual)}/{interval === "month" ? "mês" : "ano"}.
                  </p>
                )}
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {p.itens.map(i => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {i}</li>)}
                </ul>
                <div className="mt-6">
                  {!session ? (
                    <Button asChild className="w-full"><Link to="/entrar">Entrar para assinar</Link></Button>
                  ) : subscribed ? (
                    <Button variant="outline" className="w-full" disabled={!isAdmin || !!busy || current} onClick={() => go("portal")}>
                      {current ? "Plano atual" : "Trocar para este"}
                    </Button>
                  ) : (
                    <Button className="w-full" disabled={!isAdmin || !!busy} onClick={() => go("checkout", p.tier)}>
                      {busy === p.tier && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      Assinar o {p.nome}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Pagamento processado pelo Stripe; na fatura aparece CRONYS. Tem um código de desconto? Use na
          tela de pagamento. Ao assinar você concorda com os <Link to="/termos" className="underline">termos de uso</Link>.
        </p>
      </div>
    </div>
  );
}

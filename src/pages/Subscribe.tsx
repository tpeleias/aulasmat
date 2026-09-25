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
import { PLANS, EXTRA_TEACHER, EQUIPE_INCLUDED, ASSISTANT_ADDON, COUPONS_AVAILABLE, brl, canSellHere, tierName, type Interval, type Tier } from "@/lib/subscription";

import { L } from "@/lib/i18n";
import { CurrencyPicker } from "@/components/CurrencyPicker";
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

  useEffect(() => { document.title = L("Assinar — Cronys", "Subscribe — Cronys"); }, []);

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
      toast.error((data as { error?: string } | null)?.error ?? L("Não foi possível mudar o Assistente agora.", "Could not change the Assistant right now."));
      return;
    }
    toast.success(on ? L("Assistente adicionado. Ele fica disponível em instantes.", "Assistant added. It will be available in a moment.") : L("Assistente removido da assinatura.", "Assistant removed from the subscription."));
  };

  const go = async (action: "checkout" | "portal", tier?: Tier) => {
    setBusy(tier ?? action);
    const { data, error } = await supabase.functions.invoke("billing", {
      body: { action, tier, interval, assistant: onSale && withAssistant && tier === "pro_solo" },
    });
    const url = (data as { url?: string } | null)?.url;
    if (error || !url) {
      setBusy(null);
      toast.error((data as { error?: string } | null)?.error ?? L("Não foi possível abrir o pagamento. Tente de novo em instantes.", "Could not open checkout. Try again in a moment."));
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

        <h1 className="text-3xl font-bold tracking-tight">{L("Assinar o Cronys", "Subscribe to Cronys")}</h1>
        <p className="mt-2 text-muted-foreground">
          {L("Sem fidelidade: cancela quando quiser, e o que você cadastrou continua lá no plano gratuito.", "No commitment: cancel anytime, and everything you've saved stays on the free plan.")}
        </p>

        {ok && (
          <Card className="mt-6 border-primary/40 bg-primary/5 p-4 text-sm">
            {plan?.billing_status === "active"
              ? <>{L("Pagamento confirmado. Sua conta está no", "Payment confirmed. Your account is on")} <b>{tierName(plan.tier)}</b>. <Link className="text-primary underline" to="/admin">{L("Abrir o app", "Open the app")}</Link></>
              : <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {L("Pagamento recebido, confirmando com o banco…", "Payment received, confirming with the bank…")}</span>}
          </Card>
        )}

        {!loading && session && !isAdmin && (
          <Card className="mt-6 p-4 text-sm">{L("Só o administrador da empresa pode assinar.", "Only the company admin can subscribe.")}</Card>
        )}

        {subscribed && plan && (
          <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <div className="font-medium">{tierName(plan.tier)} {plan.billing_interval === "year" ? L("(anual)", "(yearly)") : L("(mensal)", "(monthly)")}</div>
              {plan.billing_status === "past_due"
                ? <p className="text-destructive">
                    {L("Pagamento em atraso", "Payment overdue")}{plan.grace_until ? L(` - a conta passa para o Essencial em ${format(new Date(plan.grace_until), "dd/MM")} se não for acertado`, ` - the account moves to Essential on ${format(new Date(plan.grace_until), "MMM d")} if not settled`) : ""}.
                  </p>
                : plan.paid_until && <p className="text-muted-foreground">{L("Renova em", "Renews on")} {format(new Date(plan.paid_until), L("dd/MM/yyyy", "MMM d, yyyy"))}.</p>}
            </div>
            {onSale && isAdmin && plan.billing_status === "active" && plan.tier === "pro_solo" && (
              <Button variant="outline" disabled={!!busy} onClick={() => toggleAssistant(!plan.assistant_billed)}>
                {plan.assistant_billed ? L("Tirar o Assistente", "Remove the Assistant") : L(`Adicionar o Assistente (+${brl(ASSISTANT_ADDON.mensal)}/mês)`, `Add the Assistant (+${brl(ASSISTANT_ADDON.mensal)}/month)`)}
              </Button>
            )}
            <Button onClick={() => go("portal")} disabled={!!busy}>
              {busy === "portal" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {L("Gerenciar assinatura", "Manage subscription")}
            </Button>
          </Card>
        )}

        {/* Sem login dá para ver em outra moeda; com login vale a da empresa. */}
        {!session && <div className="mt-6"><CurrencyPicker /></div>}
        <div className="mt-8 inline-flex rounded-xl border border-border p-1 text-sm">
          {(["month", "year"] as Interval[]).map(i => (
            <button key={i} onClick={() => setInterval_(i)}
              className={`rounded-lg px-4 py-1.5 ${interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              {i === "month" ? L("Mensal", "Monthly") : L("Anual · 10% off", "Yearly · 10% off")}
            </button>
          ))}
        </div>

        {onSale && !subscribed && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={withAssistant} onChange={e => setWithAssistant(e.target.checked)} />
            <span>
              {L("No", "On")} <b>Pro</b>, {L("incluir o", "include the")} <b>{L("Assistente", "Assistant")}</b> (+{brl(interval === "month" ? ASSISTANT_ADDON.mensal : ASSISTANT_ADDON.anual)}/{interval === "month" ? L("mês", "month") : L("ano", "year")}):{" "}
              {L("marque, remarque e consulte o financeiro conversando, até 100 mensagens por mês. No Max ele já vem incluso, com 200.", "book, reschedule and check billing by chatting, up to 100 messages a month. Max already includes it, with 200.")}
            </span>
          </label>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {paid.map(p => {
            const current = subscribed && plan?.tier === p.tier;
            const price = interval === "month" ? p.mensal : p.anual;
            return (
              <Card key={p.tier} className={`flex flex-col p-6 ${p.tier === "pro_solo" ? "border-primary/50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold">{p.nome}</h2>
                  {current && <Badge>{L("seu plano", "your plan")}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{p.resumo}</p>
                <div className="mt-4">
                  <span className="text-3xl font-bold">{brl(price)}</span>
                  <span className="text-muted-foreground">/{interval === "month" ? L("mês", "month") : L("ano", "year")}</span>
                </div>
                {p.tier === "pro" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {L(`${EQUIPE_INCLUDED} profissionais incluídos, contando você se você atende (você + ${EQUIPE_INCLUDED - 1}); cada um a mais,`, `${EQUIPE_INCLUDED} professionals included, counting you if you also work with clients (you + ${EQUIPE_INCLUDED - 1}); each extra one,`)}{" "}
                    {brl(interval === "month" ? EXTRA_TEACHER.mensal : EXTRA_TEACHER.anual)}/{interval === "month" ? L("mês", "month") : L("ano", "year")}.
                  </p>
                )}
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {p.itens.map(i => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {i}</li>)}
                </ul>
                <div className="mt-6">
                  {!session ? (
                    <Button asChild className="w-full"><Link to="/entrar">{L("Entrar para assinar", "Sign in to subscribe")}</Link></Button>
                  ) : subscribed ? (
                    <Button variant="outline" className="w-full" disabled={!isAdmin || !!busy || current} onClick={() => go("portal")}>
                      {current ? L("Plano atual", "Current plan") : L("Trocar para este", "Switch to this")}
                    </Button>
                  ) : (
                    <Button className="w-full" disabled={!isAdmin || !!busy} onClick={() => go("checkout", p.tier)}>
                      {busy === p.tier && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      {L("Assinar o", "Subscribe to")} {p.nome}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          {L("Pagamento processado pelo Stripe; na fatura aparece CRONYS.", "Payments processed by Stripe; your statement shows CRONYS.")}{" "}
          {COUPONS_AVAILABLE && <>{L("Tem um código de desconto? Use na tela de pagamento.", "Have a discount code? Use it at checkout.")}{" "}</>}
          {L("Ao assinar você concorda com os", "By subscribing you agree to the")}{" "}
          <Link to="/termos" className="underline">{L("termos de uso", "terms of use")}</Link>.
        </p>
      </div>
    </div>
  );
}

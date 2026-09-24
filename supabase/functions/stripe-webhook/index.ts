// O Stripe avisa aqui o que aconteceu com cada assinatura.
//
// Sem login (quem chama é o Stripe), então a única prova de origem é a
// assinatura HMAC do cabeçalho Stripe-Signature, conferida com
// STRIPE_WEBHOOK_SECRET antes de ler qualquer coisa. Evento sem assinatura
// válida: 400, e nada muda.
//
// Toda mudança de plano passa por billing_apply_subscription no banco - a
// mesma regra para pagou, atrasou e cancelou. Esta função só traduz o evento.
//
// Eventos (cadastrados no endpoint do Stripe):
//   checkout.session.completed
//   customer.subscription.created | updated | deleted
//   invoice.paid | invoice.payment_failed
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAssistantLookup, stripe, syncExtraSeats, tierOfLookup, verifyStripeSignature } from "../_shared/stripe.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "STRIPE_WEBHOOK_SECRET não configurada." }, 500);

  const payload = await req.text();
  if (!(await verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret))) {
    return json({ error: "assinatura inválida" }, 400);
  }

  const event = JSON.parse(payload);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const obj = event.data?.object ?? {};
    let subscriptionId: string | null = null;
    let deleted = false;

    switch (event.type) {
      case "checkout.session.completed":
        if (obj.mode !== "subscription") return json({ ignored: event.type });
        subscriptionId = obj.subscription;
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        subscriptionId = obj.id;
        break;
      case "customer.subscription.deleted":
        subscriptionId = obj.id;
        deleted = true;
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
        subscriptionId = obj.subscription ?? obj.parent?.subscription_details?.subscription ?? null;
        break;
      default:
        return json({ ignored: event.type });
    }
    if (!subscriptionId) return json({ ignored: "sem assinatura" });

    // Sempre relê a assinatura no Stripe: os eventos chegam fora de ordem, e o
    // estado de agora é o que vale, não o que veio no evento.
    const sub = deleted ? obj : await stripe("GET", `/subscriptions/${subscriptionId}`);
    const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

    let accountId: string | null = sub.metadata?.account_id ?? null;
    if (!accountId && customer) {
      const { data } = await admin.from("accounts").select("id").eq("stripe_customer_id", customer).maybeSingle();
      accountId = data?.id ?? null;
    }
    if (!accountId) return json({ ignored: "assinatura sem empresa" });

    const items: any[] = sub.items?.data ?? [];
    const base = items.find((i) => tierOfLookup(i.price?.lookup_key));
    const tier = tierOfLookup(base?.price?.lookup_key);
    const interval = base?.price?.recurring?.interval ?? null;
    // Na API nova o fim do período mora no item; na antiga, na assinatura.
    const periodEnd = base?.current_period_end ?? sub.current_period_end ?? null;

    const { data, error } = await admin.rpc("billing_apply_subscription", {
      _account: accountId,
      _customer: customer ?? null,
      _subscription: sub.id,
      _status: deleted ? "canceled" : sub.status,
      _plan: tier,
      _interval: interval,
      _period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      // Tem o adicional do assistente? O banco liga/desliga só o que foi comprado.
      _assistant: deleted ? false : items.some((i) => isAssistantLookup(i.price?.lookup_key)),
    });
    if (error) throw new Error(error.message);

    // Trocou de Solo para Equipe (ou o contrário) pelo portal: a cobrança de
    // extra acompanha. Falhar aqui não pode desfazer o plano já aplicado.
    if (!deleted && (sub.status === "active" || sub.status === "trialing")) {
      try { await syncExtraSeats(admin, accountId); } catch (e) { console.error("sync_seats", e); }
    }

    return json({ ok: true, result: data });
  } catch (e: any) {
    // 500 faz o Stripe tentar de novo mais tarde, que é o que se quer.
    console.error(event.type, e);
    return json({ error: e?.message || String(e) }, 500);
  }
});

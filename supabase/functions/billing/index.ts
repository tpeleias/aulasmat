// Assinatura do Cronys, do lado de quem assina.
//
// Só o admin da empresa chama, e só pelo SITE: a Google Play proíbe vender bem
// digital dentro do app fora da cobrança dela, então a tela de assinatura não
// existe no Android (ver src/pages/Subscribe.tsx).
//
//   checkout   - abre o Checkout do Stripe para o plano e o período escolhidos;
//                quem já tem assinatura vai para o portal em vez disso
//   portal     - portal do Stripe: trocar cartão, ver faturas, mudar de plano,
//                cancelar
//   sync_seats - acerta a cobrança de profissional extra (a tela chama depois
//                de ativar/desativar alguém na Equipe)
//   assistant  - põe ou tira o adicional de IA de quem já assina o Start ou o
//                Pro (no Max a IA vem inclusa)
//   sync_prices - SÓ o gestor da plataforma: cria/atualiza no Stripe os preços
//                de supabase/functions/_shared/plans.ts. Com chave de teste isso
//                acontece sozinho no checkout; com a real, só por aqui.
//
// Preço, plano e limite: supabase/functions/_shared/plans.ts.
//
// Quem muda o plano no banco nunca é esta função: é o webhook, quando o Stripe
// confirma o pagamento. Aqui só se abre a porta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ASSISTANT_LOOKUP, LOOKUP, allPricePairs, allowsExtraTeachers, ensurePrices, isAssistantLookup, priceIds, stripe, syncExtraSeats, tierOfLookup, toCurrency, type Interval, type Tier } from "../_shared/stripe.ts";
import { COUPON_CURRENCIES, PLANS } from "../_shared/plans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Para onde o Stripe devolve a pessoa. Só estes: um "voltar para" vindo do
// navegador sem conferência viraria redirecionamento aberto.
const SITES = ["https://cronys.com.br", "https://www.cronys.com.br", "https://cronys.netlify.app", "https://cronys.lovable.app"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, serviceKey);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "checkout");

    // O gestor da plataforma cria/atualiza os preços (inclusive no modo real).
    if (action === "sync_prices") {
      const { data: isOp } = await userClient.rpc("is_platform_admin");
      if (isOp !== true) return json({ error: "forbidden" }, 403);
      return json({ created: await ensurePrices(allPricePairs(), { force: true }) });
    }

    const { data: role } = await admin.from("user_roles").select("account_id")
      .eq("user_id", user.id).eq("role", "admin").not("account_id", "is", null).limit(1).maybeSingle();
    const accountId = (role?.account_id ?? null) as string | null;
    if (!accountId) return json({ error: "Só o administrador da empresa cuida da assinatura." }, 403);

    const { data: acc } = await admin.from("accounts")
      .select("id, name, stripe_customer_id, stripe_subscription_id, billing_status, is_public_default, locale, currency")
      .eq("id", accountId).maybeSingle();
    if (!acc) return json({ error: "Empresa não encontrada." }, 404);

    // Moeda da empresa (Configurações → Língua e moeda). O Stripe cobra na
    // moeda dela. Cupom só nas moedas de COUPON_CURRENCIES.
    const currency = toCurrency(acc.currency);
    const couponOk = COUPON_CURRENCIES.map(c => c.toLowerCase()).includes(currency);
    const stripeLocale = acc.locale === "en" ? "en" : "pt-BR";
    const origin = req.headers.get("origin") ?? "";
    const site = SITES.includes(origin) ? origin : (Deno.env.get("PUBLIC_SITE_URL") ?? SITES[0]);

    if (action === "sync_seats") return json(await syncExtraSeats(admin, accountId));

    const { data: onSale } = await admin.rpc("assistant_on_sale");
    const wantsAssistant = body?.assistant === true;
    if (wantsAssistant && onSale !== true) {
      return json({ error: "O Assistente ainda não está à venda." }, 400);
    }

    // Pôr ou tirar o adicional numa assinatura que já existe. Quem liga ou
    // desliga no banco é o webhook, quando o Stripe confirmar a mudança.
    if (action === "assistant") {
      if (!acc.stripe_subscription_id || acc.billing_status === "canceled") {
        return json({ error: "Assine um plano antes de adicionar o Assistente." }, 400);
      }
      const sub = await stripe("GET", `/subscriptions/${acc.stripe_subscription_id}`);
      const items: any[] = sub.items?.data ?? [];
      const current = items.find((i) => isAssistantLookup(i.price?.lookup_key));
      const base = items.find((i) => tierOfLookup(i.price?.lookup_key));
      const interval: Interval = base?.price?.recurring?.interval === "year" ? "year" : "month";
      // O adicional é do Start e do Pro; no Max a IA vem inclusa.
      const baseTier = tierOfLookup(base?.price?.lookup_key);
      if (wantsAssistant && (!baseTier || !PLANS[baseTier].assistantAddon)) {
        return json({ error: "No Max o Assistente já vem incluso." }, 400);
      }
      if (wantsAssistant && !current) {
        await ensurePrices([{ item: "assistant", interval }]);
        const ids = await priceIds([ASSISTANT_LOOKUP[interval]]);
        await stripe("POST", "/subscription_items", {
          subscription: acc.stripe_subscription_id, price: ids[ASSISTANT_LOOKUP[interval]], quantity: 1,
          proration_behavior: "create_prorations",
        });
      } else if (!wantsAssistant && current) {
        await stripe("DELETE", `/subscription_items/${current.id}`, { proration_behavior: "create_prorations" });
      }
      return json({ ok: true });
    }

    const hasSub = !!acc.stripe_subscription_id && acc.billing_status !== "canceled";

    // Cliente no Stripe: um por empresa, criado na primeira vez. Um cliente
    // que já pagou numa moeda não assina em outra; se a empresa trocou de
    // moeda sem assinatura ativa, começa um cliente novo.
    let customer = acc.stripe_customer_id as string | null;
    if (customer && !hasSub && action === "checkout") {
      const c = await stripe("GET", `/customers/${customer}`);
      if (c?.deleted || (c?.currency && c.currency !== currency)) customer = null;
    }
    if (!customer) {
      const c = await stripe("POST", "/customers", {
        email: user.email ?? undefined,
        name: acc.name,
        metadata: { account_id: accountId },
        preferred_locales: [stripeLocale],
      });
      customer = c.id as string;
      await admin.from("accounts").update({ stripe_customer_id: customer }).eq("id", accountId);
    }

    if (action === "portal" || (action === "checkout" && hasSub)) {
      const configs = await stripe("GET", "/billing_portal/configurations", { active: true, limit: 20 });
      const cfg = (configs.data ?? []).find((c: any) => c.metadata?.cronys === "1");
      const session = await stripe("POST", "/billing_portal/sessions", {
        customer, return_url: `${site}/assinar`, locale: stripeLocale, ...(cfg ? { configuration: cfg.id } : {}),
      });
      return json({ url: session.url, portal: true });
    }

    if (action !== "checkout") return json({ error: "Ação desconhecida." }, 400);

    const tier: Tier = body?.tier === "start" ? "start" : body?.tier === "pro_solo" ? "pro_solo" : "pro";
    const interval: Interval = body?.interval === "year" ? "year" : "month";
    // O adicional de IA é do Start e do Pro; no Max ela vem inclusa.
    const withAssistant = wantsAssistant && PLANS[tier].assistantAddon;
    const baseKey = LOOKUP[tier][interval];
    const extraKey = LOOKUP.extra[interval];
    const assistantKey = ASSISTANT_LOOKUP[interval];
    const withExtra = allowsExtraTeachers(tier);
    const keys = [baseKey, ...(withExtra ? [extraKey] : []), ...(withAssistant ? [assistantKey] : [])];
    await ensurePrices([
      { item: tier, interval },
      ...(withExtra ? [{ item: "extra" as const, interval }] : []),
      ...(withAssistant ? [{ item: "assistant" as const, interval }] : []),
    ]);
    const ids = await priceIds(keys);

    // Quem assina já com mais profissionais ativos do que o plano inclui paga
    // os extras desde o começo (o Pro vai até 3; acima disso, o Max).
    const { count: ativos } = await admin.from("teachers").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("active", true);
    const extra = withExtra ? Math.max(0, (ativos ?? 0) - PLANS[tier].includedTeachers) : 0;
    const maxT = PLANS[tier].maxTeachers;
    if (maxT !== null && (ativos ?? 0) > maxT) {
      return json({ error: `Este plano vai até ${maxT} profissional(is) ativo(s). Desative alguns ou escolha o Max.` }, 400);
    }

    const lineItems: Record<string, unknown>[] = [{ price: ids[baseKey], quantity: 1 }];
    if (extra > 0) lineItems.push({ price: ids[extraKey], quantity: extra });
    if (withAssistant) lineItems.push({ price: ids[assistantKey], quantity: 1 });

    const session = await stripe("POST", "/checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: accountId,
      line_items: lineItems,
      currency,
      // Cupom (LANCAMENTO) só no mensal: o anual já sai com desconto.
      allow_promotion_codes: interval === "month" && couponOk,
      locale: stripeLocale,
      subscription_data: { metadata: { account_id: accountId } },
      metadata: { account_id: accountId },
      success_url: `${site}/assinar?ok=1`,
      cancel_url: `${site}/assinar`,
    });
    return json({ url: session.url });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

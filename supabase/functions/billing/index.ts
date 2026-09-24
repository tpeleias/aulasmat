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
//
// Quem muda o plano no banco nunca é esta função: é o webhook, quando o Stripe
// confirma o pagamento. Aqui só se abre a porta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { LOOKUP, priceIds, stripe, syncExtraSeats, type Interval, type Tier } from "../_shared/stripe.ts";

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
    const { data: role } = await admin.from("user_roles").select("account_id")
      .eq("user_id", user.id).eq("role", "admin").not("account_id", "is", null).limit(1).maybeSingle();
    const accountId = (role?.account_id ?? null) as string | null;
    if (!accountId) return json({ error: "Só o administrador da empresa cuida da assinatura." }, 403);

    const { data: acc } = await admin.from("accounts")
      .select("id, name, stripe_customer_id, stripe_subscription_id, billing_status, is_public_default")
      .eq("id", accountId).maybeSingle();
    if (!acc) return json({ error: "Empresa não encontrada." }, 404);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "checkout");
    const origin = req.headers.get("origin") ?? "";
    const site = SITES.includes(origin) ? origin : (Deno.env.get("PUBLIC_SITE_URL") ?? SITES[0]);

    if (action === "sync_seats") return json(await syncExtraSeats(admin, accountId));

    // Cliente no Stripe: um por empresa, criado na primeira vez.
    let customer = acc.stripe_customer_id as string | null;
    if (!customer) {
      const c = await stripe("POST", "/customers", {
        email: user.email ?? undefined,
        name: acc.name,
        metadata: { account_id: accountId },
      });
      customer = c.id as string;
      await admin.from("accounts").update({ stripe_customer_id: customer }).eq("id", accountId);
    }

    const hasSub = !!acc.stripe_subscription_id && acc.billing_status !== "canceled";
    if (action === "portal" || (action === "checkout" && hasSub)) {
      const configs = await stripe("GET", "/billing_portal/configurations", { active: true, limit: 20 });
      const cfg = (configs.data ?? []).find((c: any) => c.metadata?.cronys === "1");
      const session = await stripe("POST", "/billing_portal/sessions", {
        customer, return_url: `${site}/assinar`, ...(cfg ? { configuration: cfg.id } : {}),
      });
      return json({ url: session.url, portal: true });
    }

    if (action !== "checkout") return json({ error: "Ação desconhecida." }, 400);

    const tier: Tier = body?.tier === "pro_solo" ? "pro_solo" : "pro";
    const interval: Interval = body?.interval === "year" ? "year" : "month";
    const baseKey = LOOKUP[tier][interval];
    const extraKey = LOOKUP.extra[interval];
    const ids = await priceIds(tier === "pro" ? [baseKey, extraKey] : [baseKey]);

    // Quem assina a Equipe já com mais de 5 profissionais ativos paga os extras
    // desde o começo. Conta como se já estivesse na Equipe.
    const { count: ativos } = await admin.from("teachers").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("active", true);
    const extra = tier === "pro" ? Math.max(0, (ativos ?? 0) - 5) : 0;

    const lineItems: Record<string, unknown>[] = [{ price: ids[baseKey], quantity: 1 }];
    if (extra > 0) lineItems.push({ price: ids[extraKey], quantity: extra });

    const session = await stripe("POST", "/checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: accountId,
      line_items: lineItems,
      allow_promotion_codes: true,
      locale: "pt-BR",
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

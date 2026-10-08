import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { L } from "@/lib/i18n";

/**
 * Pagamento on-line pelo Stripe da própria empresa (09/10, função "pay" e
 * migration 20261009010000). `allowed`: a empresa tem a função liberada;
 * `connected`: já colou a chave do Stripe.
 */
export type OnlineStatus = { allowed: boolean; connected: boolean };

export function useOnlinePayments() {
  const [status, setStatus] = useState<OnlineStatus>({ allowed: false, connected: false });
  const [loaded, setLoaded] = useState(false);
  const reload = async () => {
    const { data, error } = await supabase.rpc("online_payments_status" as never);
    setStatus(error || !data ? { allowed: false, connected: false } : (data as unknown as OnlineStatus));
    setLoaded(true);
  };
  useEffect(() => { void reload(); }, []);
  return { ...status, loaded, reload };
}

export type PayResult<T> = { ok: boolean; data: T; error: string };

export async function payAction<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<PayResult<T>> {
  const { data, error } = await supabase.functions.invoke("pay", { body });
  if (!error) return { ok: true, data: data as T, error: "" };
  const ctx = (error as { context?: { json?: () => Promise<{ error?: string; detail?: string }> } }).context;
  const b = await ctx?.json?.().catch(() => null);
  return { ok: false, data: (b ?? null) as T, error: b?.error ?? "failed" };
}

export function payErrorText(code: string) {
  switch (code) {
    case "invalid_key": return L("Essa não parece uma chave secreta do Stripe (começa com sk_test_ ou sk_live_).", "That doesn't look like a Stripe secret key (starts with sk_test_ or sk_live_).");
    case "stripe_refused": return L("O Stripe recusou a chave. Confira se copiou a chave secreta inteira.", "Stripe refused the key. Check you copied the whole secret key.");
    case "nothing_owed": return L("Não há nada em aberto.", "Nothing is open.");
    case "not_connected": return L("O Stripe ainda não foi conectado (Configurações → Integrações).", "Stripe isn't connected yet (Settings → Integrations).");
    case "not_enabled": return L("O pagamento on-line não está liberado para esta empresa.", "Online payment isn't enabled for this company.");
    default: return L("Não deu agora. Tente de novo em instantes.", "Couldn't do it now. Try again shortly.");
  }
}

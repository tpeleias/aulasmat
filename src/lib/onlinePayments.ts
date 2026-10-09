import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { L } from "@/lib/i18n";

/**
 * Pagamento on-line pela conta da própria empresa no Stripe ou no Asaas (09/10,
 * função "pay", migrations 20261009010000 e 20261009020000). `allowed`: a
 * empresa tem a função liberada; `provider`: qual está em uso (nulo = o padrão,
 * Pix e link das Configurações); `stripe`/`asaas`: quais já têm a chave;
 * `connected`: o escolhido está conectado (o botão de pagar aparece).
 */
export type Provider = "stripe" | "asaas";
/**
 * Parcelas no cartão pelo Asaas, por faixa de valor (migration
 * 20261009040000): "até R$ up_to, em até max vezes"; acima de todas, `above`.
 */
export type InstallmentRule = { tiers: { up_to: number; max: number }[]; above: number };
/** `installments`: o máximo de parcelas de sempre; `installment_rule`: a regra por valor. */
export type OnlineStatus = { allowed: boolean; connected: boolean; provider: Provider | null; stripe: boolean; asaas: boolean; installments: number; installment_rule: InstallmentRule };
const NONE: OnlineStatus = { allowed: false, connected: false, provider: null, stripe: false, asaas: false, installments: 1, installment_rule: { tiers: [], above: 1 } };

export function useOnlinePayments() {
  const [status, setStatus] = useState<OnlineStatus>(NONE);
  const [loaded, setLoaded] = useState(false);
  const reload = async () => {
    const { data, error } = await supabase.rpc("online_payments_status" as never);
    setStatus(error || !data ? NONE : { ...NONE, ...(data as unknown as OnlineStatus) });
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
    case "invalid_key": return L("Essa chave não parece certa: a do Stripe começa com sk_test_ ou sk_live_, a do Asaas com $aact_.", "That key doesn't look right: Stripe's starts with sk_test_ or sk_live_, Asaas's with $aact_.");
    case "asaas_refused": return L("O Asaas recusou a chave. Confira se copiou a chave de API inteira (começa com $aact_).", "Asaas refused the key. Check you copied the whole API key (starts with $aact_).");
    case "stripe_refused": return L("O Stripe recusou a chave. Confira se copiou a chave secreta inteira.", "Stripe refused the key. Check you copied the whole secret key.");
    case "nothing_owed": return L("Não há nada em aberto.", "Nothing is open.");
    case "not_connected": return L("O pagamento on-line ainda não foi escolhido ou conectado (Configurações → Integrações).", "Online payment isn't chosen or connected yet (Settings → Integrations).");
    case "not_enabled": return L("O pagamento on-line não está liberado para esta empresa.", "Online payment isn't enabled for this company.");
    default: return L("Não deu agora. Tente de novo em instantes.", "Couldn't do it now. Try again shortly.");
  }
}

/** Escolhe o pagamento on-line: nulo = o padrão (Pix e link das Configurações). */
export async function setProvider(p: Provider | null) {
  const { error } = await supabase.rpc("set_online_provider" as never, { _provider: p } as never);
  return error ? error.message : null;
}

/** Grava a regra de parcelas por valor (o banco confere: faixas crescentes, de 1 a 12x). */
export async function setInstallmentRule(rule: InstallmentRule) {
  const { error } = await supabase.rpc("set_online_installment_rule" as never, { _rule: rule } as never);
  return error ? error.message : null;
}

/** Até quantas parcelas para um valor (a mesma conta da função "pay"). */
export function installmentsFor(rule: InstallmentRule, amount: number) {
  const tier = [...rule.tiers].sort((a, b) => a.up_to - b.up_to).find(t => amount <= t.up_to);
  return tier ? tier.max : rule.above;
}

import { useState } from "react";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVocabulary } from "@/hooks/useVocabulary";
import { usePlan } from "@/hooks/usePlan";
import { dbErrorMessage } from "@/lib/dbErrors";
import { CURRENCIES, LOCALES, L, getCurrency, getLocale, type Currency, type Locale } from "@/lib/i18n";

/**
 * Língua e moeda da empresa (migration 20260925170000). Vale para todos dela:
 * equipe, portal da família, mensagens e recibos. Trocar recarrega a tela.
 */
export default function LanguageSettings() {
  const { apply } = useVocabulary();
  const { plan } = usePlan();
  // Assinatura ativa: a moeda fica travada (migration 20260925190000).
  const locked = plan.billing_status === "active" || plan.billing_status === "past_due";
  const [busy, setBusy] = useState(false);
  const locale = getLocale();
  const currency = getCurrency();

  const save = async (next: { locale?: Locale; currency?: Currency }) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("set_account_locale" as never, {
      _locale: next.locale ?? null, _currency: next.currency ?? null,
    } as never);
    setBusy(false);
    if (error) { toast.error(dbErrorMessage(error)); return; }
    // A resposta traz a língua nova; o provedor aplica e recarrega a tela.
    apply(data);
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
          <Globe className="h-4 w-4" /> {L("Língua e moeda", "Language and currency")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {L("Vale para todos da empresa: equipe, portal dos clientes, mensagens e recibos.",
             "Applies to everyone in your business: staff, client portal, messages and receipts.")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{L("Língua", "Language")}</Label>
          <Select value={locale} disabled={busy}
            onValueChange={v => save({ locale: v as Locale, currency: v === "en" && currency === "BRL" && !locked ? "USD" : undefined })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{LOCALES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>{L("Moeda", "Currency")}</Label>
          <Select value={currency} disabled={busy || locked} onValueChange={v => save({ currency: v as Currency })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {locked
          ? L("A moeda fica travada enquanto a assinatura do Cronys estiver ativa, porque ela é cobrada nessa moeda.",
              "The currency is locked while your Cronys subscription is active, since it's billed in that currency.")
          : L("A assinatura do Cronys é cobrada nesta moeda. Em dólar, euro ou libra os planos são mensais.",
              "Your Cronys subscription is billed in this currency. In USD, EUR or GBP plans are monthly.")}
      </p>
    </Card>
  );
}

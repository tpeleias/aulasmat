import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { WheelSelect } from "@/components/WheelSelect";
import { useVocabulary } from "@/hooks/useVocabulary";
import { usePlan } from "@/hooks/usePlan";
import { dbErrorMessage } from "@/lib/dbErrors";
import { CURRENCIES, LOCALES, L, getCurrency, getCustomSymbol, getLocale, type Currency, type Locale } from "@/lib/i18n";

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
  // Símbolo livre (migration 20260927030000): só a aparência dos valores; a
  // assinatura continua cobrada numa das quatro moedas.
  const savedSymbol = getCustomSymbol();
  const [other, setOther] = useState(!!savedSymbol);
  const [symbol, setSymbol] = useState(savedSymbol ?? "");

  const saveSymbol = async (next: string | null) => {
    const clean = (next ?? "").trim();
    if ((clean || null) === (savedSymbol || null)) return;
    if (clean && (clean.length > 6 || /\d/.test(clean))) {
      toast.error(L("Use até 6 caracteres, sem números (ex.: S/, MT, ₹).", "Use up to 6 characters, no digits (e.g. S/, MT, ₹)."));
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("set_account_currency_symbol" as never, { _symbol: clean || null } as never);
    setBusy(false);
    if (error) { toast.error(dbErrorMessage(error)); return; }
    apply(data);
  };

  // Voltar a uma das quatro: tira o símbolo livre e troca a moeda, e só então
  // aplica (aplicar recarrega a tela, então vai uma vez, com a resposta final).
  const pickCurrency = async (v: string) => {
    if (v === "other") { setOther(true); return; }
    setOther(false);
    setSymbol("");
    if (!savedSymbol && v === currency) return;
    setBusy(true);
    let data: unknown = null;
    if (savedSymbol) {
      const r = await supabase.rpc("set_account_currency_symbol" as never, { _symbol: null } as never);
      if (r.error) { setBusy(false); toast.error(dbErrorMessage(r.error)); return; }
      data = r.data;
    }
    if (v !== currency) {
      const r = await supabase.rpc("set_account_locale" as never, { _locale: null, _currency: v } as never);
      if (r.error) { setBusy(false); toast.error(dbErrorMessage(r.error)); return; }
      data = r.data;
    }
    setBusy(false);
    apply(data);
  };

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
          <WheelSelect value={locale} disabled={busy} label={L("Língua", "Language")} options={LOCALES}
            onValueChange={v => save({ locale: v as Locale, currency: v === "en" && currency === "BRL" && !locked ? "USD" : undefined })} />
        </div>
        <div>
          <Label>{L("Moeda", "Currency")}</Label>
          <WheelSelect value={other ? "other" : currency} disabled={busy} onValueChange={pickCurrency} label={L("Moeda", "Currency")} options={[
            ...CURRENCIES.map(c => ({ value: c.value, label: c.label, disabled: locked && c.value !== currency })),
            { value: "other", label: L("Outra (escrever o símbolo)", "Other (type the symbol)") },
          ]} />
        </div>
      </div>
      {other && (
        <div>
          <Label htmlFor="simbolo-moeda">{L("Símbolo da moeda", "Currency symbol")}</Label>
          <Input id="simbolo-moeda" value={symbol} maxLength={6} disabled={busy} className="mt-1 w-32"
            placeholder={L("ex.: S/, MT, ₹", "e.g. S/, MT, ₹")}
            onChange={e => setSymbol(e.target.value)}
            onBlur={() => saveSymbol(symbol)}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <p className="mt-1 text-xs text-muted-foreground">
            {L(`Os valores aparecem com esse símbolo no app, nas mensagens e nos recibos. A assinatura do Cronys continua cobrada em ${currency}.`,
               `Amounts show with this symbol in the app, messages and receipts. Your Cronys subscription is still billed in ${currency}.`)}
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {locked
          ? L("A moeda fica travada enquanto a assinatura do Cronys estiver ativa, porque ela é cobrada nessa moeda.",
              "The currency is locked while your Cronys subscription is active, since it's billed in that currency.")
          : L("A assinatura do Cronys é cobrada nesta moeda.",
              "Your Cronys subscription is billed in this currency.")}
      </p>
    </Card>
  );
}

import { CURRENCIES, getCurrency, getLocale, setLocale, L, type Currency } from "@/lib/i18n";

/**
 * Para o visitante (sem login) ver os preços na moeda dele. Quem já tem conta
 * vê a moeda da empresa, que é a moeda em que a assinatura é cobrada - por
 * isso as telas só mostram isto sem sessão. A escolha segue para o cadastro.
 * Os preços são lidos ao carregar a página, então trocar recarrega.
 */
export function CurrencyPicker({ className = "" }: { className?: string }) {
  const cur = getCurrency();
  const pick = (c: Currency) => {
    if (c === cur) return;
    setLocale(getLocale(), c);
    window.location.reload();
  };
  return (
    <div className={`inline-flex items-center gap-1 rounded-xl border border-border p-1 text-sm ${className}`} role="group" aria-label={L("Moeda", "Currency")}>
      {CURRENCIES.map(c => (
        <button key={c.value} type="button" onClick={() => pick(c.value)} aria-pressed={c.value === cur}
          className={`rounded-lg px-3 py-1 ${c.value === cur ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
          {c.value}
        </button>
      ))}
    </div>
  );
}

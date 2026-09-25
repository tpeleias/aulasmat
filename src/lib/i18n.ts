// Língua e moeda do app (accounts.locale / accounts.currency, migration
// 20260925170000). A empresa escolhe; vale para todos dela.
//
// Sem dicionário de chaves: cada texto traz as duas línguas no próprio lugar,
// `L("Salvar", "Save")`. Assim a frase continua legível no código, as palavras
// do ramo entram pelo `${}` de sempre, e não há arquivo gigante para manter em
// sincronia. Texto sem L() fica em português - é o padrão.
//
// O valor atual mora aqui, fora do React, porque funções puras também usam
// (fmtMoney, recibo, mensagens do WhatsApp). O VocabularyProvider atualiza ao
// ler a empresa; trocar a língua recarrega a tela inteira.
import { ptBR, enUS, type Locale as DateLocale } from "date-fns/locale";

export type Locale = "pt-BR" | "en";
export type Currency = "BRL" | "USD" | "EUR" | "GBP";

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en", label: "English" },
];

export const CURRENCIES: { value: Currency; label: string }[] = [
  { value: "BRL", label: "R$ - Real" },
  { value: "USD", label: "US$ - Dollar" },
  { value: "EUR", label: "€ - Euro" },
  { value: "GBP", label: "£ - Pound" },
];

const CACHE_KEY = "cronys.locale";

export function isLocale(x: unknown): x is Locale { return x === "pt-BR" || x === "en"; }
export function isCurrency(x: unknown): x is Currency { return x === "BRL" || x === "USD" || x === "EUR" || x === "GBP"; }

/**
 * Antes de saber a empresa (tela de entrada, cadastro, site): a última usada
 * neste aparelho ou, sem ela, a língua do aparelho.
 */
function initial(): { locale: Locale; currency: Currency } {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as { locale?: unknown; currency?: unknown } | null;
    if (saved && isLocale(saved.locale)) {
      return { locale: saved.locale, currency: isCurrency(saved.currency) ? saved.currency : saved.locale === "en" ? "USD" : "BRL" };
    }
  } catch { /* sem armazenamento */ }
  // Nos testes o jsdom diz "en-US"; o app nasceu em português.
  if (import.meta.env?.MODE === "test") return { locale: "pt-BR", currency: "BRL" };
  const nav = typeof navigator !== "undefined" ? (navigator.language || "") : "";
  const en = /^en\b/i.test(nav);
  return { locale: en ? "en" : "pt-BR", currency: en ? "USD" : "BRL" };
}

let current = initial();

export function getLocale(): Locale { return current.locale; }
export function getCurrency(): Currency { return current.currency; }
export function isEnglish(): boolean { return current.locale === "en"; }

/** Chamado por quem lê a empresa. Devolve true se mudou algo. */
export function setLocale(locale: Locale, currency: Currency): boolean {
  const changed = locale !== current.locale || currency !== current.currency;
  current = { locale, currency };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(current)); } catch { /* ok */ }
  if (typeof document !== "undefined") document.documentElement.lang = locale === "en" ? "en" : "pt-BR";
  return changed;
}

/**
 * O botão de língua do site e da tela de entrada (sem login). A moeda
 * acompanha só no par óbvio - real vira dólar no inglês, dólar vira real no
 * português; euro e libra ficam (Portugal fala português e paga em euro).
 */
export function toggleLanguage() {
  const toEn = current.locale !== "en";
  const cur = toEn && current.currency === "BRL" ? "USD" : !toEn && current.currency === "USD" ? "BRL" : current.currency;
  setLocale(toEn ? "en" : "pt-BR", cur);
  window.location.reload();
}

/** O texto na língua da empresa: `L("Salvar", "Save")`. */
export function L<T>(pt: T, en: T): T { return current.locale === "en" ? en : pt; }

/** O locale do date-fns: `format(d, "EEEE", { locale: dateLocale() })`. */
export function dateLocale(): DateLocale { return current.locale === "en" ? enUS : ptBR; }

/** Para Intl/toLocaleString. */
export function intlLocale(): string { return current.locale === "en" ? "en-US" : "pt-BR"; }

/** Dinheiro na moeda da empresa. */
export function fmtCurrency(v: number, currency: Currency = current.currency): string {
  return v.toLocaleString(intlLocale(), { style: "currency", currency });
}

/** Símbolo da moeda (R$, US$...) para rótulos de campo. */
export function currencySymbol(currency: Currency = current.currency): string {
  const parts = (0).toLocaleString(intlLocale(), { style: "currency", currency }).replace(/[\d.,\s]/g, "");
  return parts || currency;
}

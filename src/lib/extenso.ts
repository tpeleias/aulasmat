import { getCurrency, isEnglish } from "@/lib/i18n";
import { amountInWordsFor } from "@shared/extenso";
export { valorPorExtenso, numberToWordsEn, amountInWordsEn } from "@shared/extenso";

export function amountInWords(value: number): string {
  return amountInWordsFor(value, isEnglish(), getCurrency());
}

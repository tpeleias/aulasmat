import { getCurrency, isEnglish } from "@/lib/i18n";
// Valor por extenso, em português, pro recibo — um recibo sem o valor escrito
// por extenso é comum de ser rejeitado como comprovante. Cobre reais e
// centavos, até 999.999.999 (bem além de qualquer pacote deste app).

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = ["dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

// 0 a 999.
function grupoTresDigitos(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 10) partes.push(UNIDADES[resto]);
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

// 0 a 999.999.999. Entre grupos usa vírgula ("mil, duzentos e trinta e
// quatro"), exceto antes do ÚLTIMO grupo quando ele é redondo ou menor que
// 100 ("mil e cinquenta", "duzentos mil e um") - aí usa "e", como se escreve
// em português.
function extensoInteiro(n: number): string {
  if (n === 0) return "zero";
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const centenas = n % 1000;

  const grupos: { texto: string; valor: number }[] = [];
  if (milhoes > 0) grupos.push({ texto: `${grupoTresDigitos(milhoes)} ${milhoes === 1 ? "milhão" : "milhões"}`, valor: milhoes });
  if (milhares > 0) grupos.push({ texto: milhares === 1 ? "mil" : `${grupoTresDigitos(milhares)} mil`, valor: milhares });
  if (centenas > 0) grupos.push({ texto: grupoTresDigitos(centenas), valor: centenas });

  if (grupos.length === 1) return grupos[0].texto;

  const ultimo = grupos[grupos.length - 1];
  const usaE = ultimo.valor < 100 || ultimo.valor % 100 === 0;
  const inicio = grupos.slice(0, -1).map(g => g.texto).join(", ");
  return `${inicio}${usaE ? " e " : ", "}${ultimo.texto}`;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// valorEmReais pode ter centavos (220.5). Negativo ou não-finito devolve "".
export function valorPorExtenso(valorEmReais: number): string {
  if (!Number.isFinite(valorEmReais) || valorEmReais < 0) return "";
  const centavosTotais = Math.round(valorEmReais * 100);
  const inteiro = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;

  const reaisTexto = `${extensoInteiro(inteiro)} ${inteiro === 1 ? "real" : "reais"}`;
  if (centavos === 0) return capitalize(reaisTexto);

  const centavosTexto = `${extensoInteiro(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`;
  if (inteiro === 0) return capitalize(centavosTexto);
  return capitalize(`${reaisTexto} e ${centavosTexto}`);
}

// ---------------------------------------------------------------------------
// Em inglês (empresa com locale "en"): "one hundred fifty dollars and 25 cents".
// ---------------------------------------------------------------------------
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

export function numberToWordsEn(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "zero";
  const scales: [number, string][] = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"], [1, ""]];
  const out: string[] = [];
  for (const [size, name] of scales) {
    const chunk = Math.floor(n / size) % 1000;
    if (chunk) out.push(`${under1000(chunk)}${name ? ` ${name}` : ""}`);
  }
  return out.join(" ");
}

const CURRENCY_WORDS: Record<string, [string, string, string, string]> = {
  USD: ["dollar", "dollars", "cent", "cents"],
  EUR: ["euro", "euros", "cent", "cents"],
  GBP: ["pound", "pounds", "penny", "pence"],
  BRL: ["real", "reais", "centavo", "centavos"],
};

/** "One hundred fifty dollars and 25 cents". */
export function amountInWordsEn(value: number, currency = "USD"): string {
  const [one, many, cOne, cMany] = CURRENCY_WORDS[currency] ?? CURRENCY_WORDS.USD;
  const whole = Math.floor(Math.round(value * 100) / 100);
  const cents = Math.round((value - whole) * 100);
  const w = `${numberToWordsEn(whole)} ${whole === 1 ? one : many}`;
  const text = cents ? `${w} and ${numberToWordsEn(cents)} ${cents === 1 ? cOne : cMany}` : w;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** O valor por extenso na língua e na moeda da empresa. */
export function amountInWords(value: number): string {
  return isEnglish() ? amountInWordsEn(value, getCurrency()) : valorPorExtenso(value);
}

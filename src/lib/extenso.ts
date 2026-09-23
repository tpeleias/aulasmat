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

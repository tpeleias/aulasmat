// Pix "copia e cola" (BR Code estático) com o valor já preenchido. É só o
// padrão EMV do Banco Central montado em texto: não precisa de banco, API ou
// cadastro nenhum - basta a chave, o nome de quem recebe e a cidade.

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

// CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido pelo BR Code.
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Nome e cidade só aceitam ASCII; acento vira letra sem acento.
const ascii = (s: string, max: number) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-]/g, "").trim().slice(0, max);

// A chave como o banco espera. 11 dígitos sem "+" é tratado como CPF - é a
// ambiguidade do Pix (celular também tem 11 dígitos); celular precisa vir
// com +55, e as Configurações dizem isso.
export function normalizePixKey(raw: string): string {
  const key = raw.trim();
  if (key.includes("@")) return key.toLowerCase();
  if (key.startsWith("+")) return "+" + key.replace(/\D/g, "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return key.toLowerCase();
  const digits = key.replace(/\D/g, "");
  if (digits.length === 11 || digits.length === 14) return digits;
  return key;
}

export type PixInput = { key: string; name: string; city: string; amount?: number; txid?: string };

// Devolve null quando falta algo obrigatório - melhor não mandar código Pix do
// que mandar um que o banco da família recusa.
export function buildPixPayload({ key, name, city, amount, txid = "***" }: PixInput): string | null {
  const k = normalizePixKey(key ?? "");
  const n = ascii(name ?? "", 25);
  const c = ascii(city ?? "", 15);
  if (!k || !n || !c) return null;
  const merchant = field("00", "br.gov.bcb.pix") + field("01", k);
  let payload =
    field("00", "01") +
    field("26", merchant) +
    field("52", "0000") +
    field("53", "986") +
    (amount && amount > 0 ? field("54", amount.toFixed(2)) : "") +
    field("58", "BR") +
    field("59", n) +
    field("60", c) +
    field("62", field("05", ascii(txid, 25) || "***"));
  payload += "6304";
  return payload + crc16(payload);
}

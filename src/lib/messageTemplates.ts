// As mensagens prontas de cada empresa (settings.message_templates): o texto
// é dela, com campos entre chaves que o app preenche na hora - {nome},
// {dia}, {hora}... Campo vazio (ou modelo apagado) volta para o texto padrão,
// que usa as palavras do ramo da empresa (aula/consulta, aluno/paciente).

import type { Vocabulary } from "@/lib/vocabulary";
import { cap } from "@/lib/vocabulary";
import { L, isEnglish } from "@/lib/i18n";

// Em inglês os campos têm nome em inglês ({name}, {day}...). Por dentro o app
// preenche pelos nomes em português; fillTemplate aceita os dois.
export const TAG_EN: Record<string, string> = {
  saudacao: "greeting", nome: "name", aluno: "client", de_aluno: "of_client", dia: "day", hora: "time",
  endereco: "address", local: "place", localizacao: "location", mapa: "map",
  lista: "list", resumo: "summary", total: "total", como_pagar: "how_to_pay",
};
const TAG_PT = Object.fromEntries(Object.entries(TAG_EN).map(([pt, en]) => [en, pt]));

/** O nome do campo como a empresa o vê ({nome} ou {name}). */
export function displayTag(tag: string): string {
  return isEnglish() ? (TAG_EN[tag] ?? tag) : tag;
}

export type MessageKey = "lembrete" | "confirmacao" | "a_caminho" | "cobranca";
export type MessageTemplates = Partial<Record<MessageKey, string>>;

export type Placeholder = { tag: string; desc: string };

const lessonTags = (w: Vocabulary): Placeholder[] => [
  { tag: "saudacao", desc: L("\"Olá, Carla!\" (ou só \"Olá!\" sem nome)", "\"Hi Carla!\" (or just \"Hi!\" without a name)") },
  { tag: "nome", desc: L(`primeiro nome de quem recebe (${w.guardian.l} ou ${w.client.l})`, `first name of the recipient (${w.guardian.l} or ${w.client.l})`) },
  { tag: "aluno", desc: L(`primeiro nome ${w.client.do} ${w.client.l}`, `the ${w.client.l}'s first name`) },
  { tag: "de_aluno", desc: L(`" de Lucas" quando vai para ${w.guardian.o} ${w.guardian.l}; vazio quando vai para ${w.client.o} ${w.client.l}`, `" for Lucas" when sent to the ${w.guardian.l}; empty when sent to the ${w.client.l}`) },
  { tag: "dia", desc: L("\"quinta-feira, 01/10\"", "\"Thursday, Oct 1\"") },
  { tag: "hora", desc: "\"15:00\"" },
  { tag: "endereco", desc: L("o endereço cadastrado", "the saved address") },
  { tag: "local", desc: L("\" em Rua X, 10\" ou \" (on-line)\"", "\" at 10 X Street\" or \" (online)\"") },
];

export const MESSAGE_TYPES = (w: Vocabulary): { key: MessageKey; title: string; when: string; tags: Placeholder[] }[] => [
  {
    key: "lembrete", title: L(`Lembrete ${w.appointment.do} ${w.appointment.l}`, `${w.appointment.s} reminder`),
    when: L(`Botão "Lembrar no WhatsApp" (tela Hoje, ${w.appointment.l} e widget).`, `"Remind on WhatsApp" button (Today screen, ${w.appointment.l} and widget).`),
    tags: lessonTags(w),
  },
  {
    key: "confirmacao", title: L("Confirmação ao marcar", "Booking confirmation"),
    when: L(`Aviso "Avisar no WhatsApp" logo depois de marcar ${w.appointment.um} ${w.appointment.l}.`, `"Notify on WhatsApp" right after booking ${w.appointment.um} ${w.appointment.l}.`),
    tags: lessonTags(w),
  },
  {
    key: "a_caminho", title: L("Estou a caminho", "On my way"),
    when: L("Botão \"Estou a caminho\" (plano Max).", "\"On my way\" button (Max plan)."),
    tags: [
      ...lessonTags(w),
      { tag: "localizacao", desc: L("\" Minha localização agora: <link do mapa>\" (vazio se o celular não der a posição)", "\" My location now: <map link>\" (empty if the phone doesn't give a position)") },
      { tag: "mapa", desc: L("só o link do mapa", "just the map link") },
    ],
  },
  {
    key: "cobranca", title: L("Cobrança", "Payment request"),
    when: L("Botão \"Copiar cobrança\" no Financeiro.", "\"Copy request\" button in Billing."),
    tags: [
      { tag: "de_aluno", desc: L(`" de *Lucas*" quando a cobrança é de ${w.client.um} ${w.client.l} só`, `" for *Lucas*" when the request is for a single ${w.client.l}`) },
      { tag: "aluno", desc: L(`nome ${w.client.do} ${w.client.l}`, `the ${w.client.l}'s name`) },
      { tag: "lista", desc: L(`${w.appointment.p} em aberto, uma por bloco (dia, valor, desconto)`, `Outstanding ${w.appointment.lp}, one per block (day, amount, discount)`) },
      { tag: "resumo", desc: L("o total a pagar (com descontos, se houver)", "the total due (with discounts, if any)") },
      { tag: "total", desc: L("só o valor total, \"R$ 300,00\"", "just the total, \"$300.00\"") },
      { tag: "como_pagar", desc: L("Pix, Pix copia e cola e link de pagamento", "payment link and details") },
    ],
  },
];

/** O texto padrão de cada mensagem, já com as palavras do ramo. */
export function defaultTemplate(key: MessageKey, w: Vocabulary): string {
  const a = w.appointment;
  if (isEnglish()) {
    switch (key) {
      case "lembrete":
        return `{greeting} Just a reminder of the ${a.l}{of_client}: {day} at {time}{place}. Could you please confirm?`;
      case "confirmacao":
        return `{greeting} The ${a.l}{of_client} is booked for {day} at {time}{place}. See you then!`;
      case "a_caminho":
        return `{greeting} I'm on my way to the ${a.l}{of_client}.{location}`;
      case "cobranca":
        return `Hi! Hope you're well 😊

Here are the ${a.lp}{of_client} that already happened and are still open:

{list}

{summary}{how_to_pay}

Once paid, just send the receipt and we'll mark it here. Any questions, just let me know. Thank you!`;
    }
  }
  switch (key) {
    case "lembrete":
      return `{saudacao} Passando para lembrar ${a.o} ${a.l}{de_aluno}: {dia} às {hora}{local}. Pode confirmar, por favor?`;
    case "confirmacao":
      return `{saudacao} ${cap(a.o)} ${a.l}{de_aluno} está ${a.pick("marcado", "marcada")} para {dia} às {hora}{local}. Até lá!`;
    case "a_caminho":
      return `{saudacao} Estou a caminho para ${a.o} ${a.l}{de_aluno}.{localizacao}`;
    case "cobranca":
      return `Oi! Tudo bem? 😊

Passando pra fechar ${a.os} ${a.lp}{de_aluno} que já aconteceram e ainda estão em aberto:

{lista}

{resumo}{como_pagar}

Depois é só mandar o comprovante que a gente dá baixa por aqui. Qualquer dúvida, é só chamar! Obrigado! 🤓`;
  }
}

/** Troca {campo} pelo valor. Campo desconhecido fica como está, para a pessoa ver o erro. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k] : TAG_PT[k] && TAG_PT[k] in vars ? vars[TAG_PT[k]] : m))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** O modelo da empresa, ou o padrão quando ela não mudou (ou apagou) aquele. */
export function templateFor(key: MessageKey, w: Vocabulary, templates?: MessageTemplates | null): string {
  const custom = templates?.[key]?.trim();
  return custom ? custom : defaultTemplate(key, w);
}

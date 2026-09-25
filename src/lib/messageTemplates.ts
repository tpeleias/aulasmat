// As mensagens prontas de cada empresa (settings.message_templates): o texto
// é dela, com campos entre chaves que o app preenche na hora - {nome},
// {dia}, {hora}... Campo vazio (ou modelo apagado) volta para o texto padrão,
// que usa as palavras do ramo da empresa (aula/consulta, aluno/paciente).

import type { Vocabulary } from "@/lib/vocabulary";
import { cap } from "@/lib/vocabulary";

export type MessageKey = "lembrete" | "confirmacao" | "a_caminho" | "cobranca";
export type MessageTemplates = Partial<Record<MessageKey, string>>;

export type Placeholder = { tag: string; desc: string };

const lessonTags = (w: Vocabulary): Placeholder[] => [
  { tag: "saudacao", desc: "\"Olá, Carla!\" (ou só \"Olá!\" sem nome)" },
  { tag: "nome", desc: `primeiro nome de quem recebe (${w.guardian.l} ou ${w.client.l})` },
  { tag: "aluno", desc: `primeiro nome ${w.client.do} ${w.client.l}` },
  { tag: "de_aluno", desc: `" de Lucas" quando vai para ${w.guardian.o} ${w.guardian.l}; vazio quando vai para ${w.client.o} ${w.client.l}` },
  { tag: "dia", desc: "\"quinta-feira, 01/10\"" },
  { tag: "hora", desc: "\"15:00\"" },
  { tag: "endereco", desc: "o endereço cadastrado" },
  { tag: "local", desc: "\" em Rua X, 10\" ou \" (on-line)\"" },
];

export const MESSAGE_TYPES = (w: Vocabulary): { key: MessageKey; title: string; when: string; tags: Placeholder[] }[] => [
  {
    key: "lembrete", title: `Lembrete ${w.appointment.do} ${w.appointment.l}`,
    when: `Botão "Lembrar no WhatsApp" (tela Hoje, ${w.appointment.l} e widget).`,
    tags: lessonTags(w),
  },
  {
    key: "confirmacao", title: "Confirmação ao marcar",
    when: `Aviso "Avisar no WhatsApp" logo depois de marcar ${w.appointment.um} ${w.appointment.l}.`,
    tags: lessonTags(w),
  },
  {
    key: "a_caminho", title: "Estou a caminho",
    when: "Botão \"Estou a caminho\" (plano Max).",
    tags: [
      ...lessonTags(w),
      { tag: "localizacao", desc: "\" Minha localização agora: <link do mapa>\" (vazio se o celular não der a posição)" },
      { tag: "mapa", desc: "só o link do mapa" },
    ],
  },
  {
    key: "cobranca", title: "Cobrança",
    when: "Botão \"Copiar cobrança\" no Financeiro.",
    tags: [
      { tag: "de_aluno", desc: `" de *Lucas*" quando a cobrança é de ${w.client.um} ${w.client.l} só` },
      { tag: "aluno", desc: `nome ${w.client.do} ${w.client.l}` },
      { tag: "lista", desc: `${w.appointment.p} em aberto, uma por bloco (dia, valor, desconto)` },
      { tag: "resumo", desc: "o total a pagar (com descontos, se houver)" },
      { tag: "total", desc: "só o valor total, \"R$ 300,00\"" },
      { tag: "como_pagar", desc: "Pix, Pix copia e cola e link de pagamento" },
    ],
  },
];

/** O texto padrão de cada mensagem, já com as palavras do ramo. */
export function defaultTemplate(key: MessageKey, w: Vocabulary): string {
  const a = w.appointment;
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
    .replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** O modelo da empresa, ou o padrão quando ela não mudou (ou apagou) aquele. */
export function templateFor(key: MessageKey, w: Vocabulary, templates?: MessageTemplates | null): string {
  const custom = templates?.[key]?.trim();
  return custom ? custom : defaultTemplate(key, w);
}

import { L } from "@/lib/i18n";

// O que a função google-calendar devolve, na língua da empresa.
//
// A função responde com um código (`code`) e a tela escreve a frase; o erro
// que fica guardado na conexão (last_error) vem como chave "google:..." quando
// é nosso, ou como o texto do próprio Google (que já vem em inglês).

/** O erro guardado na conexão, para mostrar embaixo do nome. */
export function googleStoredError(msg: string | null | undefined): string | null {
  if (!msg) return null;
  switch (msg) {
    case "google:revoked":
    case "O acesso ao Google foi retirado. Conecte de novo.":
      return L("O acesso ao Google foi retirado. Conecte de novo.", "Access to Google was removed. Please reconnect.");
    case "google:permission":
    case "O Google não deu essa permissão. Desconecte e conecte de novo, marcando as duas caixas.":
    case "O Google não deu essa permissão. Desconecte e conecte de novo, marcando a caixa.":
      return L("O Google não deu a permissão. Desconecte e conecte de novo, marcando as caixas.",
               "Google didn't grant the permission. Disconnect and connect again, ticking the boxes.");
  }
  return msg;
}

/** A recusa da função (connect/disconnect), com o corpo lido também em erro HTTP. */
export async function googleFunctionError(data: unknown, error: unknown): Promise<string> {
  let body = data as { code?: string } | null;
  if (!body?.code && error && typeof error === "object" && "context" in error) {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    body = (await ctx?.json?.().catch(() => null)) as { code?: string } | null;
  }
  switch (body?.code) {
    case "not_configured":
      return L("O Google Agenda ainda não está disponível no Cronys.", "Google Calendar isn't available in Cronys yet.");
    case "plan":
      return L("O Google Agenda faz parte do Cronys Pro e do Max.", "Google Calendar is part of Cronys Pro and Max.");
    case "not_enabled":
      return L("Quem te atende ainda não liberou o Google Agenda.", "Your provider hasn't turned on Google Calendar yet.");
    case "forbidden":
      return L("Você só pode conectar o seu próprio Google Agenda.", "You can only connect your own Google Calendar.");
  }
  return L("Não deu para falar com o Google agora. Tente de novo.", "Couldn't reach Google right now. Please try again.");
}

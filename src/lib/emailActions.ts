import { supabase } from "@/integrations/supabase/client";
import { L } from "@/lib/i18n";

/**
 * Os envios na mão pela função "emails" (03/10): cobrança, extrato, "cobrar
 * todos" e lembrete de atendimento. A função responde com um código de erro
 * no corpo; aqui ele vira uma frase.
 */
export type EmailActionResult<T> = { ok: boolean; data: T; error: string };

export async function emailAction<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<EmailActionResult<T>> {
  const { data, error } = await supabase.functions.invoke("emails", { body });
  if (!error) return { ok: true, data: data as T, error: "" };
  const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
  const code = await ctx?.json?.().then(b => b?.error, () => null).catch(() => null);
  return { ok: false, data: null as T, error: code ?? "failed" };
}

export function emailErrorText(code: string) {
  switch (code) {
    case "no_email": return L("Ninguém desta conta tem e-mail no cadastro. Coloque o e-mail no cadastro do cliente.", "No one on this account has an email. Add it to the client's profile.");
    case "nothing_owed": return L("Esta conta não tem nada em aberto.", "This account has nothing open.");
    case "not configured": return L("Os e-mails ainda não estão configurados.", "Emails aren't set up yet.");
    case "forbidden": return L("Só o admin pode enviar este e-mail.", "Only the admin can send this email.");
    default: return L("Não deu para enviar agora. Tente de novo em alguns minutos.", "Couldn't send right now. Try again in a few minutes.");
  }
}

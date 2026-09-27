import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

// Entrar com o Google (Thiago, 27/09).
//
// No site, o Supabase leva ao Google e volta para /entrar com a sessão no
// endereço, que o cliente do Supabase lê sozinho.
//
// No app Android o Google não deixa logar dentro do app (WebView): a tela
// dele abre no navegador do celular, e a volta é por este endereço, que o
// AndroidManifest entrega ao app. Precisa estar em Supabase -> Authentication
// -> URL Configuration -> Redirect URLs.
export const NATIVE_LOGIN_RETURN = "com.aulasmat.app://login";

let enabled: Promise<boolean> | null = null;

/**
 * O Google está ligado no Supabase? Sem isso o botão não aparece: clicar
 * daria "provider is not enabled". Pergunta uma vez por abertura do app.
 */
export function googleLoginEnabled(): Promise<boolean> {
  if (!enabled) {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    enabled = !url || !key
      ? Promise.resolve(false)
      : fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
          .then(r => (r.ok ? r.json() : null))
          .then(s => s?.external?.google === true)
          .catch(() => false);
  }
  return enabled;
}

export async function signInWithGoogle(): Promise<{ error?: string }> {
  const native = Capacitor.isNativePlatform();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: native ? NATIVE_LOGIN_RETURN : `${window.location.origin}/entrar`,
      // Quem tem mais de uma conta Google escolhe qual, em vez de entrar
      // direto na última usada.
      queryParams: { prompt: "select_account" },
      skipBrowserRedirect: native,
    },
  });
  if (error) return { error: error.message };
  if (native && data?.url) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: data.url, presentationStyle: "popover" });
  }
  return {};
}

/**
 * A volta do Google no app: com.aulasmat.app://login#access_token=...&refresh_token=...
 * (ou ?error_description=... quando a pessoa cancela ou algo falha).
 * Devolve o erro, se houver; null quando o endereço não é o do login.
 */
export async function finishNativeLogin(url: string): Promise<{ error?: string } | null> {
  if (!url.startsWith(NATIVE_LOGIN_RETURN)) return null;
  const params = new URLSearchParams(url.split("#")[1] ?? url.split("?")[1] ?? "");
  const query = new URLSearchParams(url.split("?")[1]?.split("#")[0] ?? "");
  const errorText = params.get("error_description") ?? query.get("error_description");
  if (errorText) return { error: errorText.replace(/\+/g, " ") };
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return { error: "missing_tokens" };
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  return error ? { error: error.message } : {};
}

/** Veio do Google (ou outro login de fora), e não de e-mail e senha. */
export function isExternalLogin(user: { app_metadata?: { provider?: string } } | null | undefined): boolean {
  const p = user?.app_metadata?.provider;
  return !!p && p !== "email";
}

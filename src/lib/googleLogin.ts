import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

// Entrar com o Google (Thiago, 27/09).
//
// O jeito principal (28/09) pede a permissão ao Google direto daqui, e não
// pelo Supabase: assim a tela do Google mostra "cronys.com.br" (no site) ou a
// janelinha nativa do celular (no app), e não "dqfzuviwejlobrwebyum.supabase.co".
// O Google devolve um "ID token", e o Supabase abre a sessão com ele.
//   - Site: o botão oficial do Google (GoogleWebButton).
//   - App: Credential Manager do Android (@capgo/capacitor-social-login).
// Precisa do ID do cliente "Cronys login" (Aplicativo da Web, projeto Cronys
// Play no Google Cloud) em VITE_GOOGLE_WEB_CLIENT_ID. É público: vai no
// código de qualquer site que usa login do Google.
//
// O jeito antigo continua de reserva (sem o ID, ou se o nativo falhar): o
// Supabase leva ao Google e volta para /entrar - ou, no app, abre o
// navegador do celular e volta por NATIVE_LOGIN_RETURN, que o
// AndroidManifest entrega ao app e que está em Supabase -> Authentication ->
// URL Configuration -> Redirect URLs.
export const NATIVE_LOGIN_RETURN = "com.aulasmat.app://login";
export const GOOGLE_WEB_CLIENT_ID = ((import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined) ?? "").trim();

/**
 * Par de "nonce": o Google recebe o resumo (sha-256) e grava no token; o
 * Supabase recebe o original e confere. Impede reaproveitar um token alheio.
 */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const raw = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

export async function signInWithGoogleIdToken(token: string, rawNonce: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token, nonce: rawNonce });
  return error ? { error: error.message } : {};
}

let nativeReady: Promise<void> | null = null;

/** No app: a janelinha de contas do próprio Android. */
async function signInWithGoogleNative(): Promise<{ error?: string; cancelled?: boolean }> {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  if (!nativeReady) nativeReady = SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID } });
  await nativeReady;
  const { raw, hashed } = await makeNonce();
  let idToken: string | null | undefined;
  try {
    const res = await SocialLogin.login({ provider: "google", options: { nonce: hashed } });
    idToken = (res.result as { idToken?: string | null }).idToken;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return { cancelled: true };
    throw e;
  }
  if (!idToken) throw new Error("no_id_token");
  return signInWithGoogleIdToken(idToken, raw);
}

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

/**
 * O botão do Google no app, e no site quando o botão oficial não carrega.
 * No app tenta a janelinha nativa; se ela não estiver configurada (ou der
 * qualquer erro que não seja a pessoa desistir), cai no navegador.
 */
export async function signInWithGoogle(): Promise<{ error?: string }> {
  const native = Capacitor.isNativePlatform();
  if (native && GOOGLE_WEB_CLIENT_ID) {
    try {
      const r = await signInWithGoogleNative();
      if (r.cancelled) return {};
      if (!r.error) return {};
    } catch {
      // Segue para o navegador.
    }
  }
  return signInWithGoogleRedirect();
}

async function signInWithGoogleRedirect(): Promise<{ error?: string }> {
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

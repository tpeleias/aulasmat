import { Capacitor } from "@capacitor/core";

/**
 * Entrar com a digital (ou o rosto) no app Android (03/10).
 *
 * Depois de entrar com usuário e senha, o app oferece guardar esse login no
 * cofre do Android (Keystore), protegido pela biometria: para ler de volta, o
 * aparelho pede a digital. A senha não sai do celular. No site não existe -
 * lá seria passkey, que o Supabase ainda não tem pronto.
 *
 * Plugin: @capgo/capacitor-native-biometric (carregado só no app).
 */
const SERVER = "com.aulasmat.app.login";
const DECLINED_KEY = "cronys.biometric.declined";

const native = () => Capacitor.isNativePlatform();
const plugin = async () => (await import("@capgo/capacitor-native-biometric"));

export async function biometricAvailable(): Promise<boolean> {
  if (!native()) return false;
  try {
    const { NativeBiometric } = await plugin();
    return (await NativeBiometric.isAvailable()).isAvailable;
  } catch { return false; }
}

export async function hasSavedLogin(): Promise<boolean> {
  if (!native()) return false;
  try {
    const { NativeBiometric } = await plugin();
    return (await NativeBiometric.isCredentialsSaved({ server: SERVER })).isSaved;
  } catch { return false; }
}

export async function saveLogin(username: string, password: string): Promise<boolean> {
  try {
    const { NativeBiometric, AccessControl } = await plugin();
    await NativeBiometric.setCredentials({ username, password, server: SERVER, accessControl: AccessControl.BIOMETRY_CURRENT_SET });
    return true;
  } catch { return false; }
}

/** Pede a digital e devolve o login guardado; nulo se a pessoa cancelar ou o cofre não tiver. */
export async function loadLogin(reason: string): Promise<{ username: string; password: string } | null> {
  try {
    const { NativeBiometric } = await plugin();
    const c = await NativeBiometric.getSecureCredentials({ server: SERVER, reason, title: reason });
    return c?.username && c?.password ? { username: c.username, password: c.password } : null;
  } catch { return null; }
}

export async function forgetLogin(): Promise<void> {
  try {
    const { NativeBiometric } = await plugin();
    await NativeBiometric.deleteCredentials({ server: SERVER });
  } catch { /* já não havia */ }
}

/** "Agora não" vale para este login: o app não pergunta de novo a cada entrada. */
export function declinedFor(login: string): boolean {
  try { return (JSON.parse(localStorage.getItem(DECLINED_KEY) || "[]") as string[]).includes(login.toLowerCase()); } catch { return false; }
}
export function declineFor(login: string) {
  try {
    const list = JSON.parse(localStorage.getItem(DECLINED_KEY) || "[]") as string[];
    localStorage.setItem(DECLINED_KEY, JSON.stringify([...new Set([...list, login.toLowerCase()])]));
  } catch { /* sem armazenamento */ }
}

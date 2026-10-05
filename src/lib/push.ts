import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { L } from "@/lib/i18n";
import { openExternal } from "@/lib/whatsapp";

/**
 * Notificações no celular (05/10), pelo Firebase. Só no app Android. O
 * aparelho se cadastra (register_push_device) quando a pessoa deixa; quem
 * manda é a função "push", pelo que está na fila do banco (migration
 * 20261005020000). Tocar no aviso abre a tela que ele indica.
 */
export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

const TOKEN_KEY = "cronys.push.token";
export const pushSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

let listening = false;
let navigate: ((to: string) => void) | null = null;
let pending: string | null = null;

/** O roteador avisa como navegar (o aviso pode chegar antes dele montar). */
export function setPushNavigator(fn: ((to: string) => void) | null) {
  navigate = fn;
  if (fn && pending) { const to = pending; pending = null; open(to); }
}

function open(url?: string | null) {
  if (!url) return;
  if (/^https?:\/\//i.test(url)) { openExternal(url); return; }
  if (!url.startsWith("/")) return;
  if (navigate) navigate(url); else pending = url;
}

async function saveToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* sem storage */ }
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  const { error } = await supabase.rpc("register_push_device" as never, { _token: token, _platform: "android" } as never);
  if (error) console.warn("push: cadastro do aparelho", error.message);
}

/** Os ouvintes, uma vez, logo ao abrir o app (o toque que abriu o app chega aqui). */
export async function listenPush() {
  if (!pushSupported() || listening) return;
  listening = true;
  await PushNotifications.createChannel({
    id: "cronys", name: L("Avisos dos atendimentos", "Appointment notices"),
    description: L("Lembretes, pedidos e mudanças de horário", "Reminders, requests and time changes"),
    importance: 4, visibility: 1,
  }).catch(() => {});
  await PushNotifications.addListener("registration", t => { void saveToken(t.value); });
  await PushNotifications.addListener("registrationError", e => console.warn("push: registro", e.error));
  await PushNotifications.addListener("pushNotificationActionPerformed", a => open(a.notification.data?.url as string | undefined));
  // Com o app aberto o Android não mostra a notificação: vira um aviso na tela.
  await PushNotifications.addListener("pushNotificationReceived", n => {
    const url = n.data?.url as string | undefined;
    toast(n.title ?? "Cronys", {
      description: n.body,
      ...(url ? { action: { label: L("Ver", "View"), onClick: () => open(url) } } : {}),
      duration: 8000,
    });
  });
}

export async function pushPermission(): Promise<PushPermission> {
  if (!pushSupported()) return "unsupported";
  try {
    const p = await PushNotifications.checkPermissions();
    return p.receive === "granted" ? "granted" : p.receive === "denied" ? "denied" : "prompt";
  } catch { return "unsupported"; }
}

/** "Ativar": pede ao Android e, se a pessoa deixar, cadastra o aparelho. */
export async function enablePush(): Promise<PushPermission> {
  if (!pushSupported()) return "unsupported";
  await listenPush();
  const p = await PushNotifications.requestPermissions();
  if (p.receive !== "granted") return p.receive === "denied" ? "denied" : "prompt";
  await PushNotifications.register();
  return "granted";
}

/** Entrou (ou abriu o app já logado) com a permissão dada: renova o cadastro. */
export async function resumePush() {
  if ((await pushPermission()) !== "granted") return;
  await listenPush();
  await PushNotifications.register().catch(() => {});
}

/** Sair da conta: este aparelho para de receber os avisos dela. */
export async function forgetPushDevice() {
  if (!pushSupported()) return;
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* sem storage */ }
  if (token) await supabase.rpc("unregister_push_device" as never, { _token: token } as never).then(() => {}, () => {});
}

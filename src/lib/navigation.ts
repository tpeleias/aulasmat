import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { openExternal } from "@/lib/whatsapp";

/**
 * O app de rota de cada pessoa: Waze ou Google Maps (Thiago, 27/09). Escolhe
 * em Minha conta. Fica na conta (user_metadata), para valer no celular e no
 * computador, e numa cópia local para abrir na hora, sem esperar a rede.
 * Sem escolha, é o Waze, como sempre foi.
 */
export type NavApp = "waze" | "maps";

const KEY = "cronys.navApp";

const valid = (v: unknown): NavApp | null => (v === "waze" || v === "maps" ? v : null);

function local(): NavApp | null {
  try { return valid(localStorage.getItem(KEY)); } catch { return null; }
}

export function routeUrl(address: string, app: NavApp): string {
  const q = encodeURIComponent(address);
  return app === "maps"
    ? `https://www.google.com/maps/dir/?api=1&destination=${q}`
    : `https://waze.com/ul?q=${q}&navigate=yes`;
}

export const navAppName = (app: NavApp) => (app === "maps" ? "Google Maps" : "Waze");

/** O app escolhido por quem está logado. */
export function useNavApp(): NavApp {
  const { user } = useAuth();
  return valid(user?.user_metadata?.nav_app) ?? local() ?? "waze";
}

/** Abre a rota até o endereço no app escolhido. */
export function openRoute(address: string, app: NavApp) {
  openExternal(routeUrl(address, app));
}

export async function saveNavApp(app: NavApp) {
  try { localStorage.setItem(KEY, app); } catch { /* sem armazenamento: vale a da conta */ }
  return supabase.auth.updateUser({ data: { nav_app: app } });
}

import { Capacitor } from "@capacitor/core";

// Endereço público do site, para montar link que vai para fora do app.
//
// No app Android a página roda em https://localhost (é assim que o Capacitor
// serve o dist/ embutido), então window.location.origin daria um link que só
// funciona dentro do próprio celular. No site, o próprio endereço é o certo:
// quem está em cronys.com.br compartilha cronys.com.br.
const PUBLIC_SITE = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) || "https://cronys.com.br";

export function publicSiteUrl(): string {
  const origin = window.location.origin;
  const local = Capacitor.isNativePlatform() || /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
  return (local ? PUBLIC_SITE : origin).replace(/\/$/, "");
}

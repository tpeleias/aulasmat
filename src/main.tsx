import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Preferences } from "@capacitor/preferences";
import App from "./App.tsx";
import "./index.css";

if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: false });
  StatusBar.setStyle({ style: Style.Light });
  // The "group" set in capacitor.config.ts is NOT applied automatically by
  // @capacitor/preferences - it only takes effect after an explicit
  // configure() call, otherwise it silently keeps using the default
  // "CapacitorStorage" group, which the native widget doesn't read from.
  Preferences.configure({ group: "AulasMatPrefs" });
}

// As telas são arquivos separados com nome de hash. Quem está com a página
// aberta durante uma publicação pede um arquivo que já não existe; recarregar
// busca o índice novo. Uma vez só por minuto, para não entrar em laço se o
// erro for outro (sem internet, por exemplo).
window.addEventListener("vite:preloadError", (event) => {
  const key = "cronys-reload-after-deploy";
  let last = 0;
  try { last = Number(sessionStorage.getItem(key) ?? 0); } catch { /* sem storage */ }
  if (Date.now() - last < 60_000) return;
  try { sessionStorage.setItem(key, String(Date.now())); } catch { /* sem storage */ }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);

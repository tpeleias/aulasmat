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

createRoot(document.getElementById("root")!).render(<App />);

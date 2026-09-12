import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { brokeredPreviewStorage } from "./previewAuthStorage";

// On the web the session lives in localStorage, brokered when inside a preview frame.
// Inside the Android app it goes to the system preferences instead: WebView storage can
// be wiped by the system to reclaim space, which logs the family out for no reason.
export function authStorage() {
  if (!Capacitor.isNativePlatform()) return brokeredPreviewStorage();

  return {
    getItem: async (key: string) => {
      const { value } = await Preferences.get({ key });
      if (value != null) return value;
      // First run after the change: carry over whatever was already signed in.
      try {
        const legacy = localStorage.getItem(key);
        if (legacy != null) {
          await Preferences.set({ key, value: legacy });
          return legacy;
        }
      } catch {
        // Storage blocked: nothing to carry over.
      }
      return null;
    },
    setItem: async (key: string, value: string) => {
      await Preferences.set({ key, value });
    },
    removeItem: async (key: string) => {
      await Preferences.remove({ key });
      try { localStorage.removeItem(key); } catch { /* already gone */ }
    },
  };
}

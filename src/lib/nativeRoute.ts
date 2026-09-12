import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeRoutePlugin {
  getPendingRoute(): Promise<{ route: string | null }>;
}

const plugin = registerPlugin<NativeRoutePlugin>("LessonsWidget");

// Home-screen widgets launch MainActivity with a "route" extra; the native side parks it
// until the web app asks. Checked on mount and whenever the app comes back to the foreground.
export function useNativeRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const consume = async () => {
      try {
        const { route } = await plugin.getPendingRoute();
        if (route) navigate(route, { replace: true });
      } catch {
        // Older native build without the method - nothing to do.
      }
    };
    consume();
    const onVisible = () => { if (document.visibilityState === "visible") consume(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [navigate]);
}

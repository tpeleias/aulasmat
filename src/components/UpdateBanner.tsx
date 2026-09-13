import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

const RELEASE_API_URL = "https://api.github.com/repos/tpeleias/aulasmat/releases/tags/android-latest";
const RELEASE_DOWNLOAD_URL = "https://github.com/tpeleias/aulasmat/releases/download/android-latest/app-debug.apk";
const DISMISSED_KEY = "update_banner_dismissed_sha";

export default function UpdateBanner() {
  const [latestSha, setLatestSha] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // A build installed from the Play Store updates through the store.
    if (!Capacitor.isNativePlatform() || __BUILD_SHA__ === "dev" || __DISTRIBUTION__ === "play") return;

    fetch(RELEASE_API_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const match = data?.body?.match(/commit ([0-9a-f]{7,40})/i);
        const sha = match?.[1];
        if (sha && sha !== __BUILD_SHA__) {
          setLatestSha(sha);
          setDismissed(localStorage.getItem(DISMISSED_KEY) === sha);
        }
      })
      .catch(() => {
        // No network / repo unreachable - fail silently, no banner.
      });
  }, []);

  if (!latestSha || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, latestSha);
    setDismissed(true);
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-primary text-primary-foreground text-sm px-4 py-2">
      <span>Uma versão nova do app está disponível.</span>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1.5"
          onClick={() => window.open(RELEASE_DOWNLOAD_URL, "_blank", "noopener,noreferrer")}
        >
          <Download className="w-3.5 h-3.5" /> Baixar
        </Button>
        <button onClick={dismiss} className="p-1 hover:opacity-70" title="Dispensar">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

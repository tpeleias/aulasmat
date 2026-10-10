import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { L } from "@/lib/i18n";

// Aviso de versão nova do app na tela inicial (Thiago, 01/10). Pergunta à
// Play Store (In-App Updates, @capawesome/capacitor-app-update) se há uma
// versão mais nova para este aparelho - na trilha em que a pessoa está, inclusive
// a de teste. Só no app instalado pela loja; no site não aparece (ele já é
// sempre o mais novo). "Depois" esconde até sair uma versão ainda mais nova.

const DISMISS_KEY = "cronys.update.dismissed";

export default function UpdateBanner() {
  const [available, setAvailable] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    (async () => {
      try {
        const { AppUpdate, AppUpdateAvailability } = await import("@capawesome/capacitor-app-update");
        const info = await AppUpdate.getAppUpdateInfo();
        if (!alive || info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return;
        const code = info.availableVersionCode ?? "nova";
        let dismissed: string | null = null;
        try { dismissed = localStorage.getItem(DISMISS_KEY); } catch { /* sem armazenamento */ }
        if (dismissed !== code) setAvailable(code);
      } catch {
        // Fora da Play (APK instalado à mão) ou sem rede: sem aviso.
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!available) return null;

  // A tela da Play demora um pouco a abrir: o botão avisa na hora (10/10).
  const update = async () => {
    setOpening(true);
    try {
      const { AppUpdate } = await import("@capawesome/capacitor-app-update");
      // A atualização dentro do app (tela da própria Play); se não der, a página do app na loja.
      try { await AppUpdate.performImmediateUpdate(); }
      catch { await AppUpdate.openAppStore().catch(() => {}); }
    } finally { setOpening(false); }
  };

  const later = () => {
    try { localStorage.setItem(DISMISS_KEY, available); } catch { /* ok */ }
    setAvailable(null);
  };

  return (
    <div role="status" className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-3">
      <Download className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{L("Nova versão do Cronys", "New Cronys version")}</p>
        <p className="text-xs text-muted-foreground">{L("Atualize para ter as últimas melhorias e correções.", "Update to get the latest improvements and fixes.")}</p>
      </div>
      <Button size="sm" className="h-9 shrink-0 rounded-xl" disabled={opening} onClick={update}>{opening ? L("Abrindo…", "Opening…") : L("Atualizar", "Update")}</Button>
      <button type="button" aria-label={L("Depois", "Later")} onClick={later} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

import { useEffect } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { finishNativeLogin } from "@/lib/googleLogin";
import { L } from "@/lib/i18n";

// A volta do login do Google no app Android: o navegador do celular devolve
// com.aulasmat.app://login#... e o app guarda a sessão. A tela de entrar,
// que já está aberta, segue sozinha para o lugar certo quando a sessão chega.
export default function NativeLoginReturn() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;

    const handle = async (url: string | undefined) => {
      if (!url) return;
      const result = await finishNativeLogin(url);
      if (!result) return;
      import("@capacitor/browser").then(({ Browser }) => Browser.close()).catch(() => {});
      if (result.error) toast.error(L("Não deu para entrar com o Google. Tente de novo.", "Couldn't sign in with Google. Please try again."));
    };

    CapApp.addListener("appUrlOpen", ({ url }) => { void handle(url); }).then(h => {
      if (cancelled) h.remove();
      else remove = () => h.remove();
    });
    // App fechado pelo sistema enquanto a pessoa estava no Google: volta abrindo pelo endereço.
    CapApp.getLaunchUrl().then(r => { if (!cancelled) void handle(r?.url); }).catch(() => {});

    return () => { cancelled = true; remove?.(); };
  }, []);

  return null;
}

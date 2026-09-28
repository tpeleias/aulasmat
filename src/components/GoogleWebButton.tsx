import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { GOOGLE_WEB_CLIENT_ID, makeNonce, signInWithGoogleIdToken } from "@/lib/googleLogin";
import { haptics } from "@/lib/haptics";
import { isEnglish, L } from "@/lib/i18n";

// O botão oficial do Google no site (Thiago, 28/09). Com ele a janela do
// Google diz "cronys.com.br", e não o endereço do Supabase. Precisa de
// cronys.com.br (e dos outros endereços do site) em "Origens JavaScript
// autorizadas" no cliente "Cronys login" do Google Cloud.

type Gsi = {
  accounts: { id: {
    initialize: (o: Record<string, unknown>) => void;
    renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
  } };
};

const SCRIPT = "https://accounts.google.com/gsi/client";
let loading: Promise<Gsi> | null = null;

function loadGsi(): Promise<Gsi> {
  const w = window as unknown as { google?: Gsi };
  if (w.google?.accounts?.id) return Promise.resolve(w.google);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => (w.google?.accounts?.id ? resolve(w.google) : reject(new Error("gsi")));
      s.onerror = () => { loading = null; reject(new Error("gsi")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Sem o script do Google (bloqueado, sem rede), chama onUnavailable: a tela usa o botão de reserva. */
export default function GoogleWebButton({ onUnavailable }: { onUnavailable: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [gsi, nonce] = await Promise.all([loadGsi(), makeNonce()]);
        if (!alive || !ref.current) return;
        gsi.accounts.id.initialize({
          client_id: GOOGLE_WEB_CLIENT_ID,
          nonce: nonce.hashed,
          ux_mode: "popup",
          use_fedcm_for_button: true,
          callback: async ({ credential }: { credential?: string }) => {
            if (!credential) return;
            const { error } = await signInWithGoogleIdToken(credential, nonce.raw);
            if (error) { haptics.warning(); toast.error(L("Não deu para entrar com o Google. Tente de novo.", "Couldn't sign in with Google. Please try again.")); }
          },
        });
        gsi.accounts.id.renderButton(ref.current, {
          type: "standard", theme: "outline", size: "large", shape: "rectangular",
          text: "continue_with", logo_alignment: "center",
          width: Math.min(400, Math.max(200, ref.current.offsetWidth || 320)),
          locale: isEnglish() ? "en" : "pt-BR",
        });
        setReady(true);
      } catch {
        if (alive) onUnavailable();
      }
    })();
    return () => { alive = false; };
  }, [onUnavailable]);

  return (
    <div className="flex min-h-[44px] w-full justify-center">
      <div ref={ref} className="w-full max-w-[400px] [&>div]:mx-auto" aria-busy={!ready} />
    </div>
  );
}

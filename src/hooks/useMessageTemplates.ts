import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MessageTemplates } from "@/lib/messageTemplates";

// Os modelos de mensagem da empresa (settings.message_templates). Um só pedido
// ao banco para o app inteiro; quem salva avisa as outras telas.
let cached: MessageTemplates | null = null;
let settingsId: number | null = null;
let pending: Promise<MessageTemplates> | null = null;
const listeners = new Set<(t: MessageTemplates) => void>();

function fetchTemplates(): Promise<MessageTemplates> {
  if (!pending) {
    pending = (async () => {
      // "*" e não a coluna: antes da migration 20260925090000 ela não existe.
      const { data } = await supabase.from("settings").select("*").maybeSingle();
      const row = data as { id?: number; message_templates?: unknown } | null;
      settingsId = row?.id ?? null;
      const raw = row?.message_templates;
      cached = raw && typeof raw === "object" ? (raw as MessageTemplates) : {};
      return cached;
    })().finally(() => { pending = null; });
  }
  return pending;
}

/** Recarrega na próxima leitura (troca de conta, por exemplo). */
export function forgetMessageTemplates() { cached = null; }

/** Lê os modelos sem ser componente (widget, por exemplo). */
export async function loadMessageTemplates(): Promise<MessageTemplates> {
  return cached ?? fetchTemplates();
}

export function useMessageTemplates() {
  const [templates, setTemplates] = useState<MessageTemplates>(cached ?? {});
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
    let alive = true;
    const on = (t: MessageTemplates) => { if (alive) setTemplates(t); };
    listeners.add(on);
    if (cached === null) fetchTemplates().then(t => { if (alive) { setTemplates(t); setLoading(false); } });
    return () => { alive = false; listeners.delete(on); };
  }, []);

  const save = useCallback(async (next: MessageTemplates) => {
    // Só guarda o que difere do padrão: campo vazio volta a seguir o app.
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => typeof v === "string" && v.trim())) as MessageTemplates;
    if (settingsId === null) await fetchTemplates();
    if (settingsId === null) return { message: "Configurações da empresa não encontradas." };
    const { error } = await supabase.from("settings").update({ message_templates: clean } as never).eq("id", settingsId);
    if (!error) {
      cached = clean;
      listeners.forEach(l => l(clean));
    }
    return error;
  }, []);

  return { templates, loading, save };
}

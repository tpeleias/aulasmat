import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * A empresa logada é a dona do endereço público (`/disponibilidade`)?
 *
 * Só ela tem página de horários por enquanto: sem login, o banco serve a
 * empresa marcada como `is_public_default`. Para qualquer outra, o link
 * copiado mostraria a agenda da empresa errada - por isso o botão some.
 * Logado, `effective_account_id` é a própria empresa; basta comparar.
 */
export function useHasPublicPage(enabled: boolean) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    type R = { data: unknown; error: unknown };
    Promise.all([
      supabase.rpc("public_account_id" as never) as unknown as Promise<R>,
      supabase.rpc("effective_account_id" as never) as unknown as Promise<R>,
    ]).then(([pub, mine]) => {
      if (!alive) return;
      setHas(!pub.error && !mine.error && !!pub.data && pub.data === mine.data);
    });
    return () => { alive = false; };
  }, [enabled]);
  return has;
}

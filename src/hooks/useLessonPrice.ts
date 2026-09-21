import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// O que o banco usa quando a empresa ainda não tem linha em settings
// (public.account_lesson_price). Existe aqui só como último recurso: a tela
// não deve inventar um preço diferente do que a aula vai custar de verdade.
export const FALLBACK_LESSON_PRICE = 220;

// O valor muda raramente e é lido por três telas. Guardar entre montagens
// evita que o diálogo de nova aula pisque o valor errado enquanto consulta.
let cached: number | null = null;

export function primeLessonPrice(v: number) {
  if (Number.isFinite(v) && v > 0) cached = v;
}

export function useLessonPrice() {
  const [price, setPrice] = useState(cached ?? FALLBACK_LESSON_PRICE);
  const [loaded, setLoaded] = useState(cached !== null);

  useEffect(() => {
    let alive = true;
    // O banco entrega só a linha da própria empresa, então não filtra por id.
    supabase.from("settings").select("default_lesson_price").maybeSingle().then(({ data }) => {
      const v = Number((data as { default_lesson_price?: number } | null)?.default_lesson_price);
      if (!alive) return;
      if (Number.isFinite(v) && v > 0) { cached = v; setPrice(v); }
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  return { price, loaded };
}

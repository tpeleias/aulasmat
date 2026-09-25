import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Teacher = { id: string; name: string; active: boolean; sort_order?: number; subject?: string | null; whatsapp?: string | null; whatsapp_enabled?: boolean; plan_locked?: boolean; user_id?: string | null; scarcity?: Record<string, { min: number; max: number }> | null;
  /** Cor na agenda escolhida pelo admin (src/lib/teacherColors.ts); nula = pela posição. */
  color?: string | null;
  /** Etiqueta "faz todos os serviços" (migration 20260925110000). */
  all_services?: boolean };

export function useTeachers(onlyActive = true) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    // A ordem precisa ser estável: é dela que saem as cores da agenda.
    let q = supabase.from("teachers" as any).select("*").order("sort_order").order("name");
    const { data } = await q;
    let list = (data ?? []) as any as Teacher[];
    if (onlyActive) list = list.filter(t => t.active);
    setTeachers(list);
    setLoading(false);
  };
  useEffect(() => { load(); }, [onlyActive]);
  return { teachers, loading, reload: load };
}

// Slug used in lessons.teacher / blocks.teacher columns (lowercased ASCII)
export function teacherSlug(name: string) {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/\s+/g, "-");
}

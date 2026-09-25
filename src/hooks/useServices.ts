import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Um serviço da empresa (tabela services, migration 20260925110000). */
export type Service = {
  id: string;
  name: string;
  duration_minutes: number;
  /** Preço do atendimento inteiro; nulo = o preço padrão da empresa por hora. */
  price: number | null;
  mode: "presencial" | "online" | "ambos";
  color: string | null;
  active: boolean;
  sort_order: number;
};

export type TeacherService = { teacher_id: string; service_id: string };

/**
 * Os serviços da empresa e quem faz cada um. `services` vem nulo enquanto
 * carrega ou quando a tabela ainda não existe (app publicado antes da
 * migration): quem usa trata como "empresa sem serviços".
 */
export function useServices(onlyActive = false) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [links, setLinks] = useState<TeacherService[]>([]);

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      supabase.from("services" as never).select("*").order("sort_order").order("created_at"),
      supabase.from("teacher_services" as never).select("teacher_id, service_id"),
    ]);
    if (s.error) { setServices(null); return; }
    let list = (s.data ?? []) as unknown as Service[];
    if (onlyActive) list = list.filter(x => x.active);
    setServices(list);
    setLinks((l.data ?? []) as unknown as TeacherService[]);
  }, [onlyActive]);

  useEffect(() => { load(); }, [load]);

  return { services, links, reload: load };
}

/**
 * O profissional faz o serviço? Fora do Max (sem serviço por profissional),
 * todos fazem todos - igual a teacher_does_service() no banco.
 */
export function teacherDoes(
  teacher: { id: string; all_services?: boolean },
  serviceId: string | null | undefined,
  links: TeacherService[],
  perTeacher: boolean,
): boolean {
  if (!serviceId || !perTeacher || teacher.all_services !== false) return true;
  return links.some(l => l.teacher_id === teacher.id && l.service_id === serviceId);
}

/** Preço do serviço como valor da hora, que é o que a aula guarda (lessons.price). */
export function hourlyPrice(s: Pick<Service, "price" | "duration_minutes">): number | null {
  if (s.price == null || !s.duration_minutes) return null;
  return Math.round((Number(s.price) * 60 / s.duration_minutes) * 100) / 100;
}

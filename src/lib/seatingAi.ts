import { supabase } from "@/integrations/supabase/client";
import type { Student } from "@/types/seating";

export async function generateSeatingMapWithAI(
  students: Student[],
  rows: number,
  cols: number,
): Promise<(string | null)[]> {
  const { data, error } = await supabase.functions.invoke("generate-seating-map", {
    body: {
      students: students.map((s) => ({ id: s.id, name: s.name, observation: s.observation })),
      rows,
      cols,
    },
  });

  if (error) throw new Error(error.message ?? "Falha ao chamar a IA");
  if (data?.error) throw new Error(data.error);
  if (!Array.isArray(data?.studentIdBySeatIndex)) throw new Error("Resposta inválida da IA");

  return data.studentIdBySeatIndex;
}

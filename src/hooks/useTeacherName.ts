import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { teacherSlug } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";

/**
 * O nome de quem atende, a partir do apelido gravado em lessons.teacher.
 *
 * O apelido é técnico (sem acento, minúsculo, hífen no espaço: "joao",
 * "ana-paula") e vai no endereço e no banco. Na tela tem que aparecer o nome
 * cadastrado: "Bom dia, João", e não "Bom dia, Joao" (Thiago, 03/10). Sem o
 * profissional na lista (apagado), mostra o apelido com a primeira maiúscula,
 * como antes.
 *
 * A lista vem uma vez por login e é dividida entre as telas, que são muitas.
 * Inclui os inativos: aula antiga de quem saiu continua com o nome certo.
 */
type Row = { name: string };
let cache: { user: string; rows: Promise<Row[]> } | null = null;

function rowsFor(user: string): Promise<Row[]> {
  if (!cache || cache.user !== user) {
    const rows = Promise.resolve(supabase.from("teachers" as never).select("name"))
      .then(({ data }: { data: unknown }) => (data ?? []) as Row[])
      .catch(() => [] as Row[]);
    cache = { user, rows };
  }
  return cache.rows;
}

/** Para quando a lista muda (profissional novo, nome trocado). */
export function forgetTeacherNames() { cache = null; }

export function useTeacherName() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    rowsFor(user.id).then(r => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [user]);
  return useCallback((slug: string | null | undefined) => {
    if (!slug) return "";
    const found = rows.find(r => teacherSlug(r.name) === slug);
    return capitalize(found?.name ?? slug);
  }, [rows]);
}

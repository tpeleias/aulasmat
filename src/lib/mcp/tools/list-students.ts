import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { databaseError, textResult } from "../tool-utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_students",
  title: "Listar alunos",
  description: "Lista os alunos visíveis para o usuário conectado, com filtro opcional por nome.",
  inputSchema: { query: z.string().optional().describe("Parte do nome do aluno ou responsável.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query }, ctx) => {
    const supabase = supabaseForUser(ctx);
    let request = supabase.from("students").select("id,student_name,guardian_name,address").order("student_name").limit(50);
    if (query?.trim()) request = request.or(`student_name.ilike.%${query.trim()}%,guardian_name.ilike.%${query.trim()}%`);
    const { data, error } = await request;
    if (error) throw databaseError(error.message);
    return textResult({ students: data ?? [] });
  },
});

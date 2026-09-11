import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { databaseError, textResult } from "../tool-utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_lessons",
  title: "Consultar aulas",
  description: "Consulta aulas visíveis ao usuário conectado dentro de um período.",
  inputSchema: {
    from: z.string().describe("Data/hora inicial em ISO 8601."),
    to: z.string().describe("Data/hora final em ISO 8601."),
    studentName: z.string().optional(),
    teacher: z.string().optional().describe("Identificador do professor, como thiago ou mayara."),
    status: z.string().optional().describe("Situação da aula, como agendada, realizada ou cancelada."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, studentName, teacher, status }, ctx) => {
    let request = supabaseForUser(ctx).from("lessons").select("*").gte("start_at", from).lt("start_at", to).order("start_at").limit(200);
    if (studentName) request = request.ilike("student_name", `%${studentName}%`);
    if (teacher) request = request.eq("teacher", teacher);
    if (status) request = request.eq("status", status);
    const { data, error } = await request;
    if (error) throw databaseError(error.message);
    return textResult({ lessons: data ?? [] });
  },
});

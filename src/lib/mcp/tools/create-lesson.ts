import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { databaseError, requireAdmin, textResult } from "../tool-utils";

export default defineTool({
  name: "create_lesson",
  title: "Criar aula",
  description: "Cria uma aula após o usuário confirmar aluno, professor, horário, duração e valor por hora.",
  inputSchema: {
    studentName: z.string(), guardianName: z.string().optional(), teacher: z.string(), startAt: z.string(),
    durationMinutes: z.number(), subject: z.string().optional(), hourlyPrice: z.number(),
    packageType: z.string().optional(), isOnline: z.boolean().optional(), address: z.string().optional(), notes: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const supabase = await requireAdmin(ctx);
    const { data, error } = await supabase.from("lessons").insert({
      student_name: input.studentName, guardian_name: input.guardianName ?? null, teacher: input.teacher,
      start_at: input.startAt, duration_minutes: input.durationMinutes, subject: input.subject ?? null,
      price: input.hourlyPrice, package_type: input.packageType ?? "avulsa", is_online: input.isOnline ?? false,
      address: input.address ?? null, notes: input.notes ?? null,
    }).select().single();
    if (error) throw databaseError(error.message);
    return textResult({ lesson: data });
  },
});

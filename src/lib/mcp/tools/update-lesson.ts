import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { databaseError, requireAdmin, textResult } from "../tool-utils";

export default defineTool({
  name: "update_lesson",
  title: "Atualizar aula",
  description: "Atualiza os campos informados de uma aula existente após confirmação do usuário.",
  inputSchema: {
    lessonId: z.string(), studentName: z.string().optional(), guardianName: z.string().optional(), teacher: z.string().optional(),
    startAt: z.string().optional(), durationMinutes: z.number().optional(), subject: z.string().optional(),
    hourlyPrice: z.number().optional(), isOnline: z.boolean().optional(), address: z.string().optional(),
    status: z.string().optional(), paymentStatus: z.string().optional(), notes: z.string().optional(), classSummary: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ lessonId, ...input }, ctx) => {
    const supabase = await requireAdmin(ctx);
    const fields = Object.fromEntries(Object.entries({
      student_name: input.studentName, guardian_name: input.guardianName, teacher: input.teacher,
      start_at: input.startAt, duration_minutes: input.durationMinutes, subject: input.subject,
      price: input.hourlyPrice, is_online: input.isOnline, address: input.address,
      status: input.status, payment_status: input.paymentStatus, notes: input.notes, class_summary: input.classSummary,
    }).filter(([, value]) => value !== undefined));
    if (Object.keys(fields).length === 0) throw new ToolError("Informe ao menos um campo para atualizar.");
    const { data, error } = await supabase.from("lessons").update(fields).eq("id", lessonId).select().single();
    if (error) throw databaseError(error.message);
    return textResult({ lesson: data });
  },
});

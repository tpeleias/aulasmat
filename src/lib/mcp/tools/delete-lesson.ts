import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { databaseError, requireAdmin, textResult } from "../tool-utils";

export default defineTool({
  name: "delete_lesson",
  title: "Excluir aula",
  description: "Exclui definitivamente uma aula após confirmação explícita do usuário.",
  inputSchema: { lessonId: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lessonId }, ctx) => {
    const { error } = await (await requireAdmin(ctx)).from("lessons").delete().eq("id", lessonId);
    if (error) throw databaseError(error.message);
    return textResult({ deleted: true, lessonId });
  },
});

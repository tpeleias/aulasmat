import { defineTool } from "@lovable.dev/mcp-js";
import { databaseError, textResult } from "../tool-utils";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_teachers",
  title: "Listar professores",
  description: "Lista os professores ativos e seus identificadores de agenda.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { data, error } = await supabaseForUser(ctx).from("teachers").select("id,name,active").eq("active", true).order("name");
    if (error) throw databaseError(error.message);
    const teachers = (data ?? []).map((teacher) => ({
      ...teacher,
      slug: teacher.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, "-"),
    }));
    return textResult({ teachers });
  },
});

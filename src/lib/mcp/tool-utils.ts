import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";

export function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export async function requireAdmin(ctx: ToolContext) {
  if (!ctx.isAuthenticated()) throw new ToolError("Faça login para usar esta ferramenta.");
  const userId = ctx.getUserId();
  if (!userId) throw new ToolError("Não foi possível identificar o usuário.");

  const supabase = supabaseForUser(ctx);
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) throw new ToolError("Esta ação é exclusiva para administradores.");
  return supabase;
}

export function databaseError(message: string) {
  return new ToolError(`Não foi possível concluir a operação: ${message}`);
}

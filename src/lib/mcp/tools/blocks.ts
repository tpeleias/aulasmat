import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { databaseError, requireAdmin, textResult } from "../tool-utils";
import { supabaseForUser } from "../supabase";

export const listBlocks = defineTool({
  name: "list_blocks",
  title: "Consultar bloqueios",
  description: "Lista os bloqueios de agenda visíveis ao usuário conectado.",
  inputSchema: { teacher: z.string().optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ teacher }, ctx) => {
    let request = supabaseForUser(ctx).from("blocks").select("*").order("created_at", { ascending: false });
    if (teacher) request = request.or(`teacher.eq.${teacher},teacher.eq.both`);
    const { data, error } = await request;
    if (error) throw databaseError(error.message);
    return textResult({ blocks: data ?? [] });
  },
});

export const createBlock = defineTool({
  name: "create_block",
  title: "Criar bloqueio",
  description: "Cria uma indisponibilidade pontual ou recorrente após confirmação do usuário.",
  inputSchema: {
    teacher: z.string(), title: z.string(), blockType: z.string(), weekday: z.number().optional(),
    startTime: z.string().optional(), endTime: z.string().optional(), startAt: z.string().optional(), endAt: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (input.blockType === "recurring" && (input.weekday === undefined || !input.startTime || !input.endTime)) {
      throw new ToolError("Bloqueios recorrentes exigem dia da semana, início e fim.");
    }
    if (input.blockType === "one_off" && (!input.startAt || !input.endAt)) {
      throw new ToolError("Bloqueios pontuais exigem data/hora inicial e final.");
    }
    const supabase = await requireAdmin(ctx);
    const { data, error } = await supabase.from("blocks").insert({
      teacher: input.teacher, title: input.title, block_type: input.blockType,
      weekday: input.weekday ?? null, start_time: input.startTime ?? null, end_time: input.endTime ?? null,
      start_at: input.startAt ?? null, end_at: input.endAt ?? null,
    }).select().single();
    if (error) throw databaseError(error.message);
    return textResult({ block: data });
  },
});

export const deleteBlock = defineTool({
  name: "delete_block",
  title: "Excluir bloqueio",
  description: "Exclui um bloqueio de agenda após confirmação explícita do usuário.",
  inputSchema: { blockId: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ blockId }, ctx) => {
    const { error } = await (await requireAdmin(ctx)).from("blocks").delete().eq("id", blockId);
    if (error) throw databaseError(error.message);
    return textResult({ deleted: true, blockId });
  },
});

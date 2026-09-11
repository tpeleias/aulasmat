import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { databaseError, requireAdmin, textResult } from "../tool-utils";
import { supabaseForUser } from "../supabase";

export const getWalletBalance = defineTool({
  name: "get_wallet_balance",
  title: "Consultar saldo",
  description: "Consulta saldo e lançamentos financeiros visíveis ao usuário conectado.",
  inputSchema: { studentName: z.string().optional(), guardianName: z.string().optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ studentName, guardianName }, ctx) => {
    let request = supabaseForUser(ctx).from("wallet_transactions").select("*").order("created_at", { ascending: false }).limit(100);
    if (guardianName) request = request.eq("guardian_name", guardianName);
    else if (studentName) request = request.ilike("student_name", `%${studentName}%`);
    const { data, error } = await request;
    if (error) throw databaseError(error.message);
    const rows = data ?? [];
    return textResult({ balance: rows.reduce((sum, row) => sum + Number(row.amount), 0), transactions: rows });
  },
});

export const addWalletCredit = defineTool({
  name: "add_wallet_credit",
  title: "Registrar crédito",
  description: "Registra um pagamento ou ajuste positivo após confirmação do usuário.",
  inputSchema: { studentName: z.string(), guardianName: z.string().optional(), amount: z.number(), kind: z.string().optional(), description: z.string().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ studentName, guardianName, amount, kind, description }, ctx) => {
    if (amount <= 0) throw new ToolError("O valor do crédito deve ser positivo.");
    const supabase = await requireAdmin(ctx);
    const { data, error } = await supabase.from("wallet_transactions").insert({
      student_name: studentName, guardian_name: guardianName ?? null, amount,
      kind: kind ?? "package", description: description ?? null,
    }).select().single();
    if (error) throw databaseError(error.message);
    return textResult({ transaction: data });
  },
});

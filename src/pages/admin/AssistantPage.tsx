import { useRef, useState, useEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, User, Send, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import ChatMarkdown from "@/components/ChatMarkdown";
import { usePlan } from "@/hooks/usePlan";
import { useWords } from "@/hooks/useVocabulary";
import { useAuth } from "@/hooks/useAuth";
import { canSellHere } from "@/lib/subscription";

import { L } from "@/lib/i18n";
type ChatMessage = { role: "user" | "assistant"; content: any[] };

const STORAGE_KEY = "assistant_chat_messages";

function displayText(content: any[]): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function extractErrorMessage(e: any): Promise<string> {
  if (e instanceof FunctionsHttpError) {
    try {
      const body = await e.context.json();
      if (body?.error) return body.error;
    } catch {
      // context wasn't JSON - fall through to generic message
    }
  }
  return e?.message ?? L("Erro ao falar com o assistente.", "Error talking to the assistant.");
}

export default function AssistantPage() {
  const { plan, loading: planLoading } = usePlan();
  const { isAdmin } = useAuth();
  const w = useWords();
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mensagens usadas no mês (limite por empresa, migration 20260925010000).
  // Começa pelo que o plano trouxe e se atualiza a cada resposta.
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const shownUsage = usage ?? plan.assistant_usage ?? null;
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // The home screen hands over a suggestion via router state.
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill;
    if (typeof prefill === "string") {
      setInput(prefill);
      window.history.replaceState({}, "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [location.state]);

  // The home-screen widget opens this page with a question ready (?q=) or just asks for
  // the keyboard (?focus=1). The parameters are cleared so a reload starts clean.
  useEffect(() => {
    const q = searchParams.get("q");
    const focus = searchParams.get("focus");
    if (!q && !focus) return;
    if (q) setInput(q);
    setTimeout(() => inputRef.current?.focus(), 80);
    searchParams.delete("q");
    searchParams.delete("focus");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full/unavailable - conversation just won't persist across tabs
    }
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    haptics.tap();
    setError(null);
    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: [{ type: "text", text }] }];
    setMessages(nextMessages);
    setBusy(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("assistant-chat", {
        body: {
          messages: nextMessages,
          vocabulary: Object.fromEntries((["staff", "appointment", "client", "guardian"] as const)
            .map(k => [k, { s: w[k].s, p: w[k].p }])),
        },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setMessages(data.messages as ChatMessage[]);
      if (data.usage) setUsage(data.usage);
    } catch (e: any) {
      setError(await extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const visibleMessages = messages.filter((m) => displayText(m.content).trim().length > 0);

  // O botao do Assistente continua no menu de propósito: quem não tem precisa
  // DESCOBRIR que isso existe. Quem recusa de verdade e a edge function, que
  // checa a liberação antes de gastar um token sequer.
  if (!planLoading && !plan.assistant) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{L("Assistente", "Assistant")}</h1>
          <p className="text-sm text-muted-foreground">
            {L(`Marcar ${w.appointment.l}, remarcar, registrar pagamento e consultar o financeiro — conversando.`, `Book, reschedule, record payments and check billing — just by chatting.`)}
          </p>
        </div>
        {/* Cada conversa custa dinheiro: o assistente vem no Max pago, é
            adicional no Pro, ou liberado pela Cronys (migration 20260925070000).
            No app Android, só informa - sem preço nem link de compra. */}
        <Card className="mx-auto max-w-md rounded-2xl border-dashed p-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">{L("O Assistente vem no Cronys Max", "The Assistant comes with Cronys Max")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {L(`Em vez de abrir a agenda e preencher formulário, você escreve “marca com o Miguel quinta às 15h” e ele marca. Também registra pagamento, responde quanto ${w.guardian.um} ${w.guardian.l} deve e remarca ${w.appointment.l}.`,
               `Instead of opening the calendar and filling in a form, you write “book Mike on Thursday at 3pm” and it books. It also records payments, tells you how much a ${w.guardian.l} owes and reschedules ${w.appointment.lp}.`)}
          </p>
          <p className="mt-4 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            {plan.tier === "pro"
              ? L("Ele vem incluso no Max com a assinatura ativa.", "It's included in Max with an active subscription.")
              : plan.tier === "pro_solo"
                ? L("Ele vem incluso no Cronys Max. No Pro, dá para adicionar à assinatura.", "It's included in Cronys Max. On Pro, you can add it to your subscription.")
                : L("Ele vem incluso no Cronys Max, e no Pro pode ser adicionado.", "It's included in Cronys Max, and can be added on Pro.")}
          </p>
          {canSellHere() && isAdmin && (
            <Button asChild className="mt-4 rounded-xl"><Link to="/assinar">{L("Ver planos", "See plans")}</Link></Button>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{L("Assistente", "Assistant")}</h1>
          <p className="text-sm text-muted-foreground">
            {L(`Converse pra marcar ${w.appointment.lp}, editar, registrar pagamentos e consultar o financeiro.`, `Chat to book ${w.appointment.lp}, edit them, record payments and check billing.`)}
          </p>
          {shownUsage && (
            <p className={`mt-0.5 text-xs ${shownUsage.used >= shownUsage.limit ? "text-destructive" : "text-muted-foreground"}`}>
              {L(`${shownUsage.used} de ${shownUsage.limit} mensagens este mês`, `${shownUsage.used} of ${shownUsage.limit} messages this month`)}
            </p>
          )}
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat} className="shrink-0">
            {L("Limpar", "Clear")}
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 rounded-xl border border-border bg-card p-4">
        {visibleMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-muted-foreground text-sm py-12">
            {L("Peça algo como", "Ask something like")} <br />
            <span className="italic">{L(`"marca ${w.appointment.um} ${w.appointment.l} do Miguel quinta às 16h"`, `"book ${w.appointment.um} ${w.appointment.l} for Mike on Thursday at 4pm"`)}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleMessages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role !== "user" && (
                  <div className="shrink-0 w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm break-words ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  <ChatMarkdown tone={m.role === "user" ? "user" : "assistant"}>{displayText(m.content)}</ChatMarkdown>
                </div>
                {m.role === "user" && (
                  <div className="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> {L("pensando...", "thinking...")}
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </ScrollArea>

      {error && <div className="mt-2 text-sm text-destructive">{error}</div>}

      <div className="mt-3 flex gap-2 items-end">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={L("Escreva sua mensagem...", "Write your message...")}
          className="min-h-[44px] max-h-32 resize-none rounded-xl"
          disabled={busy}
        />
        <Button onClick={send} disabled={busy || !input.trim()} size="icon" className="h-11 w-11 shrink-0 rounded-xl">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

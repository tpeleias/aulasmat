import { useRef, useState, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { haptics } from "@/lib/haptics";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, User, Send, Loader2 } from "lucide-react";
import ChatMarkdown from "@/components/ChatMarkdown";

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
  return e?.message ?? "Erro ao falar com o assistente.";
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        body: { messages: nextMessages },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setMessages(data.messages as ChatMessage[]);
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Assistente</h1>
          <p className="text-sm text-muted-foreground">
            Converse pra marcar aulas, editar, registrar pagamentos e consultar o financeiro.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat} className="shrink-0">
            Limpar
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 rounded-xl border border-border bg-card p-4">
        {visibleMessages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-muted-foreground text-sm py-12">
            Peça algo como <br />
            <span className="italic">"marca uma aula do Miguel quinta às 16h com o Thiago"</span>
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
                <Loader2 className="w-4 h-4 animate-spin" /> pensando...
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
          placeholder="Escreva sua mensagem..."
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

import { useRef, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, User, Send, Loader2 } from "lucide-react";

type ChatMessage = { role: "user" | "model" | "function"; parts: any[] };

function displayText(parts: any[]): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => typeof p?.text === "string")
    .map((p) => p.text)
    .join("\n");
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", parts: [{ text }] }];
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
      setError(e?.message ?? "Erro ao falar com o assistente.");
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const visibleMessages = messages.filter((m) => displayText(m.parts).trim().length > 0);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-4rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Assistente</h1>
        <p className="text-sm text-muted-foreground">
          Converse pra marcar aulas, editar, registrar pagamentos e consultar o financeiro.
        </p>
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
                  className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {displayText(m.parts)}
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escreva sua mensagem..."
          className="min-h-[44px] max-h-32 resize-none"
          disabled={busy}
        />
        <Button onClick={send} disabled={busy || !input.trim()} size="icon" className="shrink-0">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWords } from "@/hooks/useVocabulary";
import { dbErrorMessage } from "@/lib/dbErrors";
import { intlLocale, L } from "@/lib/i18n";

/**
 * Conectar IA (11/10): liga o Claude, o ChatGPT ou outra IA que aceite
 * conector MCP ao Cronys. Cada conexão é um link secreto com uma chave; o
 * banco guarda só o hash, então o link aparece uma vez, na hora de criar.
 * Quem atende o link é a função "mcp" (migration 20261011010000).
 *
 * `platform`: a versão do painel do gestor, só com números da plataforma.
 */
export type AiConnector = { id: string; label: string; read_only: boolean; token_hint: string; created_at: string; last_used_at: string | null; mine: boolean };

export function connectorUrl(token: string) {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp/${token}`;
}

export default function AiConnectorSettings({ platform = false }: { platform?: boolean }) {
  const w = useWords();
  const [list, setList] = useState<AiConnector[] | null>(null);
  const [label, setLabel] = useState(platform ? "Claude - gestor" : "Claude");
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("ai_connectors_list" as never, { _platform: platform } as never);
    if (!error) setList((data ?? []) as AiConnector[]);
  }, [platform]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("ai_connector_create" as never, { _label: label, _read_only: readOnly, _platform: platform } as never);
    setBusy(false);
    if (error) { toast.error(dbErrorMessage(error, w)); return; }
    const token = (data as { token?: string } | null)?.token;
    if (!token) { toast.error(L("Não deu certo. Tente de novo.", "Something went wrong. Try again.")); return; }
    setCreated(connectorUrl(token));
    setCopied(false);
    load();
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
      toast.success(L("Link copiado", "Link copied"));
    } catch {
      toast.error(L("Não deu para copiar. Selecione o link e copie à mão.", "Couldn't copy. Select the link and copy it by hand."));
    }
  };

  const revoke = async (c: AiConnector) => {
    if (!confirm(L(`Desligar "${c.label}"? A IA que usa esse link perde o acesso na hora.`, `Turn off "${c.label}"? The AI using this link loses access right away.`))) return;
    const { error } = await supabase.rpc("ai_connector_revoke" as never, { _id: c.id } as never);
    if (error) { toast.error(dbErrorMessage(error, w)); return; }
    toast.success(L("Conexão desligada", "Connection turned off"));
    load();
  };

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(intlLocale(), { dateStyle: "short", timeStyle: "short" }) : L("nunca", "never");

  const examples = platform
    ? [L("Como está o Cronys este mês? Quantas empresas pagam?", "How is Cronys doing this month? How many companies pay?"),
       L("Quais testes grátis acabam esta semana? Monte um e-mail para cada uma.", "Which free trials end this week? Draft an email for each."),
       L("Quanto gastamos com o assistente de IA e em quais empresas?", "How much did the AI assistant cost, and for which companies?")]
    : [L(`Coloca estas anotações no "Como foi?" da ${w.appointment.l} de hoje com o Miguel.`, `Put these notes into the "How did it go?" of today's ${w.appointment.l} with Miguel.`),
       L(`Quem está devendo? Monta uma mensagem gentil para cada ${w.guardian.l}.`, `Who owes money? Draft a kind message for each ${w.guardian.l}.`),
       L(`Como foi meu mês? Quantas ${w.appointment.lp}, quanto entrou e quanto falta receber?`, `How was my month? How many ${w.appointment.lp}, how much came in and how much is still owed?`)];

  return (
    <Card className="space-y-4 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"><Sparkles className="h-4 w-4 text-primary" /></div>
        <div className="min-w-0 text-sm">
          <p className="font-medium">{platform ? L("Conectar IA ao painel do gestor", "Connect AI to the admin panel") : L("Conectar IA (Claude, ChatGPT)", "Connect AI (Claude, ChatGPT)")}</p>
          <p className="text-xs text-muted-foreground">
            {platform
              ? L("A sua IA lê os números do Cronys (empresas, planos, testes, receita, gasto com IA) para analisar e sugerir ações. Só números: nenhum dado dos clientes das empresas.", "Your AI reads Cronys numbers (companies, plans, trials, revenue, AI spend) to analyze and suggest actions. Numbers only: no data about the companies' clients.")
              : L(`Ligue a IA que você já usa ao Cronys e peça conversando. Ela vê a agenda, ${w.client.lp} e o financeiro, e só grava algo depois de você confirmar. A IA é sua: o Cronys não cobra por isso.`, `Connect the AI you already use to Cronys and ask by chatting. It sees the calendar, ${w.client.lp} and billing, and only saves something after you confirm. The AI is yours: Cronys doesn't charge for it.`)}
          </p>
        </div>
      </div>

      <ul className="space-y-1 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {examples.map(e => <li key={e}>“{e}”</li>)}
      </ul>

      {/* 1. Criar o link */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{L("1. Crie o link de conexão", "1. Create the connection link")}</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor={`ai-label-${platform}`} className="text-xs">{L("Nome (para você saber qual é)", "Name (so you know which one)")}</Label>
            <Input id={`ai-label-${platform}`} value={label} maxLength={60} onChange={e => setLabel(e.target.value)} />
          </div>
          <Button className="gap-1.5 rounded-xl" onClick={create} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} {L("Criar link", "Create link")}
          </Button>
        </div>
        {!platform && (
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={readOnly} onCheckedChange={setReadOnly} aria-label={L("Só leitura", "Read only")} />
            {L("Só leitura: a IA consulta, mas não marca, não registra pagamento e não escreve nada", "Read only: the AI looks things up but doesn't book, record payments or write anything")}
          </label>
        )}
        {created && (
          <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-medium">{L("Seu link (aparece só agora: copie e já cole na IA)", "Your link (shown only now: copy it and paste it into the AI)")}</p>
            <div className="flex gap-2">
              <Input readOnly value={created} className="font-mono text-[11px]" onFocus={e => e.currentTarget.select()} aria-label={L("Link de conexão", "Connection link")} />
              <Button variant="outline" className="shrink-0 gap-1.5 rounded-xl" onClick={copy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {L("Copiar", "Copy")}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {L("Quem tiver este link mexe no seu Cronys: não mande para ninguém. Perdeu ou vazou? Desligue abaixo e crie outro.", "Anyone with this link can act on your Cronys: don't send it to anyone. Lost or leaked? Turn it off below and create another.")}
            </p>
          </div>
        )}
      </div>

      {/* 2. Colar na IA */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{L("2. Cole o link na sua IA", "2. Paste the link into your AI")}</p>
        <Tabs defaultValue="claude">
          <TabsList className="h-8">
            <TabsTrigger value="claude" className="text-xs">Claude</TabsTrigger>
            <TabsTrigger value="chatgpt" className="text-xs">ChatGPT</TabsTrigger>
            <TabsTrigger value="outra" className="text-xs">{L("Outra IA", "Other AI")}</TabsTrigger>
          </TabsList>
          <TabsContent value="claude">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>{L("Entre em claude.ai (no computador é mais fácil) e abra Configurações → Conectores.", "Go to claude.ai (easier on a computer) and open Settings → Connectors.")}</li>
              <li>{L("Clique em “Adicionar conector personalizado”.", "Click “Add custom connector”.")}</li>
              <li>{L("Nome: Cronys. URL: cole o link. Clique em Adicionar (não precisa preencher mais nada).", "Name: Cronys. URL: paste the link. Click Add (nothing else to fill in).")}</li>
              <li>{L("Numa conversa nova, no botão de ferramentas (+), confira se o Cronys está ligado e peça o que quiser.", "In a new chat, in the tools button (+), make sure Cronys is on and ask away.")}</li>
              <li>{L("Na primeira vez que ele for gravar algo, o Claude pede sua permissão. Leia e aprove.", "The first time it saves something, Claude asks your permission. Read and approve.")}</li>
            </ol>
          </TabsContent>
          <TabsContent value="chatgpt">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>{L("No chatgpt.com, abra Configurações → Apps e conectores → Avançado e ligue o “Modo de desenvolvedor” (depende do seu plano do ChatGPT).", "On chatgpt.com, open Settings → Apps & Connectors → Advanced and turn on “Developer mode” (depends on your ChatGPT plan).")}</li>
              <li>{L("Volte em Apps e conectores e clique em Criar.", "Back in Apps & Connectors, click Create.")}</li>
              <li>{L("Nome: Cronys. URL do servidor MCP: cole o link. Autenticação: nenhuma. Marque que confia e crie.", "Name: Cronys. MCP server URL: paste the link. Authentication: none. Confirm you trust it and create.")}</li>
              <li>{L("Numa conversa, escolha o modo de desenvolvedor e ligue o Cronys.", "In a chat, pick developer mode and turn Cronys on.")}</li>
            </ol>
          </TabsContent>
          <TabsContent value="outra">
            <p className="text-xs text-muted-foreground">
              {L("Qualquer IA ou programa que aceite um servidor MCP por HTTP (Claude Code, Cursor, OpenSquad e outros) funciona com este mesmo link. Se pedirem a chave separada, use o final do link (começa com crn_) como “Bearer token”.", "Any AI or app that accepts an MCP server over HTTP (Claude Code, Cursor, OpenSquad and others) works with this same link. If asked for a separate key, use the end of the link (starts with crn_) as a “Bearer token”.")}
            </p>
          </TabsContent>
        </Tabs>
      </div>

      {/* Conexões ativas */}
      {list && list.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{L("Conexões ligadas", "Active connections")}</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {list.map(c => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="truncate font-medium">{c.label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">…{c.token_hint}</span>
                    {c.read_only && <Badge variant="outline" className="text-[10px]">{L("só leitura", "read only")}</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {L("Criada", "Created")} {when(c.created_at)} · {L("último uso", "last used")} {when(c.last_used_at)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-8 rounded-xl text-destructive" onClick={() => revoke(c)}>{L("Desligar", "Turn off")}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

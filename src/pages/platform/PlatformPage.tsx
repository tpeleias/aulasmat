import { PLANS as PLAN_CFG, type PlanId } from "@shared/plans";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Building2, Plus, LogOut, Power, Trash2, ShieldAlert, Copy, Bot, Pencil, Gift, KeyRound, CreditCard, MoreHorizontal, Search, Infinity as InfinityIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AiConnectorSettings from "@/components/AiConnectorSettings";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import ListSkeleton from "@/components/ListSkeleton";
import { CronysWordmark } from "@/components/brand";
import ThemeToggle from "@/components/ThemeToggle";
import StripeLiveCard from "@/components/StripeLiveCard";
import CouponsCard from "@/components/CouponsCard";
import { PRESETS, type BusinessModel } from "@/lib/vocabulary";

type Row = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  is_public_default: boolean;
  created_at: string;
  plan: "essencial" | "start" | "pro_solo" | "pro";
  assistant: boolean;
  assistant_override: boolean | null;
  responsaveis: number;
  alunos: number;
  professores: number;
  // Ausentes antes da migration 20260923020000.
  alunos_travados?: number;
  trial_ends_at?: string | null;
  professores_travados?: number;
  aulas: number;
  logins: number;
  ultima_aula: string | null;
  // Ausentes antes da migration 20260925010000.
  business_model?: string | null;
  billing_status?: string;
  paid_until?: string | null;
  past_due_since?: string | null;
  assistant_messages?: number;
  assistant_cost_usd?: number;
  assistant_monthly_messages?: number;
  assistant_monthly_cost_usd?: number;
  // Ausentes antes da migration 20260925150000.
  tester_until?: string | null;
  tester_assistant?: boolean;
};

const PLANOS = [
  { slug: "essencial", rotulo: "Essencial" },
  { slug: "start", rotulo: "Start" },
  { slug: "pro_solo", rotulo: "Pro" },
  { slug: "pro", rotulo: "Max" },
] as const;
const nomePlano = (p: string) => `Cronys ${(PLAN_CFG[p as PlanId] ?? PLAN_CFG.essencial).name.pt}`;

const slugify = (raw: string) =>
  raw.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

// Robôs de teste da Google Play abrem empresas "Test Business" e não usam nada.
const pareceTeste = (r: Row) => /^test business$/i.test(r.name.trim()) && Number(r.aulas) === 0 && Number(r.alunos) === 0
  && !r.is_public_default && r.billing_status !== "active" && r.billing_status !== "past_due";

type FiltroKey = "todas" | "assinantes" | "testadores" | "desativadas" | "teste";
const FILTROS: { key: FiltroKey; label: string; test: (r: Row) => boolean }[] = [
  { key: "todas", label: "Todas", test: () => true },
  { key: "assinantes", label: "Assinantes", test: r => r.billing_status === "active" || r.billing_status === "past_due" },
  { key: "testadores", label: "Testadores", test: r => !!r.tester_until },
  { key: "desativadas", label: "Desativadas", test: r => !r.active },
  { key: "teste", label: "Robôs de teste", test: pareceTeste },
];

export default function PlatformPage() {
  const { session, loading: authLoading, signOut } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [novaOpen, setNovaOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroKey>("todas");
  const [limparOpen, setLimparOpen] = useState(false);
  const [limparConfirma, setLimparConfirma] = useState("");

  const [excluir, setExcluir] = useState<Row | null>(null);
  const [confirmaNome, setConfirmaNome] = useState("");

  // Redefinir senha de um login (platform-console, ação reset_password).
  const [senhaOpen, setSenhaOpen] = useState(false);
  const [senhaLogin, setSenhaLogin] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [senhaFeita, setSenhaFeita] = useState<{ login: string; password: string; account_name: string | null; role: string | null } | null>(null);

  const [renomear, setRenomear] = useState<Row | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");

  // Switch geral (migration 20260926120000): desligado, o assistente só
  // funciona nas empresas liberadas uma a uma aqui embaixo.
  const [assistenteGeral, setAssistenteGeral] = useState<boolean | null>(null);
  // Vitalícias (migrations 20261010050000/060000): Max para sempre; o assistente segue no switch.
  const [vitalicias, setVitalicias] = useState<Set<string>>(new Set());

  const load = async () => {
    supabase.rpc("assistant_enabled_for_plans" as never).then(({ data }) => setAssistenteGeral(data === true));
    supabase.rpc("platform_lifetime_accounts" as never).then(({ data, error }) => {
      if (!error && Array.isArray(data)) setVitalicias(new Set((data as unknown[]).map(x => String(typeof x === "object" && x ? Object.values(x)[0] : x))));
    });
    const { data, error } = await supabase.rpc("platform_accounts_overview");
    if (error) { toast.error(error.message); setLoading(false); return; }
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || !session) return;
    supabase.rpc("is_platform_admin").then(({ data }) => {
      const ok = data === true;
      setAllowed(ok);
      if (ok) load(); else setLoading(false);
    });
  }, [authLoading, session]);

  if (authLoading) return null;
  if (!session) return <Navigate to="/entrar" replace />;

  if (allowed === false) return (
    <div className="flex min-h-dvh flex-1 items-center justify-center p-6 text-center">
      <div>
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="mb-1 text-xl font-semibold">Acesso restrito</h2>
        <p className="text-muted-foreground">Esta conta não é operadora da plataforma.</p>
        <Button className="mt-4" onClick={signOut}>Sair</Button>
      </div>
    </div>
  );

  const criar = async () => {
    if (!nome.trim()) { toast.error("Informe o nome da empresa"); return; }
    if (senha.length < 8) { toast.error("A senha do admin deve ter ao menos 8 caracteres"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("platform-console", {
      body: { action: "create_account", name: nome.trim(), slug: slug.trim(), login: login.trim(), password: senha },
    });
    setBusy(false);
    const erro = error?.message ?? (data as { error?: string })?.error;
    if (erro) { toast.error(erro); return; }
    toast.success(`"${nome.trim()}" criada. O admin já pode entrar.`);
    setNovaOpen(false);
    setNome(""); setSlug(""); setSlugTocado(false); setLogin(""); setSenha("");
    load();
  };

  const alternarAtiva = async (r: Row) => {
    if (r.active && !confirm(
      `Desativar "${r.name}"?\n\nA empresa sai do ar e os logins dela param de enxergar qualquer coisa. Nada é apagado, e dá para religar a qualquer momento.`
    )) return;
    setBusy(true);
    const { error } = await supabase.rpc("platform_set_account_active", { _account: r.id, _active: !r.active });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(r.active ? `"${r.name}" desativada` : `"${r.name}" reativada`);
    load();
  };

  const alternarVitalicio = async (r: Row) => {
    const ligar = !vitalicias.has(r.id);
    if (!confirm(ligar
      ? `Tornar "${r.name}" vitalícia?\n\nFica no Max para sempre: fim de teste, fim de cortesia ou assinatura cancelada não rebaixam. O assistente continua com você (ligar, desligar e limitar).`
      : `Tirar o vitalício de "${r.name}"?\n\nO plano continua Max por enquanto, mas volta a poder mudar (pelo painel ou pela assinatura).`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("platform_set_lifetime" as never, { _account: r.id, _on: ligar } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(ligar ? `"${r.name}" agora é vitalícia (Max)` : `"${r.name}" não é mais vitalícia`);
    load();
  };

  const mudarPlano = async (r: Row, plano: Row["plan"]) => {
    if (plano === r.plan) return;
    // Rebaixar acima do limite de profissionais pausa todos eles, e o dono
    // escolhe quem volta. Clientes nunca são pausados: o limite é de clientes
    // ATIVOS e só barra cliente novo (migration 20260926100000).
    const maxT = PLAN_CFG[plano as PlanId].maxTeachers;
    if (maxT !== null && r.professores > maxT
        && !confirm(`Passar "${r.name}" para o ${PLAN_CFG[plano as PlanId].name.pt}?\n\nos ${r.professores} profissionais ativos ficam pausados (o dono reativa até ${maxT}). Nada é apagado.`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("platform_set_account_plan", { _account: r.id, _plan: plano });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const res = (data ?? {}) as Record<string, number>;
    const pausados = (res.alunos_travados ?? 0) + (res.professores_travados ?? 0);
    const liberados = (res.alunos_liberados ?? 0) + (res.professores_liberados ?? 0);
    toast.success(`"${r.name}" agora é ${nomePlano(plano)}`
      + (pausados ? ` · ${pausados} pausado(s)` : "") + (liberados ? ` · ${liberados} liberado(s)` : ""));
    load();
  };

  // O assistente não vem com plano nenhum: só funciona para quem o gestor
  // liberar aqui (migration 20260924070000). O switch grava sempre ligado ou
  // desligado, explícito.
  const alternarAssistente = async (r: Row) => {
    setBusy(true);
    const proximo = !r.assistant;
    const { error } = await supabase.rpc("platform_set_account_plan", {
      _account: r.id,
      _assistant_override: proximo,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Assistente ${proximo ? "liberado" : "bloqueado"} para "${r.name}"`);
    load();
  };

  const alternarAssistenteGeral = async () => {
    const proximo = !assistenteGeral;
    if (proximo && !confirm(
      "Liberar o assistente pelos planos?\n\nA IA do Pro, a do Max e o adicional passam a funcionar (e o adicional volta a ser vendido). Cada conversa custa API."
    )) return;
    setBusy(true);
    const { error } = await supabase.rpc("platform_set_assistant_enabled" as never, { _on: proximo } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(proximo ? "Assistente liberado pelos planos" : "Assistente bloqueado em todos os planos");
    load();
  };

  // Limite do assistente: mensagens (o que o cliente vê) e teto em dólar.
  // Testador: Max de cortesia por N dias, com ou sem assistente. No fim a
  // empresa volta sozinha ao Essencial (expire_testers), se não assinou.
  const definirTestador = async (r: Row) => {
    const atual = r.tester_until ? ` (hoje vai até ${new Date(r.tester_until).toLocaleDateString("pt-BR")})` : "";
    const dias = prompt(`Max de cortesia para "${r.name}" por quantos dias?${atual}\n\n0 tira a cortesia agora.`, r.tester_until ? "0" : "30");
    if (dias === null) return;
    const n = Math.round(Number(dias));
    if (!(n >= 0)) { toast.error("Número de dias inválido"); return; }
    const comAssistente = n > 0 && confirm(`Incluir o assistente na cortesia de "${r.name}"?\n\nOK = com assistente (custa API) · Cancelar = sem.`);
    setBusy(true);
    const { error } = await supabase.rpc("platform_set_tester" as never, { _account: r.id, _days: n, _assistant: comAssistente } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(n > 0 ? `"${r.name}" é testador por ${n} dias${comAssistente ? ", com assistente" : ""}` : `Cortesia de "${r.name}" encerrada`);
    load();
  };

  const mudarLimiteAssistente = async (r: Row) => {
    const msgs = prompt(`Mensagens do assistente por mês para "${r.name}":`, String(r.assistant_monthly_messages ?? 150));
    if (msgs === null) return;
    const teto = prompt(`Teto de custo por mês, em dólar (uso atual: US$ ${Number(r.assistant_cost_usd ?? 0).toFixed(2)}):`, String(r.assistant_monthly_cost_usd ?? 5));
    if (teto === null) return;
    const m = Math.round(Number(msgs)), c = Number(String(teto).replace(",", "."));
    if (!(m >= 0) || !(c >= 0)) { toast.error("Números inválidos"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("platform_set_assistant_limits" as never, { _account: r.id, _messages: m, _cost_usd: c } as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Limite de "${r.name}": ${m} mensagens, US$ ${c.toFixed(2)}`);
    load();
  };

  const redefinirSenha = async () => {
    if (!senhaLogin.trim()) { toast.error("Informe o login"); return; }
    if (senhaNova && senhaNova.length < 8) { toast.error("A senha nova deve ter ao menos 8 caracteres"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("platform-console", {
      body: { action: "reset_password", login: senhaLogin.trim(), password: senhaNova },
    });
    setBusy(false);
    let erro = (data as { error?: string })?.error;
    if (!erro && error) {
      // Resposta 4xx: a mensagem de verdade vem no corpo.
      const ctx = (error as { context?: Response }).context;
      erro = (await ctx?.json?.().catch(() => null))?.error ?? error.message;
    }
    if (erro) { toast.error(erro); return; }
    setSenhaFeita(data as NonNullable<typeof senhaFeita>);
  };

  const fecharSenha = () => { setSenhaOpen(false); setSenhaLogin(""); setSenhaNova(""); setSenhaFeita(null); };

  const confirmarRenome = async () => {
    if (!renomear || !nomeNovo.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("platform_rename_account", {
      _account: renomear.id, _name: nomeNovo.trim(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Agora se chama "${nomeNovo.trim()}"`);
    setRenomear(null);
    setNomeNovo("");
    load();
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("platform-console", {
      body: { action: "delete_account", account_id: excluir.id, confirm_name: confirmaNome.trim() },
    });
    setBusy(false);
    const erro = error?.message ?? (data as { error?: string })?.error;
    if (erro) { toast.error(erro); return; }
    toast.success(`"${excluir.name}" excluída. Uma cópia de tudo ficou guardada no arquivo.`);
    setExcluir(null);
    setConfirmaNome("");
    load();
  };

  const total = rows.reduce((s, r) => ({
    empresas: s.empresas + (r.active ? 1 : 0),
    assinantes: s.assinantes + (r.billing_status === "active" || r.billing_status === "past_due" ? 1 : 0),
    alunos: s.alunos + Number(r.alunos),
    aulas: s.aulas + Number(r.aulas),
  }), { empresas: 0, assinantes: 0, alunos: 0, aulas: 0 });

  const q = busca.trim().toLowerCase();
  const filtroAtual = FILTROS.find(f => f.key === filtro) ?? FILTROS[0];
  const visiveis = rows.filter(r => filtroAtual.test(r) && (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
  const testes = rows.filter(pareceTeste);

  // Excluir de uma vez as empresas dos robôs da Play: desativa e exclui cada
  // uma pelo mesmo caminho do botão de excluir (com a cópia no arquivo).
  const limparTestes = async () => {
    setBusy(true);
    let ok = 0;
    const falhas: string[] = [];
    for (const r of testes) {
      if (r.active) {
        const { error } = await supabase.rpc("platform_set_account_active", { _account: r.id, _active: false });
        if (error) { falhas.push(r.slug); continue; }
      }
      const { data, error } = await supabase.functions.invoke("platform-console", {
        body: { action: "delete_account", account_id: r.id, confirm_name: r.name },
      });
      if (error || (data as { error?: string })?.error) falhas.push(r.slug); else ok++;
    }
    setBusy(false);
    setLimparOpen(false);
    if (falhas.length) toast.error(`${ok} excluída(s); não deu em: ${falhas.join(", ")}`);
    else toast.success(`${ok} empresa(s) de teste excluída(s). A cópia ficou no arquivo.`);
    load();
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <CronysWordmark className="h-6" />
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Building2 className="h-2.5 w-2.5" /> Gestor da plataforma
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={signOut} title="Sair"><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 p-4 pb-16">
        <div>
          <h1 className="text-2xl font-bold">Gestor da plataforma</h1>
          <p className="text-sm text-muted-foreground">Você vê só contagens: nome de aluno, agenda e financeiro de cada empresa não chegam aqui (a trava está no banco).</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Empresas ativas", value: total.empresas },
            { label: "Assinantes", value: total.assinantes },
            { label: "Alunos", value: total.alunos },
            { label: "Aulas", value: total.aulas },
          ].map(t => (
            <Card key={t.label} className="rounded-2xl p-3">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="text-2xl font-bold tabular-nums">{t.value}</div>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="empresas" className="space-y-4">
          <TabsList className="w-full justify-start overflow-x-auto rounded-xl">
            <TabsTrigger value="empresas" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Empresas</TabsTrigger>
            <TabsTrigger value="assinaturas" className="gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Assinaturas e cupons</TabsTrigger>
            <TabsTrigger value="assistente" className="gap-1.5"><Bot className="h-3.5 w-3.5" /> Assistente e IA</TabsTrigger>
          </TabsList>

          <TabsContent value="empresas" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa" aria-label="Buscar empresa" className="h-10 rounded-xl pl-9" />
              </div>
              <Button variant="outline" className="h-10 gap-1 rounded-xl" onClick={() => setSenhaOpen(true)}>
                <KeyRound className="h-4 w-4" /> Redefinir senha
              </Button>
              <Button className="h-10 gap-1 rounded-xl" onClick={() => setNovaOpen(true)}>
                <Plus className="h-4 w-4" /> Nova empresa
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTROS.map(f => (
                <button key={f.key} type="button" onClick={() => setFiltro(f.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filtro === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>
                  {f.label} <span className="tabular-nums opacity-70">{rows.filter(f.test).length}</span>
                </button>
              ))}
            </div>

            {testes.length > 0 && (
              <Card className="flex flex-wrap items-center gap-3 rounded-2xl border-warning/40 bg-warning/10 p-3">
                <Bot className="h-5 w-5 shrink-0 text-warning" />
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{testes.length} empresa{testes.length === 1 ? "" : "s"} "Test Business" sem nenhum uso</span>
                  <span className="block text-xs text-muted-foreground">Criadas pelos robôs de teste da Google Play. Dá para excluir todas de uma vez (fica uma cópia no arquivo).</span>
                </p>
                <Button size="sm" variant="destructive" className="rounded-xl" disabled={busy} onClick={() => { setLimparOpen(true); setLimparConfirma(""); }}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir todas
                </Button>
              </Card>
            )}

            {loading ? <ListSkeleton rows={3} /> : visiveis.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma empresa aqui.</p>
            ) : (
              <div className="space-y-2">
                {visiveis.map(r => (
                  <Card key={r.id} className={`rounded-2xl p-4 ${r.active ? "" : "bg-muted/30"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`font-semibold ${r.active ? "" : "text-muted-foreground"}`}>{r.name}</span>
                          {!r.active && <Badge variant="outline" className="text-[10px]">Desativada</Badge>}
                          {r.is_public_default && <Badge variant="secondary" className="text-[10px]">Endereço público</Badge>}
                          {vitalicias.has(r.id) && <Badge className="gap-1 text-[10px]"><InfinityIcon className="h-3 w-3" /> Vitalícia · Max</Badge>}
                          {r.tester_until && <Badge variant="secondary" className="text-[10px]">Testador até {new Date(r.tester_until).toLocaleDateString("pt-BR")}{r.tester_assistant ? " · com assistente" : ""}</Badge>}
                          {r.trial_ends_at && r.plan === "pro" && <Badge variant="outline" className="text-[10px]">Teste até {new Date(r.trial_ends_at).toLocaleDateString("pt-BR")}</Badge>}
                          {r.billing_status === "active" && <Badge className="text-[10px]">Assinante{r.paid_until ? ` até ${new Date(r.paid_until).toLocaleDateString("pt-BR")}` : ""}</Badge>}
                          {r.billing_status === "past_due" && <Badge variant="destructive" className="text-[10px]">Em atraso desde {r.past_due_since ? new Date(r.past_due_since).toLocaleDateString("pt-BR") : "?"}</Badge>}
                          {r.billing_status === "canceled" && <Badge variant="outline" className="text-[10px]">Cancelou</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.slug} · desde {format(new Date(r.created_at), "dd/MM/yyyy", { locale: ptBR })}
                          {r.business_model !== undefined && ` · ${r.business_model ? (PRESETS[r.business_model as BusinessModel]?.nome ?? r.business_model) : "ramo não escolhido"}`}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-xl" aria-label={`Ações de ${r.name}`} disabled={busy}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl">
                          <DropdownMenuItem onClick={() => { setRenomear(r); setNomeNovo(r.name); }}><Pencil className="mr-2 h-4 w-4" /> Renomear</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => alternarVitalicio(r)}><InfinityIcon className="mr-2 h-4 w-4" /> {vitalicias.has(r.id) ? "Tirar o vitalício" : "Tornar vitalícia (Max para sempre)"}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => definirTestador(r)}><Gift className="mr-2 h-4 w-4" /> {r.tester_until ? "Mudar ou encerrar a cortesia" : "Tornar testador (Max de cortesia)"}</DropdownMenuItem>
                          {r.assistant_monthly_messages !== undefined && (
                            <DropdownMenuItem onClick={() => mudarLimiteAssistente(r)}><Bot className="mr-2 h-4 w-4" /> Limite do assistente</DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={r.is_public_default} onClick={() => alternarAtiva(r)}>
                            <Power className="mr-2 h-4 w-4" /> {r.active ? "Desativar" : "Reativar"}
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={r.active || r.is_public_default} className="text-destructive focus:text-destructive"
                            onClick={() => { setExcluir(r); setConfirmaNome(""); }}>
                            <Trash2 className="mr-2 h-4 w-4" /> {r.active ? "Excluir (desative antes)" : "Excluir"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {[
                        { label: "Alunos", value: r.alunos, extra: Number(r.alunos_travados) > 0 ? `${r.alunos_travados} pausado(s)` : "" },
                        { label: "Responsáveis", value: r.responsaveis, extra: "" },
                        { label: "Profissionais", value: r.professores, extra: Number(r.professores_travados) > 0 ? `${r.professores_travados} pausado(s)` : "" },
                        { label: "Aulas", value: r.aulas, extra: r.ultima_aula ? `última ${format(new Date(r.ultima_aula), "dd/MM", { locale: ptBR })}` : "" },
                        { label: "Logins", value: r.logins, extra: "" },
                      ].map(m => (
                        <div key={m.label} className="rounded-xl bg-muted/40 px-2 py-1.5">
                          <div className="text-[11px] text-muted-foreground">{m.label}</div>
                          <div className="font-semibold tabular-nums">{m.value}</div>
                          {m.extra && <div className="text-[10px] text-muted-foreground">{m.extra}</div>}
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label={`Plano de ${r.name}`}>
                        {PLANOS.map(({ slug: pl, rotulo }) => (
                          <button key={pl} type="button" disabled={busy || vitalicias.has(r.id)} title={vitalicias.has(r.id) ? "Vitalícia: tire o vitalício no menu ⋯ para mudar o plano" : undefined} onClick={() => mudarPlano(r, pl)} aria-pressed={r.plan === pl}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${r.plan === pl ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                            {rotulo}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Assistente
                        {r.assistant_monthly_messages !== undefined && r.assistant && (
                          <span className="tabular-nums">{r.assistant_messages ?? 0}/{r.assistant_monthly_messages} msg</span>
                        )}
                        <Switch checked={r.assistant} disabled={busy} onCheckedChange={() => alternarAssistente(r)} aria-label={`Assistente de ${r.name}`} />
                      </label>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="assinaturas" className="space-y-3">
            <StripeLiveCard />
            <CouponsCard />
          </TabsContent>

          <TabsContent value="assistente" className="space-y-3">
            <Card className="flex items-center gap-3 rounded-xl p-3">
              <Bot className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">Assistente pelos planos</p>
                <p className="text-xs text-muted-foreground">
                  {assistenteGeral
                    ? "Ligado: a IA do Pro, a do Max e o adicional funcionam, e o adicional está à venda."
                    : "Desligado: bloqueado em todos os planos. Só funciona nas empresas que você liberar uma a uma na aba Empresas (o Portal de Aulas fica sempre liberado)."}
                </p>
              </div>
              <Switch checked={assistenteGeral === true} disabled={busy || assistenteGeral === null}
                onCheckedChange={alternarAssistenteGeral} aria-label="Assistente pelos planos" />
            </Card>
            <AiConnectorSettings platform />
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={novaOpen} onOpenChange={v => !v && setNovaOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Nova empresa</DialogTitle>
            <DialogDescription>
              A empresa nasce com o login do primeiro administrador dela, que entra
              pela mesma tela de sempre e já encontra tudo vazio e só dele.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome da empresa</Label>
              <Input
                className="h-11 rounded-xl" value={nome}
                onChange={e => { setNome(e.target.value); if (!slugTocado) setSlug(slugify(e.target.value)); }}
                placeholder="Ex.: Aulas da Mayara"
              />
            </div>
            <div>
              <Label>Apelido</Label>
              <Input
                className="h-11 rounded-xl" value={slug}
                onChange={e => { setSlugTocado(true); setSlug(e.target.value.toLowerCase()); }}
                placeholder="aulas-da-mayara"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                De 3 a 32 caracteres: letras minúsculas, números e hífen. É ele que
                vira o endereço próprio da empresa quando houver domínio.
              </p>
            </div>
            <div className="rounded-xl border border-border p-3 space-y-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Primeiro administrador</p>
              <div>
                <Label>Login</Label>
                <Input
                  className="h-11 rounded-xl" value={login} autoCapitalize="none" autoCorrect="off"
                  onChange={e => setLogin(e.target.value)} placeholder="email@dela.com"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Um e-mail, de preferência — é por ele que ela recupera a senha
                  sozinha. Sem e-mail, vale um apelido (ex.: <code>mayara</code>).
                </p>
              </div>
              <div>
                <Label>Senha provisória</Label>
                <Input
                  type="text" className="h-11 rounded-xl font-mono" value={senha}
                  onChange={e => setSenha(e.target.value)} placeholder="ao menos 8 caracteres"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Você combina essa senha com ela. Fica visível aqui de propósito,
                  para não ser digitada errada — copie antes de fechar.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setNovaOpen(false)}>Cancelar</Button>
            <Button className="rounded-xl" onClick={criar} disabled={busy}>Criar empresa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={senhaOpen} onOpenChange={v => !v && fecharSenha()}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              Para quem não consegue entrar: troca a senha de qualquer login (admin,
              profissional ou cliente). A senha antiga deixa de valer na hora.
            </DialogDescription>
          </DialogHeader>
          {senhaFeita ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-muted/60 p-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {senhaFeita.login}{senhaFeita.account_name ? ` · ${senhaFeita.account_name}` : ""}{senhaFeita.role ? ` · ${senhaFeita.role}` : ""}
                </p>
                <p className="mt-1 font-mono text-lg">{senhaFeita.password}</p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { navigator.clipboard?.writeText(senhaFeita.password); toast.success("Senha copiada"); }}
              >
                <Copy className="h-3 w-3" /> copiar a senha
              </button>
              <p className="text-[11px] text-muted-foreground">
                Passe essa senha para a pessoa e peça que troque depois, em Minha conta.
                Ela não aparece de novo.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Login</Label>
                <Input
                  className="h-11 rounded-xl" value={senhaLogin} autoCapitalize="none" autoCorrect="off" autoFocus
                  onChange={e => setSenhaLogin(e.target.value)} placeholder="email@dela.com ou usuário"
                />
              </div>
              <div>
                <Label>Senha nova (opcional)</Label>
                <Input
                  type="text" className="h-11 rounded-xl font-mono" value={senhaNova}
                  onChange={e => setSenhaNova(e.target.value)} placeholder="em branco = gerar uma"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {senhaFeita ? (
              <Button className="rounded-xl" onClick={fecharSenha}>Pronto</Button>
            ) : (
              <>
                <Button variant="outline" className="rounded-xl" onClick={fecharSenha}>Cancelar</Button>
                <Button className="rounded-xl" onClick={redefinirSenha} disabled={busy || !senhaLogin.trim()}>Redefinir</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renomear} onOpenChange={v => !v && setRenomear(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Renomear empresa</DialogTitle>
            <DialogDescription>
              O nome é o que aparece para quem usa. O apelido
              (<code>{renomear?.slug}</code>) não muda: é ele que vira o endereço
              próprio da empresa, e trocar endereço quebra link já divulgado.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Nome</Label>
            <Input
              className="h-11 rounded-xl" value={nomeNovo} autoFocus
              onChange={e => setNomeNovo(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && nomeNovo.trim()) confirmarRenome(); }}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setRenomear(null)}>Cancelar</Button>
            <Button className="rounded-xl" onClick={confirmarRenome} disabled={busy || !nomeNovo.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={limparOpen} onOpenChange={v => !v && setLimparOpen(false)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Excluir {testes.length} empresa{testes.length === 1 ? "" : "s"} de teste</DialogTitle>
            <DialogDescription>
              Todas se chamam "Test Business" e não têm aluno nem aula. Os logins delas saem junto, e uma cópia de tudo fica no arquivo.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 overflow-y-auto rounded-xl bg-muted/50 p-2 text-xs">
            {testes.map(r => <li key={r.id}>{r.name} · {r.slug} · desde {format(new Date(r.created_at), "dd/MM", { locale: ptBR })}</li>)}
          </ul>
          <div>
            <Label htmlFor="limpar-confirma">Digite EXCLUIR para confirmar</Label>
            <Input id="limpar-confirma" className="h-11 rounded-xl" value={limparConfirma} onChange={e => setLimparConfirma(e.target.value)} autoCapitalize="characters" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setLimparOpen(false)}>Cancelar</Button>
            <Button variant="destructive" className="rounded-xl" disabled={busy || limparConfirma.trim().toUpperCase() !== "EXCLUIR"} onClick={limparTestes}>
              {busy ? "Excluindo…" : "Excluir todas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!excluir} onOpenChange={v => !v && setExcluir(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-destructive">Excluir {excluir?.name}</DialogTitle>
            <DialogDescription>
              Isso apaga as {excluir?.aulas} aula(s), {excluir?.alunos} aluno(s), o
              financeiro e os {excluir?.logins} login(s) desta empresa.
            </DialogDescription>
          </DialogHeader>
          {excluir && (
            <div className="space-y-3">
              <div className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                Antes de apagar qualquer coisa, o sistema guarda uma cópia de tudo
                num arquivo interno que nem esta tela alcança. Se for engano, dá
                para recuperar pelo painel do Supabase — mas os logins, esses não
                voltam.
              </div>
              <div>
                <Label>Digite <strong className="text-foreground">{excluir.name}</strong> para confirmar</Label>
                <Input
                  className="h-11 rounded-xl" value={confirmaNome} autoCapitalize="none" autoCorrect="off"
                  onChange={e => setConfirmaNome(e.target.value)} placeholder={excluir.name}
                />
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => { navigator.clipboard?.writeText(excluir.name); toast.success("Nome copiado"); }}
              >
                <Copy className="h-3 w-3" /> copiar o nome
              </button>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setExcluir(null)}>Cancelar</Button>
            <Button
              variant="destructive" className="rounded-xl"
              disabled={busy || confirmaNome.trim() !== excluir?.name}
              onClick={confirmarExclusao}
            >
              Excluir para sempre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

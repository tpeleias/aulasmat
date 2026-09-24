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
import { Building2, Plus, LogOut, Power, Trash2, ShieldAlert, Copy, Bot, Pencil } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import ListSkeleton from "@/components/ListSkeleton";
import { CronysWordmark } from "@/components/brand";
import ThemeToggle from "@/components/ThemeToggle";

type Row = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  is_public_default: boolean;
  created_at: string;
  plan: "essencial" | "pro";
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
};

const slugify = (raw: string) =>
  raw.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

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

  const [excluir, setExcluir] = useState<Row | null>(null);
  const [confirmaNome, setConfirmaNome] = useState("");

  const [renomear, setRenomear] = useState<Row | null>(null);
  const [nomeNovo, setNomeNovo] = useState("");

  const load = async () => {
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
  if (!session) return <Navigate to="/auth" replace />;

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

  const mudarPlano = async (r: Row, plano: "essencial" | "pro") => {
    if (plano === r.plan) return;
    // Rebaixar acima do limite pausa TODOS os alunos (ou professores) dela, e o
    // dono escolhe quem liberar - não é mais só "trava o próximo cadastro".
    // Os números 5 e 1 são os de plan_features('essencial').
    if (plano === "essencial") {
      const avisos = [
        r.alunos > 5 && `os ${r.alunos} alunos ficam pausados (o dono libera até 5)`,
        r.professores > 1 && `os ${r.professores} professores ativos ficam pausados (o dono reativa 1)`,
      ].filter(Boolean);
      if (avisos.length && !confirm(`Rebaixar "${r.name}" para o Essencial?\n\n${avisos.join("\n")}\n\nNada é apagado, e voltar para o Pro libera tudo.`)) return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("platform_set_account_plan", { _account: r.id, _plan: plano });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const res = (data ?? {}) as Record<string, number>;
    const pausados = (res.alunos_travados ?? 0) + (res.professores_travados ?? 0);
    const liberados = (res.alunos_liberados ?? 0) + (res.professores_liberados ?? 0);
    toast.success(`"${r.name}" agora e ${plano === "pro" ? "Cronys Pro" : "Cronys Essencial"}`
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
    pro: s.pro + (r.plan === "pro" ? 1 : 0),
    empresas: s.empresas + (r.active ? 1 : 0),
    alunos: s.alunos + Number(r.alunos),
    responsaveis: s.responsaveis + Number(r.responsaveis),
  }), { pro: 0, empresas: 0, alunos: 0, responsaveis: 0 });

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

      <main className="mx-auto max-w-5xl space-y-6 p-4 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Empresas</h1>
            <p className="text-sm text-muted-foreground">
              {total.empresas} ativa{total.empresas === 1 ? "" : "s"} · {total.pro} no Pro · {total.alunos} aluno
              {total.alunos === 1 ? "" : "s"} · {total.responsaveis} responsáve
              {total.responsaveis === 1 ? "l" : "is"} no total
            </p>
          </div>
          <Button className="gap-1 rounded-xl" onClick={() => setNovaOpen(true)}>
            <Plus className="h-4 w-4" /> Nova empresa
          </Button>
        </div>

        <Card className="rounded-xl border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          Esta conta não pertence a nenhuma empresa, então ela só enxerga as
          contagens abaixo. Nome de aluno, agenda e financeiro de cada empresa
          não chegam até aqui — a trava está no banco, não nesta tela.
          <br />
          <span className="mt-1 inline-flex items-center gap-1">
            <Bot className="h-3 w-3" /> O Assistente fica bloqueado em qualquer plano,
            inclusive no Pro e no teste: só funciona para a empresa que você
            <strong className="text-foreground">liberar</strong> aqui.
          </span>
        </Card>

        {loading ? <ListSkeleton rows={3} /> : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Empresa</th>
                  <th className="px-3 py-2.5 text-left font-medium">Plano</th>
                  <th className="px-3 py-2.5 text-center font-medium">Assistente</th>
                  <th className="px-3 py-2.5 text-right font-medium">Responsáveis</th>
                  <th className="px-3 py-2.5 text-right font-medium">Alunos</th>
                  <th className="px-3 py-2.5 text-right font-medium">Professores</th>
                  <th className="px-3 py-2.5 text-right font-medium">Aulas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Logins</th>
                  <th className="px-3 py-2.5 text-left font-medium">Última aula</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => (
                  <tr key={r.id} className={r.active ? "" : "bg-muted/30 text-muted-foreground"}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="group inline-flex items-center gap-1 text-left font-medium text-foreground hover:text-primary"
                          title="Renomear"
                          onClick={() => { setRenomear(r); setNomeNovo(r.name); }}
                        >
                          {r.name}
                          <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                        </button>
                        {!r.active && <Badge variant="outline" className="text-[10px]">Desativada</Badge>}
                        {r.is_public_default && <Badge variant="secondary" className="text-[10px]">Endereço público</Badge>}
                        {r.trial_ends_at && r.plan === "pro" && <Badge variant="outline" className="text-[10px]">Teste até {new Date(r.trial_ends_at).toLocaleDateString("pt-BR")}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.slug} · desde {format(new Date(r.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex rounded-lg border border-border p-0.5">
                        {(["essencial", "pro"] as const).map(pl => (
                          <button
                            key={pl} type="button" disabled={busy}
                            onClick={() => mudarPlano(r, pl)}
                            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                              r.plan === pl ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                            {pl === "pro" ? "Pro" : "Essencial"}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-center gap-0.5">
                        <Switch checked={r.assistant} disabled={busy} onCheckedChange={() => alternarAssistente(r)} />
                        {r.assistant && (
                          <span className="text-[9px] uppercase tracking-wide text-primary">liberado</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.responsaveis}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.alunos}
                      {Number(r.alunos_travados) > 0 && <div className="text-[10px] text-warning">{r.alunos_travados} pausado{Number(r.alunos_travados) === 1 ? "" : "s"}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.professores}
                      {Number(r.professores_travados) > 0 && <div className="text-[10px] text-warning">{r.professores_travados} pausado{Number(r.professores_travados) === 1 ? "" : "s"}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.aulas}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.logins}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.ultima_aula ? format(new Date(r.ultima_aula), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8" disabled={busy || r.is_public_default}
                          title={r.is_public_default ? "A empresa do endereço público não pode ser desativada" : (r.active ? "Desativar" : "Reativar")}
                          onClick={() => alternarAtiva(r)}
                        >
                          <Power className={`h-3.5 w-3.5 ${r.active ? "" : "text-success"}`} />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={busy || r.active || r.is_public_default}
                          title={r.active ? "Desative a empresa antes de excluir" : "Excluir"}
                          onClick={() => { setExcluir(r); setConfirmaNome(""); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

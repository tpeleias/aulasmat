import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Wallet, FolderOpen, ListChecks, UserPlus, KeyRound } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { PaymentMethods } from "@/components/PaymentMethods";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function StudentDashboard() {
  const { student, loading } = useStudent();

  const settings = useAppSettings();
  const [lessons, setLessons] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [homework, setHomework] = useState<any[]>([]);

  useEffect(() => {
    if (!student) return;
    const loadLessons = () => supabase.from("lessons").select("*").eq("student_name", student.student_name).order("start_at", { ascending: false }).then(({ data }) => setLessons(data ?? []));
    const loadTxs = () => supabase.from("wallet_transactions").select("*").eq("student_name", student.student_name).order("created_at", { ascending: false }).then(({ data }) => setTxs(data ?? []));
    const loadHw = () => supabase.from("homework").select("*").eq("student_id", student.id).order("deadline").then(({ data }) => setHomework(data ?? []));
    loadLessons(); loadTxs(); loadHw();

    const channel = supabase
      .channel(`student-dash-${student.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lessons", filter: `student_name=eq.${student.student_name}` }, loadLessons)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_transactions", filter: `student_name=eq.${student.student_name}` }, loadTxs)
      .on("postgres_changes", { event: "*", schema: "public", table: "homework", filter: `student_id=eq.${student.id}` }, loadHw)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [student]);

  const now = new Date();
  const upcoming = lessons.filter(l => new Date(l.start_at) >= now);
  const past = lessons.filter(l => new Date(l.start_at) < now);
  const pending = lessons.filter(l => l.payment_status === "pendente");
  const balance = useMemo(() => txs.reduce((s, t) => s + Number(t.amount), 0), [txs]);
  const dueHomework = homework.filter(h => h.status !== "entregue");

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!student) return (
    <Card className="p-6">
      <h2 className="font-semibold mb-2">Conta sem vínculo</h2>
      <p className="text-sm text-muted-foreground">Avise o professor para vincular sua conta a um aluno cadastrado.</p>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá, {student.student_name.split(" ")[0]} 👋</h1>
        <p className="text-sm text-muted-foreground">Aqui está um resumo das suas aulas e tarefas.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Calendar} label="Próximas aulas" value={upcoming.length} href="/aluno/aulas" />
        <StatCard icon={Wallet} label="Saldo" value={fmt(balance)} href="/aluno/financeiro" tone={balance < 0 ? "destructive" : "default"} />
        <StatCard icon={ListChecks} label="Tarefas pendentes" value={dueHomework.length} href="/aluno/tarefas" />
        <StatCard icon={FolderOpen} label="Materiais" value="Acessar" href="/aluno/materiais" />
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">Próximas aulas</h2>
        {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma aula agendada.</p>}
        {upcoming.slice(0, 5).map(l => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 first:border-0 first:pt-0">
            <div>
              <div className="text-sm font-medium">{format(new Date(l.start_at), "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}</div>
              <div className="text-xs text-muted-foreground">{l.subject ?? "Aula"} · {l.duration_minutes} min · Prof. {capitalize(l.teacher)}</div>
            </div>
            <WhatsAppButton teacher={l.teacher} settings={settings} message={`Olá! Sobre a aula em ${format(new Date(l.start_at), "dd/MM HH:mm")}`} />
          </div>
        ))}
      </Card>

      {pending.length > 0 && (
        <Card className="p-5 space-y-3 border-destructive/40">
          <h2 className="font-semibold text-destructive">Pagamentos pendentes</h2>
          {pending.slice(0, 5).map(l => (
            <div key={l.id} className="flex items-center justify-between text-sm border-t border-border pt-2 first:border-0 first:pt-0">
              <span>{format(new Date(l.start_at), "dd/MM HH:mm")}</span>
              <Badge variant="destructive">{fmt(l.price)}</Badge>
            </div>
          ))}
          {settings?.show_payment_info_to_students && (settings.pix_key || settings.payment_link) && (
            <div className="rounded-md bg-muted p-3 space-y-2 text-sm">
              {settings.pix_key && (
                <div className="flex items-center justify-between gap-2">
                  <div><div className="text-xs text-muted-foreground">Chave PIX</div><div className="font-mono">{settings.pix_key}</div></div>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(settings.pix_key!); toast.success("PIX copiado"); }}><Copy className="w-4 h-4" /></Button>
                </div>
              )}
              {settings.payment_link && (
                <Button asChild className="w-full"><a href={settings.payment_link} target="_blank" rel="noopener noreferrer">Pagar pelo link</a></Button>
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">Últimas aulas realizadas</h2>
        {past.slice(0, 5).map(l => (
          <div key={l.id} className="border-t border-border pt-2 first:border-0 first:pt-0">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{format(new Date(l.start_at), "dd/MM 'às' HH:mm", { locale: ptBR })}</div>
              <Badge variant={l.status === "realizada" ? "default" : "secondary"}>{l.status ?? "agendada"}</Badge>
            </div>
            {l.class_summary && (
              <div className="text-xs text-muted-foreground mt-1 italic">📝 {l.class_summary}</div>
            )}
          </div>
        ))}
        {past.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma aula realizada ainda.</p>}
      </Card>

      <ChildAccessCard student={student} />
    </div>
  );
}

function ChildAccessCard({ student }: { student: any }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(student?.child_username ?? null);
  const [resetPw, setResetPw] = useState("");
  const [showReset, setShowReset] = useState(false);

  const create = async () => {
    if (!isValidUsername(username)) { toast.error("Username inválido (3-30 caracteres: letras minúsculas, números, ponto, traço, underline)"); return; }
    if (password.length < 6) { toast.error("Senha deve ter ao menos 6 caracteres"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-child-account", {
      body: { student_id: student.id, username, password, action: "create" },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || "Erro"); return; }
    toast.success(`Acesso criado para ${(data as any).username}`);
    setCreated((data as any).username);
    setUsername(""); setPassword("");
  };

  const reset = async () => {
    if (resetPw.length < 6) { toast.error("Senha deve ter ao menos 6 caracteres"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-child-account", {
      body: { student_id: student.id, password: resetPw, action: "reset" },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || "Erro"); return; }
    toast.success("Senha redefinida. O aluno será solicitado a trocá-la no próximo acesso.");
    setResetPw(""); setShowReset(false);
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">Acesso do aluno</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Crie um login simples para o seu filho(a) acessar somente as aulas, materiais e tarefas (sem dados financeiros).
      </p>

      {created ? (
        <div className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-sm">
            <div className="text-xs text-muted-foreground">Nome de usuário</div>
            <div className="font-mono font-bold">{created}</div>
          </div>
          {!showReset ? (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowReset(true)}>
              <KeyRound className="w-4 h-4" /> Redefinir senha
            </Button>
          ) : (
            <div className="space-y-2 border-t border-border pt-3">
              <div><Label>Nova senha</Label><Input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)} minLength={6} /></div>
              <div className="flex gap-2">
                <Button onClick={reset} disabled={busy} size="sm">Salvar nova senha</Button>
                <Button variant="ghost" size="sm" onClick={() => { setShowReset(false); setResetPw(""); }}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <Label>Nome de usuário</Label>
            <Input value={username} onChange={e => setUsername(normalizeUsername(e.target.value))} placeholder="ex: miguel.silva" autoCapitalize="none" autoCorrect="off" />
          </div>
          <div><Label>Senha</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
          <Button onClick={create} disabled={busy} className="gap-2"><UserPlus className="w-4 h-4" /> Gerar acesso</Button>
        </div>
      )}
    </Card>
  );
}

function StatCard({ icon: Ic, label, value, href, tone }: any) {
  return (
    <Link to={href}>
      <Card className="p-4 hover:shadow-md transition-shadow h-full">
        <Ic className="w-5 h-5 text-primary mb-2" />
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold ${tone === "destructive" ? "text-destructive" : ""}`}>{value}</div>
      </Card>
    </Link>
  );
}

function capitalize(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

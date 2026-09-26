import { useEffect, useState } from "react";
import { Navigate, NavLink, useLocation, useSearchParams } from "react-router-dom";
import AnimatedOutlet from "@/components/AnimatedOutlet";
import BottomNav, { type NavItem } from "@/components/BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Calendar, Ban, Wallet, LogOut, UserRound, Settings as SettingsIcon, Link as LinkIcon, Users, Plus, UserCog, Bot, Home, Moon, Sun, ShieldCheck, FileText, TrendingUp, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { LessonDialog } from "@/components/LessonDialog";
import ThemeToggle from "@/components/ThemeToggle";
import UpdateBanner from "@/components/UpdateBanner";
import { useDefaultTeacher } from "@/hooks/useDefaultTeacher";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";
import { useTheme } from "@/hooks/useTheme";
import { useNativeRoute } from "@/lib/nativeRoute";
import { haptics } from "@/lib/haptics";
import { CronysWordmark } from "@/components/brand";
import { usePlan } from "@/hooks/usePlan";
import { Badge } from "@/components/ui/badge";
import { publicSiteUrl } from "@/lib/publicUrl";
import { useVocabulary } from "@/hooks/useVocabulary";
import type { Vocabulary } from "@/lib/vocabulary";
import BusinessOnboarding from "@/components/BusinessOnboarding";
import { refreshLessonsWidget } from "@/lib/widgetSync";

import { L } from "@/lib/i18n";
const primary: NavItem[] = [
  { to: "/admin", label: L("Hoje", "Today"), icon: Home, end: true },
  { to: "/admin/agenda", label: L("Agenda", "Calendar"), icon: Calendar },
  { to: "/admin/assistente", label: L("Assistente", "Assistant"), icon: Bot },
  { to: "/admin/financeiro", label: L("Financeiro", "Billing"), icon: Wallet },
];

// Os endereços (/admin/alunos, /admin/professores) ficam: widgets e links
// salvos apontam para eles. O que muda com o ramo é só o rótulo.
const secondaryFor = (v: Vocabulary): NavItem[] => [
  { to: "/admin/relatorios", label: L("Relatórios", "Reports"), icon: FileText },
  { to: "/admin/evolucao", label: L("Evolução", "Progress"), icon: TrendingUp },
  { to: "/admin/alunos", label: v.client.p, icon: Users },
  { to: "/admin/acessos", label: L("Acessos", "Access"), icon: ShieldCheck },
  { to: "/admin/professores", label: v.staff.p, icon: UserCog },
  { to: "/admin/bloqueios", label: L("Bloqueios", "Time off"), icon: Ban },
  { to: "/admin/mensagens", label: L("Mensagens", "Messages"), icon: MessageSquareText },
  { to: "/admin/configuracoes", label: L("Configurações", "Settings"), icon: SettingsIcon },
];

// O que o login de professor (papel 'teacher') enxerga. O resto - financeiro,
// relatórios, acessos, professores, configurações, assistente - é da escola, e
// o banco também não entrega esses dados a ele (migration 20260924040000).
const TEACHER_PATHS = ["/admin", "/admin/agenda", "/admin/alunos", "/admin/evolucao", "/admin/bloqueios"];
const teacherCan = (path: string) => TEACHER_PATHS.includes(path.replace(/\/+$/, "") || "/admin");

export default function AdminLayout() {
  const { plan, loading: planLoading } = usePlan();
  const { v, needsOnboarding } = useVocabulary();
  const { session, isAdmin, isTeacher, role, loading, signOut } = useAuth();
  const location = useLocation();
  const defaultTeacher = useDefaultTeacher();
  const { teachers } = useTeachers(true);
  const { theme, toggleTheme } = useTheme();
  const [quickOpen, setQuickOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  useNativeRoute();

  // Widgets deep-link to "/admin?new=1" to jump straight into scheduling.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      if (!isTeacher) setQuickOpen(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Um selo so, usado na lateral (desktop) e no topo (celular). Discreto de
  // proposito: e informacao, nao propaganda - quem esta no Pro nao precisa ser
  // lembrado disso o tempo todo.
  const SeloPlano = ({ className = "" }: { className?: string }) =>
    planLoading ? null : (
      <Badge
        variant={plan.plano === "pro" ? "default" : "outline"}
        className={`h-5 px-1.5 text-[10px] font-medium ${className}`}
        title={plan.max_active_clients != null ? L(`${plan.nome}: até ${plan.max_active_clients} ${v.client.lp} ativos`, `${plan.nome}: up to ${plan.max_active_clients} active ${v.client.lp}`) : plan.nome}
      >
        {plan.nome.replace(/^Cronys /, "").toUpperCase()}
      </Badge>
    );

  // O widget de aulas se atualiza sempre que o app abre (e quando o plano
  // chega), com os atalhos de WhatsApp e "estou a caminho" que o plano libera.
  useEffect(() => {
    if (!session || planLoading) return;
    refreshLessonsWidget({ words: v, remind: !!plan.whatsapp_link, locate: !!plan.arrival_location });
  }, [session, planLoading, plan.whatsapp_link, plan.arrival_location, v]);

  if (loading) return null;
  if (!session) return <Navigate to="/entrar" replace />;
  if (role === "child") return <Navigate to="/meu-painel" replace />;
  if (isTeacher && !teacherCan(location.pathname)) return <Navigate to="/admin" replace />;
  if (!isAdmin && !isTeacher) return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <div><h2 className="text-xl font-semibold mb-2">{L("Acesso restrito", "Restricted access")}</h2><p className="text-muted-foreground">{L("Sua conta não tem permissão de administrador.", "Your account does not have admin permission.")}</p><Button className="mt-4" onClick={signOut}>{L("Sair", "Sign out")}</Button></div>
    </div>
  );

  // Empresa nova: o dono escolhe o ramo antes de tudo. Só com a resposta do
  // banco na mão - ver needsOnboarding em useVocabulary.
  if (isAdmin && needsOnboarding) return <BusinessOnboarding />;

  const secondary = secondaryFor(v);
  const primaryNav = isTeacher ? primary.filter(it => teacherCan(it.to)) : primary;
  const secondaryNav = isTeacher ? secondary.filter(it => teacherCan(it.to)) : secondary;
  // Quem tem login de profissional só divulga o próprio link de disponibilidade.
  const linkTeachers = isTeacher ? teachers.filter(t => teacherSlug(t.name) === defaultTeacher) : teachers;

  const copyLink = (path: string, label: string) => {
    navigator.clipboard.writeText(publicSiteUrl() + path);
    haptics.success();
    toast.success(L(`Link ${label} copiado!`, `Link ${label} copied!`));
  };

  const sidebarLink = (it: NavItem) => (
    <NavLink key={it.to} to={it.to} end={it.end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${
          isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "hover:bg-sidebar-accent"
        }`}>
      <it.icon className="w-4 h-4" />{it.label}
    </NavLink>
  );

  return (
    <div className="flex flex-1 flex-col bg-background">
      <UpdateBanner />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="hidden md:flex md:w-60 md:min-h-full bg-sidebar text-sidebar-foreground md:flex-col">
          <div className="p-5 flex items-center gap-2 border-b border-sidebar-border">
            <div>
              <CronysWordmark tamanho="1.25rem" />
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-xs text-sidebar-foreground/60">{isTeacher ? L("Minha agenda", "My calendar") : v.business.s}</span>
                {!isTeacher && <SeloPlano />}
              </div>
            </div>
          </div>
          <nav className="flex flex-col gap-1 p-3 flex-1">
            {primaryNav.map(sidebarLink)}
            <div className="my-2 border-t border-sidebar-border" />
            {secondaryNav.map(sidebarLink)}
          </nav>
          <div className="p-3 border-t border-sidebar-border space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-sidebar-foreground/50 px-1">{L("Links públicos", "Public links")}</div>
            {linkTeachers.map(t => {
              const slug = teacherSlug(t.name);
              return (
                <Button key={t.id} onClick={() => copyLink(`/disponibilidade/${slug}`, L(`de ${capitalize(t.name)}`, `for ${capitalize(t.name)}`))} variant="secondary" size="sm" className="w-full justify-start gap-2">
                  <LinkIcon className="w-4 h-4" />{L("Link", "Link")} - {capitalize(t.name)}
                </Button>
              );
            })}
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"><NavLink to="/minha-conta"><UserRound className="w-4 h-4" />{L("Minha conta", "My account")}</NavLink></Button>
            <Button onClick={signOut} variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"><LogOut className="w-4 h-4" />{L("Sair", "Sign out")}</Button>
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col w-full max-w-[1400px] mx-auto p-4 md:p-8 pb-20 md:pb-8">
          <AnimatedOutlet />
        </main>
      </div>

      <BottomNav
        items={primaryNav}
        more={(close) => (
          <div className="space-y-4">
            {/* No celular nao existe barra lateral, entao o selo do plano mora
                aqui - e o lugar mais parecido com ela. */}
            <div className="flex items-center gap-2">
              <CronysWordmark tamanho="1rem" />
              {!isTeacher && <SeloPlano />}
            </div>
            {/* Professor não marca aula (migration 20260925100000): só o admin. */}
            {!isTeacher && (
              <Button
                className="h-12 w-full justify-start gap-2 rounded-2xl"
                onClick={() => { haptics.tap(); close(); setQuickOpen(true); }}
              >
                <Plus className="h-4 w-4" /> {v.appointment.novo} {v.appointment.l}
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {secondaryNav.map(it => (
                <NavLink key={it.to} to={it.to} onClick={() => { haptics.tap(); close(); }}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors ${
                      isActive ? "bg-primary/10 text-primary" : "bg-muted/60 hover:bg-muted"
                    }`}>
                  <it.icon className="h-4 w-4" />{it.label}
                </NavLink>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {linkTeachers.map(t => {
                const slug = teacherSlug(t.name);
                return (
                  <Button key={t.id} variant="outline" className="h-11 justify-start gap-2 rounded-2xl" onClick={() => { copyLink(`/disponibilidade/${slug}`, L(`de ${capitalize(t.name)}`, `for ${capitalize(t.name)}`)); close(); }}>
                    <LinkIcon className="h-4 w-4" /> Link {capitalize(t.name)}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <Button variant="ghost" size="sm" className="gap-2 rounded-xl" onClick={toggleTheme}>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? L("Modo claro", "Light mode") : L("Modo escuro", "Dark mode")}
              </Button>
              <Button asChild variant="ghost" size="sm" className="gap-2 rounded-xl"><NavLink to="/minha-conta"><UserRound className="h-4 w-4" /> {L("Minha conta", "My account")}</NavLink></Button>
              <Button variant="ghost" size="sm" className="gap-2 rounded-xl text-destructive hover:text-destructive" onClick={signOut}><LogOut className="h-4 w-4" /> {L("Sair", "Sign out")}</Button>
            </div>
          </div>
        )}
      />

      <LessonDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        defaultTeacher={defaultTeacher}
        onSaved={() => { /* pages refresh on their own focus/mount */ }}
      />
    </div>
  );
}

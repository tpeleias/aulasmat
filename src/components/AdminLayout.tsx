import { useEffect, useState } from "react";
import { Navigate, NavLink, useSearchParams } from "react-router-dom";
import AnimatedOutlet from "@/components/AnimatedOutlet";
import BottomNav, { type NavItem } from "@/components/BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Calendar, Ban, Wallet, LogOut, Settings as SettingsIcon, Link as LinkIcon, Users, Plus, UserCog, Bot, ClipboardList, Home, Moon, Sun, ShieldCheck } from "lucide-react";
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
import { CronysMark, CronysWordmark } from "@/components/brand";

const primary: NavItem[] = [
  { to: "/admin", label: "Hoje", icon: Home, end: true },
  { to: "/admin/agenda", label: "Agenda", icon: Calendar },
  { to: "/admin/assistente", label: "Assistente", icon: Bot },
  { to: "/admin/financeiro", label: "Cobrança", icon: Wallet },
];

const secondary: NavItem[] = [
  { to: "/admin/alunos", label: "Alunos", icon: Users },
  { to: "/admin/organizacao", label: "Organização", icon: ClipboardList },
  { to: "/admin/acessos", label: "Acessos", icon: ShieldCheck },
  { to: "/admin/professores", label: "Professores", icon: UserCog },
  { to: "/admin/bloqueios", label: "Bloqueios", icon: Ban },
  { to: "/admin/configuracoes", label: "Configurações", icon: SettingsIcon },
];

export default function AdminLayout() {
  const { session, isAdmin, role, loading, signOut } = useAuth();
  const defaultTeacher = useDefaultTeacher();
  const { teachers } = useTeachers(true);
  const { theme, toggleTheme } = useTheme();
  const [quickOpen, setQuickOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  useNativeRoute();

  // Widgets deep-link to "/admin?new=1" to jump straight into scheduling.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setQuickOpen(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" replace />;
  if (role === "child") return <Navigate to="/meu-painel" replace />;
  if (!isAdmin) return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <div><h2 className="text-xl font-semibold mb-2">Acesso restrito</h2><p className="text-muted-foreground">Sua conta não tem permissão de administrador.</p><Button className="mt-4" onClick={signOut}>Sair</Button></div>
    </div>
  );

  const copyLink = (path: string, label: string) => {
    navigator.clipboard.writeText(window.location.origin + path);
    haptics.success();
    toast.success(`Link ${label} copiado!`);
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
            <CronysMark className="w-8 h-8 shrink-0 text-brand-gold" />
            <div><CronysWordmark className="text-lg leading-none" /><div className="text-xs text-sidebar-foreground/60 mt-0.5">Professor</div></div>
          </div>
          <nav className="flex flex-col gap-1 p-3 flex-1">
            {primary.map(sidebarLink)}
            <div className="my-2 border-t border-sidebar-border" />
            {secondary.map(sidebarLink)}
          </nav>
          <div className="p-3 border-t border-sidebar-border space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-sidebar-foreground/50 px-1">Links públicos</div>
            {teachers.map(t => {
              const slug = teacherSlug(t.name);
              return (
                <Button key={t.id} onClick={() => copyLink(`/disponibilidade/${slug}`, `de ${capitalize(t.name)}`)} variant="secondary" size="sm" className="w-full justify-start gap-2">
                  <LinkIcon className="w-4 h-4" />Link - {capitalize(t.name)}
                </Button>
              );
            })}
            <ThemeToggle />
            <Button onClick={signOut} variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"><LogOut className="w-4 h-4" />Sair</Button>
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col w-full max-w-[1400px] mx-auto p-4 md:p-8 pb-20 md:pb-8">
          <AnimatedOutlet />
        </main>
      </div>

      <BottomNav
        items={primary}
        more={(close) => (
          <div className="space-y-4">
            <Button
              className="h-12 w-full justify-start gap-2 rounded-2xl"
              onClick={() => { haptics.tap(); close(); setQuickOpen(true); }}
            >
              <Plus className="h-4 w-4" /> Nova aula
            </Button>
            <div className="grid grid-cols-2 gap-2">
              {secondary.map(it => (
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
              {teachers.map(t => {
                const slug = teacherSlug(t.name);
                return (
                  <Button key={t.id} variant="outline" className="h-11 justify-start gap-2 rounded-2xl" onClick={() => { copyLink(`/disponibilidade/${slug}`, `de ${capitalize(t.name)}`); close(); }}>
                    <LinkIcon className="h-4 w-4" /> Link {capitalize(t.name)}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <Button variant="ghost" size="sm" className="gap-2 rounded-xl" onClick={toggleTheme}>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? "Modo claro" : "Modo escuro"}
              </Button>
              <Button variant="ghost" size="sm" className="gap-2 rounded-xl text-destructive hover:text-destructive" onClick={signOut}><LogOut className="h-4 w-4" /> Sair</Button>
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

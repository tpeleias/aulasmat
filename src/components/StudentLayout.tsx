import { Navigate, NavLink, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import AnimatedOutlet from "@/components/AnimatedOutlet";
import BottomNav, { type NavItem } from "@/components/BottomNav";
import { useTheme } from "@/hooks/useTheme";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";
import { UserRound, LogOut, LayoutDashboard, Calendar, Wallet, FolderOpen, ListChecks, CalendarPlus, CalendarSearch, Moon, Sun } from "lucide-react";
import { CronysWordmark } from "@/components/brand";

export default function StudentLayout() {
  const { session, role, loading, signOut } = useAuth();
  const { student, loading: stLoading } = useStudent();
  const settings = useAppSettings();
  const { teachers } = useTeachers(true);
  const { theme, toggleTheme } = useTheme();

  if (loading || stLoading) return null;
  if (!session) return <Navigate to="/" replace />;
  if (role === "admin") return <Navigate to="/admin" replace />;
  if (role === "child") return <Navigate to="/meu-painel" replace />;
  if (role !== "student") return <Navigate to="/" replace />;
  if (student?.must_change_password) return <Navigate to="/trocar-senha" replace />;

  const items: NavItem[] = [
    { to: "/aluno", label: "Início", icon: LayoutDashboard, end: true },
    { to: "/aluno/aulas", label: "Aulas", icon: Calendar },
    ...(settings?.allow_student_booking ? [{ to: "/aluno/agendar", label: "Agendar", icon: CalendarPlus }] : []),
    { to: "/aluno/financeiro", label: "Financeiro", icon: Wallet },
    { to: "/aluno/materiais", label: "Materiais", icon: FolderOpen },
    { to: "/aluno/tarefas", label: "Tarefas", icon: ListChecks },
  ];
  const tabs = items.slice(0, 4);
  const overflow = items.slice(4);

  return (
    <div className="flex flex-1 flex-col md:flex-row bg-background">
      <aside className="hidden md:flex md:w-60 md:min-h-full bg-sidebar text-sidebar-foreground md:flex-col">
        <div className="p-5 flex items-center gap-2 border-b border-sidebar-border">
          <div><CronysWordmark tamanho="1.25rem" /><div className="text-xs text-sidebar-foreground/60 mt-1">Responsável</div></div>
        </div>
        <nav className="flex flex-col gap-1 p-3 flex-1">
          {items.map(it => (
            <NavLink key={it.to} to={it.to} end={it.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${
                  isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "hover:bg-sidebar-accent"
                }`}>
              <it.icon className="w-4 h-4" />{it.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {settings?.show_availability_to_students && (
            <>
              <div className="text-[11px] uppercase tracking-wide text-sidebar-foreground/50 px-1">Disponibilidade</div>
              {teachers.map(t => (
                <Button key={t.id} asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
                  <Link to={`/disponibilidade/${teacherSlug(t.name)}`} target="_blank"><CalendarSearch className="w-4 h-4" />Agenda - {capitalize(t.name)}</Link>
                </Button>
              ))}
            </>
          )}
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"><NavLink to="/minha-conta"><UserRound className="w-4 h-4" />Minha conta</NavLink></Button>
          <Button onClick={signOut} variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent">
            <LogOut className="w-4 h-4" />Sair
          </Button>
        </div>
      </aside>
      <main className="flex min-h-0 flex-1 flex-col w-full max-w-[1200px] mx-auto p-4 md:p-8 pb-[5.5rem] md:pb-8"><AnimatedOutlet /></main>

      <BottomNav
        items={tabs}
        more={(close) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {overflow.map(it => (
                <NavLink key={it.to} to={it.to} onClick={close}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors ${
                      isActive ? "bg-primary/10 text-primary" : "bg-muted/60 hover:bg-muted"
                    }`}>
                  <it.icon className="h-4 w-4" />{it.label}
                </NavLink>
              ))}
              {settings?.show_availability_to_students && (
                <>
                  {teachers.map(t => (
                    <Link key={t.id} to={`/disponibilidade/${teacherSlug(t.name)}`} target="_blank" onClick={close} className="flex items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3 text-sm font-medium"><CalendarSearch className="h-4 w-4" />Agenda {capitalize(t.name)}</Link>
                  ))}
                </>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <Button variant="ghost" size="sm" className="gap-2 rounded-xl" onClick={toggleTheme}>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? "Modo claro" : "Modo escuro"}
              </Button>
              <Button asChild variant="ghost" size="sm" className="gap-2 rounded-xl"><NavLink to="/minha-conta"><UserRound className="h-4 w-4" /> Minha conta</NavLink></Button>
              <Button variant="ghost" size="sm" className="gap-2 rounded-xl text-destructive hover:text-destructive" onClick={signOut}><LogOut className="h-4 w-4" /> Sair</Button>
            </div>
          </div>
        )}
      />
    </div>
  );
}

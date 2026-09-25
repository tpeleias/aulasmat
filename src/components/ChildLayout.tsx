import { Navigate, NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useStudent } from "@/hooks/useStudent";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import AnimatedOutlet from "@/components/AnimatedOutlet";
import BottomNav, { type NavItem } from "@/components/BottomNav";
import { useTheme } from "@/hooks/useTheme";
import { UserRound, LogOut, LayoutDashboard, Calendar, FolderOpen, ListChecks, Moon, Sun } from "lucide-react";
import { CronysMark } from "@/components/brand";
import { useWords } from "@/hooks/useVocabulary";

import { L } from "@/lib/i18n";
export default function ChildLayout() {
  const { session, role, loading, signOut } = useAuth();
  const { student, loading: stLoading } = useStudent();
  const { theme, toggleTheme } = useTheme();
  const w = useWords();

  if (loading || stLoading) return null;
  if (!session) return <Navigate to="/entrar" replace />;
  if (role === "admin") return <Navigate to="/admin" replace />;
  if (role === "student") return <Navigate to="/aluno" replace />;
  if (role !== "child") return <Navigate to="/" replace />;
  if (student?.child_must_change_password) return <Navigate to="/trocar-senha" replace />;

  const items: NavItem[] = [
    { to: "/meu-painel", label: L("Início", "Home"), icon: LayoutDashboard, end: true },
    { to: "/meu-painel/aulas", label: w.appointment.p, icon: Calendar },
    { to: "/meu-painel/materiais", label: L("Materiais", "Materials"), icon: FolderOpen },
    { to: "/meu-painel/tarefas", label: L("Tarefas", "Tasks"), icon: ListChecks },
  ];

  return (
    <div className="flex flex-1 flex-col md:flex-row bg-background">
      <aside className="hidden md:flex md:w-60 md:min-h-full bg-sidebar text-sidebar-foreground md:flex-col">
        <div className="p-5 flex items-center gap-2 border-b border-sidebar-border">
          <CronysMark className="w-8 h-8 shrink-0" />
          <div>
            <div className="font-semibold text-sm">{L("Meu painel", "My dashboard")}</div>
            <div className="text-xs text-sidebar-foreground/60">{student?.student_name?.split(" ")[0] ?? w.client.s}</div>
          </div>
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
        <div className="p-3 border-t border-sidebar-border">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"><NavLink to="/minha-conta"><UserRound className="w-4 h-4" />{L("Minha conta", "My account")}</NavLink></Button>
          <Button onClick={signOut} variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent">
            <LogOut className="w-4 h-4" />Sair
          </Button>
        </div>
      </aside>
      <main className="flex min-h-0 flex-1 flex-col w-full max-w-[1200px] mx-auto p-4 md:p-8 pb-[5.5rem] md:pb-8"><AnimatedOutlet /></main>

      <BottomNav
        items={items}
        more={() => (
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-2 rounded-xl" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === "dark" ? L("Modo claro", "Light mode") : L("Modo escuro", "Dark mode")}
            </Button>
            <Button asChild variant="ghost" size="sm" className="gap-2 rounded-xl"><NavLink to="/minha-conta"><UserRound className="h-4 w-4" /> {L("Minha conta", "My account")}</NavLink></Button>
            <Button variant="ghost" size="sm" className="gap-2 rounded-xl text-destructive hover:text-destructive" onClick={signOut}><LogOut className="h-4 w-4" /> {L("Sair", "Sign out")}</Button>
          </div>
        )}
      />
    </div>
  );
}

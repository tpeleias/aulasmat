import { Navigate, NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useStudent } from "@/hooks/useStudent";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import AnimatedOutlet from "@/components/AnimatedOutlet";
import BottomNav, { type NavItem } from "@/components/BottomNav";
import { useTheme } from "@/hooks/useTheme";
import { GraduationCap, LogOut, LayoutDashboard, Calendar, FolderOpen, ListChecks, Moon, Sun } from "lucide-react";

export default function ChildLayout() {
  const { session, role, loading, signOut } = useAuth();
  const { student, loading: stLoading } = useStudent();
  const { theme, toggleTheme } = useTheme();

  if (loading || stLoading) return null;
  if (!session) return <Navigate to="/" replace />;
  if (role === "admin") return <Navigate to="/admin" replace />;
  if (role === "student") return <Navigate to="/aluno" replace />;
  if (role !== "child") return <Navigate to="/" replace />;
  if (student?.child_must_change_password) return <Navigate to="/trocar-senha" replace />;

  const items: NavItem[] = [
    { to: "/meu-painel", label: "Início", icon: LayoutDashboard, end: true },
    { to: "/meu-painel/aulas", label: "Aulas", icon: Calendar },
    { to: "/meu-painel/materiais", label: "Materiais", icon: FolderOpen },
    { to: "/meu-painel/tarefas", label: "Tarefas", icon: ListChecks },
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      <aside className="hidden md:flex md:w-60 md:min-h-screen bg-sidebar text-sidebar-foreground md:flex-col">
        <div className="p-5 flex items-center gap-2 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-semibold text-sm">Meu Painel</div>
            <div className="text-xs text-sidebar-foreground/60">{student?.student_name?.split(" ")[0] ?? "Aluno"}</div>
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
          <Button onClick={signOut} variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent">
            <LogOut className="w-4 h-4" />Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 w-full max-w-[1200px] mx-auto p-4 md:p-8 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8"><AnimatedOutlet /></main>

      <BottomNav
        items={items}
        more={() => (
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" className="gap-2 rounded-xl" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === "dark" ? "Modo claro" : "Modo escuro"}
            </Button>
            <Button variant="ghost" size="sm" className="gap-2 rounded-xl text-destructive hover:text-destructive" onClick={signOut}><LogOut className="h-4 w-4" /> Sair</Button>
          </div>
        )}
      />
    </div>
  );
}

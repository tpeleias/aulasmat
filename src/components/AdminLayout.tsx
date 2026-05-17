import { useState } from "react";
import { Navigate, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Calendar, Ban, Wallet, LogOut, GraduationCap, Settings as SettingsIcon, Link as LinkIcon, History, Users, Plus } from "lucide-react";
import { toast } from "sonner";
import { LessonDialog } from "@/components/LessonDialog";
import { useDefaultTeacher } from "@/hooks/useDefaultTeacher";

const items = [
  { to: "/admin", label: "Calendário", icon: Calendar, end: true },
  { to: "/admin/alunos", label: "Alunos", icon: Users },
  { to: "/admin/bloqueios", label: "Bloqueios", icon: Ban },
  { to: "/admin/financeiro", label: "Cobrança", icon: Wallet },
  { to: "/admin/configuracoes", label: "Configurações", icon: SettingsIcon },
  { to: "/admin/auditoria", label: "Auditoria", icon: History },
];

export default function AdminLayout() {
  const { session, isAdmin, loading, signOut } = useAuth();
  const defaultTeacher = useDefaultTeacher();
  const [quickOpen, setQuickOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  if (loading) return null;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAdmin) return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div><h2 className="text-xl font-semibold mb-2">Acesso restrito</h2><p className="text-muted-foreground">Sua conta não tem permissão de administrador.</p><Button className="mt-4" onClick={signOut}>Sair</Button></div>
    </div>
  );

  const copyLink = (path: string, label: string) => {
    navigator.clipboard.writeText(window.location.origin + path);
    toast.success(`Link ${label} copiado!`);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      <aside className="md:w-60 md:min-h-screen bg-sidebar text-sidebar-foreground flex md:flex-col">
        <div className="p-5 hidden md:flex items-center gap-2 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div><div className="font-semibold text-sm">Agenda</div><div className="text-xs text-sidebar-foreground/60">Professor</div></div>
        </div>
        <nav className="flex md:flex-col gap-1 p-2 md:p-3 flex-1 overflow-x-auto">
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
        <div className="p-3 hidden md:block border-t border-sidebar-border space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-sidebar-foreground/50 px-1">Links públicos</div>
          <Button onClick={() => copyLink("/disponibilidade/thiago", "do Thiago")} variant="secondary" size="sm" className="w-full justify-start gap-2"><LinkIcon className="w-4 h-4" />Link - Thiago</Button>
          <Button onClick={() => copyLink("/disponibilidade/mayara", "da Mayara")} variant="secondary" size="sm" className="w-full justify-start gap-2"><LinkIcon className="w-4 h-4" />Link - Mayara</Button>
          <Button onClick={signOut} variant="ghost" size="sm" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"><LogOut className="w-4 h-4" />Sair</Button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8 max-w-[1400px] w-full mx-auto"><Outlet /></main>
    </div>
  );
}

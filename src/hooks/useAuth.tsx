import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type Role = "admin" | "teacher" | "student" | "child" | null;
type Ctx = {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  isTeacher: boolean;
  // O operador da plataforma é uma conta sem empresa: nenhum papel, nenhuma
  // linha de nenhuma empresa. Só o gestor responde para ele.
  isPlatformAdmin: boolean;
  role: Role;
  loading: boolean;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<Ctx>({ session: null, user: null, isAdmin: false, isTeacher: false, isPlatformAdmin: false, role: null, loading: true, signOut: async () => {} });

async function fetchPlatformAdmin(): Promise<boolean> {
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true;
}

async function fetchRole(userId: string): Promise<Role> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role as string);
  if (roles.includes("admin")) return "admin";
  // Professor da equipe (não admin): vê a própria agenda, sem financeiro.
  if (roles.includes("teacher")) return "teacher";
  // child takes precedence over student so a user accidentally holding both roles
  // (auto-assigned 'student' from handle_new_user + 'child' added afterwards) lands on the child view.
  if (roles.includes("child")) return "child";
  if (roles.includes("student")) return "student";
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) setTimeout(async () => {
        setRole(await fetchRole(s.user.id));
        setIsPlatformAdmin(await fetchPlatformAdmin());
      }, 0);
      else { setRole(null); setIsPlatformAdmin(false); }
    });
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        setRole(await fetchRole(s.user.id));
        setIsPlatformAdmin(await fetchPlatformAdmin());
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null,
      isAdmin: role === "admin",
      isTeacher: role === "teacher",
      isPlatformAdmin,
      role,
      loading,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);

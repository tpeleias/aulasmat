import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type Role = "admin" | "student" | "child" | null;
type Ctx = {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  role: Role;
  loading: boolean;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<Ctx>({ session: null, user: null, isAdmin: false, role: null, loading: true, signOut: async () => {} });

async function fetchRole(userId: string): Promise<Role> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role as string);
  if (roles.includes("admin")) return "admin";
  // child takes precedence over student so a user accidentally holding both roles
  // (auto-assigned 'student' from handle_new_user + 'child' added afterwards) lands on the child view.
  if (roles.includes("child")) return "child";
  if (roles.includes("student")) return "student";
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) setTimeout(async () => setRole(await fetchRole(s.user.id)), 0);
      else setRole(null);
    });
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) setRole(await fetchRole(s.user.id));
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null,
      isAdmin: role === "admin",
      role,
      loading,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);

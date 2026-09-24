import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
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

// Uma consulta que não volta não pode prender o app: sem resposta em alguns
// segundos, segue como se não houvesse papel - a pessoa vê a tela de "aguardando"
// com o botão de sair, em vez de uma tela vazia sem saída.
const LIMITE_MS = 8000;
function comLimite<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), LIMITE_MS)),
  ]);
}

async function fetchPlatformAdmin(): Promise<boolean> {
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true;
}

async function fetchRole(userId: string): Promise<Role> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((data ?? []) as { role: string }[]).map(r => r.role);
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
  // Entre o login e a resposta de "quem é você", o app não sabe o papel. Antes,
  // nesse intervalo a tela de login já decidia - e o gestor, que não tem papel
  // em empresa nenhuma, caía em "aguardando liberação" até a resposta chegar
  // (ou para sempre, se ela não chegasse). Agora esse intervalo conta como
  // carregando.
  const [resolving, setResolving] = useState(false);
  // De quem é a resposta que está a caminho. Trocar de conta no meio descarta a
  // anterior, e renovar o token da mesma conta (a cada hora) não pergunta de
  // novo - perguntar apagaria a tela durante a consulta.
  const resolvedFor = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    const resolve = async (userId: string | null) => {
      if (userId === resolvedFor.current) return;
      resolvedFor.current = userId;
      if (!userId) { setRole(null); setIsPlatformAdmin(false); setResolving(false); return; }
      setResolving(true);
      const [r, p] = await Promise.all([
        comLimite(fetchRole(userId), null),
        comLimite(fetchPlatformAdmin(), false),
      ]);
      if (!alive || resolvedFor.current !== userId) return;
      setRole(r);
      setIsPlatformAdmin(p);
      setResolving(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      // Junto com a sessão nova, e não depois: se a tela renderizar entre uma
      // coisa e outra, ela vê "logado, sem papel" e decide errado.
      if ((s?.user?.id ?? null) !== resolvedFor.current && s?.user) setResolving(true);
      setSession(s);
      // Fora do callback: chamar o supabase aqui dentro trava o cliente de auth.
      setTimeout(() => { void resolve(s?.user?.id ?? null); }, 0);
    });

    // Sessão guardada que não carrega (armazenamento corrompido, rede) não pode
    // deixar o app em "carregando" para sempre: numa tela escura, isso é uma
    // tela preta sem botão de sair.
    comLimite(supabase.auth.getSession().then(({ data }) => data.session), null)
      .then(async s => {
        if (!alive) return;
        setSession(s);
        await resolve(s?.user?.id ?? null);
      })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null,
      isAdmin: role === "admin",
      isTeacher: role === "teacher",
      isPlatformAdmin,
      role,
      loading: loading || resolving,
      signOut: async () => {
        // Sair tem que funcionar mesmo com o servidor fora: se a chamada falhar,
        // a sessão local é apagada assim mesmo.
        const { error } = await supabase.auth.signOut().catch(e => ({ error: e }));
        if (error) await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      },
    }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);

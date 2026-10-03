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
  /** A pergunta "quem é você?" não teve resposta (rede, ou o cliente do
   *  Supabase travado). Não é o mesmo que "sem papel": a tela oferece tentar
   *  de novo, em vez de dizer que a conta aguarda liberação. */
  roleFailed: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<Ctx>({ session: null, user: null, isAdmin: false, isTeacher: false, isPlatformAdmin: false, role: null, roleFailed: false, loading: true, signOut: async () => {} });

// Uma consulta que não volta não pode prender o app: sem resposta em alguns
// segundos, desiste. Para o papel, tenta mais uma vez e, se ainda assim não
// vier, a tela diz que não deu para carregar (com "tentar de novo" e "sair") -
// antes dizia "aguardando liberação", o que enganava quem tem acesso (26/09:
// login de professor, depois de sair e entrar na mesma aba, nenhuma consulta
// chegou a sair do navegador).
const LIMITE_MS = 6000;
const FALHOU = Symbol("falhou");
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
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
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
  const [roleFailed, setRoleFailed] = useState(false);
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
      if (!userId) { setRole(null); setRoleFailed(false); setIsPlatformAdmin(false); setResolving(false); return; }
      setResolving(true);
      const pedirPapel = () => comLimite<Role | typeof FALHOU>(fetchRole(userId), FALHOU);
      const [r1, p] = await Promise.all([pedirPapel(), comLimite(fetchPlatformAdmin(), false)]);
      const r = r1 === FALHOU && alive && resolvedFor.current === userId ? await pedirPapel() : r1;
      if (!alive || resolvedFor.current !== userId) return;
      // O gestor da plataforma não tem papel: se ele respondeu, não é falha.
      const failed = r === FALHOU && !p;
      setRole(r === FALHOU ? null : r);
      setRoleFailed(failed);
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
      roleFailed,
      loading: loading || resolving,
      signOut: async () => {
        // Sair tem que funcionar mesmo com o servidor fora: se a chamada falhar,
        // a sessão local é apagada assim mesmo.
        const { error } = await supabase.auth.signOut().catch(e => ({ error: e }));
        if (error) await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        // E recarrega do zero (02/10): sair e entrar de novo na mesma aba às
        // vezes deixava o cliente do Supabase sem mandar a consulta do papel, e
        // o login novo caía em "Não deu para carregar sua conta" (visto nos
        // registros: o login entrava, a pergunta a user_roles nunca saía). Uma
        // página nova começa com um cliente novo.
        if (import.meta.env.MODE !== "test") window.location.replace("/");
      },
    }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);

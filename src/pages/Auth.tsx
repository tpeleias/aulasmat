import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { isValidUsername, usernameToEmail, normalizeUsername } from "@/lib/username";

export default function Auth() {
  const { session, role, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [childPw, setChildPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "Acesso — Portal de Aulas"; }, []);

  if (loading) return null;
  if (session) {
    if (role === "admin") return <Navigate to="/admin" replace />;
    if (role === "student") return <Navigate to="/aluno" replace />;
    if (role === "child") return <Navigate to="/meu-painel" replace />;
    return <PendingScreen />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
  };
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/" } });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Conta criada! Se for aluno, peça ao professor para vincular seu acesso.");
  };
  const handleChildLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidUsername(username)) {
      toast.error("Username inválido. Use 3-30 caracteres: letras, números, ponto, traço ou underline.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password: childPw,
    });
    setBusy(false);
    if (error) toast.error("Usuário ou senha incorretos.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--gradient-subtle)" }}>
      <Card className="w-full max-w-md p-8 shadow-[var(--shadow-elegant)]">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "var(--gradient-primary)" }}>
            <GraduationCap className="text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Portal de Aulas</h1>
          <p className="text-sm text-muted-foreground text-center">Acesso de professores, responsáveis e alunos</p>
        </div>
        <Tabs defaultValue="login">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="login">Entrar</TabsTrigger>
            <TabsTrigger value="child">Aluno</TabsTrigger>
            <TabsTrigger value="signup">Criar conta</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <form onSubmit={handleLogin} className="space-y-4 mt-4">
              <div><Label>Email</Label><Input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div><Label>Senha</Label><Input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
              <Button type="submit" className="w-full" disabled={busy}>Entrar</Button>
            </form>
          </TabsContent>
          <TabsContent value="child">
            <form onSubmit={handleChildLogin} className="space-y-4 mt-4">
              <div>
                <Label>Nome de usuário</Label>
                <Input required value={username} onChange={e => setUsername(normalizeUsername(e.target.value))} placeholder="ex: miguel.silva" autoCapitalize="none" autoCorrect="off" />
              </div>
              <div><Label>Senha</Label><Input type="password" required value={childPw} onChange={e => setChildPw(e.target.value)} /></div>
              <Button type="submit" className="w-full" disabled={busy}>Entrar como aluno</Button>
              <p className="text-xs text-muted-foreground text-center">
                Acesso criado pelo responsável ou professor.
              </p>
            </form>
          </TabsContent>
          <TabsContent value="signup">
            <form onSubmit={handleSignup} className="space-y-4 mt-4">
              <div><Label>Email</Label><Input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div><Label>Senha</Label><Input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} /></div>
              <Button type="submit" className="w-full" disabled={busy}>Criar conta</Button>
              <p className="text-xs text-muted-foreground text-center">
                Após criar, o professor precisa vincular sua conta ao cadastro do aluno para liberar o acesso.
              </p>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}

function PendingScreen() {
  const { signOut, user } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--gradient-subtle)" }}>
      <Card className="max-w-md p-8 text-center space-y-4">
        <h2 className="text-xl font-semibold">Conta aguardando liberação</h2>
        <p className="text-sm text-muted-foreground">
          Sua conta ({user?.email}) foi criada, mas o professor ainda precisa vincular você ao cadastro do aluno.
          Avise o professor com este e-mail para liberar seu acesso.
        </p>
        <Button onClick={signOut} variant="outline">Sair</Button>
      </Card>
    </div>
  );
}

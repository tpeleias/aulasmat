import { useState, useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ArrowRight } from "lucide-react";
import { CronysMark, CronysWordmark } from "@/components/brand";
import { isValidUsername, usernameToEmail, normalizeUsername } from "@/lib/username";
import { haptics } from "@/lib/haptics";
import { publicSiteUrl } from "@/lib/publicUrl";
import { Capacitor } from "@capacitor/core";

type Mode = "account" | "child";

export default function Auth() {
  const { session, role, isPlatformAdmin, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("account");
  const [signup, setSignup] = useState(false);
  // "school": professor/escola criando a própria conta (vira admin de uma
  // escola nova, com teste do Pro). "family": responsável entrando numa escola
  // pelo código que o professor passou.
  const [signupKind, setSignupKind] = useState<"family" | "school">("family");
  const [schoolName, setSchoolName] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  // No app da loja não existe "a escola do endereço": sem código, a família
  // cairia em escola nenhuma. No site, a vitrine é da escola do endereço.
  const codeRequired = Capacitor.isNativePlatform();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [childPw, setChildPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = "Acesso — Cronys"; }, []);

  if (loading) return null;
  if (session) {
    // Antes dos papéis: o operador da plataforma não tem papel nenhum, porque
    // não pertence a empresa nenhuma. Sem isto ele cairia na tela de "aguarde
    // o professor te vincular", que não é o caso dele.
    if (isPlatformAdmin) return <Navigate to="/gestor" replace />;
    if (role === "admin" || role === "teacher") return <Navigate to="/admin" replace />;
    if (role === "student") return <Navigate to="/aluno" replace />;
    if (role === "child") return <Navigate to="/meu-painel" replace />;
    return <PendingScreen />;
  }

  const submitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = email.trim();
    // A guardian without an e-mail signs in with a username, which auth stores as an
    // address on an internal domain. Anything without "@" is treated as a username.
    const isUsername = !typed.includes("@");
    if (isUsername && !isValidUsername(typed)) {
      toast.error("Informe um e-mail válido ou um nome de usuário (3-30 caracteres).");
      return;
    }
    if (signup && !acceptTerms) {
      toast.error("Para criar a conta, aceite os termos de uso e a política de privacidade.");
      return;
    }
    if (signup && signupKind === "school" && (!schoolName.trim() || !teacherName.trim())) {
      toast.error("Informe o nome da escola e o seu nome.");
      return;
    }
    if (signup && signupKind === "family" && codeRequired && !schoolCode.trim()) {
      toast.error("Informe o código da escola - peça ao professor.");
      return;
    }
    if (signup && isUsername) {
      toast.error("Para criar uma conta é preciso um e-mail. Peça ao professor um acesso por usuário.");
      return;
    }
    const loginEmail = isUsername ? usernameToEmail(typed) : typed;
    setBusy(true);
    const { error } = signup
      ? await supabase.auth.signUp({
          email: loginEmail, password,
          options: {
            emailRedirectTo: publicSiteUrl() + "/",
            // Lido por handle_new_user no banco (migration 20260924020000).
            data: signupKind === "school"
              ? { signup_kind: "school", school_name: schoolName.trim(), teacher_name: teacherName.trim() }
              : schoolCode.trim() ? { school_code: schoolCode.trim().toLowerCase() } : {},
          },
        })
      : await supabase.auth.signInWithPassword({ email: loginEmail, password });
    setBusy(false);
    if (error) { haptics.warning(); toast.error(signup ? error.message : isUsername ? "Usuário ou senha incorretos." : "E-mail ou senha incorretos."); return; }
    haptics.success();
    if (signup) toast.success(signupKind === "school"
      ? "Escola criada! Você tem 14 dias do Cronys Pro para testar. Se pedirmos confirmação por e-mail, confirme e entre."
      : "Conta criada! Peça ao professor para vincular seu acesso ao cadastro do aluno.");
  };

  const submitChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidUsername(username)) {
      toast.error("Usuário inválido. Use 3-30 caracteres: letras, números, ponto, traço ou underline.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password: childPw });
    setBusy(false);
    if (error) { haptics.warning(); toast.error("Usuário ou senha incorretos."); return; }
    haptics.success();
  };

  return (
    <div className="flex-1 bg-background md:flex md:items-center md:justify-center md:bg-sidebar">
      <div className="mx-auto w-full md:max-w-md md:overflow-hidden md:rounded-[2rem] md:bg-background md:shadow-[0_24px_80px_-24px_rgba(0,0,0,0.6)]">
        {/* Hero */}
        <div className="relative overflow-hidden bg-sidebar px-6 pb-16 pt-14 text-sidebar-foreground md:pt-12">
          {/* Dois véus fracos: o dourado a 12% e o teal a 10%. Mais que isso
              vira mancha marrom em cima do navy, e o spec não quer gradiente
              chamando atenção perto da marca. */}
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-gold/12 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-brand-teal/10 blur-3xl" />
          <div className="relative flex items-center gap-3">
            {/* O símbolo sem moldura, direto sobre o navy: aqui o fundo já é
                a cor da marca, e um quadradinho por cima só somaria borda. */}
            <div>
              <CronysWordmark tamanho="2.25rem" className="text-brand-ink" />
              <div className="text-sm text-sidebar-foreground/70">Agenda, alunos e cobrança</div>
            </div>
          </div>
        </div>

        {/* Form panel overlapping the hero */}
        <div className="relative -mt-8 rounded-t-[2rem] bg-background px-6 pb-8 pt-6" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
          <div className="mb-5 grid grid-cols-2 rounded-2xl bg-muted p-1 text-sm font-medium">
            {([["account", "Professor / Responsável"], ["child", "Aluno"]] as [Mode, string][]).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => { haptics.tap(); setMode(m); }}
                className={`rounded-xl py-2 transition-all ${mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "account" ? (
            <form onSubmit={submitAccount} className="space-y-4">
              {signup && signupKind === "school" && (
                <>
                  <Field label="Nome da escola (ou o seu, se dá aula sozinho)">
                    <Input required value={schoolName} onChange={e => setSchoolName(e.target.value)} className="h-12 rounded-xl" maxLength={120} />
                  </Field>
                  <Field label="Seu nome, como professor">
                    <Input required value={teacherName} onChange={e => setTeacherName(e.target.value)} className="h-12 rounded-xl" maxLength={60} autoComplete="given-name" />
                  </Field>
                </>
              )}
              {signup && signupKind === "family" && (
                <Field label={codeRequired ? "Código da escola" : "Código da escola (se o professor passou)"}>
                  <Input required={codeRequired} value={schoolCode} onChange={e => setSchoolCode(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="ex.: escola-avila" className="h-12 rounded-xl" />
                </Field>
              )}
              <Field label={signup ? "E-mail" : "E-mail ou usuário"}>
                <Input
                  type={signup ? "email" : "text"}
                  required
                  name="username"
                  id="login-username"
                  autoComplete={signup ? "email" : "username"}
                  inputMode={signup ? "email" : "text"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={email}
                  onChange={e => setEmail(signup ? e.target.value : e.target.value.trimStart())}
                  className="h-12 rounded-xl"
                />
              </Field>
              <Field label="Senha">
                <Input type="password" required name="password" id="login-password" minLength={signup ? 6 : undefined} autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} className="h-12 rounded-xl" />
              </Field>
              {signup && (
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={acceptTerms} onChange={e => setAcceptTerms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                  <span>Li e aceito os <Link to="/termos" className="text-primary underline">termos de uso</Link> e a <Link to="/privacidade" className="text-primary underline">política de privacidade</Link>.</span>
                </label>
              )}
              <Button type="submit" disabled={busy} className="h-12 w-full gap-2 rounded-xl text-base">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {signup ? (signupKind === "school" ? "Criar minha escola" : "Criar conta") : "Entrar"}
              </Button>
              {signup ? (
                <p className="text-center text-xs text-muted-foreground">
                  Já tem conta? <button type="button" className="font-medium text-primary" onClick={() => setSignup(false)}>Entrar</button>
                </p>
              ) : (
                <div className="space-y-1 text-center text-xs text-muted-foreground">
                  <p>Responsável novo? <button type="button" className="font-medium text-primary" onClick={() => { setSignupKind("family"); setSignup(true); }}>Criar conta</button></p>
                  <p>Professor ou escola? <button type="button" className="font-medium text-primary" onClick={() => { setSignupKind("school"); setSignup(true); }}>Criar minha escola - 14 dias de Pro grátis</button></p>
                </div>
              )}
              {signup && signupKind === "family" && (
                <p className="text-center text-xs text-muted-foreground">
                  Depois de criar, o professor vincula sua conta ao cadastro do aluno.
                </p>
              )}
            </form>
          ) : (
            <form onSubmit={submitChild} className="space-y-4">
              <Field label="Nome de usuário">
                <Input required name="username" id="child-username" value={username} onChange={e => setUsername(normalizeUsername(e.target.value))} placeholder="ex: miguel.silva" autoCapitalize="none" autoCorrect="off" autoComplete="username" className="h-12 rounded-xl" />
              </Field>
              <Field label="Senha">
                <Input type="password" required name="password" id="child-password" autoComplete="current-password" value={childPw} onChange={e => setChildPw(e.target.value)} className="h-12 rounded-xl" />
              </Field>
              <Button type="submit" disabled={busy} className="h-12 w-full gap-2 rounded-xl text-base">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Entrar como aluno
              </Button>
              <p className="text-center text-xs text-muted-foreground">Acesso criado pelo responsável ou pelo professor.</p>
            </form>
          )}

          <div className="mt-8 border-t border-border pt-4 text-center text-xs text-muted-foreground">
            Ainda não é aluno?{" "}
            <Link to="/inicio" className="font-medium text-primary">Veja os horários disponíveis</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function PendingScreen() {
  const { signOut, user } = useAuth();
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 rounded-3xl border border-border bg-card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CronysMark className="h-7 w-7" /></div>
        <h2 className="text-xl font-semibold">Conta aguardando liberação</h2>
        <p className="text-sm text-muted-foreground">
          Sua conta ({user?.email}) foi criada, mas o professor ainda precisa vincular você ao cadastro do aluno.
          Avise o professor com este e-mail para liberar seu acesso.
        </p>
        <Button onClick={signOut} variant="outline" className="rounded-xl">Sair</Button>
      </div>
    </div>
  );
}

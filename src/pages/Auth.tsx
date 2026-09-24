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
import { isValidUsername, usernameToEmail } from "@/lib/username";
import { haptics } from "@/lib/haptics";
import { publicSiteUrl } from "@/lib/publicUrl";
import { Capacitor } from "@capacitor/core";


export default function Auth() {
  const { session, role, isPlatformAdmin, loading } = useAuth();
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
      toast.error("Informe o nome da empresa e o seu nome.");
      return;
    }
    if (signup && signupKind === "family" && codeRequired && !schoolCode.trim()) {
      toast.error("Informe o código da empresa - peça a quem te atende.");
      return;
    }
    if (signup && isUsername) {
      toast.error("Para criar uma conta é preciso um e-mail. Peça a quem te atende um acesso por usuário.");
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
      ? "Empresa criada! Você tem 14 dias do Cronys Pro para testar. Se pedirmos confirmação por e-mail, confirme e entre."
      : "Conta criada! Peça a quem te atende para vincular seu acesso ao seu cadastro.");
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
              <div className="text-sm text-sidebar-foreground/70">Agenda, clientes e cobrança</div>
            </div>
          </div>
        </div>

        {/* Form panel overlapping the hero */}
        <div className="relative -mt-8 rounded-t-[2rem] bg-background px-6 pb-8 pt-6" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
          {/* Uma tela só para todo mundo. Antes havia uma aba para o login de
              criança, mas ela fazia o mesmo que esta: sem "@", o que se digita
              é tratado como usuário, e quem decide a tela depois é o papel da
              conta, não a aba. */}
          <h2 className="mb-5 text-lg font-semibold">
            {signup ? (signupKind === "school" ? "Criar sua empresa" : "Criar conta") : "Entrar"}
          </h2>

          <form onSubmit={submitAccount} className="space-y-4">
            {signup && signupKind === "school" && (
              <>
                <Field label="Nome da empresa (ou o seu, se trabalha sozinho)">
                  <Input required value={schoolName} onChange={e => setSchoolName(e.target.value)} className="h-12 rounded-xl" maxLength={120} />
                </Field>
                <Field label="Seu nome, como profissional">
                  <Input required value={teacherName} onChange={e => setTeacherName(e.target.value)} className="h-12 rounded-xl" maxLength={60} autoComplete="given-name" />
                </Field>
              </>
            )}
            {signup && signupKind === "family" && (
              <Field label={codeRequired ? "Código da empresa" : "Código da empresa (se te passaram)"}>
                <Input required={codeRequired} value={schoolCode} onChange={e => setSchoolCode(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="ex.: clinica-avila" className="h-12 rounded-xl" />
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
                placeholder={signup ? "seu@email.com" : "seu@email.com ou seu usuário"}
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
              {signup ? (signupKind === "school" ? "Criar minha empresa" : "Criar conta") : "Entrar"}
            </Button>
            {signup ? (
              <p className="text-center text-xs text-muted-foreground">
                Já tem conta? <button type="button" className="font-medium text-primary" onClick={() => setSignup(false)}>Entrar</button>
              </p>
            ) : (
              <div className="space-y-1 text-center text-xs text-muted-foreground">
                <p>Cliente novo? <button type="button" className="font-medium text-primary" onClick={() => { setSignupKind("family"); setSignup(true); }}>Criar conta</button></p>
                <p>Tem um negócio? <button type="button" className="font-medium text-primary" onClick={() => { setSignupKind("school"); setSignup(true); }}>Criar minha empresa - 14 dias de Pro grátis</button></p>
              </div>
            )}
            {signup && signupKind === "family" && (
              <p className="text-center text-xs text-muted-foreground">
                Depois de criar, quem te atende vincula sua conta ao seu cadastro.
              </p>
            )}
          </form>

          <div className="mt-8 border-t border-border pt-4 text-center text-xs text-muted-foreground">
            Ainda não é cliente?{" "}
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
          Sua conta ({user?.email}) foi criada, mas quem te atende ainda precisa vincular você ao seu cadastro.
          Avise com este e-mail para liberar seu acesso.
        </p>
        <Button onClick={signOut} variant="outline" className="rounded-xl">Sair</Button>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ArrowRight, Globe } from "lucide-react";
import { CronysMark, CronysWordmark } from "@/components/brand";
import { isValidUsername, usernameToEmail } from "@/lib/username";
import { haptics } from "@/lib/haptics";
import { publicSiteUrl } from "@/lib/publicUrl";
import { Capacitor } from "@capacitor/core";
import { TRIAL_DAYS } from "@shared/plans";
import { GOOGLE_WEB_CLIENT_ID, googleLoginEnabled, isExternalLogin, signInWithGoogle } from "@/lib/googleLogin";
import GoogleWebButton from "@/components/GoogleWebButton";
import { dbErrorMessage } from "@/lib/dbErrors";


import { L, getLocale, getCurrency, isEnglish, toggleLanguage } from "@/lib/i18n";
export default function Auth() {
  const { session, user, role, roleFailed, isPlatformAdmin, loading } = useAuth();
  const [signup, setSignup] = useState(false);
  // "school": professor/escola criando a própria conta (vira admin de uma
  // escola nova, com teste do Pro). "family": responsável entrando numa escola
  // pelo código que o professor passou.
  // Por enquanto (Thiago, 27/09) só se cria empresa por aqui: os clientes são
  // cadastrados pelo admin. O ramo "family" fica no código para quando voltar.
  const [signupKind, setSignupKind] = useState<"family" | "school">("school");
  // /entrar?criar=empresa abre direto no cadastro de empresa (botão da página inicial).
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get("criar") === "empresa") { setSignupKind("school"); setSignup(true); }
  }, [params]);
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
  const [google, setGoogle] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // No site, o botão oficial do Google (mostra cronys.com.br); se ele não
  // carregar, o nosso, que passa pelo Supabase.
  const [officialFailed, setOfficialFailed] = useState(false);
  const onOfficialUnavailable = useCallback(() => setOfficialFailed(true), []);
  const useOfficial = !Capacitor.isNativePlatform() && !!GOOGLE_WEB_CLIENT_ID && !officialFailed;
  useEffect(() => { let on = true; googleLoginEnabled().then(v => { if (on) setGoogle(v); }); return () => { on = false; }; }, []);

  useEffect(() => { document.title = L("Acesso — Cronys", "Sign in — Cronys"); }, []);

  if (loading) return null;
  if (session) {
    // Antes dos papéis: o operador da plataforma não tem papel nenhum, porque
    // não pertence a empresa nenhuma. Sem isto ele cairia na tela de "aguarde
    // o professor te vincular", que não é o caso dele.
    if (isPlatformAdmin) return <Navigate to="/gestor" replace />;
    if (role === "admin" || role === "teacher") return <Navigate to="/admin" replace />;
    if (role === "student") return <Navigate to="/aluno" replace />;
    if (role === "child") return <Navigate to="/meu-painel" replace />;
    if (roleFailed) return <LoadFailedScreen />;
    // Primeira entrada pelo Google: ainda não tem empresa. Pergunta o nome
    // do negócio em vez de mandar esperar liberação (migration 20260928010000).
    if (isExternalLogin(user)) return <WelcomeBusinessScreen />;
    return <PendingScreen />;
  }

  const submitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = email.trim();
    // A guardian without an e-mail signs in with a username, which auth stores as an
    // address on an internal domain. Anything without "@" is treated as a username.
    const isUsername = !typed.includes("@");
    if (isUsername && !isValidUsername(typed)) {
      toast.error(L("Informe um e-mail válido ou um nome de usuário (3-30 caracteres).", "Enter a valid email or a username (3-30 characters)."));
      return;
    }
    if (signup && !acceptTerms) {
      toast.error(L("Para criar a conta, aceite os termos de uso e a política de privacidade.", "To create an account, accept the terms of use and the privacy policy."));
      return;
    }
    if (signup && signupKind === "school" && (!schoolName.trim() || !teacherName.trim())) {
      toast.error(L("Informe o nome da empresa e o seu nome.", "Enter the business name and your name."));
      return;
    }
    if (signup && signupKind === "family" && codeRequired && !schoolCode.trim()) {
      toast.error(L("Informe o código da empresa - peça a quem te atende.", "Enter the business code - ask your provider for it."));
      return;
    }
    if (signup && isUsername) {
      toast.error(L("Para criar uma conta é preciso um e-mail. Peça a quem te atende um acesso por usuário.", "Creating an account requires an email. Ask your provider for a username login."));
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
              // Língua e moeda do aparelho: a empresa nasce nelas (migration 20260925180000).
              ? { signup_kind: "school", school_name: schoolName.trim(), teacher_name: teacherName.trim(), locale: getLocale(), currency: getCurrency() }
              : schoolCode.trim() ? { school_code: schoolCode.trim().toLowerCase() } : {},
          },
        })
      : await supabase.auth.signInWithPassword({ email: loginEmail, password });
    setBusy(false);
    if (error) { haptics.warning(); toast.error(signup ? error.message : isUsername ? L("Usuário ou senha incorretos.", "Wrong username or password.") : L("E-mail ou senha incorretos.", "Wrong email or password.")); return; }
    haptics.success();
    if (signup) toast.success(signupKind === "school"
      ? L(`Empresa criada! Você tem ${TRIAL_DAYS} dias do Cronys Pro para testar. Se pedirmos confirmação por e-mail, confirme e entre.`, `Business created! You have ${TRIAL_DAYS} days of Cronys Pro to try it. If we ask you to confirm by email, confirm and sign in.`)
      : L("Conta criada! Peça a quem te atende para vincular seu acesso ao seu cadastro.", "Account created! Ask your provider to link your login to your profile."));
  };

  const continueWithGoogle = async () => {
    setGoogleBusy(true);
    const { error } = await signInWithGoogle();
    // No site a página sai para o Google; no app o navegador abre por cima.
    // Nos dois casos, o botão volta ao normal se a pessoa desistir.
    setGoogleBusy(false);
    if (error) { haptics.warning(); toast.error(L("Não deu para entrar com o Google. Tente de novo.", "Couldn't sign in with Google. Please try again.")); }
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
              <div className="text-sm text-sidebar-foreground/70">{L("Agenda, clientes e cobrança", "Scheduling, clients and billing")}</div>
            </div>
          </div>
          {/* Quem ainda não tem conta escolhe a língua aqui; depois vale a da empresa. */}
          <button type="button" onClick={() => { toggleLanguage(); }}
            className="absolute right-4 top-4 flex items-center gap-1 rounded-full border border-sidebar-foreground/20 px-2.5 py-1 text-xs text-sidebar-foreground/80 hover:bg-sidebar-foreground/10">
            <Globe className="h-3.5 w-3.5" /> {isEnglish() ? "Português" : "English"}
          </button>
        </div>

        {/* Form panel overlapping the hero */}
        <div className="relative -mt-8 rounded-t-[2rem] bg-background px-6 pb-8 pt-6" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
          {/* Uma tela só para todo mundo. Antes havia uma aba para o login de
              criança, mas ela fazia o mesmo que esta: sem "@", o que se digita
              é tratado como usuário, e quem decide a tela depois é o papel da
              conta, não a aba. */}
          <h2 className="mb-5 text-lg font-semibold">
            {signup ? (signupKind === "school" ? L("Criar sua empresa", "Create your business") : L("Criar conta", "Create account")) : L("Entrar", "Sign in")}
          </h2>

          {google && (
            <div className="mb-5 space-y-5">
              {useOfficial ? <GoogleWebButton onUnavailable={onOfficialUnavailable} /> : (
                <Button type="button" variant="outline" disabled={googleBusy} onClick={continueWithGoogle}
                  className="h-12 w-full gap-3 rounded-xl border-border bg-white text-base font-medium text-[#1f1f1f] hover:bg-neutral-50 hover:text-[#1f1f1f]">
                  {googleBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleG />}
                  {L("Continuar com o Google", "Continue with Google")}
                </Button>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />{L("ou com e-mail", "or with email")}<span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}

          <form onSubmit={submitAccount} className="space-y-4">
            {signup && signupKind === "school" && (
              <>
                <Field label={L("Nome da empresa (ou o seu, se trabalha sozinho)", "Business name (or yours, if you work alone)")}>
                  <Input required value={schoolName} onChange={e => setSchoolName(e.target.value)} className="h-12 rounded-xl" maxLength={120} />
                </Field>
                <Field label={L("Seu nome, como profissional", "Your name, as a professional")}>
                  <Input required value={teacherName} onChange={e => setTeacherName(e.target.value)} className="h-12 rounded-xl" maxLength={60} autoComplete="given-name" />
                </Field>
              </>
            )}
            {signup && signupKind === "family" && (
              <Field label={codeRequired ? L("Código da empresa", "Business code") : L("Código da empresa (se te passaram)", "Business code (if you got one)")}>
                <Input required={codeRequired} value={schoolCode} onChange={e => setSchoolCode(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder={L("ex.: clinica-avila", "e.g. smith-studio")} className="h-12 rounded-xl" />
              </Field>
            )}
            <Field label={signup ? L("E-mail", "Email") : L("E-mail ou usuário", "Email or username")}>
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
                placeholder={signup ? L("seu@email.com", "you@email.com") : L("seu@email.com ou seu usuário", "you@email.com or your username")}
                className="h-12 rounded-xl"
              />
            </Field>
            <Field label={L("Senha", "Password")}>
              <Input type="password" required name="password" id="login-password" minLength={signup ? 6 : undefined} autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} className="h-12 rounded-xl" />
            </Field>
            {signup && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={acceptTerms} onChange={e => setAcceptTerms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                <span>{L("Li e aceito os", "I have read and accept the")} <Link to="/termos" className="text-primary underline">{L("termos de uso", "terms of use")}</Link> {L("e a", "and the")} <Link to="/privacidade" className="text-primary underline">{L("política de privacidade", "privacy policy")}</Link>.</span>
              </label>
            )}
            <Button type="submit" disabled={busy} className="h-12 w-full gap-2 rounded-xl text-base">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {signup ? (signupKind === "school" ? L("Criar minha empresa", "Create my business") : L("Criar conta", "Create account")) : L("Entrar", "Sign in")}
            </Button>
            {signup ? (
              <p className="text-center text-xs text-muted-foreground">
                {L("Já tem conta?", "Already have an account?")} <button type="button" className="font-medium text-primary" onClick={() => setSignup(false)}>{L("Entrar", "Sign in")}</button>
              </p>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {L("Não tem conta?", "No account yet?")} <button type="button" className="font-medium text-primary" onClick={() => { setSignupKind("school"); setSignup(true); }}>{L(`Criar conta - ${TRIAL_DAYS} dias de Pro grátis`, `Create account - ${TRIAL_DAYS} days of Pro free`)}</button>
              </p>
            )}
            {!signup && (
              // Para o cliente de uma empresa não criar conta por engano (Thiago, 28/09).
              <p className="text-center text-xs text-muted-foreground/80">
                {L("É cliente? Entre com o usuário que a empresa te passou.", "A client? Sign in with the username your provider gave you.")}
              </p>
            )}
            {signup && signupKind === "family" && (
              <p className="text-center text-xs text-muted-foreground">
                {L("Depois de criar, quem te atende vincula sua conta ao seu cadastro.", "After you create it, your provider links your account to your profile.")}
              </p>
            )}
          </form>

        </div>
      </div>
    </div>
  );
}

// O "G" colorido do Google, como o guia de marca dele pede no botão.
function GoogleG() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// Quem entrou pelo Google e ainda não tem empresa (Thiago, 27/09): só o nome
// do negócio e o seu, e pronto. Os clientes não passam por aqui - eles entram
// com o usuário que a empresa cria.
function WelcomeBusinessScreen() {
  const { signOut, user } = useAuth();
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  const [school, setSchool] = useState("");
  const [name, setName] = useState((meta.full_name ?? meta.name ?? "").split(" ")[0] ?? "");
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school.trim() || !name.trim()) {
      toast.error(L("Informe o nome do negócio e o seu nome.", "Enter the business name and your name."));
      return;
    }
    if (!accept) {
      toast.error(L("Para começar, aceite os termos de uso e a política de privacidade.", "To start, accept the terms of use and the privacy policy."));
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("create_my_business" as never, {
      _school: school.trim(), _teacher: name.trim(), _locale: getLocale(), _currency: getCurrency(),
    } as never);
    if (error) {
      setBusy(false);
      haptics.warning();
      toast.error(dbErrorMessage(error, undefined, L("Não deu para criar a empresa. Tente de novo.", "Couldn't create the business. Please try again.")));
      return;
    }
    haptics.success();
    // O papel de admin acabou de nascer: recarregar faz o app perguntar de novo
    // quem é a pessoa e abrir o painel.
    window.location.replace("/admin");
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CronysMark className="h-7 w-7" /></div>
        <div className="text-center">
          <h2 className="text-xl font-semibold">{L("Bem-vindo ao Cronys!", "Welcome to Cronys!")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <Field htmlFor="welcome-school" label={L("Qual o nome do seu negócio?", "What's your business called?")}>
          <Input id="welcome-school" value={school} onChange={e => setSchool(e.target.value)} className="h-12 rounded-xl" maxLength={120} autoFocus
            placeholder={L("ou o seu nome, se trabalha sozinho", "or your name, if you work alone")} />
        </Field>
        <Field htmlFor="welcome-name" label={L("Como você quer ser chamado?", "What should we call you?")}>
          <Input id="welcome-name" value={name} onChange={e => setName(e.target.value)} className="h-12 rounded-xl" maxLength={60} autoComplete="given-name" />
        </Field>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
          <span>{L("Li e aceito os", "I have read and accept the")} <Link to="/termos" className="text-primary underline">{L("termos de uso", "terms of use")}</Link> {L("e a", "and the")} <Link to="/privacidade" className="text-primary underline">{L("política de privacidade", "privacy policy")}</Link>.</span>
        </label>
        <Button type="submit" disabled={busy} className="h-12 w-full gap-2 rounded-xl text-base">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {L(`Começar - ${TRIAL_DAYS} dias de Pro grátis`, `Start - ${TRIAL_DAYS} days of Pro free`)}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {L("Conta errada?", "Wrong account?")} <button type="button" className="font-medium text-primary" onClick={signOut}>{L("Sair", "Sign out")}</button>
        </p>
      </form>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// A conta existe, mas não deu para saber o que ela pode ver (a consulta não
// voltou). Recarregar a página resolve quase sempre: começa um cliente novo.
function LoadFailedScreen() {
  const { signOut, user } = useAuth();
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 rounded-3xl border border-border bg-card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CronysMark className="h-7 w-7" /></div>
        <h2 className="text-xl font-semibold">{L("Não deu para carregar sua conta", "Couldn't load your account")}</h2>
        <p className="text-sm text-muted-foreground">
          {L(`Você entrou como ${user?.email}, mas a conexão não respondeu a tempo. Tente de novo.`,
             `You're signed in as ${user?.email}, but the connection didn't respond in time. Please try again.`)}
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => window.location.reload()} className="rounded-xl">{L("Tentar de novo", "Try again")}</Button>
          <Button onClick={signOut} variant="outline" className="rounded-xl">{L("Sair", "Sign out")}</Button>
        </div>
      </div>
    </div>
  );
}

function PendingScreen() {
  const { signOut, user } = useAuth();
  return (
    <div className="flex flex-1 items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 rounded-3xl border border-border bg-card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CronysMark className="h-7 w-7" /></div>
        <h2 className="text-xl font-semibold">{L("Conta aguardando liberação", "Account waiting for approval")}</h2>
        <p className="text-sm text-muted-foreground">
          {L(`Sua conta (${user?.email}) foi criada, mas quem te atende ainda precisa vincular você ao seu cadastro. Avise com este e-mail para liberar seu acesso.`,
             `Your account (${user?.email}) was created, but your provider still needs to link you to your profile. Let them know this email to unlock your access.`)}
        </p>
        <Button onClick={signOut} variant="outline" className="rounded-xl">{L("Sair", "Sign out")}</Button>
      </div>
    </div>
  );
}

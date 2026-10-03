// E-mails de login pelo Resend, em português ou inglês (03/10, etapa 4): o
// "Send Email Hook" do Supabase Auth chama POST /functions/v1/emails/auth-hook
// em vez de mandar o e-mail padrão (em inglês, do remetente do Supabase).
//
// Para ligar (Thiago, no painel do Supabase): Authentication → Hooks → Send
// Email Hook → HTTPS, com o endereço acima; o segredo gerado ali ("v1,whsec_...")
// vai para o cofre como auth_hook_secret.
//
// A língua: user_metadata.locale (o cadastro grava a do aparelho); sem ela, a
// da empresa da pessoa; sem empresa, português.
import { esc, layout, NOREPLY, real, secret, send, SITE, type Admin } from "./core.ts";

type HookUser = { id: string; email?: string; new_email?: string; user_metadata?: Record<string, unknown> };
type EmailData = {
  token: string; token_hash: string; redirect_to: string; email_action_type: string; site_url: string;
  token_new?: string; token_hash_new?: string; old_email?: string;
};

/** Standard Webhooks (o mesmo esquema do Svix): `id.timestamp.corpo`, HMAC-SHA256. */
async function signed(secretRaw: string, req: Request, raw: string) {
  const id = req.headers.get("webhook-id") ?? "", ts = req.headers.get("webhook-timestamp") ?? "", header = req.headers.get("webhook-signature") ?? "";
  if (!id || !ts || !header || Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
  const keyBytes = Uint8Array.from(atob(secretRaw.replace(/^v1,/, "").replace(/^whsec_/, "")), c => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  const mine = btoa(String.fromCharCode(...sig));
  return header.split(" ").some(p => p.split(",")[1] === mine);
}

async function localeOf(admin: Admin, u: HookUser): Promise<boolean> {
  const l = String(u.user_metadata?.locale ?? "");
  if (l) return l.startsWith("en");
  const { data } = await admin.from("user_roles").select("account_id").eq("user_id", u.id).limit(1);
  const acc = data?.[0]?.account_id;
  if (!acc) return false;
  const { data: a } = await admin.from("accounts").select("locale").eq("id", acc).maybeSingle();
  return a?.locale === "en";
}

const verifyLink = (d: EmailData, hash: string, type: string) =>
  `${Deno.env.get("SUPABASE_URL")}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(d.redirect_to || SITE)}`;

type Text = { subject: string; title: string; body: string[]; cta?: string; code?: boolean };

/** Os textos de cada tipo. `code` mostra o código de 6 dígitos (quando o tipo usa). */
export function authText(type: string, en: boolean, forNewAddress = false): Text | null {
  const T: Record<string, [Text, Text]> = {
    signup: [
      { subject: "Confirme seu e-mail no Cronys", title: "Confirme seu e-mail", body: ["Falta só um passo para começar a usar o Cronys: confirme que este e-mail é seu."], cta: "Confirmar meu e-mail", code: true },
      { subject: "Confirm your email for Cronys", title: "Confirm your email", body: ["One last step to start using Cronys: confirm this email is yours."], cta: "Confirm my email", code: true },
    ],
    invite: [
      { subject: "Você foi convidado para o Cronys", title: "Você recebeu um convite", body: ["Você foi convidado para entrar no Cronys. Toque no botão para aceitar e criar sua senha."], cta: "Aceitar o convite" },
      { subject: "You've been invited to Cronys", title: "You've been invited", body: ["You've been invited to join Cronys. Tap the button to accept and set your password."], cta: "Accept the invite" },
    ],
    magiclink: [
      { subject: "Seu link para entrar no Cronys", title: "Entrar no Cronys", body: ["Toque no botão para entrar. O link vale por pouco tempo e só uma vez."], cta: "Entrar", code: true },
      { subject: "Your Cronys sign-in link", title: "Sign in to Cronys", body: ["Tap the button to sign in. The link works once and for a short time."], cta: "Sign in", code: true },
    ],
    recovery: [
      { subject: "Criar uma senha nova no Cronys", title: "Criar uma senha nova", body: ["Alguém pediu para trocar a senha da sua conta no Cronys. Se foi você, toque no botão abaixo.", "Se não foi você, é só ignorar este e-mail: a senha continua a mesma."], cta: "Criar senha nova", code: true },
      { subject: "Reset your Cronys password", title: "Create a new password", body: ["Someone asked to reset the password of your Cronys account. If it was you, tap the button below.", "If it wasn't you, just ignore this email: your password stays the same."], cta: "Create a new password", code: true },
    ],
    email_change: forNewAddress ? [
      { subject: "Confirme seu novo e-mail no Cronys", title: "Confirme o novo e-mail", body: ["Você pediu para usar este endereço na sua conta do Cronys. Confirme que ele é seu."], cta: "Confirmar o novo e-mail", code: true },
      { subject: "Confirm your new email for Cronys", title: "Confirm your new email", body: ["You asked to use this address on your Cronys account. Confirm it's yours."], cta: "Confirm the new email", code: true },
    ] : [
      { subject: "Confirme a troca de e-mail no Cronys", title: "Trocar o e-mail da conta", body: ["Alguém pediu para trocar o e-mail da sua conta no Cronys. Se foi você, confirme abaixo.", "Se não foi você, ignore este e-mail e troque sua senha."], cta: "Confirmar a troca", code: true },
      { subject: "Confirm your Cronys email change", title: "Change your account email", body: ["Someone asked to change the email on your Cronys account. If it was you, confirm below.", "If it wasn't you, ignore this email and change your password."], cta: "Confirm the change", code: true },
    ],
    reauthentication: [
      { subject: "Seu código de confirmação do Cronys", title: "Código de confirmação", body: ["Use o código abaixo para confirmar que é você. Ele vale por pouco tempo."], code: true },
      { subject: "Your Cronys verification code", title: "Verification code", body: ["Use the code below to confirm it's you. It expires shortly."], code: true },
    ],
    password_changed_notification: [
      { subject: "Sua senha do Cronys foi trocada", title: "Senha trocada", body: ["A senha da sua conta no Cronys acabou de ser trocada.", "Se não foi você, use \"Esqueci a senha\" na tela de entrada agora."] },
      { subject: "Your Cronys password was changed", title: "Password changed", body: ["The password of your Cronys account was just changed.", "If it wasn't you, use \"Forgot password\" on the sign-in screen now."] },
    ],
    email_changed_notification: [
      { subject: "O e-mail da sua conta do Cronys mudou", title: "E-mail trocado", body: ["O e-mail da sua conta no Cronys foi trocado.", "Se não foi você, fale com a gente respondendo este e-mail."] },
      { subject: "Your Cronys account email changed", title: "Email changed", body: ["The email on your Cronys account was changed.", "If it wasn't you, reply to this email to reach us."] },
    ],
  };
  const t = T[type];
  return t ? t[en ? 1 : 0] : null;
}

export function authMail(t: Text, en: boolean, link: string | null, code: string | null) {
  // O app não tem onde digitar o código: ele só aparece quando não há botão.
  const codeBlock = t.code && code && !link
    ? `<p style="font-size:13px;color:#77756c;margin:0 0 4px">${esc(en ? "Your code:" : "Seu código:")}</p>
<div style="font-family:Menlo,Consolas,monospace;font-size:24px;letter-spacing:.2em;font-weight:bold;color:#13141b;background:#f7f5ef;border:1px solid #e6e1d4;border-radius:10px;padding:10px 14px;display:inline-block;margin:0 0 16px">${esc(code)}</div>`
    : "";
  const [first, ...rest] = t.body.map(esc);
  return layout({
    tone: "info", title: t.title, lead: first,
    html: codeBlock ? [codeBlock] : [],
    paragraphs: rest,
    ...(link && t.cta ? { cta: { href: link, label: t.cta } } : {}),
  }, { from: "Cronys", en });
}

export async function handleAuthHook(admin: Admin, req: Request, raw: string, apiKey: string | null) {
  const fail = (code: number, message: string) =>
    new Response(JSON.stringify({ error: { http_code: code, message } }), { status: code, headers: { "content-type": "application/json" } });
  const sec = await secret(admin, "auth_hook_secret");
  if (!sec || !(await signed(sec, req, raw))) return fail(401, "invalid signature");
  if (!apiKey) return fail(500, "email not configured");
  const { user, email_data: d } = JSON.parse(raw) as { user: HookUser; email_data: EmailData };
  const en = await localeOf(admin, user);
  const type = d.email_action_type;
  const jobs: { to: string; t: Text; link: string | null; code: string | null }[] = [];
  if (type === "email_change") {
    // Os nomes vêm trocados no Supabase: token_hash_new é do e-mail atual.
    const cur = real(user.email), next = real(user.new_email);
    if (cur && d.token_hash_new) jobs.push({ to: cur, t: authText(type, en, false)!, link: verifyLink(d, d.token_hash_new, type), code: d.token || null });
    if (next && d.token_hash) jobs.push({ to: next, t: authText(type, en, true)!, link: verifyLink(d, d.token_hash, type), code: d.token_new || null });
  } else {
    const t = authText(type, en);
    const to = real(user.email);
    // Tipo que não conhecemos ou login sem e-mail de verdade: nada a mandar.
    if (!t || !to) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    const linkable = !["reauthentication", "password_changed_notification", "email_changed_notification"].includes(type);
    jobs.push({ to, t, link: linkable && d.token_hash ? verifyLink(d, d.token_hash, type) : null, code: d.token || null });
  }
  try {
    for (const j of jobs) await send(apiKey, { from: NOREPLY, to: j.to, subject: j.t.subject, html: authMail(j.t, en, j.link, j.code) });
  } catch (e) {
    console.error("auth hook", String(e));
    return fail(500, "could not send email");
  }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}

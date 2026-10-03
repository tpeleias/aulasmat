import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { USERNAME_DOMAIN } from "@/lib/username";
import { L } from "@/lib/i18n";

/**
 * "E-mail para avisos" em Minha conta (03/10): o profissional, o cliente e o
 * responsável põem o e-mail onde querem receber marcações, mudanças e
 * lembretes - quem entra com usuário (sem @) não tinha onde dizer. Grava pela
 * função set_my_notification_email (migration 20261003030000). Some para quem
 * não tem cadastro ligado ao login (o admin que não atende).
 *
 * Com `prompt`, vira o aviso de primeira entrada na tela inicial ("Quer
 * receber os lembretes por e-mail?"): só aparece se a empresa ligou os
 * e-mails, se ainda não há e-mail para avisos e se o login não é um e-mail de
 * verdade (aí os avisos já chegam nele). "Agora não" vale para este login.
 */
const DISMISS_KEY = "cronys.emailPrompt.dismissed";
const dismissed = (uid: string) => {
  try { return (JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]") as string[]).includes(uid); } catch { return false; }
};
const dismiss = (uid: string) => {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]") as string[];
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...new Set([...list, uid])]));
  } catch { /* sem armazenamento */ }
};

type Info = { kind: "teacher" | "client"; emails_on?: boolean; email: string | null; student_name?: string | null; guardian_name?: string | null; guardian_email?: string | null };

const RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

export function NotificationEmailCard({ prompt = false }: { prompt?: boolean }) {
  const { user } = useAuth();
  const [info, setInfo] = useState<Info | null>(null);
  const [hidden, setHidden] = useState(false);
  const [email, setEmail] = useState("");
  const [guardian, setGuardian] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (d: Info | null) => {
    setInfo(d);
    setEmail(d?.email ?? "");
    setGuardian(d?.guardian_email ?? "");
  };
  // Falhou a consulta (sem rede, por exemplo): o cartão só não aparece.
  useEffect(() => {
    void Promise.resolve().then(() => rpc("my_notification_email"))
      .then(({ data }) => apply((data as Info | null) ?? null), () => apply(null));
  }, []);

  if (!info || hidden) return null;
  if (prompt) {
    const uid = user?.id ?? "";
    const loginIsEmail = !!user?.email && !user.email.endsWith(`@${USERNAME_DOMAIN}`);
    if (!info.emails_on || info.email || info.guardian_email || loginIsEmail || !uid || dismissed(uid)) return null;
  }
  // O login do cliente costuma ser usado pela família: cada campo diz de quem
  // é. Responsável com o mesmo nome do cliente vira um campo só.
  const same = (a?: string | null, b?: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  const hasGuardian = info.kind === "client" && !!info.guardian_name && !same(info.guardian_name, info.student_name);
  const e = email.trim().toLowerCase();
  const g = guardian.trim().toLowerCase();
  const bad = (e && !RE.test(e)) || (hasGuardian && g && !RE.test(g));
  const changed = e !== (info.email ?? "") || (hasGuardian && g !== (info.guardian_email ?? ""));

  const save = async () => {
    setBusy(true);
    const { data, error } = await rpc("set_my_notification_email", { _email: e, _guardian_email: hasGuardian ? g : null });
    setBusy(false);
    if (error) { toast.error(L("Não deu para salvar. Confira o e-mail.", "Couldn't save. Check the email.")); return; }
    apply(data as Info);
    if (prompt) setHidden(true);
    toast.success(e || g ? L("Pronto: os avisos vão para esse e-mail", "Done: notices go to that email") : L("E-mail removido", "Email removed"));
  };

  return (
    <Card className={`space-y-3 rounded-2xl p-4 ${prompt ? "border-primary/40 bg-primary/5" : ""}`}>
      <h2 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4" /> {prompt
        ? L("Quer receber os avisos por e-mail?", "Get notices by email?")
        : L("E-mail para avisos", "Email for notices")}</h2>
      <p className="text-xs text-muted-foreground">
        {prompt
          ? (info.kind === "teacher"
            ? L("Coloque seu e-mail e fique sabendo do que muda na sua agenda. Dá para trocar depois em Minha conta.", "Add your email to hear about changes to your calendar. You can change it later in My account.")
            : L("Coloque seu e-mail e receba as marcações, mudanças de horário e lembretes. Dá para trocar depois em Minha conta.", "Add your email to get bookings, time changes and reminders. You can change it later in My account."))
          : info.kind === "teacher"
          ? L("Onde você recebe o que muda na sua agenda, quando a empresa liga os e-mails.", "Where you get changes to your calendar, when the business turns emails on.")
          : L("Onde chegam marcações, mudanças de horário e lembretes, quando a empresa liga os e-mails.", "Where bookings, time changes and reminders arrive, when the business turns emails on.")}
      </p>
      <div className="space-y-1.5">
        {hasGuardian && <Label htmlFor="notif-email">{info.student_name ? L(`E-mail de ${info.student_name}`, `${info.student_name}'s email`) : L("E-mail do cliente", "Client's email")}</Label>}
        <Input id="notif-email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={email}
          onChange={ev => setEmail(ev.target.value)} placeholder={L("seu@email.com", "you@email.com")} aria-label={L("E-mail para avisos", "Email for notices")} />
      </div>
      {hasGuardian && (
        <div className="space-y-1.5">
          <Label htmlFor="notif-guardian">{L(`E-mail de ${info.guardian_name}, responsável`, `${info.guardian_name}'s email (guardian)`)}</Label>
          <Input id="notif-guardian" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={guardian}
            onChange={ev => setGuardian(ev.target.value)} placeholder={L("email@exemplo.com", "email@example.com")} />
        </div>
      )}
      {hasGuardian && <p className="text-xs text-muted-foreground">{L("Pode preencher só um: os avisos vão para quem tiver e-mail.", "You can fill in just one: notices go to whoever has an email.")}</p>}
      {bad && <p className="text-xs text-destructive">{L("Confira o e-mail: falta o @ ou o domínio.", "Check the email: the @ or the domain is missing.")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant={prompt ? "default" : "outline"} className="rounded-xl" disabled={busy || !changed || !!bad} onClick={save}>{L("Salvar e-mail", "Save email")}</Button>
        {prompt && (
          <Button variant="ghost" className="rounded-xl text-muted-foreground" onClick={() => { dismiss(user?.id ?? ""); setHidden(true); }}>
            {L("Agora não", "Not now")}
          </Button>
        )}
      </div>
    </Card>
  );
}

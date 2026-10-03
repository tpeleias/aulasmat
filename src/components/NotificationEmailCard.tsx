import { useEffect, useState } from "react";
import { ChevronDown, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { USERNAME_DOMAIN } from "@/lib/username";
import { L } from "@/lib/i18n";

/**
 * "E-mail para avisos" em Minha conta (03/10): cada um põe o e-mail onde quer
 * receber marcações, mudanças e lembretes - quem entra com usuário (sem @) não
 * tinha onde dizer. O campo depende de quem entrou (my_notification_email,
 * migration 20261003050000):
 *
 *   profissional       -> o dele.
 *   família (/aluno)   -> "Seu e-mail" é o do responsável; o do aluno fica num
 *                         campo recolhido, "Adicionar o e-mail de ...".
 *   cliente adulto     -> o dele.
 *   aluno (meu-painel) -> só o dele, já com o que a família tiver posto.
 *
 * Some para quem não tem cadastro ligado ao login (o admin que não atende).
 *
 * Com `prompt`, vira o aviso de primeira entrada na tela inicial ("Quer
 * receber os avisos por e-mail?"): só aparece se a empresa ligou os
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

type Info = {
  kind: "teacher" | "client" | "guardian" | "child";
  emails_on?: boolean;
  email: string | null;
  student_name?: string | null;
  guardian_name?: string | null;
  student_email?: string | null;
};

const RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

function describe(info: Info, prompt: boolean) {
  const later = prompt ? " " + L("Dá para trocar depois em Minha conta.", "You can change it later in My account.") : "";
  switch (info.kind) {
    case "teacher":
      return L("Onde você fica sabendo do que muda na sua agenda.", "Where you hear about changes to your calendar.") + later;
    case "guardian":
      return L(`Onde chegam as marcações, mudanças de horário e lembretes de ${info.student_name}.`,
               `Where ${info.student_name}'s bookings, time changes and reminders arrive.`) + later;
    default:
      return L("Onde chegam as marcações, mudanças de horário e lembretes.", "Where bookings, time changes and reminders arrive.") + later;
  }
}

export function NotificationEmailCard({ prompt = false }: { prompt?: boolean }) {
  const { user } = useAuth();
  const [info, setInfo] = useState<Info | null>(null);
  const [hidden, setHidden] = useState(false);
  const [email, setEmail] = useState("");
  const [student, setStudent] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (d: Info | null) => {
    setInfo(d);
    setEmail(d?.email ?? "");
    setStudent(d?.student_email ?? "");
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
    if (!info.emails_on || info.email || loginIsEmail || !uid || dismissed(uid)) return null;
  }

  const guardian = info.kind === "guardian";
  const e = email.trim().toLowerCase();
  const s = student.trim().toLowerCase();
  const bad = (e && !RE.test(e)) || (guardian && s && !RE.test(s));
  const changed = e !== (info.email ?? "") || (guardian && s !== (info.student_email ?? ""));

  const save = async () => {
    setBusy(true);
    const { data, error } = await rpc("save_my_notification_email", { _mine: e, _student: guardian ? s : null });
    setBusy(false);
    if (error) { toast.error(L("Não deu para salvar. Confira o e-mail.", "Couldn't save. Check the email.")); return; }
    apply(data as Info);
    if (prompt) setHidden(true);
    toast.success(e || s ? L("Pronto: os avisos vão para esse e-mail", "Done: notices go to that email") : L("E-mail removido", "Email removed"));
  };

  return (
    <Card className={`space-y-3 rounded-2xl p-4 ${prompt ? "border-primary/40 bg-primary/5" : ""}`}>
      <h2 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4" /> {prompt
        ? L("Quer receber os avisos por e-mail?", "Get notices by email?")
        : L("E-mail para avisos", "Email for notices")}</h2>
      <p className="text-xs text-muted-foreground">{describe(info, prompt)}</p>
      <div className="space-y-1.5">
        {guardian && <Label htmlFor="notif-email">{L("Seu e-mail", "Your email")}</Label>}
        <Input id="notif-email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={email}
          onChange={ev => setEmail(ev.target.value)} placeholder={L("seu@email.com", "you@email.com")} aria-label={L("E-mail para avisos", "Email for notices")} />
      </div>
      {guardian && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-left text-sm text-primary">
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            {info.student_email
              ? L(`E-mail de ${info.student_name}: ${info.student_email}`, `${info.student_name}'s email: ${info.student_email}`)
              : L(`Adicionar o e-mail de ${info.student_name}`, `Add ${info.student_name}'s email`)}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1.5 pt-2">
            <Label htmlFor="notif-student">{L(`E-mail de ${info.student_name}`, `${info.student_name}'s email`)}</Label>
            <Input id="notif-student" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={student}
              onChange={ev => setStudent(ev.target.value)} placeholder={L("email@exemplo.com", "email@example.com")} />
            <p className="text-xs text-muted-foreground">
              {L(`${info.student_name} também passa a receber os avisos. Quem tem login próprio pode trocar por lá.`,
                 `${info.student_name} also gets the notices, and can change it from their own login.`)}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
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

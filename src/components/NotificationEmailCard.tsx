import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { L } from "@/lib/i18n";

/**
 * "E-mail para avisos" em Minha conta (03/10): o profissional, o cliente e o
 * responsável põem o e-mail onde querem receber marcações, mudanças e
 * lembretes - quem entra com usuário (sem @) não tinha onde dizer. Grava pela
 * função set_my_notification_email (migration 20261003030000). Some para quem
 * não tem cadastro ligado ao login (o admin que não atende).
 */
type Info = { kind: "teacher" | "client"; email: string | null; guardian_name?: string | null; guardian_email?: string | null };

const RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

export function NotificationEmailCard() {
  const [info, setInfo] = useState<Info | null>(null);
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

  if (!info) return null;
  const hasGuardian = info.kind === "client" && !!info.guardian_name;
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
    toast.success(e || g ? L("Pronto: os avisos vão para esse e-mail", "Done: notices go to that email") : L("E-mail removido", "Email removed"));
  };

  return (
    <Card className="space-y-3 rounded-2xl p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4" /> {L("E-mail para avisos", "Email for notices")}</h2>
      <p className="text-xs text-muted-foreground">
        {info.kind === "teacher"
          ? L("Onde você recebe o que muda na sua agenda, quando a empresa liga os e-mails.", "Where you get changes to your calendar, when the business turns emails on.")
          : L("Onde chegam marcações, mudanças de horário e lembretes, quando a empresa liga os e-mails.", "Where bookings, time changes and reminders arrive, when the business turns emails on.")}
      </p>
      <div className="space-y-1.5">
        {hasGuardian && <Label htmlFor="notif-email">{L("Seu e-mail", "Your email")}</Label>}
        <Input id="notif-email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={email}
          onChange={ev => setEmail(ev.target.value)} placeholder={L("seu@email.com", "you@email.com")} aria-label={L("E-mail para avisos", "Email for notices")} />
      </div>
      {hasGuardian && (
        <div className="space-y-1.5">
          <Label htmlFor="notif-guardian">{L(`E-mail de ${info.guardian_name}`, `${info.guardian_name}'s email`)}</Label>
          <Input id="notif-guardian" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={guardian}
            onChange={ev => setGuardian(ev.target.value)} placeholder={L("email@exemplo.com", "email@example.com")} />
        </div>
      )}
      {bad && <p className="text-xs text-destructive">{L("Confira o e-mail: falta o @ ou o domínio.", "Check the email: the @ or the domain is missing.")}</p>}
      <Button variant="outline" className="rounded-xl" disabled={busy || !changed || !!bad} onClick={save}>{L("Salvar e-mail", "Save email")}</Button>
    </Card>
  );
}

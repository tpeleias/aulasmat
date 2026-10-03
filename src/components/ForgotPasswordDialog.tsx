import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { USERNAME_DOMAIN } from "@/lib/username";
import { getLocale, L } from "@/lib/i18n";

/**
 * "Esqueci a senha" (03/10): manda um link para criar senha nova, pela função
 * "emails" (Resend). A resposta é sempre a mesma, tenha o e-mail conta ou não.
 * Quem entra por usuário (sem e-mail) pede a senha nova a quem o atende - o
 * admin tem o "redefinir senha".
 */
export function ForgotPasswordDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (v: boolean) => void; initial?: string }) {
  const [email, setEmail] = useState(initial?.includes("@") ? initial : "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const typed = email.trim().toLowerCase();
  const isUsername = !!typed && !typed.includes("@");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed || isUsername || typed.endsWith(`@${USERNAME_DOMAIN}`)) return;
    setBusy(true);
    await supabase.functions.invoke("emails", { body: { action: "password_reset", email: typed, locale: getLocale() } }).catch(() => null);
    setBusy(false);
    setDone(true);
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) setDone(false); }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{L("Esqueci a senha", "Forgot password")}</DialogTitle>
          <DialogDescription>
            {done
              ? L("Se esse e-mail tiver uma conta no Cronys, o link para criar uma senha nova chega em alguns minutos. Confira também o spam.",
                  "If that email has a Cronys account, the link to create a new password arrives in a few minutes. Check your spam folder too.")
              : L("Digite o e-mail com que você entra. Mandamos um link para criar uma senha nova.",
                  "Enter the email you sign in with. We'll send a link to create a new password.")}
          </DialogDescription>
        </DialogHeader>
        {!done && (
          <form onSubmit={submit} className="space-y-3">
            <Input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={email} onChange={e => setEmail(e.target.value)}
              placeholder={L("seu@email.com", "you@email.com")} className="h-12 rounded-xl" aria-label="E-mail" />
            {isUsername && (
              <p className="text-xs text-muted-foreground">
                {L("Quem entra com usuário (sem @) pede a senha nova a quem te atende: lá tem o botão de redefinir.",
                   "If you sign in with a username (no @), ask your provider for a new password: they have a reset button.")}
              </p>
            )}
            <Button type="submit" className="h-11 w-full gap-2 rounded-xl" disabled={busy || !typed || isUsername}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {L("Mandar o link", "Send the link")}
            </Button>
          </form>
        )}
        {done && <Button className="h-11 w-full rounded-xl" onClick={() => onOpenChange(false)}>{L("Entendi", "OK")}</Button>}
      </DialogContent>
    </Dialog>
  );
}

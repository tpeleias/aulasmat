import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CronysBadge } from "@/components/brand";
import { L } from "@/lib/i18n";

/**
 * Senha nova pelo link do "Esqueci a senha" (03/10). O link do e-mail abre
 * esta página já com a sessão de recuperação (o Supabase lê o endereço); aqui
 * só se escolhe a senha. Sem sessão, o link venceu ou já foi usado.
 */
export default function NewPassword() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = L("Criar senha nova", "Create a new password"); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) { toast.error(L("Use pelo menos 6 caracteres", "Use at least 6 characters")); return; }
    if (pw !== confirm) { toast.error(L("As senhas não coincidem", "Passwords don't match")); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(/different from the old/i.test(error.message) ? L("Escolha uma senha diferente da antiga.", "Choose a password different from the old one.") : error.message); return; }
    toast.success(L("Senha nova salva!", "New password saved!"));
    nav("/", { replace: true });
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md space-y-4 p-6">
        <div className="flex items-center gap-2">
          <CronysBadge className="h-10 w-10 rounded-xl" />
          <h1 className="flex items-center gap-2 font-semibold"><Lock className="h-4 w-4" /> {L("Criar senha nova", "Create a new password")}</h1>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">{L("Carregando…", "Loading…")}</p>
        ) : !session ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{L("Este link venceu ou já foi usado. Peça outro na tela de entrar, em \"Esqueci a senha\".", "This link has expired or was already used. Ask for another one on the sign-in screen, under \"Forgot password\".")}</p>
            <Button asChild className="w-full rounded-xl"><Link to="/entrar">{L("Ir para a tela de entrar", "Go to sign in")}</Link></Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-muted-foreground">{L(`Conta: ${session.user.email}`, `Account: ${session.user.email}`)}</p>
            <div><Label htmlFor="np1">{L("Senha nova", "New password")}</Label>
              <Input id="np1" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} className="h-11 rounded-xl" /></div>
            <div><Label htmlFor="np2">{L("Repita a senha", "Repeat the password")}</Label>
              <Input id="np2" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className="h-11 rounded-xl" /></div>
            <Button type="submit" className="h-11 w-full gap-2 rounded-xl" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {L("Salvar senha nova", "Save new password")}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

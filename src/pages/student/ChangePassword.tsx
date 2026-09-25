import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStudent } from "@/hooks/useStudent";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { CronysBadge } from "@/components/brand";

import { L } from "@/lib/i18n";
export default function ChangePassword() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { student, loading: stLoading } = useStudent();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = L("Alterar senha", "Change password");
  }, []);

  const { role } = useAuth();
  if (authLoading || stLoading) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{L("Carregando…", "Loading…")}</div>;
  if (!session) return <Navigate to="/entrar" replace />;
  const isChild = role === "child";
  const destination = isChild ? "/meu-painel" : "/aluno";
  const needsChange = isChild ? !!student?.child_must_change_password : !!student?.must_change_password;
  // If user doesn't need to change password, send them along
  if (student && !needsChange) return <Navigate to={destination} replace />;

  const releaseAccess = async () => {
    const { error: fnErr } = await supabase.functions.invoke("clear-must-change-password");
    if (fnErr) throw fnErr;
    toast.success(L("Senha definida!", "Password set!"));
    window.location.replace(destination);
  };

  const submit = async () => {
    if (pw.length < 6) { toast.error(L("Use pelo menos 6 caracteres", "Use at least 6 characters")); return; }
    if (pw !== confirm) { toast.error(L("As senhas não coincidem", "Passwords don't match")); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      if ((error as any).code === "same_password" || /different from the old/i.test(error.message)) {
        try {
          await releaseAccess();
        } catch {
          toast.error(L("Não foi possível liberar o acesso. Tente novamente.", "Could not unlock access. Please try again."));
        } finally {
          setBusy(false);
        }
      } else {
        setBusy(false);
        toast.error(error.message);
      }
      return;
    }
    try {
      await releaseAccess();
    } catch {
      setBusy(false);
      toast.error(L("Senha alterada, mas houve um erro ao liberar o acesso. Tente novamente.", "Password changed, but there was an error unlocking access. Please try again."));
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CronysBadge className="h-10 w-10 rounded-xl" />
          <div>
            <h1 className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4" /> {L("Definir nova senha", "Set a new password")}</h1>
            <p className="text-xs text-muted-foreground">{L("Para sua segurança, escolha uma senha pessoal antes de continuar.", "For your security, choose a personal password before continuing.")}</p>
          </div>
        </div>
        <div className="space-y-3">
          <div><Label>{L("Nova senha", "New password")}</Label><Input type="password" value={pw} onChange={e => setPw(e.target.value)} minLength={6} autoFocus /></div>
          <div><Label>{L("Confirme a senha", "Confirm password")}</Label><Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={6} /></div>
        </div>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy} className="flex-1">{L("Salvar", "Save")}</Button>
          <Button variant="ghost" onClick={signOut}>{L("Sair", "Sign out")}</Button>
        </div>
      </Card>
    </div>
  );
}

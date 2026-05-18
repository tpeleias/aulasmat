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
import { GraduationCap, Lock } from "lucide-react";

export default function ChangePassword() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { student, loading: stLoading } = useStudent();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Alterar senha";
  }, []);

  const { role } = useAuth();
  if (authLoading || stLoading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!session) return <Navigate to="/" replace />;
  const isChild = role === "child";
  const destination = isChild ? "/meu-painel" : "/aluno";
  const needsChange = isChild ? !!student?.child_must_change_password : !!student?.must_change_password;
  // If user doesn't need to change password, send them along
  if (student && !needsChange) return <Navigate to={destination} replace />;

  const releaseAccess = async () => {
    const { error: fnErr } = await supabase.functions.invoke("clear-must-change-password");
    if (fnErr) throw fnErr;
    toast.success("Senha definida!");
    window.location.replace(destination);
  };

  const submit = async () => {
    if (pw.length < 6) { toast.error("Use pelo menos 6 caracteres"); return; }
    if (pw !== confirm) { toast.error("As senhas não coincidem"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      if ((error as any).code === "same_password" || /different from the old/i.test(error.message)) {
        try {
          await releaseAccess();
        } catch {
          toast.error("Não foi possível liberar o acesso. Tente novamente.");
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
      toast.error("Senha alterada, mas houve um erro ao liberar o acesso. Tente novamente.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4" /> Definir nova senha</h1>
            <p className="text-xs text-muted-foreground">Para sua segurança, escolha uma senha pessoal antes de continuar.</p>
          </div>
        </div>
        <div className="space-y-3">
          <div><Label>Nova senha</Label><Input type="password" value={pw} onChange={e => setPw(e.target.value)} minLength={6} autoFocus /></div>
          <div><Label>Confirme a senha</Label><Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={6} /></div>
        </div>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy} className="flex-1">Salvar</Button>
          <Button variant="ghost" onClick={signOut}>Sair</Button>
        </div>
      </Card>
    </div>
  );
}

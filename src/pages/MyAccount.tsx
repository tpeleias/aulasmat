import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { USERNAME_DOMAIN } from "@/lib/username";

import { L } from "@/lib/i18n";
// Qualquer papel chega aqui (admin, professor, responsável, aluno). Excluir a
// própria conta dentro do app é exigência da Google Play para apps com
// cadastro; quem faz o trabalho é a edge function delete-my-account.
export default function MyAccount() {
  const { session, user, role, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const word = L("EXCLUIR", "DELETE");
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  if (loading) return null;
  if (!session) return <Navigate to="/entrar" replace />;

  const email = user?.email ?? "";
  const login = email.endsWith(`@${USERNAME_DOMAIN}`) ? email.slice(0, -USERNAME_DOMAIN.length - 1) : email;
  const back = role === "admin" || role === "teacher" ? "/admin" : role === "child" ? "/meu-painel" : "/aluno";

  const changePassword = async () => {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(L("Senha trocada", "Password changed"));
    setPw(""); setPw2("");
  };

  const remove = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("delete-my-account", { body: { confirm: "EXCLUIR" } });
    setBusy(false);
    // A mensagem de recusa (ex.: único admin da escola) vem no corpo.
    const msg = (data as { error?: string } | null)?.error
      ?? (error && "context" in error ? await (error as { context: Response }).context.json().then(b => b?.error, () => null) : null)
      ?? error?.message;
    if (msg || !(data as { ok?: boolean } | null)?.ok) { toast.error(msg || L("Não foi possível excluir a conta.", "Could not delete the account.")); return; }
    toast.success(L("Sua conta foi excluída.", "Your account was deleted."));
    await signOut().catch(() => {});
    navigate("/", { replace: true });
  };

  return (
    <div className="flex-1 bg-background">
      <div className="mx-auto w-full max-w-lg space-y-5 px-5 py-8">
        <Link to={back} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> {L("Voltar", "Back")}</Link>
        <div>
          <h1 className="text-2xl font-bold">{L("Minha conta", "My account")}</h1>
          <p className="text-sm text-muted-foreground">{L("Entrando como", "Signed in as")} <span className="font-medium text-foreground">{login}</span></p>
        </div>

        {/* /trocar-senha é só a troca obrigatória do primeiro acesso (quem não
            precisa trocar é mandado embora de lá), por isso a troca livre mora aqui. */}
        <Card className="space-y-3 rounded-2xl p-4">
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> {L("Trocar senha", "Change password")}</h2>
          <Input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder={L("Nova senha (mínimo 6)", "New password (min. 6)")} autoComplete="new-password" />
          <Input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder={L("Repita a nova senha", "Repeat the new password")} autoComplete="new-password" />
          <Button variant="outline" className="rounded-xl" disabled={busy || pw.length < 6 || pw !== pw2} onClick={changePassword}>{L("Salvar nova senha", "Save new password")}</Button>
        </Card>

        <Card className="space-y-3 rounded-2xl border-destructive/40 p-4">
          <div>
            <h2 className="font-semibold">{L("Excluir minha conta", "Delete my account")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {L("Apaga o seu acesso: você não consegue mais entrar com este login. O histórico de atendimentos e pagamentos continua com a empresa, que pode precisar dele para o controle financeiro - para pedir a exclusão desses dados, fale com a empresa.",
                "Deletes your access: you won't be able to sign in with this login anymore. The appointment and payment history stays with the company, which may need it for its records - to request deletion of that data, contact the company.")}
            </p>
          </div>
          <Button variant="destructive" className="gap-2 rounded-xl" onClick={() => { setTyped(""); setOpen(true); }}>
            <Trash2 className="h-4 w-4" /> {L("Excluir minha conta", "Delete my account")}
          </Button>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/termos" className="underline">{L("Termos de uso", "Terms of use")}</Link> · <Link to="/privacidade" className="underline">{L("Privacidade", "Privacy")}</Link>
        </p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{L("Excluir a conta de vez?", "Delete the account for good?")}</DialogTitle>
            <DialogDescription>{L("Isso não pode ser desfeito. Para confirmar, digite", "This can't be undone. To confirm, type")} {word}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{L("Confirmação", "Confirmation")}</Label>
            <Input value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="characters" placeholder={word} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{L("Cancelar", "Cancel")}</Button>
            <Button variant="destructive" disabled={busy || typed.trim().toUpperCase() !== word} onClick={remove}>{L("Excluir", "Delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

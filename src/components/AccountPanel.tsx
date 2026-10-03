import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Fingerprint, KeyRound, Moon, Navigation, Sun, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { USERNAME_DOMAIN } from "@/lib/username";
import { saveNavApp, useNavApp, type NavApp } from "@/lib/navigation";
import { L } from "@/lib/i18n";
import { biometricAvailable, forgetLogin, hasSavedLogin } from "@/lib/biometric";

/**
 * O que é da pessoa, não da empresa: login, senha, app de rota, modo claro ou
 * escuro e excluir a conta. O admin vê isto como a seção "Minha conta" das
 * Configurações (com o plano, que o SettingsPage passa em `plan`); os outros
 * papéis, na página /minha-conta.
 */
export default function AccountPanel({ plan }: { plan?: React.ReactNode }) {
  const { user, role, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const word = L("EXCLUIR", "DELETE");
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const navApp = useNavApp();
  // A escolha aparece na hora; a conta confirma em seguida.
  const [navPick, setNavPick] = useState<NavApp | null>(null);
  // Entrar com a digital (só no app, e só se o login estiver guardado).
  const [bioSaved, setBioSaved] = useState(false);
  useEffect(() => { void (async () => setBioSaved((await biometricAvailable()) && (await hasSavedLogin())))(); }, []);

  const email = user?.email ?? "";
  const login = email.endsWith(`@${USERNAME_DOMAIN}`) ? email.slice(0, -USERNAME_DOMAIN.length - 1) : email;
  const staff = role === "admin" || role === "teacher";
  // Conta de teste (o login do Hive): senha e exclusão travadas, também no
  // banco (migration 20260928020000). Aqui só troca o formulário pelo aviso.
  const demo = (user?.app_metadata as { demo_account?: boolean } | undefined)?.demo_account === true;
  const demoNote = L("Conta de teste: não é permitido mudar a senha nem excluir a conta.", "Test account: changing the password or deleting the account isn't allowed.");

  const changePassword = async () => {
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(L("Senha trocada", "Password changed"));
    setPw(""); setPw2("");
    // A senha guardada para a digital ficou velha: na próxima entrada com
    // senha o app oferece guardar de novo.
    if (bioSaved) { await forgetLogin(); setBioSaved(false); }
  };

  const pickNav = async (app: NavApp) => {
    setNavPick(app);
    const { error } = await saveNavApp(app);
    if (error) { setNavPick(null); toast.error(error.message); return; }
    toast.success(app === "maps" ? L("As rotas abrem no Google Maps", "Routes open in Google Maps") : L("As rotas abrem no Waze", "Routes open in Waze"));
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
    <div className="space-y-5">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><UserRound className="h-4 w-4" /> {L("Entrando como", "Signed in as")} <span className="font-medium text-foreground">{login}</span></p>

      {plan}

        <Card className="space-y-3 rounded-2xl p-4">
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> {L("Trocar senha", "Change password")}</h2>
          {demo ? <p className="text-sm text-muted-foreground">{demoNote}</p> : <>
          <Input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder={L("Nova senha (mínimo 6)", "New password (min. 6)")} autoComplete="new-password" />
          <Input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder={L("Repita a nova senha", "Repeat the new password")} autoComplete="new-password" />
          <Button variant="outline" className="rounded-xl" disabled={busy || pw.length < 6 || pw !== pw2} onClick={changePassword}>{L("Salvar nova senha", "Save new password")}</Button>
          </>}
          {bioSaved && (
            <Button variant="ghost" className="gap-2 rounded-xl px-0 text-muted-foreground"
              onClick={async () => { await forgetLogin(); setBioSaved(false); toast.success(L("Pronto: a digital não entra mais nesta conta", "Done: fingerprint sign-in is off")); }}>
              <Fingerprint className="h-4 w-4" /> {L("Parar de entrar com a digital", "Stop signing in with fingerprint")}
            </Button>
          )}
        </Card>

        {staff && (
          <Card className="space-y-3 rounded-2xl p-4">
            <div>
              <h2 className="flex items-center gap-2 font-semibold"><Navigation className="h-4 w-4" /> {L("App de rota", "Navigation app")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{L("Onde abre a rota até o endereço do atendimento.", "Where the route to the appointment address opens.")}</p>
            </div>
            <div className="flex gap-2" role="radiogroup" aria-label={L("App de rota", "Navigation app")}>
              {(["waze", "maps"] as const).map(app => {
                const on = (navPick ?? navApp) === app;
                return (
                  <Button key={app} type="button" role="radio" aria-checked={on} variant={on ? "default" : "outline"}
                    className="flex-1 rounded-xl" onClick={() => { if (!on) pickNav(app); }}>
                    {app === "maps" ? "Google Maps" : "Waze"}
                  </Button>
                );
              })}
            </div>
          </Card>
        )}

        <Card className="space-y-3 rounded-2xl p-4">
          <h2 className="flex items-center gap-2 font-semibold">{theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />} {L("Aparência", "Appearance")}</h2>
          <div className="flex gap-2" role="radiogroup" aria-label={L("Aparência", "Appearance")}>
            {(["light", "dark"] as const).map(t => (
              <Button key={t} type="button" role="radio" aria-checked={theme === t} variant={theme === t ? "default" : "outline"}
                className="flex-1 gap-2 rounded-xl" onClick={() => setTheme(t)}>
                {t === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                {t === "dark" ? L("Escuro", "Dark") : L("Claro", "Light")}
              </Button>
            ))}
          </div>
        </Card>

        <Card className="space-y-3 rounded-2xl border-destructive/40 p-4">
          <div>
            <h2 className="font-semibold">{L("Excluir minha conta", "Delete my account")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {L("Apaga o seu acesso: você não consegue mais entrar com este login. O histórico de atendimentos e pagamentos continua com a empresa, que pode precisar dele para o controle financeiro - para pedir a exclusão desses dados, fale com a empresa.",
                "Deletes your access: you won't be able to sign in with this login anymore. The appointment and payment history stays with the company, which may need it for its records - to request deletion of that data, contact the company.")}
            </p>
          </div>
          <Button variant="destructive" className="gap-2 rounded-xl" disabled={demo} onClick={() => { setTyped(""); setOpen(true); }}>
            <Trash2 className="h-4 w-4" /> {L("Excluir minha conta", "Delete my account")}
          </Button>
          {demo && <p className="text-xs text-muted-foreground">{demoNote}</p>}
        </Card>

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

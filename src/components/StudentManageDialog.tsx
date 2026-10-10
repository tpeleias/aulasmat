import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { useTasksEnabled, useWords } from "@/hooks/useVocabulary";
import { cap, listWithTasks } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
type Student = { id: string; student_name: string; guardian_name?: string | null; user_id: string | null; guardian_username?: string | null; child_user_id?: string | null; child_username?: string | null };

// Acesso do cliente ao portal: login, senha, convite (11/10: materiais e
// tarefas saíram daqui para a janela própria, StudentWorkDialog).
export function StudentManageDialog({ student, open, onOpenChange, onChanged }: {
  student: Student | null; open: boolean; onOpenChange: (v: boolean) => void; onChanged: () => void;
}) {
  if (!student) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle>{L(`Acesso de ${student.student_name}`, `${student.student_name}'s access`)}</DialogTitle></DialogHeader>
        <AccountTab student={student} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}

function AccountTab({ student, onChanged }: { student: Student; onChanged: () => void }) {
  const w = useWords();
  const [byUsername, setByUsername] = useState(false);
  const [email, setEmail] = useState("");
  const [guardianUser, setGuardianUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [newPw, setNewPw] = useState<string | null>(null);

  const link = async () => {
    // Families without an e-mail they actually read get a username instead; the server
    // refuses one that already belongs to a student or to another guardian.
    const body = byUsername
      ? { student_id: student.id, username: guardianUser, password }
      : { student_id: student.id, email: email.trim(), password: password || undefined };

    if (byUsername) {
      if (!isValidUsername(guardianUser)) { toast.error(L("Usuário inválido (3-30 caracteres: letras minúsculas, números, ponto, traço ou underline)", "Invalid username (3-30 characters: lowercase letters, numbers, dot, dash or underscore)")); return; }
      if (password.length < 6) { toast.error(L("Senha deve ter ao menos 6 caracteres", "Password must have at least 6 characters")); return; }
    } else if (!email.trim()) {
      toast.error(L("Informe o e-mail", "Enter the email")); return;
    }

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("link-student-account", { body });
    setBusy(false);
    if (error || (data as any)?.error) toast.error((data as any)?.error || error?.message || L("Erro ao vincular", "Error linking"));
    else { toast.success(L("Conta vinculada. A senha deverá ser trocada no primeiro acesso.", "Account linked. The password must be changed on first sign-in.")); onChanged(); }
  };

  const unlink = async () => {
    if (!confirm(L(`Desvincular a conta d${w.client.este} ${w.client.l}?`, `Unlink this ${w.client.l}'s account?`))) return;
    const { error } = await supabase.from("students").update({ user_id: null }).eq("id", student.id);
    if (error) toast.error(error.message); else { toast.success(L("Desvinculado", "Unlinked")); onChanged(); }
  };

  const resetPassword = async () => {
    if (!confirm(L(`Gerar uma nova senha provisória? ${cap(w.payer.o)} ${w.payer.l} deverá trocá-la no próximo acesso.`, `Generate a new temporary password? The ${w.payer.l} will have to change it on next sign-in.`))) return;
    setBusy(true); setNewPw(null);
    const { data, error } = await supabase.functions.invoke("admin-reset-student-password", {
      body: { student_id: student.id },
    });
    setBusy(false);
    if (error || (data as any)?.error) toast.error((data as any)?.error || error?.message || L("Erro ao resetar", "Error resetting"));
    else { setNewPw((data as any).password); toast.success(L("Senha redefinida", "Password reset")); }
  };

  return (
    <div className="space-y-4">
      {student.user_id ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{L("Conta vinculada", "Linked account")}</div>
              <div className="text-xs text-muted-foreground font-mono break-all">
                {student.guardian_username ? `${L("usuário", "username")}: ${student.guardian_username}` : student.user_id}
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={unlink}>{L("Desvincular", "Unlink")}</Button>
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {L(`Por segurança, senhas são armazenadas com hash e não podem ser visualizadas. Em vez disso, gere uma nova senha provisória — ${w.payer.o} ${w.payer.l} ${w.payer.pick("será forçado", "será forçada")} a trocá-la no próximo login.`,
                 `For security, passwords are hashed and can't be viewed. Instead, generate a new temporary password — the ${w.payer.l} will have to change it on next sign-in.`)}
            </p>
            <Button onClick={resetPassword} disabled={busy} variant="outline" size="sm">{L("Resetar senha", "Reset password")}</Button>
            {newPw && (
              <div className="rounded-md bg-muted p-3 text-sm flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">{L("Nova senha provisória", "New temporary password")}</div>
                  <div className="font-mono font-bold">{newPw}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newPw); toast.success(L("Copiada", "Copied")); }}>{L("Copiar", "Copy")}</Button>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-4 space-y-3">
          <div>
            <div className="text-sm font-medium mb-1">{L(`Criar acesso ${w.payer.do} ${w.payer.l}`, `Create ${w.payer.l} login`)}</div>
            <p className="text-xs text-muted-foreground">
              {L("Por e-mail, se a pessoa usa um. Por nome de usuário, quando não usa: funciona igual, só não serve para recuperar senha sozinho.", "By email, if they use one. By username when they don't: it works the same, but they can't recover the password on their own.")}
            </p>
          </div>

          <div className="inline-flex rounded-md border border-border p-0.5 bg-muted text-xs">
            <button type="button" onClick={() => setByUsername(false)} className={`px-3 py-1 rounded ${!byUsername ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>E-mail</button>
            <button type="button" onClick={() => setByUsername(true)} className={`px-3 py-1 rounded ${byUsername ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>{L("Usuário", "Username")}</button>
          </div>

          {byUsername ? (
            <>
              <div>
                <Label>{L("Nome de usuário", "Username")}</Label>
                <Input value={guardianUser} onChange={e => setGuardianUser(normalizeUsername(e.target.value))} placeholder={L("ex: flavia.miguel", "e.g. mary.smith")} autoCapitalize="none" autoCorrect="off" />
              </div>
              <div><Label>{L("Senha", "Password")}</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
            </>
          ) : (
            <>
              <div><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
              <div><Label>{L("Senha temporária (opcional, só para criar)", "Temporary password (optional, only when creating)")}</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
            </>
          )}
          <Button onClick={link} disabled={busy} className="gap-2"><Link2 className="w-4 h-4" /> {L("Criar acesso", "Create login")}</Button>
        </Card>
      )}

      {/* Pet não entra no app; o login é do tutor. */}
      {/* Login próprio do menor: em aulas sempre; nos ramos em que quem paga
          é o próprio cliente, só se ele tem responsável (menor de 18). */}
      {w.model !== "pet" && (w.model === "aulas" || !!student.guardian_name?.trim() || !!student.child_user_id)
        && <ChildAccessSection student={student} onChanged={onChanged} />}
    </div>
  );
}

function ChildAccessSection({ student, onChanged }: { student: Student; onChanged: () => void }) {
  const w = useWords();
  const tasks = useTasksEnabled();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [resetPw, setResetPw] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!isValidUsername(username)) { toast.error(L("Username inválido (3-30 caracteres: letras minúsculas, números, ponto, traço, underline)", "Invalid username (3-30 characters: lowercase letters, numbers, dot, dash, underscore)")); return; }
    if (password.length < 6) { toast.error(L("Senha deve ter ao menos 6 caracteres", "Password must have at least 6 characters")); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-child-account", {
      body: { student_id: student.id, username, password, action: "create" },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || "Erro"); return; }
    toast.success(L(`Acesso criado para ${(data as any).username}`, `Login created for ${(data as any).username}`));
    setUsername(""); setPassword("");
    onChanged();
  };

  const reset = async () => {
    if (resetPw.length < 6) { toast.error(L("Senha deve ter ao menos 6 caracteres", "Password must have at least 6 characters")); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("create-child-account", {
      body: { student_id: student.id, password: resetPw, action: "reset" },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || "Erro"); return; }
    toast.success(L("Senha redefinida", "Password reset"));
    setResetPw(""); setShowReset(false);
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="text-sm font-medium mb-1">{L(`Acesso próprio ${w.client.do} ${w.client.l} (ex.: criança ou adolescente)`, `The ${w.client.l}'s own login (e.g. a child or teenager)`)}</div>
        <p className="text-xs text-muted-foreground">
          {L(`Login simples por username, com acesso restrito a ${listWithTasks([w.appointment.lp, "materiais"], w, tasks)} (sem dados financeiros).`, `Simple username login, limited to ${listWithTasks([w.appointment.lp, "materials"], w, tasks)} (no billing data).`)}
        </p>
      </div>
      {student.child_username ? (
        <div className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-sm">
            <div className="text-xs text-muted-foreground">{L("Nome de usuário", "Username")}</div>
            <div className="font-mono font-bold">{student.child_username}</div>
          </div>
          {!showReset ? (
            <Button variant="outline" size="sm" onClick={() => setShowReset(true)}>{L("Redefinir senha", "Reset password")}</Button>
          ) : (
            <div className="space-y-2 border-t border-border pt-3">
              <div><Label>{L("Nova senha", "New password")}</Label><Input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)} minLength={6} /></div>
              <div className="flex gap-2">
                <Button size="sm" onClick={reset} disabled={busy}>{L("Salvar", "Save")}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowReset(false); setResetPw(""); }}>{L("Cancelar", "Cancel")}</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <Label>Username</Label>
            <Input value={username} onChange={e => setUsername(normalizeUsername(e.target.value))} placeholder={L("ex: miguel.silva", "e.g. mike.smith")} autoCapitalize="none" autoCorrect="off" />
          </div>
          <div><Label>{L("Senha", "Password")}</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} /></div>
          <Button onClick={create} disabled={busy} size="sm">{L(`Gerar acesso ${w.client.do} ${w.client.l}`, `Create the ${w.client.l}'s login`)}</Button>
        </div>
      )}
    </Card>
  );
}

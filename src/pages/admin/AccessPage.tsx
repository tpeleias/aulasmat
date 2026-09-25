import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KeyRound, Send, Users, ShieldCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { StudentManageDialog } from "@/components/StudentManageDialog";
import EmptyState from "@/components/EmptyState";
import ListSkeleton from "@/components/ListSkeleton";
import PullToRefresh from "@/components/PullToRefresh";
import { haptics } from "@/lib/haptics";
import { publicSiteUrl } from "@/lib/publicUrl";
import { usePlan } from "@/hooks/usePlan";
import { useWords } from "@/hooks/useVocabulary";
import { cap, type Vocabulary } from "@/lib/vocabulary";

import { L } from "@/lib/i18n";
type Student = {
  id: string; student_name: string; guardian_name: string | null;
  user_id: string | null; guardian_username: string | null;
  child_user_id: string | null; child_username: string | null;
};

type Visibility = {
  allow_student_booking: boolean;
  show_availability_to_students: boolean;
  show_payment_info_to_students: boolean;
};

const FILTERS = [
  { key: "all", label: L("Todos", "All") },
  { key: "with", label: L("Com acesso", "With access") },
  { key: "without", label: L("Sem acesso", "Without access") },
] as const;

type Filter = typeof FILTERS[number]["key"];

const toggles = (w: Vocabulary): { key: keyof Visibility; label: string; hint: string }[] => [
  { key: "allow_student_booking", label: L(`Deixar marcar ${w.appointment.l}`, `Allow booking ${w.appointment.lp}`), hint: L(`${cap(w.guardian.o)} ${w.guardian.l} escolhe um horário livre e agenda sozinho.`, `The ${w.guardian.l} picks a free time and books on their own.`) },
  { key: "show_availability_to_students", label: L("Mostrar disponibilidade", "Show availability"), hint: L(`Link com os horários livres de cada ${w.staff.l}.`, `Link with each ${w.staff.l}'s free times.`) },
  { key: "show_payment_info_to_students", label: L("Mostrar como pagar", "Show how to pay"), hint: L("Chave Pix e link de pagamento no portal.", "Payment link in the portal.") },
];

export default function AccessPage() {
  const { plan } = usePlan();
  const w = useWords();
  const TOGGLES = toggles(w);
  const [students, setStudents] = useState<Student[]>([]);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  // O banco entrega só a linha da própria empresa; guardamos o id dela para gravar.
  const [settingsRowId, setSettingsRowId] = useState<number | null>(null);
  const [manageFor, setManageFor] = useState<Student | null>(null);
  const [inviteFor, setInviteFor] = useState<Student | null>(null);
  const [invitePassword, setInvitePassword] = useState("");

  const load = async () => {
    const [{ data: st }, { data: cfg }] = await Promise.all([
      supabase.from("students").select("id, student_name, guardian_name, user_id, guardian_username, child_user_id, child_username").order("student_name"),
      supabase.from("settings").select("id, allow_student_booking, show_availability_to_students, show_payment_info_to_students").maybeSingle(),
    ]);
    setStudents((st ?? []) as Student[]);
    if (cfg) {
      const { id, ...flags } = cfg as Visibility & { id: number };
      setSettingsRowId(id);
      setVisibility(flags as Visibility);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const withAccess = useMemo(
    () => students.filter(s => s.user_id || s.child_user_id).length,
    [students]
  );

  const visible = useMemo(() => {
    if (filter === "with") return students.filter(s => s.user_id || s.child_user_id);
    if (filter === "without") return students.filter(s => !s.user_id && !s.child_user_id);
    return students;
  }, [students, filter]);

  const saveVisibility = async (key: keyof Visibility, value: boolean) => {
    if (!visibility || settingsRowId === null) return;
    const previous = visibility;
    setVisibility({ ...visibility, [key]: value });
    const patch: Partial<Visibility> = { [key]: value };
    const { error } = await supabase.from("settings").update(patch).eq("id", settingsRowId);
    if (error) { setVisibility(previous); toast.error(error.message); }
    else { haptics.success(); toast.success(L("Preferência salva", "Preference saved")); }
  };

  // The password is never readable after it is set, so it is typed in here only when the
  // teacher just generated one and wants to send it along.
  const inviteText = (s: Student, password: string) => {
    const who = (s.guardian_name?.trim() || s.student_name).split(" ")[0];
    const lines = [
      L(`Oi, ${who}! Criei um acesso no app ${w.business.do} ${w.business.l} para você acompanhar ${s.student_name}.`, `Hi ${who}! I created a login for you in our app so you can follow ${s.student_name}.`),
      "",
      `Link: ${publicSiteUrl()}/`,
    ];
    if (s.guardian_username) lines.push(L(`Seu acesso: usuário ${s.guardian_username}.`, `Your login: username ${s.guardian_username}.`));
    else if (s.user_id) lines.push(L("Entre com o seu e-mail.", "Sign in with your email."));
    else if (plan.school_code) lines.push(L(`Para criar sua conta pelo app, use o código ${w.business.do} ${w.business.l}: ${plan.school_code}`, `To create your account in the app, use our code: ${plan.school_code}`));
    if (s.child_username) lines.push(L(`Acesso ${w.client.do} ${w.client.l}: usuário ${s.child_username} (entra na mesma tela, com a senha dele).`, `The ${w.client.l}'s login: username ${s.child_username} (same sign-in screen, with their own password).`));
    if (password.trim()) lines.push(L(`Senha provisória: ${password.trim()} (o app pede para trocar no primeiro acesso).`, `Temporary password: ${password.trim()} (the app asks you to change it on first sign-in).`));
    lines.push("", L(`Por lá você vê ${w.appointment.os} ${w.appointment.pick("próximos", "próximas")} ${w.appointment.lp}, o que está em aberto, os materiais e as tarefas.`, `There you'll see upcoming ${w.appointment.lp}, what's outstanding, materials and homework.`));
    return lines.join("\n");
  };

  const sendInvite = async () => {
    if (!inviteFor) return;
    const text = inviteText(inviteFor, invitePassword);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast.success(L("Convite copiado", "Invite copied")); }
      haptics.success();
    } catch {
      // The share sheet was dismissed, or sharing is unavailable: fall back to the clipboard.
      try { await navigator.clipboard.writeText(text); toast.success(L("Convite copiado", "Invite copied")); } catch { toast.error(L("Não foi possível copiar", "Couldn't copy")); }
    }
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6" /> {L("Acessos", "Access")}</h1>
          <p className="text-sm text-muted-foreground">
            {L("Quem entra no portal e o que enxerga por lá.", "Who signs in to the portal and what they see there.")}
          </p>
        </div>

        <Card className="rounded-2xl p-4 md:p-5">
          <div className="text-xs uppercase text-muted-foreground">{L(`${w.guardian.p} com acesso`, `${w.guardian.p} with access`)}</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">{withAccess}<span className="text-base font-normal text-muted-foreground"> {L("de", "of")} {students.length}</span></div>
        </Card>

        <Card className="rounded-2xl p-4 md:p-5 space-y-4">
          <div className="text-sm font-semibold">{L(`O que ${w.guardian.o} ${w.guardian.l} pode fazer`, `What the ${w.guardian.l} can do`)}</div>
          {TOGGLES.map(t => (
            <div key={t.key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm">{t.label}</div>
                <div className="text-xs text-muted-foreground">{t.hint}</div>
              </div>
              <Switch
                checked={!!visibility?.[t.key]}
                disabled={!visibility}
                onCheckedChange={v => saveVisibility(t.key, v)}
              />
            </div>
          ))}
        </Card>

        <div className="flex items-center gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => { haptics.tap(); setFilter(f.key); }}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === f.key ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"
              }`}
            >{f.label}</button>
          ))}
        </div>

        {loading ? (
          <ListSkeleton rows={5} />
        ) : visible.length === 0 ? (
          <EmptyState icon={Users} title={L(`${w.client.nenhum} ${w.client.l} aqui`, `No ${w.client.lp} here`)} description={L("Troque o filtro para ver os outros cadastros.", "Change the filter to see the others.")} />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border">
            {visible.map(s => (
              <li key={s.id} className="p-4 space-y-3">
                <div>
                  <div className="font-medium">{s.student_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.guardian_name ? `${w.guardian.s}: ${s.guardian_name}` : L(`Sem ${w.guardian.l} ${w.guardian.pick("cadastrado", "cadastrada")}`, `No ${w.guardian.l} on file`)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={s.user_id ? "default" : "outline"} className="rounded-full text-[10px]">
                    {s.guardian_username
                      ? `${w.guardian.s}: ${s.guardian_username}`
                      : s.user_id ? L(`${w.guardian.s} por e-mail`, `${w.guardian.s} by email`) : L(`${w.guardian.s} sem acesso`, `${w.guardian.s} without access`)}
                  </Badge>
                  <Badge variant={s.child_user_id ? "default" : "outline"} className="rounded-full text-[10px]">
                    {s.child_username ? `${w.client.s}: ${s.child_username}` : L(`${w.client.s} sem acesso`, `${w.client.s} without access`)}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => { haptics.tap(); setManageFor(s); }}>
                    <KeyRound className="h-3.5 w-3.5" /> {L("Gerenciar acesso", "Manage access")}
                  </Button>
                  {(s.user_id || s.child_user_id) && (
                    <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => { haptics.tap(); setInvitePassword(""); setInviteFor(s); }}>
                      <Send className="h-3.5 w-3.5" /> {L("Enviar convite", "Send invite")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <StudentManageDialog
        student={manageFor}
        open={!!manageFor}
        onOpenChange={v => !v && setManageFor(null)}
        onChanged={load}
      />

      <Dialog open={!!inviteFor} onOpenChange={v => !v && setInviteFor(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{L("Enviar convite", "Send invite")}</DialogTitle>
            <DialogDescription>{inviteFor?.student_name}</DialogDescription>
          </DialogHeader>
          {inviteFor && (
            <div className="space-y-3">
              <div>
                <Label>{L("Senha provisória (opcional)", "Temporary password (optional)")}</Label>
                <Input
                  className="h-11 rounded-xl"
                  value={invitePassword}
                  onChange={e => setInvitePassword(e.target.value)}
                  placeholder={L("cole aqui se acabou de gerar", "paste here if you just generated one")}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {L("Senhas ficam guardadas com hash e não podem ser lidas depois. Gere uma nova em “Gerenciar acesso” e cole aqui.", "Passwords are hashed and can't be read later. Generate a new one in “Manage access” and paste it here.")}
                </p>
              </div>
              <div>
                <Label>{L("Mensagem", "Message")}</Label>
                <Textarea readOnly value={inviteText(inviteFor, invitePassword)} className="min-h-[170px] rounded-xl text-xs" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setInviteFor(null)}>{L("Fechar", "Close")}</Button>
            <Button className="rounded-xl gap-1.5" onClick={sendInvite}>
              <Copy className="h-4 w-4" /> {L("Copiar ou compartilhar", "Copy or share")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PullToRefresh>
  );
}

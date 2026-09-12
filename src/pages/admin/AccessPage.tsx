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

type Student = {
  id: string; student_name: string; guardian_name: string | null;
  user_id: string | null; child_user_id: string | null; child_username: string | null;
};

type Visibility = {
  allow_student_booking: boolean;
  show_availability_to_students: boolean;
  show_payment_info_to_students: boolean;
};

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "with", label: "Com acesso" },
  { key: "without", label: "Sem acesso" },
] as const;

type Filter = typeof FILTERS[number]["key"];

const TOGGLES: { key: keyof Visibility; label: string; hint: string }[] = [
  { key: "allow_student_booking", label: "Deixar marcar aula", hint: "O responsável escolhe um horário livre e agenda sozinho." },
  { key: "show_availability_to_students", label: "Mostrar disponibilidade", hint: "Link com os horários livres de cada professor." },
  { key: "show_payment_info_to_students", label: "Mostrar como pagar", hint: "Chave Pix e link de pagamento no portal da família." },
];

export default function AccessPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [manageFor, setManageFor] = useState<Student | null>(null);
  const [inviteFor, setInviteFor] = useState<Student | null>(null);
  const [invitePassword, setInvitePassword] = useState("");

  const load = async () => {
    const [{ data: st }, { data: cfg }] = await Promise.all([
      supabase.from("students").select("id, student_name, guardian_name, user_id, child_user_id, child_username").order("student_name"),
      supabase.from("settings").select("allow_student_booking, show_availability_to_students, show_payment_info_to_students").eq("id", 1).maybeSingle(),
    ]);
    setStudents((st ?? []) as Student[]);
    if (cfg) setVisibility(cfg as Visibility);
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
    if (!visibility) return;
    const previous = visibility;
    setVisibility({ ...visibility, [key]: value });
    const patch: Partial<Visibility> = { [key]: value };
    const { error } = await supabase.from("settings").update(patch).eq("id", 1);
    if (error) { setVisibility(previous); toast.error(error.message); }
    else { haptics.success(); toast.success("Preferência salva"); }
  };

  // The password is never readable after it is set, so it is typed in here only when the
  // teacher just generated one and wants to send it along.
  const inviteText = (s: Student, password: string) => {
    const who = (s.guardian_name?.trim() || s.student_name).split(" ")[0];
    const lines = [
      `Oi, ${who}! Criei um acesso no app das aulas para você acompanhar ${s.student_name}.`,
      "",
      `Link: ${window.location.origin}/`,
    ];
    if (s.user_id) lines.push("Entre em “Responsável · Aluno” com o seu e-mail.");
    if (s.child_username) lines.push(`Acesso do aluno: usuário ${s.child_username}.`);
    if (password.trim()) lines.push(`Senha provisória: ${password.trim()} (o app pede para trocar no primeiro acesso).`);
    lines.push("", "Por lá você vê as próximas aulas, o que está em aberto, os materiais e as tarefas.");
    return lines.join("\n");
  };

  const sendInvite = async () => {
    if (!inviteFor) return;
    const text = inviteText(inviteFor, invitePassword);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast.success("Convite copiado"); }
      haptics.success();
    } catch {
      // The share sheet was dismissed, or sharing is unavailable: fall back to the clipboard.
      try { await navigator.clipboard.writeText(text); toast.success("Convite copiado"); } catch { toast.error("Não foi possível copiar"); }
    }
  };

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-6 w-6" /> Acessos</h1>
          <p className="text-sm text-muted-foreground">
            Quem da família entra no app e o que enxerga por lá.
          </p>
        </div>

        <Card className="rounded-2xl p-4 md:p-5">
          <div className="text-xs uppercase text-muted-foreground">Famílias com acesso</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">{withAccess}<span className="text-base font-normal text-muted-foreground"> de {students.length}</span></div>
        </Card>

        <Card className="rounded-2xl p-4 md:p-5 space-y-4">
          <div className="text-sm font-semibold">O que a família pode fazer</div>
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
          <EmptyState icon={Users} title="Nenhum aluno aqui" description="Troque o filtro para ver os outros cadastros." />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border">
            {visible.map(s => (
              <li key={s.id} className="p-4 space-y-3">
                <div>
                  <div className="font-medium">{s.student_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.guardian_name ? `Resp.: ${s.guardian_name}` : "Sem responsável cadastrado"}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={s.user_id ? "default" : "outline"} className="rounded-full text-[10px]">
                    {s.user_id ? "Responsável com acesso" : "Responsável sem acesso"}
                  </Badge>
                  <Badge variant={s.child_user_id ? "default" : "outline"} className="rounded-full text-[10px]">
                    {s.child_username ? `Aluno: ${s.child_username}` : "Aluno sem acesso"}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => { haptics.tap(); setManageFor(s); }}>
                    <KeyRound className="h-3.5 w-3.5" /> Gerenciar acesso
                  </Button>
                  {(s.user_id || s.child_user_id) && (
                    <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => { haptics.tap(); setInvitePassword(""); setInviteFor(s); }}>
                      <Send className="h-3.5 w-3.5" /> Enviar convite
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
            <DialogTitle>Enviar convite</DialogTitle>
            <DialogDescription>{inviteFor?.student_name}</DialogDescription>
          </DialogHeader>
          {inviteFor && (
            <div className="space-y-3">
              <div>
                <Label>Senha provisória (opcional)</Label>
                <Input
                  className="h-11 rounded-xl"
                  value={invitePassword}
                  onChange={e => setInvitePassword(e.target.value)}
                  placeholder="cole aqui se acabou de gerar"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Senhas ficam guardadas com hash e não podem ser lidas depois. Gere uma nova em “Gerenciar acesso” e cole aqui.
                </p>
              </div>
              <div>
                <Label>Mensagem</Label>
                <Textarea readOnly value={inviteText(inviteFor, invitePassword)} className="min-h-[170px] rounded-xl text-xs" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setInviteFor(null)}>Fechar</Button>
            <Button className="rounded-xl gap-1.5" onClick={sendInvite}>
              <Copy className="h-4 w-4" /> Copiar ou compartilhar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PullToRefresh>
  );
}

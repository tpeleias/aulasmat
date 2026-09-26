import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Users, ChevronRight, Search, Link2, FileUp } from "lucide-react";
import { toast } from "sonner";
import { LessonDialog } from "@/components/LessonDialog";
import { useDefaultTeacher } from "@/hooks/useDefaultTeacher";
import { StudentManageDialog } from "@/components/StudentManageDialog";
import StudentImportDialog from "@/components/StudentImportDialog";
import StudentSheet, { type SheetLesson } from "@/components/StudentSheet";
import EmptyState from "@/components/EmptyState";
import ListSkeleton from "@/components/ListSkeleton";
import PullToRefresh from "@/components/PullToRefresh";
import SortMenu, { useSortPreference } from "@/components/SortMenu";
import { accountKey, fmtMoney } from "@/lib/balance";
import { computeStatements, isOverdue, type LedgerTx } from "@/lib/billing";
import { haptics } from "@/lib/haptics";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/hooks/useAuth";
import { ProUpsell } from "@/components/ProUpsell";
import { nextPlanForClients, upgradeOffer } from "@/lib/subscription";
import { useWords } from "@/hooks/useVocabulary";
import { dbErrorMessage } from "@/lib/dbErrors";
import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";
import { normalizeWhatsApp } from "@/lib/whatsapp";

import { L } from "@/lib/i18n";
type Student = {
  id: string; student_name: string; guardian_name: string | null; address: string | null; user_id: string | null;
  /** Migration 20260925070000; ausente antes dela. */
  whatsapp?: string | null;
  // Ausente enquanto a migration 20260923020000 não estiver aplicada - e aí
  // ninguém está travado, que é exatamente o comportamento de antes.
  plan_locked?: boolean;
};
type Lesson = SheetLesson & { student_name: string; guardian_name: string | null };

type StudentSort = "name" | "owed" | "next" | "lessons";

const studentSorts = (w: Vocabulary): { key: StudentSort; label: string }[] => [
  { key: "name", label: L("Nome (A–Z)", "Name (A–Z)") },
  { key: "owed", label: L("Maior valor em aberto", "Largest amount due") },
  { key: "next", label: L(`${w.appointment.proximo} ${w.appointment.l}`, `Next ${w.appointment.l}`) },
  { key: "lessons", label: L(`Mais ${w.appointment.lp}`, `Most ${w.appointment.lp}`) },
];
// Só as chaves importam para lembrar a ordem escolhida.
const STUDENT_SORTS = studentSorts(DEFAULT_VOCABULARY);

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("");

export default function StudentsPage() {
  const { plan } = usePlan();
  // Login de professor: vê os alunos e cadastra novo, mas não o financeiro
  // nem a administração do cadastro (editar, acessos, excluir, pausar).
  const { isTeacher } = useAuth();
  const w = useWords();
  const c = w.client;
  const SORTS = studentSorts(w);
  const navigate = useNavigate();
  const [students, setStudents] = useState<Student[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [txs, setTxs] = useState<LedgerTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useSortPreference<StudentSort>("alunos", STUDENT_SORTS, "name");
  const [selected, setSelected] = useState<Student | null>(null);
  const [editing, setEditing] = useState<Partial<Student> | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Student | null>(null);
  const [manageFor, setManageFor] = useState<Student | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const defaultTeacher = useDefaultTeacher();

  const load = async () => {
    const [{ data: s }, { data: l }, { data: t }] = await Promise.all([
      supabase.from("students").select("*").order("student_name"),
      supabase.from("lessons").select("id, student_name, guardian_name, start_at, duration_minutes, subject, teacher, status"),
      isTeacher
        ? Promise.resolve({ data: [] as LedgerTx[] })
        : supabase.from("wallet_transactions").select("id, guardian_name, student_name, amount, kind, lesson_id, description, created_at"),
    ]);
    setStudents((s ?? []) as Student[]);
    setLessons((l ?? []) as Lesson[]);
    setTxs((t ?? []) as LedgerTx[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const statements = useMemo(() => {
    const done = lessons.filter(l => l.status === "realizada");
    return new Map(computeStatements(txs, done, w).map(s => [s.key, s]));
  }, [txs, lessons, w]);

  const lessonsByAccount = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const l of lessons) (map.get(accountKey(l)) ?? map.set(accountKey(l), []).get(accountKey(l))!).push(l);
    return map;
  }, [lessons]);

  // Start of the next scheduled lesson per account, for the "Próxima aula" order.
  const nextByAccount = useMemo(() => {
    const nowIso = new Date().toISOString();
    const map = new Map<string, string>();
    for (const l of lessons) {
      if (l.status !== "agendada" || l.start_at < nowIso) continue;
      const k = accountKey(l);
      const cur = map.get(k);
      if (!cur || l.start_at < cur) map.set(k, l.start_at);
    }
    return map;
  }, [lessons]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q
      ? students.filter(s => s.student_name.toLowerCase().includes(q) || (s.guardian_name ?? "").toLowerCase().includes(q))
      : [...students];

    const byName = (a: Student, b: Student) => a.student_name.localeCompare(b.student_name, "pt-BR");
    const owedOf = (s: Student) => statements.get(accountKey(s))?.owed ?? 0;

    switch (sort) {
      case "owed":
        return found.sort((a, b) => owedOf(b) - owedOf(a) || byName(a, b));
      case "lessons":
        return found.sort((a, b) =>
          (lessonsByAccount.get(accountKey(b))?.length ?? 0) - (lessonsByAccount.get(accountKey(a))?.length ?? 0) || byName(a, b));
      case "next":
        // Who you see soonest comes first; students with nothing booked go last.
        return found.sort((a, b) => {
          const na = nextByAccount.get(accountKey(a));
          const nb = nextByAccount.get(accountKey(b));
          if (!na && !nb) return byName(a, b);
          if (!na) return 1;
          if (!nb) return -1;
          return na.localeCompare(nb);
        });
      default:
        return found.sort(byName);
    }
  }, [students, query, sort, statements, lessonsByAccount, nextByAccount]);

  const save = async () => {
    if (!editing?.student_name?.trim()) { toast.error(L(`Nome ${c.do} ${c.l} obrigatório`, `${c.s} name is required`)); return; }
    const zap = normalizeWhatsApp(editing.whatsapp);
    if (zap === "invalido") { toast.error(L("WhatsApp com DDD, ex.: (11) 98765-4321", "WhatsApp with country code, e.g. +1 555 123 4567")); return; }
    setBusy(true);
    const payload = {
      student_name: editing.student_name.trim(),
      guardian_name: editing.guardian_name?.trim() || null,
      address: editing.address?.trim() || null,
      // Só manda a coluna quando há o que gravar: antes da migration ela não existe.
      ...(zap || editing.whatsapp !== undefined ? { whatsapp: zap } : {}),
    } as never;
    const { error } = editing.id
      ? await supabase.from("students").update(payload).eq("id", editing.id)
      : await supabase.from("students").insert(payload);
    setBusy(false);
    if (error) { haptics.warning(); toast.error(dbErrorMessage(error, w)); }
    else { haptics.success(); toast.success(L(`${c.s} ${c.pick("salvo", "salva")}`, `${c.s} saved`)); setEditing(null); setSelected(null); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm(L(`Excluir ${c.este} ${c.l} do cadastro? (Não afeta ${w.appointment.lp} existentes)`, `Delete this ${c.l}? (Existing ${w.appointment.lp} are not affected)`))) return;
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) toast.error(error.message); else { haptics.success(); toast.success(L(`${c.s} ${c.pick("excluído", "excluída")}`, `${c.s} deleted`)); setSelected(null); load(); }
  };

  // Limite do plano: clientes ATIVOS (atendimento nos últimos N dias ou
  // marcado), contados pelo banco. Cadastrar é livre.
  const activeLimit = plan.max_active_clients ?? null;
  const activeNow = plan.active_clients ?? 0;
  const atActiveLimit = activeLimit !== null && activeNow >= activeLimit;
  const nextTier = activeLimit !== null ? nextPlanForClients(activeLimit) : null;

  const selectedStatement = selected ? statements.get(accountKey(selected)) : undefined;
  const selectedLessons = selected ? (lessonsByAccount.get(accountKey(selected)) ?? []) : [];

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6" /> {c.p}</h1>
            <p className="text-sm text-muted-foreground">
              {L(`${students.length} cadastrado${students.length === 1 ? "" : "s"}`, `${students.length} total`)}
              {!isTeacher && activeLimit !== null && (
                <span title={L(`Ativo: atendimento nos últimos ${plan.active_client_days ?? 60} dias ou marcado`, `Active: an appointment in the last ${plan.active_client_days ?? 60} days or booked`)}>
                  {L(` · ${activeNow} de ${activeLimit} ${c.lp} ativos`, ` · ${activeNow} of ${activeLimit} active ${c.lp}`)}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {!isTeacher && (
              <Button variant="outline" className="rounded-xl gap-1.5" title={L("Cadastrar vários de uma planilha", "Add many from a spreadsheet")}
                onClick={() => { haptics.tap(); setImportOpen(true); }}>
                <FileUp className="w-4 h-4" /> {L("Importar", "Import")}
              </Button>
            )}
            {!isTeacher && <Button
              className="rounded-xl gap-1.5"
              onClick={() => { haptics.tap(); setEditing({ student_name: "", guardian_name: "", address: "" }); }}>
              <Plus className="w-4 h-4" /> {L("Novo", "New")}
            </Button>}
          </div>
        </div>

        {!isTeacher && atActiveLimit && (
          <ProUpsell titulo={L(`Você chegou a ${activeLimit} ${c.lp} ativos, o limite do seu plano`, `You've reached ${activeLimit} active ${c.lp}, your plan's limit`)} icon={Users} compacto>
            {L(`Quem já é ativo continua normal, e cadastrar é livre. Para marcar ${w.appointment.um} ${w.appointment.l} com ${c.um} ${c.l} novo, libere uma vaga (quem fica ${plan.active_client_days ?? 60} dias sem ${w.appointment.l} deixa de contar)`,
               `Existing active ${c.lp} keep working, and adding is free. To book a new ${c.l}, free up a spot (anyone without ${w.appointment.lp} for ${plan.active_client_days ?? 60} days stops counting)`)}
            {nextTier ? L(` ou mude para o ${upgradeOffer(nextTier)}.`, ` or upgrade to ${upgradeOffer(nextTier)}.`) : "."}
          </ProUpsell>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={L(`Buscar ${c.l} ou ${w.guardian.l}`, `Search ${c.l} or ${w.guardian.l}`)} className="h-11 rounded-xl pl-9" />
          </div>
          <SortMenu value={sort} options={isTeacher ? SORTS.filter(o => o.key !== "owed") : SORTS} onChange={setSort} className="h-11" />
        </div>

        {loading ? (
          <ListSkeleton rows={5} />
        ) : students.length === 0 ? (
          <EmptyState icon={Users} title={L(`${c.nenhum} ${c.l} ${c.pick("cadastrado", "cadastrada")}`, `No ${c.lp} yet`)}
            description={isTeacher ? L(`Aqui aparecem ${c.os} ${c.lp} que têm ${w.appointment.l} com você.`, `${c.p} who have ${w.appointment.lp} with you show up here.`) : L(`Cadastre ${c.o} ${c.pick("primeiro", "primeira")} ${c.l} para começar a agendar.`, `Add your first ${c.l} to start booking.`)}
            action={isTeacher ? undefined : <div className="flex flex-wrap justify-center gap-2">
              <Button className="rounded-xl" onClick={() => setEditing({ student_name: "", guardian_name: "", address: "" })}><Plus className="mr-1.5 h-4 w-4" /> {c.novo} {c.l}</Button>
              {!isTeacher && <Button variant="outline" className="rounded-xl" onClick={() => setImportOpen(true)}><FileUp className="mr-1.5 h-4 w-4" /> {L("Importar de planilha", "Import from spreadsheet")}</Button>}
            </div>} />
        ) : visible.length === 0 ? (
          <EmptyState icon={Search} title={L("Nada encontrado", "Nothing found")} description={L(`${c.nenhum} ${c.l} ou ${w.guardian.l} com "${query}".`, `No ${c.l} or ${w.guardian.l} matching "${query}".`)} />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border">
            {visible.map(st => {
              const s = statements.get(accountKey(st));
              const owed = s?.owed ?? 0;
              const credit = s && s.balance > 0 ? s.balance : 0;
              const overdue = s ? isOverdue(s) : false;
              return (
                <li key={st.id}>
                  <button
                    onClick={() => { haptics.tap(); setSelected(st); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {initials(st.student_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{st.student_name}</span>
                        {st.user_id && <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        {st.plan_locked && <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning">{L("pausado", "paused")}</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {st.guardian_name ? `${L("Resp.", w.guardian.s)}: ${st.guardian_name}` : L("Sem responsável", `No ${w.guardian.l}`)}
                      </div>
                    </div>
                    {!isTeacher && <div className="shrink-0 text-right">
                      {credit > 0 ? (
                        <><div className="font-semibold tabular-nums text-success">{fmtMoney(credit)}</div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{L("crédito", "credit")}</div></>
                      ) : owed > 0 ? (
                        <><div className={`font-semibold tabular-nums ${overdue ? "text-destructive" : ""}`}>{fmtMoney(owed)}</div><div className={`text-[10px] uppercase tracking-wide ${overdue ? "text-destructive" : "text-muted-foreground"}`}>{overdue ? L("em atraso", "overdue") : L("a receber", "due")}</div></>
                      ) : (
                        <div className="text-xs text-muted-foreground">{L("Em dia", "Up to date")}</div>
                      )}
                    </div>}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <StudentSheet
        student={selected}
        lessons={selectedLessons}
        statement={selectedStatement}
        open={!!selected}
        onOpenChange={v => !v && setSelected(null)}
        onSchedule={isTeacher ? undefined : () => { const s = selected!; setSelected(null); setScheduleFor(s); }}
        showMoney={!isTeacher}
        onManage={() => { const s = selected!; setSelected(null); setManageFor(s); }}
        manageLabel={isTeacher ? L("Materiais e tarefas", "Materials and homework") : undefined}
        onEdit={isTeacher ? undefined : () => { const s = selected!; setSelected(null); setEditing(s); }}
        onDelete={isTeacher ? undefined : () => remove(selected!.id)}
        onBilling={isTeacher ? undefined : () => navigate("/admin/financeiro")}
        onEvolution={() => navigate(`/admin/evolucao?aluno=${selected!.id}`)}
      />

      <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? L(`Editar ${c.l}`, `Edit ${c.l}`) : `${c.novo} ${c.l}`}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>{L(`Nome ${c.do} ${c.l}`, `${c.s} name`)}</Label>
              <Input className="h-11 rounded-xl" value={editing?.student_name ?? ""} onChange={e => setEditing(p => ({ ...p!, student_name: e.target.value }))} />
            </div>
            <div><Label>{w.guardian.s}</Label>
              <Input className="h-11 rounded-xl" value={editing?.guardian_name ?? ""} onChange={e => setEditing(p => ({ ...p!, guardian_name: e.target.value }))} />
            </div>
            <div><Label>{L("Endereço", "Address")}</Label>
              <Input className="h-11 rounded-xl" value={editing?.address ?? ""} onChange={e => setEditing(p => ({ ...p!, address: e.target.value }))} placeholder={L("Rua, número, bairro, cidade", "Street, number, city")} />
            </div>
            <div><Label>{L(`WhatsApp ${editing?.guardian_name?.trim() ? `${w.guardian.do} ${w.guardian.l}` : `${c.do} ${c.l}`}`, `${editing?.guardian_name?.trim() ? w.guardian.s : c.s} WhatsApp`)}</Label>
              <Input className="h-11 rounded-xl" type="tel" inputMode="tel" value={editing?.whatsapp ?? ""}
                onChange={e => setEditing(p => ({ ...p!, whatsapp: e.target.value }))} placeholder={L("(11) 98765-4321", "+1 555 123 4567")} />
              <p className="mt-1 text-xs text-muted-foreground">{L("Opcional. Usado para mandar lembrete e aviso pelo WhatsApp.", "Optional. Used to send reminders and notices on WhatsApp.")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setEditing(null)}>{L("Cancelar", "Cancel")}</Button>
            <Button className="rounded-xl" onClick={save} disabled={busy}>{L("Salvar", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LessonDialog
        open={!!scheduleFor}
        onOpenChange={v => !v && setScheduleFor(null)}
        defaultTeacher={defaultTeacher}
        initialStudent={scheduleFor ? {
          student_name: scheduleFor.student_name,
          guardian_name: scheduleFor.guardian_name,
          address: scheduleFor.address,
        } : null}
        onSaved={() => { setScheduleFor(null); load(); }}
      />

      <StudentImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existing={students}
        room={null}
        onImported={load}
      />

      <StudentManageDialog
        teacherMode={isTeacher}
        student={manageFor}
        open={!!manageFor}
        onOpenChange={v => !v && setManageFor(null)}
        onChanged={load}
      />
    </PullToRefresh>
  );
}

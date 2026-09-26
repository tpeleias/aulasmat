import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useDefaultTeacher } from "@/hooks/useDefaultTeacher";
import { useTeachers, teacherSlug } from "@/hooks/useTeachers";
import { capitalize } from "@/lib/balance";

import { usePlan } from "@/hooks/usePlan";
import { ProUpsell } from "@/components/ProUpsell";
import GoogleCalendarSettings from "@/components/GoogleCalendarSettings";
import { useWords } from "@/hooks/useVocabulary";

import { L } from "@/lib/i18n";
type Block = { id: string; title: string; block_type: string; start_at: string | null; end_at: string | null; weekday: number | null; start_time: string | null; end_time: string | null; teacher: string };

const WEEKDAYS = L(["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"], ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
export default function BlocksPage() {
  const w = useWords();
  // Bloqueio pontual vale nos dois planos: dizer "dia 14 nao dou aula" e
  // funcao basica de agenda. O que o Pro vende e nao repetir isso toda semana.
  const { plan } = usePlan();
  const { teachers: allTeachers } = useTeachers(true);
  // O login de professor bloqueia só a própria agenda (e o banco só deixa
  // mexer nos bloqueios dele). Os da escola aparecem, sem a lixeira.
  const { isTeacher } = useAuth();
  const own = useDefaultTeacher();
  const teachers = isTeacher ? allTeachers.filter(t => teacherSlug(t.name) === own) : allTeachers;
  const canRemove = (b: Block) => !isTeacher || b.teacher === own;
  // "both" continua sendo o valor gravado para "vale para todos os professores".
  const teacherLabel = (slug: string) =>
    slug === "both"
      ? L("Todos", "All")
      : capitalize(teachers.find(t => teacherSlug(t.name) === slug)?.name ?? slug);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [recForm, setRecForm] = useState({ title: L("Compromisso fixo", "Recurring commitment"), weekday: 1, start_time: "07:00", end_time: "13:00", teacher: "both" });
  const [oneForm, setOneForm] = useState({ title: L("Lazer", "Time off"), start_at: "", end_at: "", teacher: "both" });
  useEffect(() => {
    if (!isTeacher || !own) return;
    setRecForm(f => ({ ...f, teacher: own }));
    setOneForm(f => ({ ...f, teacher: own }));
  }, [isTeacher, own]);

  // O ocupado importado do Google não entra na lista: é espelho, atualizado
  // sozinho (aparece na agenda). Aqui ficam só os bloqueios feitos à mão.
  const load = async () => { const { data } = await supabase.from("blocks").select("*").neq("source" as never, "google").order("created_at", { ascending: false }); setBlocks((data ?? []) as Block[]); };
  useEffect(() => { load(); }, []);

  const addRecurring = async () => {
    const { error } = await supabase.from("blocks").insert({ title: recForm.title, block_type: "recurring", weekday: recForm.weekday, start_time: recForm.start_time, end_time: recForm.end_time, teacher: recForm.teacher });
    if (error) toast.error(error.message); else { toast.success(L("Bloqueio recorrente criado", "Recurring time off created")); load(); }
  };
  const addOneOff = async () => {
    if (!oneForm.start_at || !oneForm.end_at) { toast.error(L("Preencha início e fim", "Fill in start and end")); return; }
    const { error } = await supabase.from("blocks").insert({ title: oneForm.title, block_type: "one_off", start_at: new Date(oneForm.start_at).toISOString(), end_at: new Date(oneForm.end_at).toISOString(), teacher: oneForm.teacher });
    if (error) toast.error(error.message); else { toast.success(L("Bloqueio criado", "Time off created")); load(); }
  };
  const remove = async (id: string) => { await supabase.from("blocks").delete().eq("id", id); load(); };

  const recurring = blocks.filter(b => b.block_type === "recurring");
  const oneOffs = blocks.filter(b => b.block_type === "one_off");

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">{L("Bloqueios de horário", "Time off")}</h1><p className="text-sm text-muted-foreground">{L("Marque períodos indisponíveis na sua agenda.", "Mark times you're not available on your calendar.")}</p></div>

      <GoogleCalendarSettings />

      <Tabs defaultValue="recurring">
        <TabsList><TabsTrigger value="recurring">{L("Recorrentes", "Recurring")}</TabsTrigger><TabsTrigger value="oneoff">{L("Pontuais", "One-off")}</TabsTrigger></TabsList>

        <TabsContent value="recurring" className="space-y-4">
          {!plan.recurring_blocks && (
            <ProUpsell titulo={L("Bloqueio que se repete é a partir do Cronys Start", "Recurring time off comes with Cronys Start and up")} compacto>
              {L("no Essencial dá para bloquear uma data específica, na aba ao lado.", "on Essential you can block a specific date, in the next tab.")}
              Aqui você diz uma vez &ldquo;toda terça à tarde&rdquo; e não repete mais.
            </ProUpsell>
          )}
          <Card className="p-5">
            <h3 className="font-semibold mb-3">{L("Novo bloqueio recorrente", "New recurring time off")}</h3>
            <div className="grid md:grid-cols-6 gap-3 items-end">
              <div className="md:col-span-2"><Label>{L("Título", "Title")}</Label><Input value={recForm.title} onChange={e => setRecForm({ ...recForm, title: e.target.value })} /></div>
              <div><Label>{w.staff.s}</Label>
                <Select value={recForm.teacher} onValueChange={v => setRecForm({ ...recForm, teacher: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!isTeacher && <SelectItem value="both">{L("Todos", "All")}</SelectItem>}
                    {teachers.map(t => (
                      <SelectItem key={t.id} value={teacherSlug(t.name)}>{capitalize(t.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>{L("Dia", "Day")}</Label>
                <Select value={String(recForm.weekday)} onValueChange={v => setRecForm({ ...recForm, weekday: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{WEEKDAYS.map((w, i) => <SelectItem key={i} value={String(i)}>{w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>{L("Início", "Start")}</Label><Input type="time" value={recForm.start_time} onChange={e => setRecForm({ ...recForm, start_time: e.target.value })} /></div>
              <div><Label>{L("Fim", "End")}</Label><Input type="time" value={recForm.end_time} onChange={e => setRecForm({ ...recForm, end_time: e.target.value })} /></div>
            </div>
            <Button className="mt-4" onClick={addRecurring}>{L("Adicionar", "Add")}</Button>
          </Card>
          <div className="space-y-2">
            {recurring.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">{L("Nenhum bloqueio recorrente.", "No recurring time off.")}</p>}
            {recurring.map(b => (
              <Card key={b.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium flex items-center gap-2">{b.title}<span className="text-[10px] uppercase tracking-wide bg-muted px-2 py-0.5 rounded">{teacherLabel(b.teacher)}</span></div>
                  <div className="text-sm text-muted-foreground">{WEEKDAYS[b.weekday ?? 0]} · {b.start_time?.slice(0,5)} – {b.end_time?.slice(0,5)}</div>
                </div>
                {canRemove(b) && <Button variant="ghost" size="icon" onClick={() => remove(b.id)}><Trash2 className="w-4 h-4" /></Button>}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="oneoff" className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-3">{L("Novo bloqueio pontual", "New one-off time off")}</h3>
            <div className="grid md:grid-cols-4 gap-3 items-end">
              <div><Label>{L("Título", "Title")}</Label><Input value={oneForm.title} onChange={e => setOneForm({ ...oneForm, title: e.target.value })} /></div>
              <div><Label>{w.staff.s}</Label>
                <Select value={oneForm.teacher} onValueChange={v => setOneForm({ ...oneForm, teacher: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!isTeacher && <SelectItem value="both">{L("Todos", "All")}</SelectItem>}
                    {teachers.map(t => (
                      <SelectItem key={t.id} value={teacherSlug(t.name)}>{capitalize(t.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>{L("Início", "Start")}</Label><Input type="datetime-local" value={oneForm.start_at} onChange={e => setOneForm({ ...oneForm, start_at: e.target.value })} /></div>
              <div><Label>{L("Fim", "End")}</Label><Input type="datetime-local" value={oneForm.end_at} onChange={e => setOneForm({ ...oneForm, end_at: e.target.value })} /></div>
            </div>
            <Button className="mt-4" onClick={addOneOff}>{L("Adicionar", "Add")}</Button>
          </Card>
          <div className="space-y-2">
            {oneOffs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">{L("Nenhum bloqueio pontual.", "No one-off time off.")}</p>}
            {oneOffs.map(b => (
              <Card key={b.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium flex items-center gap-2">{b.title}<span className="text-[10px] uppercase tracking-wide bg-muted px-2 py-0.5 rounded">{teacherLabel(b.teacher)}</span></div>
                  <div className="text-sm text-muted-foreground">{b.start_at && format(new Date(b.start_at), L("dd/MM/yyyy HH:mm", "MMM d, yyyy HH:mm"))} – {b.end_at && format(new Date(b.end_at), L("dd/MM HH:mm", "MMM d, HH:mm"))}</div>
                </div>
                {canRemove(b) && <Button variant="ghost" size="icon" onClick={() => remove(b.id)}><Trash2 className="w-4 h-4" /></Button>}
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

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

type Block = { id: string; title: string; block_type: string; start_at: string | null; end_at: string | null; weekday: number | null; start_time: string | null; end_time: string | null; teacher: string };

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const TEACHER_LABEL: Record<string, string> = { thiago: "Thiago", mayara: "Mayara", both: "Ambos" };

export default function BlocksPage() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [recForm, setRecForm] = useState({ title: "Escola", weekday: 1, start_time: "07:00", end_time: "13:00", teacher: "both" });
  const [oneForm, setOneForm] = useState({ title: "Lazer", start_at: "", end_at: "", teacher: "both" });

  const load = async () => { const { data } = await supabase.from("blocks").select("*").order("created_at", { ascending: false }); setBlocks((data ?? []) as Block[]); };
  useEffect(() => { load(); }, []);

  const addRecurring = async () => {
    const { error } = await supabase.from("blocks").insert({ title: recForm.title, block_type: "recurring", weekday: recForm.weekday, start_time: recForm.start_time, end_time: recForm.end_time, teacher: recForm.teacher });
    if (error) toast.error(error.message); else { toast.success("Bloqueio recorrente criado"); load(); }
  };
  const addOneOff = async () => {
    if (!oneForm.start_at || !oneForm.end_at) { toast.error("Preencha início e fim"); return; }
    const { error } = await supabase.from("blocks").insert({ title: oneForm.title, block_type: "one_off", start_at: new Date(oneForm.start_at).toISOString(), end_at: new Date(oneForm.end_at).toISOString(), teacher: oneForm.teacher });
    if (error) toast.error(error.message); else { toast.success("Bloqueio criado"); load(); }
  };
  const remove = async (id: string) => { await supabase.from("blocks").delete().eq("id", id); load(); };

  const recurring = blocks.filter(b => b.block_type === "recurring");
  const oneOffs = blocks.filter(b => b.block_type === "one_off");

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Bloqueios de horário</h1><p className="text-sm text-muted-foreground">Marque períodos indisponíveis na sua agenda.</p></div>

      <Tabs defaultValue="recurring">
        <TabsList><TabsTrigger value="recurring">Recorrentes (escola)</TabsTrigger><TabsTrigger value="oneoff">Pontuais (lazer)</TabsTrigger></TabsList>

        <TabsContent value="recurring" className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-3">Novo bloqueio recorrente</h3>
            <div className="grid md:grid-cols-6 gap-3 items-end">
              <div className="md:col-span-2"><Label>Título</Label><Input value={recForm.title} onChange={e => setRecForm({ ...recForm, title: e.target.value })} /></div>
              <div><Label>Professor(a)</Label>
                <Select value={recForm.teacher} onValueChange={v => setRecForm({ ...recForm, teacher: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Ambos</SelectItem>
                    <SelectItem value="thiago">Thiago</SelectItem>
                    <SelectItem value="mayara">Mayara</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Dia</Label>
                <Select value={String(recForm.weekday)} onValueChange={v => setRecForm({ ...recForm, weekday: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{WEEKDAYS.map((w, i) => <SelectItem key={i} value={String(i)}>{w}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Início</Label><Input type="time" value={recForm.start_time} onChange={e => setRecForm({ ...recForm, start_time: e.target.value })} /></div>
              <div><Label>Fim</Label><Input type="time" value={recForm.end_time} onChange={e => setRecForm({ ...recForm, end_time: e.target.value })} /></div>
            </div>
            <Button className="mt-4" onClick={addRecurring}>Adicionar</Button>
          </Card>
          <div className="space-y-2">
            {recurring.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nenhum bloqueio recorrente.</p>}
            {recurring.map(b => (
              <Card key={b.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium flex items-center gap-2">{b.title}<span className="text-[10px] uppercase tracking-wide bg-muted px-2 py-0.5 rounded">{TEACHER_LABEL[b.teacher] ?? b.teacher}</span></div>
                  <div className="text-sm text-muted-foreground">{WEEKDAYS[b.weekday ?? 0]} · {b.start_time?.slice(0,5)} – {b.end_time?.slice(0,5)}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(b.id)}><Trash2 className="w-4 h-4" /></Button>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="oneoff" className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-3">Novo bloqueio pontual</h3>
            <div className="grid md:grid-cols-3 gap-3 items-end">
              <div><Label>Título</Label><Input value={oneForm.title} onChange={e => setOneForm({ ...oneForm, title: e.target.value })} /></div>
              <div><Label>Início</Label><Input type="datetime-local" value={oneForm.start_at} onChange={e => setOneForm({ ...oneForm, start_at: e.target.value })} /></div>
              <div><Label>Fim</Label><Input type="datetime-local" value={oneForm.end_at} onChange={e => setOneForm({ ...oneForm, end_at: e.target.value })} /></div>
            </div>
            <Button className="mt-4" onClick={addOneOff}>Adicionar</Button>
          </Card>
          <div className="space-y-2">
            {oneOffs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nenhum bloqueio pontual.</p>}
            {oneOffs.map(b => (
              <Card key={b.id} className="p-4 flex items-center justify-between">
                <div><div className="font-medium">{b.title}</div><div className="text-sm text-muted-foreground">{b.start_at && format(new Date(b.start_at), "dd/MM/yyyy HH:mm")} – {b.end_at && format(new Date(b.end_at), "dd/MM HH:mm")}</div></div>
                <Button variant="ghost" size="icon" onClick={() => remove(b.id)}><Trash2 className="w-4 h-4" /></Button>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

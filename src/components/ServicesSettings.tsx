import { useState } from "react";
import { Pencil, Plus, Trash2, Tags } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fmtMoney } from "@/lib/balance";
import { useWords } from "@/hooks/useVocabulary";
import { usePlan } from "@/hooks/usePlan";
import { useLessonPrice } from "@/hooks/useLessonPrice";
import { useServices, type Service } from "@/hooks/useServices";
import { dbErrorMessage } from "@/lib/dbErrors";
import { cap } from "@/lib/vocabulary";
import { colorOf } from "@/lib/teacherColors";
import { ColorPicker } from "@/components/ColorPicker";

import { L, currencySymbol } from "@/lib/i18n";
type Draft = { id?: string; name: string; duration: string; price: string; mode: Service["mode"]; color: string | null };

const EMPTY: Draft = { name: "", duration: "60", price: "", mode: "ambos", color: null };

const MODES: { v: Service["mode"]; label: string }[] = [
  { v: "ambos", label: L("Presencial ou on-line", "In person or online") },
  { v: "presencial", label: L("Só presencial", "In person only") },
  { v: "online", label: L("Só on-line", "Online only") },
];

/**
 * Os serviços da empresa (tabela services, migration 20260925110000): nome,
 * duração, preço do atendimento, onde acontece e cor. Na hora de marcar, o
 * serviço preenche a duração e o preço; no portal, a família escolhe o serviço
 * e só vê quem faz.
 */
export default function ServicesSettings() {
  const w = useWords();
  const tp = w.topic;
  const { plan } = usePlan();
  const { price: listPrice } = useLessonPrice();
  const { services: items, reload } = useServices(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  if (items === null) return null;

  const multi = !!plan.services_multi;
  const ativos = items.filter(s => s.active).length;
  const podeNovo = multi || ativos === 0;

  const save = async () => {
    if (!draft) return;
    const duration_minutes = Math.round(Number(draft.duration));
    const priceTxt = String(draft.price).replace(",", ".").trim();
    const price = priceTxt === "" ? null : Number(priceTxt);
    if (!draft.name.trim() || !(duration_minutes >= 5) || (price !== null && !(price >= 0))) {
      toast.error(L("Informe o nome e a duração (em minutos). O preço é opcional.", "Enter the name and the duration (in minutes). Price is optional."));
      return;
    }
    setBusy(true);
    const row = { name: draft.name.trim(), duration_minutes, price, mode: draft.mode, color: draft.color };
    const { error } = draft.id
      ? await supabase.from("services" as never).update(row as never).eq("id", draft.id)
      : await supabase.from("services" as never).insert({ ...row, sort_order: items.length + 1 } as never);
    setBusy(false);
    if (error) { toast.error(dbErrorMessage(error, w)); return; }
    toast.success(draft.id ? L("Salvo", "Saved") : L(`${tp.s} ${tp.pick("criado", "criada")}`, `${tp.s} created`));
    setDraft(null);
    reload();
  };

  const toggle = async (s: Service, active: boolean) => {
    const { error } = await supabase.from("services" as never).update({ active } as never).eq("id", s.id);
    if (error) toast.error(dbErrorMessage(error, w)); else reload();
  };

  const remove = async (s: Service) => {
    if (!confirm(L(`Excluir "${s.name}"? ${cap(w.appointment.os)} ${w.appointment.lp} já ${w.appointment.pick("marcados", "marcadas")} continuam, só perdem o vínculo.`, `Delete "${s.name}"? ${w.appointment.p} already booked stay; they just lose the link.`))) return;
    const { error } = await supabase.from("services" as never).delete().eq("id", s.id);
    if (error) toast.error(dbErrorMessage(error, w)); else { toast.success(L("Excluído", "Deleted")); reload(); }
  };

  const hourly = (s: { price: number | null; duration_minutes: number }) =>
    s.price == null ? `${fmtMoney(listPrice * s.duration_minutes / 60)} (${L("preço padrão", "default price")})` : fmtMoney(Number(s.price));

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-sm uppercase text-muted-foreground"><Tags className="h-4 w-4" /> {tp.p}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {L(`Cada um com duração e preço. Ao marcar, escolher ${tp.o} ${tp.l} já preenche os dois; no portal, ${w.client.o} ${w.client.l} escolhe ${tp.o} ${tp.l} e só vê quem ${tp.pick("o", "a")} faz.`,
               `Each with its own duration and price. When booking, picking the ${tp.l} fills in both; in the portal, the ${w.client.l} picks the ${tp.l} and only sees who offers it.`)}
            {!multi && L(` No ${plan.nome} é ${tp.um} ${tp.l}; vários, a partir do Cronys Start.`, ` ${plan.nome} includes one ${tp.l}; multiple ${tp.lp} from Cronys Start up.`)}
          </p>
        </div>
        {!draft && podeNovo && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setDraft(EMPTY)}>
            <Plus className="mr-1 h-4 w-4" /> {L("Novo", "New")}
          </Button>
        )}
      </div>

      {items.length === 0 && !draft && (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          {L(`${tp.nenhum} ${tp.l} ainda. Sem ${tp.lp}, tudo segue como antes: duração escolhida na hora e o preço padrão.`, `No ${tp.lp} yet. Without them, everything works as before: duration picked when booking and the default price.`)}
        </p>
      )}

      <ul className="space-y-2">
        {items.map(s => {
          const c = colorOf(s.color);
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-3 w-3 shrink-0 rounded-full ${c ? c.dot : "border border-border"}`} />
                <div className="min-w-0">
                  <div className={`truncate text-sm font-medium ${s.active ? "" : "text-muted-foreground line-through"}`}>{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.duration_minutes} min · {hourly(s)}{s.mode !== "ambos" ? ` · ${s.mode === "online" ? L("on-line", "online") : L("presencial", "in person")}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch checked={s.active} onCheckedChange={v => toggle(s, v)} title={s.active ? L("Desligar", "Turn off") : L("Ligar", "Turn on")} />
                <Button size="icon" variant="ghost" className="h-8 w-8" title={L("Editar", "Edit")}
                  onClick={() => setDraft({ id: s.id, name: s.name, duration: String(s.duration_minutes), price: s.price == null ? "" : String(s.price), mode: s.mode, color: s.color })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title={L("Excluir", "Delete")} onClick={() => remove(s)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {draft && (
        <div className="space-y-3 rounded-md border border-primary/40 p-3">
          <div>
            <Label>{L("Nome", "Name")}</Label>
            <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder={w.model === "aulas" ? L("Ex: Matemática", "E.g. Math") : L("Ex: Avaliação", "E.g. Assessment")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{L("Duração (min)", "Duration (min)")}</Label>
              <Input type="number" min={5} step={5} value={draft.duration} onChange={e => setDraft({ ...draft, duration: e.target.value })} />
            </div>
            <div>
              <Label>{L("Preço", "Price")} ({currencySymbol()})</Label>
              <Input type="number" step="0.01" inputMode="decimal" value={draft.price} placeholder={L("Padrão", "Default")}
                onChange={e => setDraft({ ...draft, price: e.target.value })} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {L(`Preço do atendimento inteiro. Em branco, vale o preço padrão (${fmtMoney(listPrice)}/h).`, `Price for the whole ${w.appointment.l}. If empty, the default price applies (${fmtMoney(listPrice)}/h).`)}
          </p>
          <div>
            <Label>{L("Onde acontece", "Where it happens")}</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {MODES.map(m => (
                <Button key={m.v} type="button" size="sm" variant={draft.mode === m.v ? "default" : "outline"} className="h-8 rounded-full px-3"
                  onClick={() => setDraft({ ...draft, mode: m.v })}>{m.label}</Button>
              ))}
            </div>
          </div>
          <div>
            <Label>{L("Cor", "Color")}</Label>
            <ColorPicker value={draft.color} onChange={color => setDraft({ ...draft, color })} allowNone />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={busy}>{L("Cancelar", "Cancel")}</Button>
            <Button size="sm" onClick={save} disabled={busy}>{L("Salvar", "Save")}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

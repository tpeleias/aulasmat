import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fmtMoney } from "@/lib/balance";
import { useWords } from "@/hooks/useVocabulary";
import { useLessonPrice } from "@/hooks/useLessonPrice";
import { dbErrorMessage } from "@/lib/dbErrors";
import { packageVoucher, type LessonPackage } from "@/lib/packages";

type Draft = { id?: string; name: string; lessons: string; price: string };

const EMPTY: Draft = { name: "", lessons: "", price: "" };

/**
 * Os pacotes da empresa (tabela lesson_packages, migration 20260925040000):
 * "N aulas por R$ X". No Financeiro eles viram botões que lançam o dinheiro e
 * um voucher com a diferença para o valor cheio.
 */
export default function PackagesSettings() {
  const w = useWords();
  const ap = w.appointment;
  const { price: listPrice } = useLessonPrice();
  const [items, setItems] = useState<LessonPackage[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("lesson_packages" as never).select("*").order("sort_order").order("created_at");
    // Tabela ainda não existe (front publicado antes da migration): não mostra nada.
    if (error) { setItems(null); return; }
    setItems((data ?? []) as unknown as LessonPackage[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (items === null) return null;

  const save = async () => {
    if (!draft) return;
    const lessons = Math.round(Number(draft.lessons));
    const price = Number(String(draft.price).replace(",", "."));
    if (!draft.name.trim() || !(lessons >= 1) || !(price > 0)) {
      toast.error(`Informe o nome, quantas ${ap.lp} e o preço do pacote`);
      return;
    }
    setBusy(true);
    const row = { name: draft.name.trim(), lessons, price };
    const { error } = draft.id
      ? await supabase.from("lesson_packages" as never).update(row as never).eq("id", draft.id)
      : await supabase.from("lesson_packages" as never).insert({ ...row, sort_order: items.length + 1 } as never);
    setBusy(false);
    if (error) { toast.error(dbErrorMessage(error, w)); return; }
    toast.success(draft.id ? "Pacote atualizado" : "Pacote criado");
    setDraft(null);
    load();
  };

  const toggle = async (p: LessonPackage, active: boolean) => {
    const { error } = await supabase.from("lesson_packages" as never).update({ active } as never).eq("id", p.id);
    if (error) toast.error(dbErrorMessage(error, w)); else load();
  };

  const remove = async (p: LessonPackage) => {
    if (!confirm(`Excluir o pacote "${p.name}"? Os pagamentos já registrados com ele continuam no Financeiro.`)) return;
    const { error } = await supabase.from("lesson_packages" as never).delete().eq("id", p.id);
    if (error) toast.error(dbErrorMessage(error, w)); else { toast.success("Pacote excluído"); load(); }
  };

  const preview = draft ? packageVoucher(Math.round(Number(draft.lessons)) || 0, Number(String(draft.price).replace(",", ".")) || 0, listPrice) : 0;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">Pacotes</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Aparecem como botões ao registrar pagamento no Financeiro. {cap1(ap.os)} {ap.lp} continuam a {fmtMoney(listPrice)}/h;
            a diferença entra como voucher.
          </p>
        </div>
        {!draft && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setDraft(EMPTY)}>
            <Plus className="mr-1 h-4 w-4" /> Novo
          </Button>
        )}
      </div>

      {items.length === 0 && !draft && (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Nenhum pacote ainda. Ex.: 10 {ap.lp} por {fmtMoney(listPrice * 10 * 0.9)}.
        </p>
      )}

      <ul className="space-y-2">
        {items.map(p => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0">
              <div className={`truncate text-sm font-medium ${p.active ? "" : "text-muted-foreground line-through"}`}>{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.lessons} {p.lessons === 1 ? ap.l : ap.lp} por {fmtMoney(Number(p.price))}
                {packageVoucher(p.lessons, Number(p.price), listPrice) > 0 && ` · voucher de ${fmtMoney(packageVoucher(p.lessons, Number(p.price), listPrice))}`}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Switch checked={p.active} onCheckedChange={v => toggle(p, v)} title={p.active ? "Desligar" : "Ligar"} />
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Editar"
                onClick={() => setDraft({ id: p.id, name: p.name, lessons: String(p.lessons), price: String(p.price) })}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title="Excluir" onClick={() => remove(p)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <div className="space-y-3 rounded-md border border-primary/40 p-3">
          <div>
            <Label>Nome</Label>
            <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder={`Pacote 10 ${ap.lp}`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantas {ap.lp}</Label>
              <Input type="number" min={1} value={draft.lessons} onChange={e => setDraft({ ...draft, lessons: e.target.value })} />
            </div>
            <div>
              <Label>Preço do pacote (R$)</Label>
              <Input type="number" step="0.01" inputMode="decimal" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} />
            </div>
          </div>
          {preview > 0 && (
            <p className="text-xs text-muted-foreground">Voucher lançado junto: {fmtMoney(preview)} (a diferença para o valor cheio).</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={busy}>Cancelar</Button>
            <Button size="sm" onClick={save} disabled={busy}>Salvar</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

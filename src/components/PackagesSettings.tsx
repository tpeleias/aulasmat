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
import { packageUnitPrice, packageVoucher, type LessonPackage } from "@/lib/packages";
import { useServices } from "@/hooks/useServices";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { L, currencySymbol } from "@/lib/i18n";
type Draft = { id?: string; name: string; lessons: string; price: string; service_id: string | null };

const EMPTY: Draft = { name: "", lessons: "", price: "", service_id: null };

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
  const { services: allServices } = useServices(false);
  const services = allServices ?? [];
  const unit = (p: { service_id?: string | null }) => packageUnitPrice(p, services, listPrice);
  const serviceName = (id?: string | null) => services.find(s => s.id === id)?.name;

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
      toast.error(L(`Informe o nome, quantas ${ap.lp} e o preço do pacote`, `Enter the name, how many ${ap.lp} and the package price`));
      return;
    }
    setBusy(true);
    const row = { name: draft.name.trim(), lessons, price, ...(services.length ? { service_id: draft.service_id } : {}) };
    const { error } = draft.id
      ? await supabase.from("lesson_packages" as never).update(row as never).eq("id", draft.id)
      : await supabase.from("lesson_packages" as never).insert({ ...row, sort_order: items.length + 1 } as never);
    setBusy(false);
    if (error) { toast.error(dbErrorMessage(error, w)); return; }
    toast.success(draft.id ? L("Pacote atualizado", "Package updated") : L("Pacote criado", "Package created"));
    setDraft(null);
    load();
  };

  const toggle = async (p: LessonPackage, active: boolean) => {
    const { error } = await supabase.from("lesson_packages" as never).update({ active } as never).eq("id", p.id);
    if (error) toast.error(dbErrorMessage(error, w)); else load();
  };

  const remove = async (p: LessonPackage) => {
    if (!confirm(L(`Excluir o pacote "${p.name}"? Os pagamentos já registrados com ele continuam no Financeiro.`, `Delete the package "${p.name}"? Payments already recorded with it stay in Billing.`))) return;
    const { error } = await supabase.from("lesson_packages" as never).delete().eq("id", p.id);
    if (error) toast.error(dbErrorMessage(error, w)); else { toast.success(L("Pacote excluído", "Package deleted")); load(); }
  };

  const preview = draft ? packageVoucher(Math.round(Number(draft.lessons)) || 0, Number(String(draft.price).replace(",", ".")) || 0, unit(draft)) : 0;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm uppercase text-muted-foreground">{L("Pacotes", "Packages")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {L(`Aparecem como botões ao registrar pagamento no Financeiro. ${cap1(ap.os)} ${ap.lp} continuam a ${fmtMoney(listPrice)}/h; a diferença entra como voucher.`,
               `They show up as buttons when recording a payment in Billing. ${ap.p} stay at ${fmtMoney(listPrice)}/h; the difference goes in as a voucher.`)}
          </p>
        </div>
        {!draft && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setDraft(EMPTY)}>
            <Plus className="mr-1 h-4 w-4" /> {L("Novo", "New")}
          </Button>
        )}
      </div>

      {items.length === 0 && !draft && (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          {L(`Nenhum pacote ainda. Ex.: 10 ${ap.lp} por ${fmtMoney(listPrice * 10 * 0.9)}.`, `No packages yet. E.g. 10 ${ap.lp} for ${fmtMoney(listPrice * 10 * 0.9)}.`)}
        </p>
      )}

      <ul className="space-y-2">
        {items.map(p => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0">
              <div className={`truncate text-sm font-medium ${p.active ? "" : "text-muted-foreground line-through"}`}>{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.lessons} {p.lessons === 1 ? ap.l : ap.lp}{serviceName(p.service_id) ? L(` de ${serviceName(p.service_id)}`, ` of ${serviceName(p.service_id)}`) : ""} {L("por", "for")} {fmtMoney(Number(p.price))}
                {packageVoucher(p.lessons, Number(p.price), unit(p)) > 0 && ` · ${L("voucher de", "voucher of")} ${fmtMoney(packageVoucher(p.lessons, Number(p.price), unit(p)))}`}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Switch checked={p.active} onCheckedChange={v => toggle(p, v)} title={p.active ? L("Desligar", "Turn off") : L("Ligar", "Turn on")} />
              <Button size="icon" variant="ghost" className="h-8 w-8" title={L("Editar", "Edit")}
                onClick={() => setDraft({ id: p.id, name: p.name, lessons: String(p.lessons), price: String(p.price), service_id: p.service_id ?? null })}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title={L("Excluir", "Delete")} onClick={() => remove(p)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <div className="space-y-3 rounded-md border border-primary/40 p-3">
          <div>
            <Label>{L("Nome", "Name")}</Label>
            <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder={L(`Pacote 10 ${ap.lp}`, `10-${ap.l} package`)} />
          </div>
          {services.length > 0 && (
            <div>
              <Label>{w.topic.s}</Label>
              <Select value={draft.service_id ?? "none"} onValueChange={v => setDraft({ ...draft, service_id: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{L(`Qualquer ${w.topic.l} (pacote geral)`, `Any ${w.topic.l} (general package)`)}</SelectItem>
                  {services.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{L(`Quantas ${ap.lp}`, `How many ${ap.lp}`)}</Label>
              <Input type="number" min={1} value={draft.lessons} onChange={e => setDraft({ ...draft, lessons: e.target.value })} />
            </div>
            <div>
              <Label>{L("Preço do pacote", "Package price")} ({currencySymbol()})</Label>
              <Input type="number" step="0.01" inputMode="decimal" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} />
            </div>
          </div>
          {preview > 0 && (
            <p className="text-xs text-muted-foreground">{L(`Voucher lançado junto: ${fmtMoney(preview)} (a diferença para o valor cheio).`, `Voucher added with it: ${fmtMoney(preview)} (the difference from full price).`)}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={busy}>{L("Cancelar", "Cancel")}</Button>
            <Button size="sm" onClick={save} disabled={busy}>{L("Salvar", "Save")}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

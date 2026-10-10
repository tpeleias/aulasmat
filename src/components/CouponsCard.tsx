import { useEffect, useState } from "react";
import { Plus, Ticket } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Cupons e códigos de desconto das assinaturas (10/10, painel do gestor).
 * Lista os códigos do Stripe com uso e liga/desliga; cria desconto novo com o
 * primeiro código. Quem fala com o Stripe é a função "billing" (coupons.ts).
 */
export type CouponCode = {
  id: string; code: string; active: boolean; used: number; max: number | null; expires_at: string | null; first_time: boolean;
  coupon: { id: string; name: string | null; percent: number | null; amount: number | null; duration: string; months: number | null; valid: boolean; used: number; max: number | null };
};

const ERRORS: Record<string, string> = {
  invalid_code: "Código com 3 a 30 letras sem acento, números ou traço (ex.: BLACKFRIDAY).",
  code_exists: "Esse código já existe.",
  invalid_value: "Confira o desconto (porcentagem até 100).",
  invalid_months: "Por quantos meses: de 1 a 36.",
  invalid_max: "O limite de usos precisa ser 1 ou mais.",
  invalid_expiry: "A data final precisa ser depois de hoje.",
};

export function describeCoupon(c: CouponCode["coupon"]) {
  const off = c.percent != null ? `${String(c.percent).replace(".", ",")}%` : `R$ ${(c.amount ?? 0).toFixed(2).replace(".", ",")}`;
  const when = c.duration === "forever" ? "para sempre" : c.duration === "once" ? "no 1º pagamento" : `por ${c.months} ${c.months === 1 ? "mês" : "meses"}`;
  return `${off} ${when}`;
}

const empty = { name: "", code: "", kind: "percent" as "percent" | "amount", value: "", duration: "repeating" as "once" | "repeating" | "forever", months: "2", max: "", expires_at: "", first_time: false };

export default function CouponsCard() {
  const [codes, setCodes] = useState<CouponCode[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.functions.invoke("billing", { body: { action: "coupons_list" } });
    const d = data as { ok?: boolean; codes?: CouponCode[] } | null;
    if (d?.ok && d.codes) { setCodes(d.codes); setFailed(false); } else setFailed(true);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (c: CouponCode, active: boolean) => {
    setCodes(cs => cs?.map(x => (x.id === c.id ? { ...x, active } : x)) ?? null);
    const { data } = await supabase.functions.invoke("billing", { body: { action: "code_active", id: c.id, active } });
    if (!(data as { ok?: boolean } | null)?.ok) { toast.error("Não deu para mudar agora."); load(); }
    else toast.success(active ? `${c.code} ligado` : `${c.code} desligado`);
  };

  const create = async () => {
    setBusy(true);
    const { data } = await supabase.functions.invoke("billing", { body: { action: "coupon_create", ...form } });
    setBusy(false);
    const r = data as { ok?: boolean; error?: string } | null;
    if (!r?.ok) { toast.error(ERRORS[r?.error ?? ""] ?? "Não deu certo. Tente de novo."); return; }
    toast.success(`Código ${form.code.trim().toUpperCase()} criado e ligado`);
    setOpen(false); setForm(empty); load();
  };

  return (
    <Card className="space-y-3 rounded-xl p-3">
      <div className="flex items-center gap-3">
        <Ticket className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Cupons e códigos de desconto</p>
          <p className="text-xs text-muted-foreground">Valem nos planos (não no profissional extra nem no assistente), no mensal em real.</p>
        </div>
        <Button size="sm" className="h-8 gap-1 rounded-xl" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Novo</Button>
      </div>

      {failed && <p className="text-xs text-destructive">Não deu para ler os cupons do Stripe agora.</p>}
      {!codes && !failed && <p className="text-xs text-muted-foreground">Carregando…</p>}
      {codes && codes.length === 0 && <p className="text-xs text-muted-foreground">Nenhum código ainda.</p>}
      {codes && codes.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {codes.map(c => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{c.code}</span>
                  {!c.coupon.valid && <Badge variant="outline" className="text-[10px]">esgotado</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {describeCoupon(c.coupon)} · usado {c.used}{c.max ? ` de ${c.max}` : ""}{c.coupon.max ? ` (desconto: ${c.coupon.used} de ${c.coupon.max})` : ""}
                  {c.first_time ? " · só quem nunca assinou" : ""}
                  {c.expires_at ? ` · até ${new Date(c.expires_at).toLocaleDateString("pt-BR")}` : ""}
                </p>
              </div>
              <Switch checked={c.active} onCheckedChange={v => toggle(c, v)} aria-label={`Ligar ${c.code}`} />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Novo código de desconto</DialogTitle>
            <DialogDescription>Nasce ligado. Quem assina digita o código no pagamento.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div><Label htmlFor="cp-code">Código</Label>
              <Input id="cp-code" value={form.code} placeholder="BLACKFRIDAY" autoCapitalize="characters"
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") }))} /></div>
            <div><Label htmlFor="cp-name">Nome (aparece no recibo)</Label>
              <Input id="cp-name" value={form.name} placeholder="Black Friday" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="cp-kind">Tipo</Label>
                <select id="cp-kind" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.kind}
                  onChange={e => setForm(f => ({ ...f, kind: e.target.value as "percent" | "amount" }))}>
                  <option value="percent">Porcentagem (%)</option>
                  <option value="amount">Valor (R$)</option>
                </select></div>
              <div><Label htmlFor="cp-value">Desconto</Label>
                <Input id="cp-value" inputMode="decimal" value={form.value} placeholder={form.kind === "percent" ? "25" : "10,00"}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value.replace(",", ".") }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="cp-dur">Por quanto tempo</Label>
                <select id="cp-dur" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.duration}
                  onChange={e => setForm(f => ({ ...f, duration: e.target.value as "once" | "repeating" | "forever" }))}>
                  <option value="once">Só o 1º pagamento</option>
                  <option value="repeating">Alguns meses</option>
                  <option value="forever">Para sempre</option>
                </select></div>
              {form.duration === "repeating" && (
                <div><Label htmlFor="cp-months">Meses</Label>
                  <Input id="cp-months" inputMode="numeric" value={form.months} onChange={e => setForm(f => ({ ...f, months: e.target.value.replace(/\D/g, "") }))} /></div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="cp-max">Limite de usos (opcional)</Label>
                <Input id="cp-max" inputMode="numeric" value={form.max} placeholder="sem limite" onChange={e => setForm(f => ({ ...f, max: e.target.value.replace(/\D/g, "") }))} /></div>
              <div><Label htmlFor="cp-exp">Vale até (opcional)</Label>
                <Input id="cp-exp" type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.first_time} onCheckedChange={v => setForm(f => ({ ...f, first_time: !!v }))} />
              Só para quem nunca assinou
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={busy || form.code.length < 3 || !form.value} onClick={create}>{busy ? "Criando…" : "Criar código"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

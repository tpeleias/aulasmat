import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { L } from "@/lib/i18n";
import { payAction, payErrorText, setInstallmentRule, setProvider, useOnlinePayments, type InstallmentRule, type Provider } from "@/lib/onlinePayments";

const NAMES: Record<Provider, string> = { stripe: "Stripe", asaas: "Asaas" };

/**
 * Pagamento on-line pela conta da própria empresa (09/10). Só aparece para
 * empresa com a função liberada (accounts.online_payments). O interruptor
 * escolhe entre o padrão (a chave Pix e o link de pagamento das Configurações,
 * como o InfinitePay) e o Stripe ou o Asaas. A chave vai direto para o cofre
 * pela função "pay"; a tela nunca a lê de volta.
 */
export default function OnlinePaymentsSettings() {
  const st = useOnlinePayments();
  const [on, setOn] = useState(false);
  const [choice, setChoice] = useState<Provider>("stripe");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!st.loaded) return;
    setOn(!!st.provider);
    setChoice(st.provider ?? (st.asaas && !st.stripe ? "asaas" : "stripe"));
  }, [st.loaded, st.provider, st.stripe, st.asaas]);

  if (!st.loaded || !st.allowed) return null;
  const has = (p: Provider) => (p === "stripe" ? st.stripe : st.asaas);

  const choose = async (p: Provider | null) => {
    const err = await setProvider(p);
    if (err) { toast.error(payErrorText(/not connected/.test(err) ? "not_connected" : "failed")); return false; }
    toast.success(p ? L(`As cobranças agora levam o link do ${NAMES[p]}`, `Billing now carries the ${NAMES[p]} link`) : L("As cobranças voltaram ao padrão (Pix e link das Configurações)", "Billing is back to the default (Pix and link from Settings)"));
    await st.reload();
    return true;
  };

  const toggle = async (v: boolean) => {
    setOn(v);
    setEditing(false); setKey("");
    if (!v) { if (st.provider) await choose(null); return; }
    if (has(choice)) await choose(choice);
  };

  const pick = async (p: Provider) => {
    setChoice(p); setEditing(false); setKey("");
    if (has(p) && st.provider !== p) await choose(p);
  };

  const connect = async () => {
    setBusy(true);
    const r = await payAction<{ test: boolean; name: string | null }>({ action: "connect", provider: choice, key: key.trim() });
    setBusy(false);
    if (!r.ok) { toast.error(payErrorText(r.error)); return; }
    toast.success(L(`${NAMES[choice]} conectado${r.data.name ? ` (${r.data.name})` : ""}${r.data.test ? " em modo de teste" : ""}`, `${NAMES[choice]} connected${r.data.name ? ` (${r.data.name})` : ""}${r.data.test ? " in test mode" : ""}`));
    setKey(""); setEditing(false);
    await choose(choice);
  };

  const steps: Record<Provider, string[]> = {
    stripe: [
      L("No Stripe da empresa: Desenvolvedores → Chaves de API → Chave secreta → Revelar e copiar.", "In your company's Stripe: Developers → API keys → Secret key → Reveal and copy."),
      L("Para aceitar Pix: Configurações → Formas de pagamento → Pix → Ativar.", "To accept Pix: Settings → Payment methods → Pix → Turn on."),
      L("Comece com a chave de teste (sk_test_); quando estiver tudo certo, troque pela real (sk_live_).", "Start with the test key (sk_test_); when all is good, switch to the live one (sk_live_)."),
    ],
    asaas: [
      L("No Asaas, pelo computador (o aplicativo não tem essa opção): toque na sua foto no canto de cima → Integrações (ou Minha conta → Integração) → Chaves API → Gerar chave de API. Copie na hora: ela só aparece uma vez (começa com $aact_).", "In Asaas, on a computer (the app doesn't have it): your avatar at the top → Integrations (or My account → Integration) → API keys → Generate API key. Copy it right away: it's shown only once (starts with $aact_)."),
      L("Só aparece para o administrador da conta, e com o cadastro aprovado.", "Only the account admin sees it, once the account is approved."),
      L("Para aceitar Pix, cadastre uma chave Pix no Asaas (Pix → Minhas chaves). Cartão e boleto já vêm ligados.", "To accept Pix, register a Pix key in Asaas (Pix → My keys). Card and boleto come on already."),
      L("Para testar antes, use uma conta do Sandbox (sandbox.asaas.com): a chave de lá começa com $aact_hmlg_.", "To test first, use a Sandbox account (sandbox.asaas.com): its key starts with $aact_hmlg_."),
    ],
  };
  const showForm = !has(choice) || editing;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">{L("Pagamento on-line (cartão e Pix)", "Online payment (card and Pix)")}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {on
              ? L("As famílias recebem um link \"Pagar com cartão ou Pix\" com o valor em aberto, no e-mail de cobrança e na mensagem do WhatsApp, e podem pagar pelo portal. O pagamento entra sozinho no Financeiro e a família recebe o recibo.",
                  "Families get a \"Pay by card or Pix\" link with the open amount, in the billing email and the WhatsApp message, and can pay in the portal. The payment goes into Billing by itself and the family gets the receipt.")
              : L("Desligado: as cobranças usam o padrão da empresa, a chave Pix e o link de pagamento das Configurações (como o InfinitePay).",
                  "Off: billing uses the company default, the Pix key and the payment link from Settings.")}
          </p>
        </div>
        <Switch aria-label={L("Usar pagamento on-line", "Use online payment")} checked={on} onCheckedChange={toggle} />
      </div>

      {on && (
        <>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={L("Onde cobrar", "Where to charge")}>
            {(["stripe", "asaas"] as Provider[]).map(p => (
              <button key={p} type="button" role="radio" aria-checked={choice === p} onClick={() => pick(p)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${choice === p ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60"}`}>
                <div className="font-semibold">{NAMES[p]}</div>
                <div className={`text-xs ${has(p) ? "text-success" : "text-muted-foreground"}`}>
                  {st.provider === p ? L("Em uso", "In use") : has(p) ? L("Conectado", "Connected") : L("Não conectado", "Not connected")}
                </div>
              </button>
            ))}
          </div>

          {!showForm ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success/10 px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" /> {L(`${NAMES[choice]} conectado`, `${NAMES[choice]} connected`)}</span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{L("Trocar a chave", "Change key")}</Button>
            </div>
          ) : null}
          {!showForm && choice === "asaas" && <InstallmentRuleEditor rule={st.installment_rule} onSaved={st.reload} />}
          {showForm && (
            <div className="space-y-2">
              <Label htmlFor="pay-key">{choice === "stripe" ? L("Chave secreta do Stripe", "Stripe secret key") : L("Chave de API do Asaas", "Asaas API key")}</Label>
              <Input id="pay-key" type="password" autoComplete="off"
                placeholder={choice === "stripe" ? L("sk_test_... ou sk_live_...", "sk_test_... or sk_live_...") : "$aact_..."}
                value={key} onChange={e => setKey(e.target.value)} />
              <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
                {steps[choice].map(s => <li key={s}>{s}</li>)}
              </ol>
              <div className="flex gap-2">
                <Button onClick={connect} disabled={busy || !key.trim()}>{busy ? L("Conectando…", "Connecting…") : L("Conectar", "Connect")}</Button>
                {has(choice) && <Button variant="ghost" onClick={() => { setEditing(false); setKey(""); }}>{L("Cancelar", "Cancel")}</Button>}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const times = (n: number) => (n === 1 ? L("1x (à vista)", "1x (in full)") : `${n}x`);
const TIMES = Array.from({ length: 12 }, (_, i) => i + 1);
const selectCls = "h-9 rounded-xl border border-input bg-background px-2 text-sm";

/**
 * Parcelas no cartão por faixa de valor (09/10, pedido do Thiago): "até R$ 300
 * em até 2x, até R$ 500 em até 3x..." e o máximo acima de todas. O Pix é
 * sempre à vista.
 */
function InstallmentRuleEditor({ rule, onSaved }: { rule: InstallmentRule; onSaved: () => Promise<void> | void }) {
  const [tiers, setTiers] = useState(rule.tiers.map(t => ({ up_to: String(t.up_to), max: t.max })));
  const [above, setAbove] = useState(rule.above);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTiers(rule.tiers.map(t => ({ up_to: String(t.up_to), max: t.max })));
    setAbove(rule.above);
  }, [rule]);

  const parsed = tiers.map(t => ({ up_to: Number(String(t.up_to).replace(/\./g, "").replace(",", ".")), max: t.max }));
  const sorted = [...parsed].sort((a, b) => a.up_to - b.up_to);
  const invalid = parsed.some(t => !(t.up_to > 0)) || new Set(parsed.map(t => t.up_to)).size !== parsed.length;

  const save = async () => {
    setSaving(true);
    const err = await setInstallmentRule({ tiers: sorted, above });
    setSaving(false);
    if (err) { toast.error(L("Confira as faixas: valores diferentes e maiores que zero.", "Check the ranges: different values above zero.")); return; }
    toast.success(L("Parcelas salvas", "Installments saved"));
    await onSaved();
  };

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div>
        <div className="text-sm font-medium">{L("Parcelas no cartão por valor", "Card installments by amount")}</div>
        <p className="text-xs text-muted-foreground">{L("O Pix é sempre à vista. A taxa de cada parcela é a do seu plano no Asaas. Cada parcela paga entra no Financeiro.", "Pix is always in full. Each installment's fee is your Asaas plan's. Each installment paid goes into Billing.")}</p>
      </div>
      {tiers.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{L("Até R$", "Up to")}</span>
          <Input aria-label={L(`Valor da faixa ${i + 1}`, `Range ${i + 1} amount`)} inputMode="decimal" className="h-9 w-24"
            value={t.up_to} onChange={e => setTiers(tiers.map((x, j) => (j === i ? { ...x, up_to: e.target.value } : x)))} />
          <span className="text-muted-foreground">{L("em até", "up to")}</span>
          <select aria-label={L(`Parcelas da faixa ${i + 1}`, `Range ${i + 1} installments`)} className={selectCls}
            value={t.max} onChange={e => setTiers(tiers.map((x, j) => (j === i ? { ...x, max: Number(e.target.value) } : x)))}>
            {TIMES.map(n => <option key={n} value={n}>{times(n)}</option>)}
          </select>
          <Button size="icon" variant="ghost" aria-label={L("Tirar faixa", "Remove range")} onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{tiers.length ? L("Acima disso, em até", "Above that, up to") : L("Qualquer valor, em até", "Any amount, up to")}</span>
        <select aria-label={L("Parcelas acima das faixas", "Installments above the ranges")} className={selectCls} value={above} onChange={e => setAbove(Number(e.target.value))}>
          {TIMES.map(n => <option key={n} value={n}>{times(n)}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1" disabled={tiers.length >= 10}
          onClick={() => setTiers([...tiers, { up_to: String((sorted.at(-1)?.up_to || 0) + 500), max: Math.min(12, (sorted.at(-1)?.max ?? 1) + 1) }])}>
          <Plus className="h-4 w-4" /> {L("Faixa", "Range")}
        </Button>
        <Button size="sm" onClick={save} disabled={saving || invalid}>{saving ? L("Salvando…", "Saving…") : L("Salvar parcelas", "Save installments")}</Button>
      </div>
    </div>
  );
}

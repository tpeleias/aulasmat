import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVocabulary } from "@/hooks/useVocabulary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CronysWordmark } from "@/components/brand";
import { BusinessModelPicker } from "@/components/BusinessModelPicker";
import { WheelSelect } from "@/components/WheelSelect";
import { NumberField } from "@/components/NumberField";
import { GuardianField } from "@/components/GuardianField";
import { haptics } from "@/lib/haptics";
import { dbErrorMessage } from "@/lib/dbErrors";
import { normalizeWhatsApp } from "@/lib/whatsapp";
import { CURRENCIES, LOCALES, L, durationLabel, fmtCurrency, getCurrency, getLocale, timeFmt, type Currency, type Locale } from "@/lib/i18n";
import type { BusinessModel } from "@/lib/vocabulary";

/**
 * Configuração guiada do primeiro acesso (Thiago, 28/09). O admin de uma
 * empresa nova só chega ao app depois de passar por aqui:
 *   1. Negócio (ramo, língua, moeda)  - obrigatória
 *   2. Agenda (horário, duração)       - obrigatória
 *   3. Serviços e valores              - obrigatória
 *   4. Como recebe                     - pode pular
 *   5. Primeiro cliente                - pode pular
 * No fim, complete_account_setup (migration 20260928030000). A etapa em que
 * a pessoa está fica guardada no aparelho: trocar a língua recarrega a tela.
 */

type Step = 1 | 2 | 3 | 4 | 5;
const STEP_KEY = "cronys.setup.step";
const readStep = (): Step => {
  try { const n = Number(localStorage.getItem(STEP_KEY)); return (n >= 1 && n <= 5 ? n : 1) as Step; } catch { return 1; }
};
const writeStep = (s: Step | null) => {
  try { if (s) localStorage.setItem(STEP_KEY, String(s)); else localStorage.removeItem(STEP_KEY); } catch { /* sem armazenamento */ }
};

// Das 5h às 23h30, de meia em meia hora.
const TIMES = Array.from({ length: 38 }, (_, i) => {
  const m = 5 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
const DURATIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 5);
const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60];
const timeLabel = (t: string) => format(new Date(`2000-01-01T${t}`), timeFmt());

type Settings = {
  id: number; work_start: string; work_end: string; slot_minutes: number; buffer_minutes: number;
  default_lesson_price: number; pix_key: string | null; pix_receiver_name: string | null; pix_city: string | null; payment_link: string | null;
};
type Service = { id: string; name: string; duration_minutes: number; price: number | null };

export default function SetupWizard() {
  const { signOut } = useAuth();
  const { model, apply, v } = useVocabulary();
  const [step, setStepState] = useState<Step>(() => (model ? readStep() : 1));
  const setStep = (s: Step) => { writeStep(s); setStepState(s); window.scrollTo?.(0, 0); };
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    supabase.from("settings").select("id, work_start, work_end, slot_minutes, buffer_minutes, default_lesson_price, pix_key, pix_receiver_name, pix_city, payment_link")
      .maybeSingle().then(({ data }) => {
        if (!data) return;
        const d = data as unknown as Settings;
        setCfg({ ...d, work_start: d.work_start.slice(0, 5), work_end: d.work_end.slice(0, 5), buffer_minutes: d.buffer_minutes ?? 0 });
      });
    supabase.from("services" as never).select("id, name, duration_minutes, price").order("sort_order")
      .then(({ data }) => setServices((data ?? []) as unknown as Service[]));
  }, []);

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!cfg) return false;
    const { error } = await supabase.from("settings").update(patch as never).eq("id", cfg.id);
    if (error) { haptics.warning(); toast.error(dbErrorMessage(error, v)); return false; }
    setCfg({ ...cfg, ...patch });
    return true;
  };

  const finish = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("complete_account_setup" as never);
    setBusy(false);
    if (error) { haptics.warning(); toast.error(dbErrorMessage(error, v)); return; }
    haptics.success();
    writeStep(null);
    apply(data);
  };

  const titles: Record<Step, string> = {
    1: L("Seu negócio", "Your business"),
    2: L("Sua agenda", "Your schedule"),
    3: L(`${v.topic.p} e valores`, `${v.topic.p} and prices`),
    4: L("Como você recebe", "How you get paid"),
    5: L(`${v.client.pick("Seu primeiro", "Sua primeira")} ${v.client.l}`, `Your first ${v.client.l}`),
  };

  return (
    <div className="flex flex-1 justify-center overflow-y-auto bg-background px-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="space-y-3">
          <CronysWordmark tamanho="1.5rem" />
          <div className="flex gap-1.5" aria-hidden>
            {[1, 2, 3, 4, 5].map(n => (
              <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{L(`Etapa ${step} de 5`, `Step ${step} of 5`)}</p>
          <h1 className="text-2xl font-semibold">{titles[step]}</h1>
        </div>

        {step === 1 && <BusinessStep busy={busy} setBusy={setBusy} current={model} onDone={data => { setStep(2); apply(data); }} />}
        {step === 2 && (cfg ? <ScheduleStep cfg={cfg} busy={busy} onBack={() => setStep(1)}
          onNext={async p => { setBusy(true); const ok = await saveSettings(p); setBusy(false); if (ok) setStep(3); }} /> : <Loading />)}
        {step === 3 && (cfg ? <ServicesStep cfg={cfg} services={services} setServices={setServices} busy={busy} setBusy={setBusy}
          onBack={() => setStep(2)} saveSettings={saveSettings} onNext={() => setStep(4)} /> : <Loading />)}
        {step === 4 && (cfg ? <PaymentStep cfg={cfg} busy={busy} onBack={() => setStep(3)} onSkip={() => setStep(5)}
          onNext={async p => { setBusy(true); const ok = await saveSettings(p); setBusy(false); if (ok) setStep(5); }} /> : <Loading />)}
        {step === 5 && <ClientStep busy={busy} setBusy={setBusy} onBack={() => setStep(4)} onFinish={finish} />}

        <div className="border-t border-border pt-4 text-center">
          <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground" onClick={signOut}>{L("Sair", "Sign out")}</Button>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}

function Nav({ onBack, onNext, nextLabel, busy, disabled, onSkip }: {
  onBack?: () => void; onNext: () => void; nextLabel?: string; busy: boolean; disabled?: boolean; onSkip?: () => void;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-2">
        {onBack && <Button variant="ghost" className="gap-1.5 rounded-xl" onClick={onBack} disabled={busy}><ArrowLeft className="h-4 w-4" /> {L("Voltar", "Back")}</Button>}
        {onSkip && <Button variant="outline" className="rounded-xl" onClick={onSkip} disabled={busy}>{L("Pular", "Skip")}</Button>}
      </div>
      <Button className="h-12 gap-2 rounded-xl px-6 text-base" disabled={busy || disabled} onClick={onNext}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        {nextLabel ?? L("Continuar", "Continue")}
      </Button>
    </div>
  );
}

function BusinessStep({ busy, setBusy, current, onDone }: {
  busy: boolean; setBusy: (b: boolean) => void; current: BusinessModel | null; onDone: (data: unknown) => void;
}) {
  const [choice, setChoice] = useState<BusinessModel | null>(current);
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [currency, setCurrency] = useState<Currency>(getCurrency());

  const next = async () => {
    if (!choice) return;
    setBusy(true);
    const a = await supabase.rpc("set_business_model", { _model: choice });
    if (a.error) { setBusy(false); haptics.warning(); toast.error(a.error.message); return; }
    const b = await supabase.rpc("set_account_locale" as never, { _locale: locale, _currency: currency } as never);
    setBusy(false);
    if (b.error) { haptics.warning(); toast.error(b.error.message); return; }
    haptics.success();
    // Trocar a língua recarrega a tela; a etapa 2 já fica guardada antes.
    onDone(b.data ?? a.data);
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {L("O app usa as palavras do seu ramo em todas as telas - para você, sua equipe e seus clientes.",
           "The app uses the words of your field on every screen - for you, your team and your clients.")}
      </p>
      <BusinessModelPicker value={choice} onChange={setChoice} disabled={busy} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{L("Língua", "Language")}</Label>
          <WheelSelect value={locale} onValueChange={x => {
            setLocaleState(x as Locale);
            if (x === "en" && currency === "BRL") setCurrency("USD");
          }} label={L("Língua", "Language")} options={LOCALES} />
        </div>
        <div className="space-y-1.5">
          <Label>{L("Moeda", "Currency")}</Label>
          <WheelSelect value={currency} onValueChange={x => setCurrency(x as Currency)} label={L("Moeda", "Currency")} options={CURRENCIES} />
        </div>
      </div>
      <Nav busy={busy} disabled={!choice} onNext={next} />
    </div>
  );
}

function ScheduleStep({ cfg, busy, onBack, onNext }: {
  cfg: Settings; busy: boolean; onBack: () => void; onNext: (p: Partial<Settings>) => void;
}) {
  const { v } = useVocabulary();
  const [start, setStart] = useState(TIMES.includes(cfg.work_start) ? cfg.work_start : "08:00");
  const [end, setEnd] = useState(TIMES.includes(cfg.work_end) ? cfg.work_end : "18:00");
  const [slot, setSlot] = useState(DURATIONS.includes(cfg.slot_minutes) ? cfg.slot_minutes : 60);
  const [buffer, setBuffer] = useState(BUFFERS.includes(cfg.buffer_minutes) ? cfg.buffer_minutes : 0);
  const valid = end > start;
  const times = TIMES.map(t => ({ value: t, label: timeLabel(t) }));

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {L(`Os horários em que você atende. A agenda e a página de horários livres usam isto; dias de folga você marca depois em Bloqueios.`,
           `The hours you work. The calendar and the free-times page use this; days off you add later under Time off.`)}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>{L("Começa às", "Starts at")}</Label>
          <WheelSelect value={start} onValueChange={setStart} label={L("Começa às", "Starts at")} options={times} /></div>
        <div className="space-y-1.5"><Label>{L("Termina às", "Ends at")}</Label>
          <WheelSelect value={end} onValueChange={setEnd} label={L("Termina às", "Ends at")} options={times} /></div>
      </div>
      {!valid && <p className="text-sm text-destructive">{L("O fim precisa ser depois do começo.", "The end must be after the start.")}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>{L(`Duração ${v.appointment.do} ${v.appointment.l}`, `${v.appointment.s} length`)}</Label>
          <WheelSelect value={String(slot)} onValueChange={x => setSlot(Number(x))} label={L("Duração", "Length")}
            options={DURATIONS.map(d => ({ value: String(d), label: durationLabel(d) }))} /></div>
        <div className="space-y-1.5"><Label>{L("Intervalo entre eles", "Break between them")}</Label>
          <WheelSelect value={String(buffer)} onValueChange={x => setBuffer(Number(x))} label={L("Intervalo", "Break")}
            options={BUFFERS.map(b => ({ value: String(b), label: b === 0 ? L("Sem intervalo", "No break") : durationLabel(b) }))} /></div>
      </div>
      <Nav busy={busy} disabled={!valid} onBack={onBack}
        onNext={() => onNext({ work_start: start, work_end: end, slot_minutes: slot, buffer_minutes: buffer })} />
    </div>
  );
}

function ServicesStep({ cfg, services, setServices, busy, setBusy, onBack, saveSettings, onNext }: {
  cfg: Settings; services: Service[]; setServices: (s: Service[]) => void; busy: boolean; setBusy: (b: boolean) => void;
  onBack: () => void; saveSettings: (p: Partial<Settings>) => Promise<boolean>; onNext: () => void;
}) {
  const { v } = useVocabulary();
  const tp = v.topic;
  const [hourlyOnly, setHourlyOnly] = useState(false);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(DURATIONS.includes(cfg.slot_minutes) ? cfg.slot_minutes : 60);
  const [price, setPrice] = useState(0);
  const [hourly, setHourly] = useState(0);

  const add = async () => {
    if (!name.trim() || !(price > 0)) { toast.error(L("Informe o nome e o valor.", "Enter the name and the price.")); return; }
    setBusy(true);
    const { data, error } = await supabase.from("services" as never)
      .insert({ name: name.trim(), duration_minutes: duration, price, mode: "ambos", sort_order: services.length + 1 } as never)
      .select("id, name, duration_minutes, price").single();
    setBusy(false);
    if (error) { haptics.warning(); toast.error(dbErrorMessage(error, v)); return; }
    haptics.success();
    setServices([...services, data as unknown as Service]);
    setName(""); setPrice(0);
  };

  const next = async () => {
    setBusy(true);
    // O valor por hora padrão acompanha o primeiro serviço (ou o que foi
    // digitado): é o que vale para quem marca sem escolher serviço.
    const first = services.find(s => s.price != null);
    const perHour = hourlyOnly ? hourly : first ? Math.round(Number(first.price) * 60 / first.duration_minutes * 100) / 100 : 0;
    const ok = perHour > 0 ? await saveSettings({ default_lesson_price: perHour }) : true;
    setBusy(false);
    if (ok) onNext();
  };

  const canGo = hourlyOnly ? hourly > 0 : services.length > 0;

  return (
    <div className="space-y-5">
      {!hourlyOnly ? (
        <>
          <p className="text-sm text-muted-foreground">
            {L(`Cadastre pelo menos ${tp.um} ${tp.l}, com duração e valor. Ao marcar, escolher ${tp.o} ${tp.l} já preenche os dois.`,
               `Add at least one ${tp.l}, with its length and price. When booking, picking the ${tp.l} fills in both.`)}
          </p>
          {services.length > 0 && (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {services.map(s => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><Check className="h-4 w-4 shrink-0 text-primary" /><span className="truncate font-medium">{s.name}</span></span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{durationLabel(s.duration_minutes)}{s.price != null ? ` · ${fmtCurrency(Number(s.price))}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-3 rounded-xl border border-border p-3">
            <div className="space-y-1.5"><Label htmlFor="setup-svc-name">{L(`Nome ${tp.do} ${tp.l}`, `${tp.s} name`)}</Label>
              <Input id="setup-svc-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{L("Duração", "Length")}</Label>
                <WheelSelect value={String(duration)} onValueChange={x => setDuration(Number(x))} label={L("Duração", "Length")}
                  options={DURATIONS.map(d => ({ value: String(d), label: durationLabel(d) }))} /></div>
              <div className="space-y-1.5"><Label htmlFor="setup-svc-price">{L("Valor", "Price")}</Label>
                <NumberField id="setup-svc-price" step="0.01" inputMode="decimal" min={0} value={price} onValueChange={setPrice} /></div>
            </div>
            <Button variant="secondary" className="w-full gap-1.5 rounded-xl" disabled={busy} onClick={add}>
              <Plus className="h-4 w-4" /> {L(`Adicionar ${tp.l}`, `Add ${tp.l}`)}
            </Button>
          </div>
          <button type="button" className="text-sm font-medium text-primary" onClick={() => setHourlyOnly(true)}>
            {L(`Prefiro um valor por hora, sem lista de ${tp.lp}`, `I'd rather use an hourly price, without a list of ${tp.lp}`)}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {L(`Cada ${v.appointment.l} é ${v.appointment.pick("cobrado", "cobrada")} pelo tempo: valor por hora × duração. Dá para criar ${tp.lp} depois, em Configurações.`,
               `Each ${v.appointment.l} is charged by time: hourly price × length. You can add ${tp.lp} later in Settings.`)}
          </p>
          <div className="max-w-xs space-y-1.5"><Label htmlFor="setup-hourly">{L("Valor por hora", "Hourly price")}</Label>
            <NumberField id="setup-hourly" step="0.01" inputMode="decimal" min={0} value={hourly} onValueChange={setHourly} /></div>
          <button type="button" className="text-sm font-medium text-primary" onClick={() => setHourlyOnly(false)}>
            {L(`Voltar para a lista de ${tp.lp}`, `Back to the list of ${tp.lp}`)}
          </button>
        </>
      )}
      <Nav busy={busy} disabled={!canGo} onBack={onBack} onNext={next} />
    </div>
  );
}

function PaymentStep({ cfg, busy, onBack, onSkip, onNext }: {
  cfg: Settings; busy: boolean; onBack: () => void; onSkip: () => void; onNext: (p: Partial<Settings>) => void;
}) {
  const pix = getLocale() !== "en";
  const [pixKey, setPixKey] = useState(cfg.pix_key ?? "");
  const [pixName, setPixName] = useState(cfg.pix_receiver_name ?? "");
  const [pixCity, setPixCity] = useState(cfg.pix_city ?? "");
  const [link, setLink] = useState(cfg.payment_link ?? "");
  const filled = !!(pixKey.trim() || link.trim());

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {L("Aparece nas cobranças e no portal dos seus clientes. Pode deixar para depois.", "Shown on payment requests and in your clients' portal. You can leave it for later.")}
      </p>
      {pix && (
        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="space-y-1.5"><Label htmlFor="setup-pix">{L("Chave Pix", "Pix key")}</Label>
            <Input id="setup-pix" value={pixKey} onChange={e => setPixKey(e.target.value)} placeholder="CPF, CNPJ, e-mail, +55 celular ou chave aleatória" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="setup-pix-name">{L("Nome de quem recebe", "Receiver name")}</Label>
              <Input id="setup-pix-name" value={pixName} onChange={e => setPixName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="setup-pix-city">{L("Cidade", "City")}</Label>
              <Input id="setup-pix-city" value={pixCity} onChange={e => setPixCity(e.target.value)} /></div>
          </div>
        </div>
      )}
      <div className="space-y-1.5"><Label htmlFor="setup-link">{L("Link de pagamento (opcional)", "Payment link")}</Label>
        <Input id="setup-link" value={link} onChange={e => setLink(e.target.value)} placeholder="https://" inputMode="url" /></div>
      <Nav busy={busy} disabled={!filled} onBack={onBack} onSkip={onSkip}
        onNext={() => onNext({
          pix_key: pixKey.trim() || null, pix_receiver_name: pixName.trim() || null,
          pix_city: pixCity.trim() || null, payment_link: link.trim() || null,
        })} />
    </div>
  );
}

function ClientStep({ busy, setBusy, onBack, onFinish }: {
  busy: boolean; setBusy: (b: boolean) => void; onBack: () => void; onFinish: () => void;
}) {
  const { v } = useVocabulary();
  const c = v.client;
  const [name, setName] = useState("");
  const [guardian, setGuardian] = useState("");
  const [zapText, setZapText] = useState("");
  const zap = useMemo(() => normalizeWhatsApp(zapText), [zapText]);

  const save = async () => {
    if (!name.trim()) return;
    if (zap === "invalido") { toast.error(L("WhatsApp com DDD, ex.: (11) 98765-4321", "WhatsApp with country code, e.g. +1 555 123 4567")); return; }
    setBusy(true);
    const { error } = await supabase.from("students").insert({
      student_name: name.trim(), guardian_name: guardian.trim() || null, ...(zap ? { whatsapp: zap } : {}),
    } as never);
    setBusy(false);
    if (error) { haptics.warning(); toast.error(dbErrorMessage(error, v)); return; }
    onFinish();
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {L(`Cadastre quem você já atende. Os outros você cadastra depois em ${c.p}.`, `Add someone you already serve. You can add the rest later under ${c.p}.`)}
      </p>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="setup-client">{L(`Nome ${c.do} ${c.l}`, `${c.s} name`)}</Label>
          <Input id="setup-client" value={name} onChange={e => setName(e.target.value)} maxLength={120} /></div>
        <GuardianField w={v} value={guardian} onChange={setGuardian} />
        <div className="space-y-1.5"><Label htmlFor="setup-zap">WhatsApp</Label>
          <Input id="setup-zap" type="tel" inputMode="tel" value={zapText} onChange={e => setZapText(e.target.value)} placeholder={L("(11) 98765-4321", "+1 555 123 4567")} /></div>
      </div>
      <Nav busy={busy} disabled={!name.trim()} onBack={onBack} onSkip={onFinish}
        nextLabel={L("Concluir", "Finish")} onNext={save} />
    </div>
  );
}

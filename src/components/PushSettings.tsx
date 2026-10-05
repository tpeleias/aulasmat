import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useTasksEnabled, useWords } from "@/hooks/useVocabulary";
import { dbErrorMessage } from "@/lib/dbErrors";
import { L } from "@/lib/i18n";
import { enablePush, pushPermission, pushSupported, type PushPermission } from "@/lib/push";

/**
 * Notificações no celular (05/10): o pedido de permissão (na hora certa, não
 * ao abrir o app) e o que cada pessoa quer receber. Ver src/lib/push.ts.
 */
type Prefs = Record<string, boolean | number>;
const isStaff = (role: string | null) => role === "admin" || role === "teacher";

function usePermission() {
  const [perm, setPerm] = useState<PushPermission>("unsupported");
  const refresh = useCallback(() => { void pushPermission().then(setPerm); }, []);
  useEffect(() => {
    refresh();
    // Voltou das configurações do Android: relê.
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  return { perm, setPerm };
}

const DISMISS_KEY = "cronys.push.prompt.dismissed";

/** O convite, no painel de quem ainda não decidiu. "Agora não" esconde neste aparelho. */
export function PushPrompt() {
  const { role, user } = useAuth();
  const w = useWords();
  const { perm, setPerm } = usePermission();
  const key = `${DISMISS_KEY}.${user?.id ?? ""}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  if (!pushSupported() || perm !== "prompt" || hidden || !user) return null;
  const ap = w.appointment;
  const dismiss = () => { try { localStorage.setItem(key, "1"); } catch { /* ok */ } setHidden(true); };
  const enable = async () => {
    const p = await enablePush();
    setPerm(p);
    if (p === "granted") toast.success(L("Pronto: os avisos chegam neste celular.", "Done: notices will arrive on this phone."));
    else dismiss();
  };
  return (
    <Card className="flex items-start gap-3 border-primary/30 p-4">
      <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-semibold">{L("Receber avisos no celular?", "Get notices on your phone?")}</p>
        <p className="text-xs text-muted-foreground">
          {isStaff(role)
            ? L(`Um aviso antes de cada ${ap.l} e quando um cliente pedir ou cancelar horário. Você escolhe o que recebe em Minha conta.`,
                `A heads-up before each ${ap.l} and when a client requests or cancels. Choose what you get in My account.`)
            : L(`Lembrete ${ap.pick("do", "da")} ${ap.l} na véspera e 1 hora antes, e quando o horário mudar.`,
                `A reminder the day before and 1 hour before each ${ap.l}, and when the time changes.`)}
        </p>
        <div className="flex gap-2">
          <Button size="sm" className="rounded-xl" onClick={enable}>{L("Ativar", "Turn on")}</Button>
          <Button size="sm" variant="ghost" className="rounded-xl" onClick={dismiss}>{L("Agora não", "Not now")}</Button>
        </div>
      </div>
      <button type="button" aria-label={L("Fechar", "Close")} className="text-muted-foreground" onClick={dismiss}><X className="h-4 w-4" /></button>
    </Card>
  );
}

/** Em Minha conta: ligar e escolher cada tipo. */
export default function PushSettings() {
  const { role } = useAuth();
  const w = useWords();
  const tasks = useTasksEnabled();
  const { perm, setPerm } = usePermission();
  const [prefs, setPrefs] = useState<Prefs>({});

  useEffect(() => {
    if (perm !== "granted") return;
    void supabase.rpc("my_push_prefs" as never).then(({ data }) => setPrefs((data ?? {}) as Prefs));
  }, [perm]);

  if (!pushSupported()) return null;
  const ap = w.appointment;
  const on = (k: string) => prefs[k] !== false;
  const save = async (patch: Prefs) => {
    const before = prefs;
    setPrefs(p => ({ ...p, ...patch }));
    const { data, error } = await supabase.rpc("set_push_prefs" as never, { _prefs: patch } as never);
    if (error) { setPrefs(before); toast.error(dbErrorMessage(error)); return; }
    setPrefs((data ?? {}) as Prefs);
  };

  const row = (k: string, title: string, text: string, extra?: React.ReactNode) => (
    <div key={k} className="flex items-start justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{text}</div>
        {extra}
      </div>
      <Switch checked={on(k)} onCheckedChange={v => save({ [k]: v })} aria-label={title} />
    </div>
  );

  const staffRows = [
    row("soon", L(`Antes ${ap.pick("de cada", "de cada")} ${ap.l}`, `Before each ${ap.l}`), L("Com o nome do cliente e o horário.", "With the client's name and time."),
      on("soon") && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <span>{L("Avisar", "Notify")}</span>
          <Select value={String(prefs.soon_minutes ?? 30)} onValueChange={v => save({ soon_minutes: Number(v) })}>
            <SelectTrigger className="h-7 w-24 rounded-lg text-xs" aria-label={L("Quanto antes", "How early")}><SelectValue /></SelectTrigger>
            <SelectContent>{[10, 15, 30, 60].map(m => <SelectItem key={m} value={String(m)}>{m} min</SelectItem>)}</SelectContent>
          </Select>
          <span>{L("antes", "before")}</span>
        </div>
      )),
    row("requests", L("Pedidos e cancelamentos", "Requests and cancellations"), L("Quando um cliente pede um horário ou cancela.", "When a client requests a time or cancels.")),
    row("day", L("Resumo do dia", "Daily summary"), L(`Às 7h: quant${ap.pick("os", "as")} ${ap.lp} hoje e ${ap.pick("o primeiro", "a primeira")}.`, `At 7am: how many ${ap.lp} today and the first one.`)),
  ];
  const clientRows = [
    row("eve", L("Na véspera", "The day before"), L(`Às 18h, ${ap.pick("o", "a")} ${ap.l} de amanhã.`, `At 6pm, tomorrow's ${ap.l}.`)),
    row("hour", L("1 hora antes", "1 hour before"), L(`On-line: tocar no aviso já entra na reunião.`, "Online: tapping the notice joins the meeting.")),
    row("changes", L("Mudanças", "Changes"), L("Marcado, aceito, recusado, cancelado ou horário novo.", "Booked, accepted, declined, canceled or a new time.")),
    ...(tasks ? [row("homework", L(`${w.task.novo} ${w.task.l}`, `New ${w.task.l}`), L(`Quando ${w.task.pick("um", "uma")} ${w.task.l} for passad${w.task.pick("o", "a")}.`, `When a ${w.task.l} is assigned.`))] : []),
  ];

  return (
    <Card className="space-y-3 rounded-2xl p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Bell className="h-4 w-4" /> {L("Avisos no celular", "Phone notices")}</h2>
      {perm === "denied" ? (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
          {L("Os avisos estão bloqueados neste celular. Para liberar: Configurações do Android → Apps → Cronys → Notificações.",
             "Notices are blocked on this phone. To allow them: Android Settings → Apps → Cronys → Notifications.")}
        </p>
      ) : perm !== "granted" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{L("Desligados neste celular.", "Off on this phone.")}</p>
          <Button size="sm" className="rounded-xl" onClick={async () => setPerm(await enablePush())}>{L("Ativar", "Turn on")}</Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">{isStaff(role) ? staffRows : clientRows}</div>
          <p className="text-xs text-muted-foreground">
            {L("Entre 21h e 8h só chegam os lembretes de horário; o resto espera a manhã. Cobrança não vem por aqui, só por e-mail.",
               "Between 9pm and 8am only time reminders arrive; the rest waits for the morning. Billing never comes here, only by email.")}
          </p>
        </>
      )}
    </Card>
  );
}

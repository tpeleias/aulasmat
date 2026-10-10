import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Lock, Video } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { usePlan } from "@/hooks/usePlan";
import { useWords } from "@/hooks/useVocabulary";
import { capitalize } from "@/lib/balance";
import { dbErrorMessage } from "@/lib/dbErrors";
import { L } from "@/lib/i18n";
import type { MeetingMode } from "@/lib/meeting";

/**
 * Link de reunião das aulas on-line, por profissional (Thiago, 05/10; ver a
 * migration 20261005010000). O admin vê todos; o profissional com login, só
 * a si. Quem gera o link é o banco (e o Google, no Meet).
 */
type Row = { teacher_id: string; teacher_name: string; mode: MeetingMode; fixed_url: string | null; google_ready: boolean; is_self: boolean };

export default function MeetingSettings() {
  const { plan } = usePlan();
  const w = useWords();
  const ap = w.appointment;
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("meeting_settings" as never);
    const list = (data ?? []) as Row[];
    setRows(list);
    setUrls(Object.fromEntries(list.map(r => [r.teacher_id, r.fixed_url ?? ""])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (r: Row, mode: MeetingMode, url?: string) => {
    const fixed = (url ?? urls[r.teacher_id] ?? "").trim();
    if (mode === "fixed" && !fixed) {
      // Escolheu "sala fixa" sem link ainda: só marca na tela, salva quando colar.
      setRows(rs => rs.map(x => (x.teacher_id === r.teacher_id ? { ...x, mode } : x)));
      return;
    }
    setBusy(r.teacher_id);
    const { error } = await supabase.rpc("set_meeting_settings" as never, {
      _teacher: r.teacher_id, _mode: mode, _fixed_url: mode === "fixed" ? fixed : (r.fixed_url ?? null),
    } as never);
    setBusy(null);
    if (error) { toast.error(dbErrorMessage(error)); load(); return; }
    toast.success(L(`Pronto. ${cap1(ap.os)} próxim${ap.pick("os", "as")} ${ap.lp} on-line já usam esta escolha.`, `Done. Upcoming online ${ap.lp} now use this choice.`));
    load();
  };

  const options = (r: Row): { value: MeetingMode; title: string; text: string; locked?: string }[] => [
    { value: "none", title: L("Nenhum automático", "No automatic link"),
      text: L(`Você cola o link em cada ${ap.l}, se quiser.`, `Paste a link in each ${ap.l} if you want.`) },
    { value: "fixed", title: L("Minha sala fixa", "My personal room"),
      text: L(`O link da sua sala no Zoom, Meet, Teams... O mesmo em tod${ap.pick("o", "a")} ${ap.l}.`, `Your Zoom, Meet, Teams... room link. The same for every ${ap.l}.`) },
    { value: "jitsi", title: L("Jitsi Meet (grátis, sem cadastro)", "Jitsi Meet (free, no sign-up)"),
      text: L(`Uma sala nova para cada ${ap.l}, criada na hora.`, `A new room for each ${ap.l}, created instantly.`) },
    { value: "google_meet", title: "Google Meet",
      text: L(`Um Meet para cada ${ap.l}, criado no seu Google Agenda.`, `A Meet for each ${ap.l}, created in your Google Calendar.`),
      locked: !plan.google_calendar
        ? L("Do Cronys Pro e do Max IA.", "Comes with Cronys Pro and Max AI.")
        : !r.google_ready
          ? L("Precisa do Google Agenda conectado, com \"Exportar agendamentos\" ligado (em Integrações). Sem isso, as aulas usam o Jitsi.",
              "Needs Google Calendar connected with \"Export bookings\" on (in Integrations). Without it, sessions use Jitsi.")
          : undefined },
  ];

  if (rows.length === 0) return null;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <Video className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h3 className="font-semibold">{L(`Link d${ap.pick("os", "as")} ${ap.lp} on-line`, `Online ${ap.l} link`)}</h3>
          <p className="text-sm text-muted-foreground">
            {L(`Ao marcar ${ap.um} ${ap.l} on-line, o link entra sozinho: no lembrete por e-mail, no WhatsApp, no portal do cliente (botão "Entrar") e no Google Agenda.`,
               `When you book an online ${ap.l}, the link goes in automatically: email reminders, WhatsApp, the client portal ("Join" button) and Google Calendar.`)}
          </p>
        </div>
      </div>

      {rows.map(r => (
        <div key={r.teacher_id} className="space-y-3 rounded-lg border p-3">
          {rows.length > 1 && <div className="font-medium">{capitalize(r.teacher_name)}</div>}
          <RadioGroup value={r.mode} onValueChange={v => save(r, v as MeetingMode)} disabled={busy === r.teacher_id} className="gap-2">
            {options(r).map(o => (
              <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 ${r.mode === o.value ? "bg-primary/10" : "bg-muted/40"}`}>
                <RadioGroupItem value={o.value} className="mt-0.5" disabled={o.value === "google_meet" && !plan.google_calendar} aria-label={o.title} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {o.title}
                    {o.value === "google_meet" && !plan.google_calendar && <Lock className="h-3 w-3" aria-label={L("travado", "locked")} />}
                  </span>
                  <span className="block text-xs text-muted-foreground">{o.text}</span>
                  {o.locked && <span className="mt-0.5 block text-xs font-medium text-foreground/80">{o.locked}</span>}
                </span>
              </label>
            ))}
          </RadioGroup>

          {r.mode === "fixed" && (
            <div className="flex gap-2">
              <Input inputMode="url" aria-label={L("Link da sua sala", "Your room link")} value={urls[r.teacher_id] ?? ""}
                placeholder="https://zoom.us/j/..."
                onChange={e => setUrls(u => ({ ...u, [r.teacher_id]: e.target.value }))} />
              <Button size="sm" className="h-10 rounded-xl" disabled={busy === r.teacher_id || !(urls[r.teacher_id] ?? "").trim() || (urls[r.teacher_id] ?? "").trim() === (r.fixed_url ?? "")}
                onClick={() => save(r, "fixed", urls[r.teacher_id])}>{L("Salvar", "Save")}</Button>
            </div>
          )}

          {r.mode === "jitsi" && <JitsiHelp />}
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        {L(`Trocar a escolha muda o link d${ap.pick("os", "as")} próxim${ap.pick("os", "as")} ${ap.lp} on-line. O link colado à mão n${ap.pick("um", "uma")} ${ap.l} continua o mesmo.`,
           `Changing this updates the link of upcoming online ${ap.lp}. A link pasted by hand in a ${ap.l} stays.`)}
      </p>
    </Card>
  );
}

const cap1 = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** Como usar o Jitsi, para quem nunca usou (Thiago pediu as instruções, 05/10). */
export function JitsiHelp({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const w = useWords();
  const ap = w.appointment;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-dashed px-3 py-2">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium">
        {L("Como funciona o Jitsi", "How Jitsi works")}
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
          <li>{L(`Cada ${ap.l} on-line ganha uma sala própria (meet.jit.si/Cronys-...). O link vai para o cliente no lembrete, no portal e no WhatsApp.`,
                 `Each online ${ap.l} gets its own room (meet.jit.si/Cronys-...). The client gets the link in reminders, the portal and WhatsApp.`)}</li>
          <li>{L("Na hora, você toca em \"Entrar\" (na agenda ou no início do Cronys). No computador abre no navegador, sem instalar nada.",
                 "At the time, tap \"Join\" (in the Cronys calendar or home). On a computer it opens in the browser, nothing to install.")}</li>
          <li>{L("No celular, o Jitsi pede o app \"Jitsi Meet\" (grátis, na Play Store e na App Store). Vale avisar o cliente na primeira vez.",
                 "On a phone, Jitsi asks for the \"Jitsi Meet\" app (free, on Google Play and the App Store). Worth telling the client the first time.")}</li>
          <li>{L("Quem abre a sala (você) entra com uma conta Google, GitHub ou Facebook - é a regra do Jitsi para salas públicas. O cliente entra sem conta e espera você abrir.",
                 "Whoever opens the room (you) signs in with a Google, GitHub or Facebook account - Jitsi's rule for public rooms. The client joins without an account and waits for you.")}</li>
          <li>{L("Entre alguns minutos antes, para o cliente não ficar esperando. Sem limite de tempo; a sala some quando todos saem.",
                 "Join a few minutes early so the client isn't left waiting. No time limit; the room goes away when everyone leaves.")}</li>
          <li>{L("Dica: libere câmera e microfone quando o navegador perguntar. Se travar, feche e abra o link de novo.",
                 "Tip: allow camera and microphone when the browser asks. If it freezes, close and open the link again.")}</li>
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

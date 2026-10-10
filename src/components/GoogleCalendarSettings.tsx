import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ProUpsell } from "@/components/ProUpsell";
import { usePlan } from "@/hooks/usePlan";
import { useAuth } from "@/hooks/useAuth";
import { capitalize } from "@/lib/balance";
import { openExternal } from "@/lib/whatsapp";
import { L } from "@/lib/i18n";
import { dbErrorMessage } from "@/lib/dbErrors";
import { googleFunctionError, googleStoredError } from "@/lib/googleCalendarErrors";
import { toast } from "sonner";
import { CalendarDays, Loader2 } from "lucide-react";

// Google Agenda por profissional (Pro e Max). O admin vê todo mundo; o login de
// profissional vê só a si. Cada um conecta SÓ o próprio Google (ninguém entra
// na conta Google de outra pessoa): o profissional com login, o dele; o admin,
// o cadastro que ele marcou como "sou eu" (teachers.admin_user_id). Os demais
// aparecem só com a situação. Quem fala com o Google é a função
// google-calendar. Ver as migrations 20260926140000 e 20260926170000.

type Row = {
  teacher_id: string;
  teacher_name: string;
  connected: boolean;
  google_email: string | null;
  import_enabled: boolean;
  export_enabled: boolean;
  status: string | null;
  last_error: string | null;
  last_import_at: string | null;
  last_export_at: string | null;
  /** Pode conectar/mexer: é o próprio (login de profissional ou "sou eu" do admin). */
  can_manage: boolean;
  has_login: boolean;
  /** Este cadastro é quem está logado. */
  is_self: boolean;
  /** Admin pode marcar como "sou eu" (sem login e sem dono). */
  claimable: boolean;
};

export default function GoogleCalendarSettings() {
  const { plan } = usePlan();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const { isAdmin } = useAuth();
  // Clientes recebendo os horários no Google deles (só o admin liga).
  const [clients, setClients] = useState<{ id: number; on: boolean } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("google_calendar_status" as never);
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("settings").select("id, client_google_calendar" as "id").maybeSingle().then(({ data }) => {
      const d = data as { id: number; client_google_calendar?: boolean } | null;
      if (d) setClients({ id: d.id, on: !!d.client_google_calendar });
    });
  }, [isAdmin]);
  const setClientsOn = async (on: boolean) => {
    if (!clients) return;
    setClients({ ...clients, on });
    const { error } = await supabase.from("settings").update({ client_google_calendar: on } as never).eq("id", clients.id);
    if (error) { toast.error(dbErrorMessage(error)); setClients({ ...clients, on: !on }); }
  };
  // Quem conectou no navegador do celular volta ao app: relê ao voltar.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (!plan.google_calendar) {
    return (
      <ProUpsell titulo={L("Google Agenda é do Cronys Pro e do Max IA", "Google Calendar comes with Cronys Pro and Max AI")} compacto>
        {L("os compromissos do Google bloqueiam o horário aqui, e os agendamentos do Cronys aparecem no Google.",
           "your Google events block the time here, and Cronys bookings show up in Google.")}
      </ProUpsell>
    );
  }

  const connect = async (r: Row) => {
    setBusy(r.teacher_id);
    const { data, error } = await supabase.functions.invoke("google-calendar", {
      body: {
        action: "connect",
        teacher_id: r.teacher_id,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
    setBusy(null);
    if (error || !data?.url) {
      toast.error(await googleFunctionError(data, error));
      return;
    }
    openExternal(data.url);
  };

  const setSwitches = async (r: Row, imp: boolean, exp: boolean) => {
    setRows(rs => rs.map(x => (x.teacher_id === r.teacher_id ? { ...x, import_enabled: imp, export_enabled: exp } : x)));
    const { error } = await supabase.rpc("google_calendar_set" as never, { _teacher: r.teacher_id, _import: imp, _export: exp } as never);
    if (error) { toast.error(dbErrorMessage(error)); load(); return; }
    // Aplica já (o ocupado entra, ou os agendamentos saem do Google).
    supabase.functions.invoke("google-calendar", { body: { action: "sync", teacher_id: r.teacher_id } }).then(() => load());
  };

  // "Sou eu": o admin diz qual cadastro de profissional é ele (null = nenhum).
  const claim = async (teacherId: string | null) => {
    setBusy(teacherId ?? "none");
    const { error } = await supabase.rpc("google_calendar_claim_self" as never, { _teacher: teacherId } as never);
    setBusy(null);
    if (error) toast.error(dbErrorMessage(error));
    load();
  };
  const hasSelf = rows.some(r => r.is_self);

  const disconnect = async (r: Row) => {
    if (!confirm(L(
      `Desconectar o Google de ${capitalize(r.teacher_name)}? O ocupado importado sai daqui e a agenda "Cronys" é apagada do Google.`,
      `Disconnect Google for ${capitalize(r.teacher_name)}? Imported busy times are removed here and the "Cronys" calendar is deleted from Google.`,
    ))) return;
    setBusy(r.teacher_id);
    const { error } = await supabase.functions.invoke("google-calendar", { body: { action: "disconnect", teacher_id: r.teacher_id } });
    setBusy(null);
    if (error) toast.error(L("Não deu para desconectar agora.", "Couldn't disconnect right now."));
    else toast.success(L("Google desconectado.", "Google disconnected."));
    load();
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <CalendarDays className="w-5 h-5 mt-0.5 text-primary shrink-0" />
        <div>
          <h3 className="font-semibold">Google Agenda</h3>
          <p className="text-sm text-muted-foreground">
            {L("Importar: o que está ocupado no Google bloqueia o horário aqui (só o horário, sem o título). Exportar: os agendamentos vão para uma agenda \"Cronys\" dentro do Google.",
               "Import: busy times in Google block the time here (just the time, no titles). Export: bookings go to a \"Cronys\" calendar inside Google.")}
          </p>
        </div>
      </div>

      {rows.length === 0 && <p className="text-sm text-muted-foreground">{L("Nenhum profissional ativo.", "No active professionals.")}</p>}
      {!hasSelf && rows.some(r => r.claimable) && (
        <p className="text-sm rounded-md bg-muted/50 px-3 py-2">
          {L("Você também atende? Toque em \"Sou eu\" no seu cadastro para conectar o seu Google.",
             "Do you also see clients? Tap \"This is me\" on your profile to connect your Google.")}
        </p>
      )}

      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.teacher_id} className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium">{capitalize(r.teacher_name)}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.connected ? (r.google_email ?? L("Conectado", "Connected")) : L("Não conectado", "Not connected")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {r.connected && r.status === "revoked" && <Badge variant="destructive">{L("Sem acesso", "No access")}</Badge>}
                {r.connected && r.status === "error" && <Badge variant="outline">{L("Com erro", "Error")}</Badge>}
                {busy === r.teacher_id && <Loader2 className="w-4 h-4 animate-spin" />}
                {!r.can_manage ? (
                  r.claimable && !hasSelf ? (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => claim(r.teacher_id)}>
                      {L("Sou eu", "This is me")}
                    </Button>
                  ) : r.connected && r.status === "ok" ? (
                    <Badge variant="outline">{r.import_enabled || r.export_enabled ? L("Sincronizado", "Synced") : L("Pausado", "Paused")}</Badge>
                  ) : null
                ) : !r.connected || r.status === "revoked" ? (
                  <Button size="sm" disabled={busy !== null} onClick={() => connect(r)}>
                    {r.connected ? L("Reconectar", "Reconnect") : L("Conectar Google", "Connect Google")}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => disconnect(r)}>
                    {L("Desconectar", "Disconnect")}
                  </Button>
                )}
              </div>
            </div>
            {!r.can_manage && !(r.claimable && !hasSelf) && (
              <p className="text-xs text-muted-foreground">
                {r.has_login || !r.claimable
                  ? L(`Quem conecta é ${capitalize(r.teacher_name)}, pelo acesso próprio (a agenda do Google é pessoal).`,
                      `${capitalize(r.teacher_name)} connects it from their own login (the Google calendar is personal).`)
                  : L(`Para conectar a agenda de ${capitalize(r.teacher_name)}, ${capitalize(r.teacher_name)} precisa de um acesso próprio (em Acessos) - cada um conecta só o próprio Google.`,
                      `To connect ${capitalize(r.teacher_name)}'s calendar, ${capitalize(r.teacher_name)} needs their own login (in Access) - everyone connects only their own Google.`)}
              </p>
            )}
            {r.is_self && !r.has_login && !r.connected && (
              <button type="button" className="text-xs text-muted-foreground underline" disabled={busy !== null} onClick={() => claim(null)}>
                {L("Não sou eu", "This isn't me")}
              </button>
            )}
            {r.can_manage && r.connected && r.status !== "revoked" && (
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <span>{L("Importar ocupado do Google", "Import Google busy times")}</span>
                  <Switch checked={r.import_enabled} onCheckedChange={v => setSwitches(r, v, r.export_enabled)} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <span>{L("Exportar agendamentos para o Google", "Export bookings to Google")}</span>
                  <Switch checked={r.export_enabled} onCheckedChange={v => setSwitches(r, r.import_enabled, v)} />
                </label>
              </div>
            )}
            {r.can_manage && r.connected && r.last_error && (
              <p className="text-xs text-destructive">{googleStoredError(r.last_error)}</p>
            )}
          </div>
        ))}
      </div>

      {isAdmin && clients && (
        <label className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>
            <span className="font-medium">{L("Clientes também", "Clients too")}</span>
            <span className="block text-xs text-muted-foreground">
              {L("Cada cliente com acesso ao portal pode receber os próprios horários no Google Agenda dele (\"Aula com Thiago · Matemática\", com endereço ou online, sem valores). Só nesse sentido: nada do Google do cliente é lido.",
                 "Each client with portal access can get their own appointments in their Google Calendar (\"Lesson with Thiago · Math\", with address or online, no prices). One way only: nothing in the client's Google is read.")}
            </span>
          </span>
          <Switch checked={clients.on} onCheckedChange={setClientsOn} />
        </label>
      )}
    </Card>
  );
}

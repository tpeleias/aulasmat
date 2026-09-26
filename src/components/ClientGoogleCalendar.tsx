import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { openExternal } from "@/lib/whatsapp";
import { L } from "@/lib/i18n";
import { googleFunctionError, googleStoredError } from "@/lib/googleCalendarErrors";
import { toast } from "sonner";
import { CalendarDays, Loader2 } from "lucide-react";

// O cliente recebe os próprios horários no Google Agenda dele (só nesse
// sentido: nada do Google dele é lido). Só aparece quando a empresa liberou
// (Configurações → Google Agenda) e o plano traz. Migration 20260926190000.

type Status = { enabled: boolean; connected: boolean; google_email: string | null; status: string | null; last_error: string | null };

export default function ClientGoogleCalendar() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("client_calendar_status" as never);
    const rows = data as unknown as Status[] | Status | null;
    setSt((Array.isArray(rows) ? rows[0] : rows) ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);
  // Quem conectou no navegador do celular volta ao app: relê ao voltar.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (!st || (!st.enabled && !st.connected)) return null;

  const connect = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("google-calendar", {
      body: { action: "connect", kind: "client", tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
    setBusy(false);
    if (error || !data?.url) {
      toast.error(await googleFunctionError(data, error));
      return;
    }
    openExternal(data.url);
  };

  const disconnect = async () => {
    if (!confirm(L("Desconectar o Google Agenda? A agenda \"Cronys\" é apagada do seu Google.",
                   "Disconnect Google Calendar? The \"Cronys\" calendar is deleted from your Google."))) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("google-calendar", { body: { action: "disconnect", kind: "client" } });
    setBusy(false);
    if (error) toast.error(L("Não deu para desconectar agora.", "Couldn't disconnect right now."));
    load();
  };

  const revoked = st.connected && st.status === "revoked";

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start gap-3">
        <CalendarDays className="w-5 h-5 mt-0.5 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Google Agenda</h2>
          <p className="text-sm text-muted-foreground">
            {st.connected && !revoked
              ? L(`Seus horários aparecem na agenda "Cronys" do seu Google (${st.google_email ?? ""}) e se atualizam sozinhos.`,
                  `Your appointments show up in the "Cronys" calendar in your Google (${st.google_email ?? ""}) and update on their own.`)
              : L("Receba seus horários no seu Google Agenda. Remarcou aqui, muda lá sozinho. Nada da sua agenda é lido.",
                  "Get your appointments in your Google Calendar. Rescheduled here, it changes there. Nothing in your calendar is read.")}
          </p>
          {st.connected && st.status === "error" && st.last_error && <p className="mt-1 text-xs text-destructive">{googleStoredError(st.last_error)}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {revoked && <Badge variant="destructive">{L("Sem acesso", "No access")}</Badge>}
        {!st.connected || revoked ? (
          st.enabled && (
            <Button size="sm" disabled={busy} onClick={connect}>
              {revoked ? L("Reconectar", "Reconnect") : L("Conectar Google Agenda", "Connect Google Calendar")}
            </Button>
          )
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={disconnect}>{L("Desconectar", "Disconnect")}</Button>
        )}
      </div>
    </Card>
  );
}

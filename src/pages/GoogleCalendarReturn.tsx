import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { L } from "@/lib/i18n";
import { CalendarCheck, CalendarX, Loader2 } from "lucide-react";

// A volta do Google depois de conectar a agenda. O Google devolve a pessoa a
// /google-agenda/callback deste site (é esse endereço que a tela de permissão
// do Google mostra, por isso tem de ser do Cronys); esta página repassa o
// código à função google-calendar e mostra o resultado. Quem conectou pelo app
// Android está no navegador do celular: é só voltar ao app.
export default function GoogleCalendarReturn() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const isCallback = pathname.replace(/\/+$/, "").endsWith("/callback");
  const [status, setStatus] = useState<string | null>(isCallback ? null : params.get("status"));
  const sent = useRef(false);

  useEffect(() => {
    if (!isCallback || sent.current) return;
    sent.current = true;
    supabase.functions.invoke("google-calendar", {
      body: {
        action: "callback",
        code: params.get("code") ?? undefined,
        state: params.get("state") ?? undefined,
        error: params.get("error") ?? undefined,
      },
    }).then(({ data }) => {
      setStatus((data as { status?: string } | null)?.status ?? "erro");
      // Tira o código da barra de endereço (ele só vale uma vez).
      window.history.replaceState(null, "", "/google-agenda");
    });
  }, [isCallback, params]);

  if (status === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full p-6 space-y-4 text-center">
          <Loader2 className="w-10 h-10 mx-auto animate-spin text-primary" />
          <p>{L("Conectando o Google Agenda...", "Connecting Google Calendar...")}</p>
        </Card>
      </div>
    );
  }

  const ok = status === "ok";
  const msg = ok
    ? L("Google Agenda conectado. O ocupado de lá já bloqueia o horário no Cronys, e os agendamentos aparecem na agenda \"Cronys\" do Google.",
        "Google Calendar connected. Busy times there now block the time in Cronys, and bookings show up in the \"Cronys\" calendar in Google.")
    : status === "negado"
      ? L("A conexão foi cancelada na tela do Google. Nada mudou.", "The connection was cancelled on Google's screen. Nothing changed.")
      : L("Não deu para conectar agora. Tente de novo pelo Cronys.", "Couldn't connect right now. Please try again from Cronys.");

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full p-6 space-y-4 text-center">
        {ok ? <CalendarCheck className="w-10 h-10 mx-auto text-primary" /> : <CalendarX className="w-10 h-10 mx-auto text-muted-foreground" />}
        <p>{msg}</p>
        <p className="text-sm text-muted-foreground">
          {L("Se você começou pelo app do celular, pode fechar esta página e voltar para ele.",
             "If you started from the phone app, you can close this page and go back to it.")}
        </p>
        <Button asChild><Link to="/admin/bloqueios">{L("Abrir o Cronys", "Open Cronys")}</Link></Button>
      </Card>
    </div>
  );
}

import { Link, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { L } from "@/lib/i18n";
import { CalendarCheck, CalendarX } from "lucide-react";

// Para onde o Google devolve a pessoa depois de conectar a agenda (a função
// google-calendar redireciona para cá com ?status=). Quem conectou pelo app
// Android está no navegador do celular: é só voltar ao app.
export default function GoogleCalendarReturn() {
  const [params] = useSearchParams();
  const status = params.get("status");
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

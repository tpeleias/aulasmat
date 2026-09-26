import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/hooks/usePlan";
import { useWords } from "@/hooks/useVocabulary";
import { reminderMessage, whatsAppLink } from "@/lib/whatsapp";
import { WhatsAppGlyph, sendOnMyWay } from "@/components/LessonQuickActions";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";

import { L } from "@/lib/i18n";
type LessonLike = {
  id?: string;
  student_name: string;
  guardian_name?: string | null;
  start_at: string;
  address?: string | null;
  is_online?: boolean;
  status?: string;
};

/**
 * WhatsApp de um toque na aula já marcada (Pro e Max) e "Estou a caminho" com
 * a localização (Max). Quem envia é a pessoa, pelo WhatsApp do celular dela:
 * nada passa pelo servidor e a localização não fica guardada em lugar nenhum.
 */
export function LessonWhatsApp({ lesson, phone }: { lesson: LessonLike; phone: string | null }) {
  const { plan, loading } = usePlan();
  const w = useWords();
  const { templates } = useMessageTemplates();
  const [locating, setLocating] = useState(false);

  if (loading || !lesson.id || lesson.status !== "agendada") return null;

  if (!plan.whatsapp_link) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        {L("Lembrete e aviso pelo WhatsApp com um toque: a partir do Cronys Start.", "One-tap WhatsApp reminders and notices: from Cronys Start up.")}
      </p>
    );
  }

  const start = new Date(lesson.start_at).getTime();
  const hoursAway = (start - Date.now()) / 3_600_000;
  // "Estou a caminho" só faz sentido perto da hora e em atendimento presencial.
  const nearNow = hoursAway <= 24 && hoursAway >= -2;
  const showOnMyWay = nearNow && !lesson.is_online;

  const locate = async () => {
    if (!plan.arrival_location) {
      toast.info(L("\"Estou a caminho\" com a localização é do Cronys Max.", "\"On my way\" with location is part of Cronys Max."));
      return;
    }
    setLocating(true);
    try { await sendOnMyWay({ ...lesson, id: lesson.id! }, phone, w, templates); } finally { setLocating(false); }
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <a href={whatsAppLink(phone, reminderMessage(lesson, w, templates))} target="_blank" rel="noopener noreferrer">
            <WhatsAppGlyph /> {L("Lembrar no WhatsApp", "Remind on WhatsApp")}
          </a>
        </Button>
        {showOnMyWay && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={locate} disabled={locating}>
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            {L("Estou a caminho", "On my way")}{!plan.arrival_location && " (Max)"}
          </Button>
        )}
      </div>
      {!phone && (
        <p className="text-xs text-muted-foreground">
          {L(`Sem WhatsApp no cadastro ${w.client.do} ${w.client.l}: o WhatsApp abre para você escolher o contato.`, `No WhatsApp number on the ${w.client.l}'s profile: WhatsApp opens so you can pick the contact.`)}
        </p>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Loader2, MapPin, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/hooks/usePlan";
import { useWords } from "@/hooks/useVocabulary";
import { currentPosition, onMyWayMessage, reminderMessage, whatsAppLink } from "@/lib/whatsapp";

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
  const [locating, setLocating] = useState(false);
  // O link do "Estou a caminho" fica pronto depois de pegar a localização. O
  // envio é um segundo toque de propósito: abrir o WhatsApp sozinho depois de
  // esperar o GPS é bloqueado pelo navegador (não veio de um toque).
  const [onMyWay, setOnMyWay] = useState<string | null>(null);
  useEffect(() => { setOnMyWay(null); }, [lesson.id]);

  if (loading || !lesson.id || lesson.status !== "agendada") return null;

  if (!plan.whatsapp_link) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        Lembrete e aviso pelo WhatsApp com um toque: no Cronys Pro e no Max.
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
      toast.info("\"Estou a caminho\" com a localização é do Cronys Max.");
      return;
    }
    setLocating(true);
    try {
      const pos = await currentPosition();
      setOnMyWay(whatsAppLink(phone, onMyWayMessage(lesson, w, pos)));
    } catch (e) {
      toast.error((e as Error).message);
      // Sem localização ainda dá para avisar que está a caminho.
      setOnMyWay(whatsAppLink(phone, onMyWayMessage(lesson, w, null)));
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <a href={whatsAppLink(phone, reminderMessage(lesson, w))} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" /> Lembrar no WhatsApp
          </a>
        </Button>
        {showOnMyWay && (onMyWay ? (
          <Button asChild size="sm" className="gap-1.5">
            <a href={onMyWay} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(() => setOnMyWay(null), 500)}>
              <MapPin className="h-4 w-4" /> Enviar "estou a caminho"
            </a>
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={locate} disabled={locating}>
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Estou a caminho{!plan.arrival_location && " (Max)"}
          </Button>
        ))}
      </div>
      {!phone && (
        <p className="text-xs text-muted-foreground">
          Sem WhatsApp no cadastro {w.client.do} {w.client.l}: o WhatsApp abre para você escolher o contato.
        </p>
      )}
    </div>
  );
}

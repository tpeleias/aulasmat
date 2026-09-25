import { useState } from "react";
import { Loader2, MapPin, Navigation } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/hooks/usePlan";
import { useWords } from "@/hooks/useVocabulary";
import { haptics } from "@/lib/haptics";
import type { Vocabulary } from "@/lib/vocabulary";
import type { MessageTemplates } from "@/lib/messageTemplates";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import {
  currentPosition, onMyWayMessage, openExternal, reminderMessage, wazeLink, whatsAppLink,
} from "@/lib/whatsapp";

import { L } from "@/lib/i18n";
export type QuickLesson = {
  id: string;
  student_name: string;
  guardian_name?: string | null;
  start_at: string;
  address?: string | null;
  is_online?: boolean;
};

/** Balão com telefone no verde do WhatsApp (desenho do ícone brand-whatsapp do Tabler, MIT). */
export function WhatsAppGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#25D366" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9l-5.05.9" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
    </svg>
  );
}

/**
 * "Estou a caminho": pega a posição uma vez e abre o WhatsApp com o link do
 * mapa. No navegador, se a aba for bloqueada por ter vindo depois da espera do
 * GPS, oferece o botão de enviar num aviso.
 */
export async function sendOnMyWay(lesson: QuickLesson, phone: string | null, w: Vocabulary, templates?: MessageTemplates | null) {
  let pos: { lat: number; lng: number } | null = null;
  try {
    pos = await currentPosition();
  } catch (e) {
    toast.error((e as Error).message);
  }
  const url = whatsAppLink(phone, onMyWayMessage(lesson, w, pos, templates));
  if (!openExternal(url)) {
    toast.success(L("Localização pronta", "Location ready"), {
      action: { label: L("Enviar no WhatsApp", "Send on WhatsApp"), onClick: () => { window.open(url, "_blank", "noopener"); } },
      duration: 15000,
    });
  }
}

/**
 * Atalhos de uma aula, em ícones: lembrete no WhatsApp (Pro e Max), "estou a
 * caminho" com a localização (Max, presencial, perto da hora) e a rota no Waze.
 */
export function LessonQuickActions({ lesson, phone }: { lesson: QuickLesson; phone: string | null }) {
  const { plan } = usePlan();
  const w = useWords();
  const { templates } = useMessageTemplates();
  const [locating, setLocating] = useState(false);
  const hoursAway = (new Date(lesson.start_at).getTime() - Date.now()) / 3_600_000;
  const presencial = !lesson.is_online && !!lesson.address;
  const canLocate = plan.arrival_location && !lesson.is_online && hoursAway <= 24 && hoursAway >= -2;

  const locate = async () => {
    haptics.tap();
    setLocating(true);
    try { await sendOnMyWay(lesson, phone, w, templates); } finally { setLocating(false); }
  };

  const btn = "h-9 w-9 shrink-0 rounded-full";
  return (
    <div className="flex shrink-0 items-center">
      {plan.whatsapp_link && (
        <Button asChild size="icon" variant="ghost" className={btn} title={L("Lembrar no WhatsApp", "Remind on WhatsApp")}>
          <a href={whatsAppLink(phone, reminderMessage(lesson, w, templates))} target="_blank" rel="noopener noreferrer" onClick={() => haptics.tap()}>
            <WhatsAppGlyph />
          </a>
        </Button>
      )}
      {canLocate && (
        <Button size="icon" variant="ghost" className={`${btn} text-primary`} onClick={locate} disabled={locating} title={L("Estou a caminho (manda sua localização)", "On my way (sends your location)")}>
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
        </Button>
      )}
      {presencial && (
        <Button size="icon" variant="ghost" className={`${btn} text-primary`} title={L("Abrir rota", "Open route")}
          onClick={() => { haptics.tap(); openExternal(wazeLink(lesson.address!)); }}>
          <Navigation className="h-4 w-4" fill="currentColor" />
        </Button>
      )}
    </div>
  );
}

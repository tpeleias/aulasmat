import { format } from "date-fns";
import { Navigation, Pencil, Video } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useWords } from "@/hooks/useVocabulary";
import { haptics } from "@/lib/haptics";
import { dateLocale, L, timeFmt } from "@/lib/i18n";
import { lessonMeetingUrl, meetingProvider } from "@/lib/meeting";
import { navAppName, openRoute, type NavApp } from "@/lib/navigation";
import { openExternal } from "@/lib/whatsapp";

export type GoLesson = { id: string; student_name: string; start_at: string; address?: string | null; is_online?: boolean | null; meeting_url?: string | null };

/**
 * Tocar numa aula da lista (05/10): em vez de abrir o Waze sem dizer nada,
 * pergunta o que fazer. A presencial oferece a rota; a on-line, entrar na
 * reunião; as duas, abrir a aula. O toque longo continua abrindo a aula direto.
 */
export function LessonGoSheet({ lesson, navApp, onClose, onEdit }: {
  lesson: GoLesson | null; navApp: NavApp; onClose: () => void; onEdit: (l: GoLesson) => void;
}) {
  const w = useWords();
  const ap = w.appointment;
  const link = lesson ? lessonMeetingUrl(lesson) : null;
  const provider = meetingProvider(link);
  const route = lesson && !lesson.is_online && lesson.address ? lesson.address : null;
  const go = (fn: () => void) => { haptics.tap(); onClose(); fn(); };
  return (
    <Drawer open={!!lesson} onOpenChange={o => { if (!o) onClose(); }}>
      <DrawerContent>
        {lesson && <>
          <DrawerHeader className="pb-2 text-left">
            <DrawerTitle>{lesson.student_name}</DrawerTitle>
            <DrawerDescription>
              {format(new Date(lesson.start_at), L("EEEE, dd/MM 'às' ", "EEEE, MMM d 'at' "), { locale: dateLocale() })}{format(new Date(lesson.start_at), timeFmt())}
              {lesson.is_online ? L(" · on-line", " · online") : route ? ` · ${route}` : ""}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter className="gap-2 pt-0">
            {link && (
              <Button className="h-12 justify-start gap-3 rounded-xl" onClick={() => go(() => openExternal(link))}>
                <Video className="h-5 w-5" />
                {provider ? L(`Entrar na reunião (${provider})`, `Join the meeting (${provider})`) : L("Entrar na reunião", "Join the meeting")}
              </Button>
            )}
            {route && (
              <Button className="h-12 justify-start gap-3 rounded-xl" onClick={() => go(() => openRoute(route, navApp))}>
                <Navigation className="h-5 w-5" /> {L(`Abrir rota no ${navAppName(navApp)}`, `Open route in ${navAppName(navApp)}`)}
              </Button>
            )}
            {lesson.is_online && !link && (
              <p className="text-xs text-muted-foreground">
                {L(`${ap.s} on-line sem link de reunião. Abra ${ap.o} ${ap.l} para colar um, ou escolha o link automático em Configurações → Integrações.`,
                   `Online ${ap.l} with no meeting link. Open the ${ap.l} to paste one, or pick an automatic link in Settings → Integrations.`)}
              </p>
            )}
            <Button variant={link || route ? "outline" : "default"} className="h-12 justify-start gap-3 rounded-xl" onClick={() => go(() => onEdit(lesson))}>
              <Pencil className="h-5 w-5" /> {L(`Abrir ${ap.o} ${ap.l}`, `Open the ${ap.l}`)}
            </Button>
            <Button variant="ghost" className="h-11 rounded-xl" onClick={onClose}>{L("Cancelar", "Cancel")}</Button>
          </DrawerFooter>
        </>}
      </DrawerContent>
    </Drawer>
  );
}

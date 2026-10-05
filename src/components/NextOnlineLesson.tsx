import { format } from "date-fns";
import { Video } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MeetingJoinButton } from "@/components/MeetingJoinButton";
import { useWords } from "@/hooks/useVocabulary";
import { dateLocale, L, timeFmt } from "@/lib/i18n";
import { safeMeetingUrl } from "@/lib/meeting";

type L1 = { id: string; start_at: string; duration_minutes?: number | null; status?: string | null; teacher?: string; is_online?: boolean | null; meeting_url?: string | null };

/**
 * O atendimento on-line de hoje ou amanhã, com o botão de entrar (05/10).
 * Aparece das 24h antes até o fim do horário.
 */
export function NextOnlineLesson({ lessons, teacherName }: { lessons: L1[]; teacherName: (slug: string) => string }) {
  const w = useWords();
  const ap = w.appointment;
  const now = Date.now();
  const next = lessons
    .filter(l => (l.status === "agendada" || !l.status) && safeMeetingUrl(l.meeting_url) && l.is_online !== false)
    .filter(l => {
      const start = new Date(l.start_at).getTime();
      const end = start + (l.duration_minutes ?? 60) * 60_000;
      return end > now && start - now <= 24 * 3_600_000;
    })
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0];
  if (!next) return null;
  const start = new Date(next.start_at);
  const today = start.toDateString() === new Date().toDateString();
  const started = start.getTime() <= now;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center gap-3">
        <Video className="h-5 w-5 shrink-0 text-primary" />
        <div>
          <div className="text-sm font-semibold">
            {started
              ? L(`${ap.s} on-line acontecendo agora`, `Online ${ap.l} happening now`)
              : L(`${ap.s} on-line ${today ? "hoje" : "amanhã"} às ${format(start, timeFmt(), { locale: dateLocale() })}`,
                  `Online ${ap.l} ${today ? "today" : "tomorrow"} at ${format(start, timeFmt(), { locale: dateLocale() })}`)}
          </div>
          {next.teacher && <div className="text-xs text-muted-foreground">{L("com", "with")} {teacherName(next.teacher)}</div>}
        </div>
      </div>
      <MeetingJoinButton url={next.meeting_url} />
    </Card>
  );
}

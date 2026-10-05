import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { haptics } from "@/lib/haptics";
import { L } from "@/lib/i18n";
import { meetingProvider, safeMeetingUrl } from "@/lib/meeting";
import { openExternal } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

/** "Entrar" na reunião da aula on-line. Sem link válido, não aparece. */
export function MeetingJoinButton({ url, compact, className }: { url?: string | null; compact?: boolean; className?: string }) {
  const href = safeMeetingUrl(url);
  if (!href) return null;
  const provider = meetingProvider(href);
  const title = provider ? L(`Entrar pelo ${provider}`, `Join on ${provider}`) : L("Entrar na reunião", "Join the meeting");
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    haptics.tap();
    if (!openExternal(href)) window.location.href = href;
  };
  if (compact) {
    return (
      <Button asChild size="icon" variant="ghost" className={cn("h-9 w-9 shrink-0 rounded-full text-primary", className)} title={title}>
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={open} aria-label={title}><Video className="h-4 w-4" /></a>
      </Button>
    );
  }
  return (
    <Button asChild size="sm" className={cn("gap-1.5 rounded-xl", className)}>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={open}><Video className="h-4 w-4" /> {title}</a>
    </Button>
  );
}

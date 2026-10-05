/**
 * Link de reunião das aulas on-line (migration 20261005010000). Cada
 * profissional escolhe: nada, sala fixa, Jitsi (uma sala por aula) ou Google
 * Meet (pelo Google Agenda, no Pro e Max). O banco preenche lessons.meeting_url.
 */
export type MeetingMode = "none" | "fixed" | "jitsi" | "google_meet";

/** Só http(s) sem espaço vira link clicável (o banco já recusa o resto). */
export function safeMeetingUrl(url?: string | null): string | null {
  const u = (url ?? "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

/** O nome do serviço, para o botão dizer onde a pessoa vai entrar. */
export function meetingProvider(url?: string | null): string | null {
  const u = safeMeetingUrl(url);
  if (!u) return null;
  const host = (() => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } })();
  if (host === "meet.google.com") return "Google Meet";
  if (host.endsWith("zoom.us")) return "Zoom";
  if (host === "meet.jit.si" || host.endsWith(".jitsi.net")) return "Jitsi";
  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) return "Teams";
  if (host.endsWith("whereby.com")) return "Whereby";
  return null;
}

/** A aula tem link para entrar agora. */
export const lessonMeetingUrl = (l: { is_online?: boolean | null; meeting_url?: string | null }) =>
  l.is_online ? safeMeetingUrl(l.meeting_url) : null;

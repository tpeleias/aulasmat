import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { lessonMeetingUrl, meetingProvider, safeMeetingUrl } from "@/lib/meeting";
import { reminderMessage } from "@/lib/whatsapp";
import { buildVocabulary } from "@/lib/vocabulary";
import { MeetingJoinButton } from "@/components/MeetingJoinButton";

vi.mock("@/lib/haptics", () => ({ haptics: { tap: () => {} } }));

const w = buildVocabulary("aulas");

describe("Link de reunião (05/10)", () => {
  it("só http(s) sem espaço vira link", () => {
    expect(safeMeetingUrl("https://meet.jit.si/Cronys-abc")).toBe("https://meet.jit.si/Cronys-abc");
    expect(safeMeetingUrl("javascript:alert(1)")).toBeNull();
    expect(safeMeetingUrl("https://x.com/a b")).toBeNull();
    expect(safeMeetingUrl('https://x.com/"><script>')).toBeNull();
    expect(safeMeetingUrl(null)).toBeNull();
  });

  it("reconhece o serviço pelo endereço", () => {
    expect(meetingProvider("https://meet.google.com/abc-defg-hij")).toBe("Google Meet");
    expect(meetingProvider("https://us02web.zoom.us/j/123")).toBe("Zoom");
    expect(meetingProvider("https://meet.jit.si/Cronys-1")).toBe("Jitsi");
    expect(meetingProvider("https://exemplo.com/sala")).toBeNull();
  });

  it("aula presencial não tem link, mesmo que sobre um no registro", () => {
    expect(lessonMeetingUrl({ is_online: false, meeting_url: "https://meet.jit.si/x" })).toBeNull();
    expect(lessonMeetingUrl({ is_online: true, meeting_url: "https://meet.jit.si/x" })).toBe("https://meet.jit.si/x");
  });

  it("o lembrete do WhatsApp leva o link da aula on-line", () => {
    const aula = { student_name: "Lucas", guardian_name: "Carla", start_at: "2026-10-06T18:00:00Z", is_online: true, meeting_url: "https://meet.jit.si/Cronys-abc" };
    expect(reminderMessage(aula, w)).toContain("link: https://meet.jit.si/Cronys-abc");
    expect(reminderMessage({ ...aula, meeting_url: null }, w)).not.toContain("link:");
    expect(reminderMessage(aula, w, { lembrete: "Entre por {link}" })).toBe("Entre por https://meet.jit.si/Cronys-abc");
  });

  it("botão Entrar diz o serviço e some sem link", () => {
    const { rerender } = render(<MeetingJoinButton url="https://meet.google.com/abc-defg-hij" />);
    expect(screen.getByRole("link", { name: /Entrar pelo Google Meet/ })).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    rerender(<MeetingJoinButton url="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

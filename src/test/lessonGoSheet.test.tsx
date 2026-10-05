import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LessonGoSheet } from "@/components/LessonGoSheet";

vi.mock("@/lib/haptics", () => ({ haptics: { tap: () => {} } }));
vi.mock("@/hooks/useVocabulary", async () => {
  const { buildVocabulary } = await import("@/lib/vocabulary");
  return { useWords: () => buildVocabulary("aulas") };
});

const base = { id: "1", student_name: "Bia", start_at: "2026-10-06T18:00:00Z" };

describe("Tocar na aula da lista (05/10)", () => {
  it("on-line com link: oferece entrar na reunião, com o nome do serviço", () => {
    render(<LessonGoSheet lesson={{ ...base, is_online: true, meeting_url: "https://meet.google.com/abc-defg-hij" }} navApp="waze" onClose={() => {}} onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: /Entrar na reunião \(Google Meet\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rota/ })).toBeNull();
  });

  it("presencial: oferece a rota no app escolhido, e não a reunião", () => {
    render(<LessonGoSheet lesson={{ ...base, address: "Rua A, 10" }} navApp="waze" onClose={() => {}} onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: /Abrir rota no Waze/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reunião/ })).toBeNull();
  });

  it("on-line sem link: explica e deixa abrir a aula", () => {
    render(<LessonGoSheet lesson={{ ...base, is_online: true }} navApp="waze" onClose={() => {}} onEdit={() => {}} />);
    expect(screen.getByText(/sem link de reunião/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir a aula/ })).toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { normalizeWhatsApp, whatsAppLink, reminderMessage, onMyWayMessage } from "@/lib/whatsapp";
import { buildVocabulary } from "@/lib/vocabulary";

const w = buildVocabulary("aulas");

describe("normalizeWhatsApp", () => {
  it("aceita o que a pessoa digita e acrescenta o 55", () => {
    expect(normalizeWhatsApp("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizeWhatsApp("11 3456-7890")).toBe("551134567890");
    expect(normalizeWhatsApp("+55 11 98765 4321")).toBe("5511987654321");
    expect(normalizeWhatsApp("011 98765-4321")).toBe("5511987654321");
  });
  it("vazio é nulo; curto demais é inválido", () => {
    expect(normalizeWhatsApp("  ")).toBeNull();
    expect(normalizeWhatsApp(null)).toBeNull();
    expect(normalizeWhatsApp("9876-543")).toBe("invalido");
  });
});

describe("mensagens", () => {
  const aula = { student_name: "bia souza", guardian_name: "ana", start_at: new Date(2026, 9, 1, 15, 0), address: "Rua A, 10" };

  it("lembrete fala com o responsável, do aluno, com dia, hora e endereço", () => {
    const m = reminderMessage(aula, w);
    expect(m).toContain("Olá, Ana!");
    expect(m).toContain("a aula de Bia");
    expect(m).toContain("01/10 às 15:00");
    expect(m).toContain("em Rua A, 10");
  });

  it("sem responsável, fala com o próprio cliente", () => {
    const m = reminderMessage({ ...aula, guardian_name: null }, w);
    expect(m).toContain("Olá, Bia!");
    expect(m).not.toContain("de Bia");
  });

  it("estou a caminho leva o link do mapa", () => {
    const m = onMyWayMessage(aula, w, { lat: -23.55052, lng: -46.633308 });
    expect(m).toContain("Estou a caminho para a aula de Bia");
    expect(m).toContain("https://maps.google.com/?q=-23.55052,-46.63331");
  });

  it("link com e sem número", () => {
    expect(whatsAppLink("5511987654321", "oi a")).toBe("https://wa.me/5511987654321?text=oi%20a");
    expect(whatsAppLink(null, "oi")).toBe("https://wa.me/?text=oi");
  });
});

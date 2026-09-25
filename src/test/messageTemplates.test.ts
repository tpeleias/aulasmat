import { describe, expect, it } from "vitest";
import { buildVocabulary } from "@/lib/vocabulary";
import { confirmMessage, onMyWayMessage, reminderMessage } from "@/lib/whatsapp";
import { buildCollectionMessage } from "@/lib/collectionMessage";
import { fillTemplate } from "@/lib/messageTemplates";

const w = buildVocabulary("aulas");
const aula = { student_name: "Lucas Almeida", guardian_name: "Carla Almeida", start_at: new Date(2026, 9, 1, 15, 0), address: "Rua A, 10" };

describe("modelos de mensagem", () => {
  it("sem modelo, usa o padrão com as palavras do ramo", () => {
    expect(confirmMessage(aula, w)).toBe("Olá, Carla! A aula de Lucas está marcada para quinta-feira, 01/10 às 15:00 em Rua A, 10. Até lá!");
    const clinica = buildVocabulary("saude");
    expect(confirmMessage(aula, clinica)).toContain("A consulta de Lucas está marcada");
  });

  it("com modelo da empresa, usa o texto dela", () => {
    const t = { lembrete: "Oi {nome}, amanhã tem {aluno} às {hora}! 📚" };
    expect(reminderMessage(aula, w, t)).toBe("Oi Carla, amanhã tem Lucas às 15:00! 📚");
  });

  it("modelo em branco volta para o padrão", () => {
    expect(reminderMessage(aula, w, { lembrete: "   " })).toContain("Passando para lembrar a aula de Lucas");
  });

  it("estou a caminho: {localizacao} some sem GPS, {mapa} traz o link", () => {
    expect(onMyWayMessage(aula, w, null)).toBe("Olá, Carla! Estou a caminho para a aula de Lucas.");
    const t = { a_caminho: "Chegando! {mapa}" };
    expect(onMyWayMessage(aula, w, { lat: -23.5, lng: -46.6 }, t)).toBe("Chegando! https://maps.google.com/?q=-23.50000,-46.60000");
  });

  it("cobrança com modelo: lista e total continuam calculados pelo app", () => {
    const items = [{ id: "1", date: "2026-05-15T19:30:00Z", amount: 200, student: "Luana", detail: "Matemática (60 min)", partial: false }];
    const msg = buildCollectionMessage(items, { pixKey: null, paymentLink: null }, w, { cobranca: "Olá! Deve {total}.\n\n{lista}" })
      .replace(/ /g, " ");
    expect(msg.startsWith("Olá! Deve R$ 200,00.")).toBe(true);
    expect(msg).toContain("Matemática · 60 min");
  });

  it("campo desconhecido fica visível, para a pessoa perceber o erro", () => {
    expect(fillTemplate("Oi {nomee}", { nome: "Ana" })).toBe("Oi {nomee}");
  });
});

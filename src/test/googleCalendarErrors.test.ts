import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { dbErrorMessage } from "@/lib/dbErrors";
import { googleFunctionError, googleStoredError } from "@/lib/googleCalendarErrors";

// As recusas do Google Agenda saem na língua da empresa (26/09): o banco manda
// a chave, a função manda o código, e a tela escreve a frase.

describe("erros do Google Agenda", () => {
  afterEach(() => { setLocale("pt-BR", "BRL"); });

  it("recusa do banco com chave", () => {
    const e = { message: "Desconecte o Google do seu cadastro atual antes de trocar.", hint: "google_trocar_desconecte" };
    setLocale("pt-BR", "BRL");
    expect(dbErrorMessage(e)).toMatch(/^Desconecte o Google/);
    setLocale("en", "USD");
    expect(dbErrorMessage(e)).toBe("Disconnect Google from your current profile before switching.");
    expect(dbErrorMessage({ message: "x", hint: "plano:google_calendar" })).toBe("Google Calendar isn't available on your plan.");
    expect(dbErrorMessage({ message: "x", hint: "plano:google_calendar_import" })).toBe("Importing Google busy times is part of Start, Pro and Max.");
  });

  it("código da função, também vindo em erro HTTP", async () => {
    setLocale("en", "USD");
    expect(await googleFunctionError({ code: "not_enabled" }, null)).toMatch(/hasn't turned on/);
    const httpError = { context: { json: async () => ({ code: "plan" }) } };
    expect(await googleFunctionError(null, httpError)).toMatch(/isn't available on your plan/);
    setLocale("pt-BR", "BRL");
    expect(await googleFunctionError(null, httpError)).toMatch(/não está disponível no seu plano/);
  });

  it("erro guardado na conexão: chave nova, texto antigo e texto do Google", () => {
    setLocale("en", "USD");
    expect(googleStoredError("google:revoked")).toMatch(/Please reconnect/);
    expect(googleStoredError("O acesso ao Google foi retirado. Conecte de novo.")).toMatch(/Please reconnect/);
    expect(googleStoredError("Rate Limit Exceeded")).toBe("Rate Limit Exceeded");
    expect(googleStoredError(null)).toBeNull();
  });
});

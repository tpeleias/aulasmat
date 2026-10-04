import { describe, expect, it } from "vitest";
import { scrub, scrubEvent } from "@/lib/monitoring";

describe("Sentry: nada de dado pessoal", () => {
  it("tira e-mail, CPF, CNPJ, telefone e tokens", () => {
    expect(scrub("falhou para ana.souza@gmail.com")).toBe("falhou para [removido]");
    expect(scrub("cpf 123.456.789-09")).toBe("cpf [removido]");
    expect(scrub("cnpj 12.345.678/0001-90")).toBe("cnpj [removido]");
    expect(scrub("ligar (11) 99876-5432")).toBe("ligar [removido]");
    expect(scrub("https://cronys.com.br/#access_token=abc.def&type=recovery")).toBe("https://cronys.com.br/#access_token=[removido]&type=recovery");
    expect(scrub("Bearer eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl")).toBe("Bearer [removido]");
  });

  it("mantém mensagens comuns e os ids do Sentry", () => {
    expect(scrub("Cannot read properties of undefined (reading 'id')")).toBe("Cannot read properties of undefined (reading 'id')");
    const ev = scrubEvent({
      type: undefined,
      event_id: "12345678901234567890123456789012",
      message: "erro com joao@x.com",
      user: { id: "u-1", email: "joao@x.com", ip_address: "1.2.3.4" },
      request: { url: "https://cronys.com.br/agenda", cookies: { a: "b" }, headers: { Authorization: "x" }, data: "{}" },
    });
    expect(ev.event_id).toBe("12345678901234567890123456789012");
    expect(ev.message).toBe("erro com [removido]");
    expect(ev.user).toEqual({ id: "u-1" });
    expect(ev.request?.cookies).toBeUndefined();
    expect(ev.request?.data).toBeUndefined();
    expect(ev.request?.headers).toEqual({});
  });
});

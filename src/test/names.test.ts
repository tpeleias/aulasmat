import { describe, expect, it } from "vitest";
import { sameClient, similarName } from "@/lib/names";

describe("Nomes parecidos no cadastro (10/10)", () => {
  const guardians = ["Thaciana", "Maria José", "Ana"];
  it("acha o responsável parecido", () => {
    expect(similarName("Taciana", guardians)).toBe("Thaciana");
    expect(similarName("thaciana ", guardians)).toBeNull(); // igual (o Financeiro já junta)
    expect(similarName("Maria Jose", guardians)).toBe("Maria José");
    expect(similarName("Ana", guardians)).toBeNull();
    expect(similarName("Bia", guardians)).toBeNull();
    expect(similarName("Roberto", guardians)).toBeNull();
  });
  it("acha o cadastro repetido", () => {
    const list = [{ id: "1", student_name: "Pedro", guardian_name: null }, { id: "2", student_name: "Lia", guardian_name: "Tati" }];
    expect(sameClient("pedro ", "", list)?.id).toBe("1");
    expect(sameClient("Pedro", "", list, "1")).toBeNull();
    expect(sameClient("Lia", "Rosa", list)).toBeNull();
    expect(sameClient("Lia", "tati", list)?.id).toBe("2");
  });
});

import { describe, expect, it } from "vitest";
import { firstSteps } from "@/lib/firstSteps";
import { buildVocabulary } from "@/lib/vocabulary";

const vazio = { hasPayment: false, students: 0, lessons: 0, portalLogins: 0 };

describe("firstSteps", () => {
  it("empresa nova: nada feito, na ordem pagamento → cliente → atendimento → portal", () => {
    const s = firstSteps(vazio, buildVocabulary("aulas"));
    expect(s.map(x => x.key)).toEqual(["pagamento", "cliente", "atendimento", "portal"]);
    expect(s.every(x => !x.done)).toBe(true);
  });

  it("cada passo se marca pelo que existe no banco", () => {
    const s = firstSteps({ hasPayment: true, students: 3, lessons: 0, portalLogins: 1 }, buildVocabulary("aulas"));
    expect(s.filter(x => x.done).map(x => x.key)).toEqual(["pagamento", "cliente", "portal"]);
  });

  it("fala a língua do ramo, com o gênero certo", () => {
    const aulas = firstSteps(vazio, buildVocabulary("aulas"));
    expect(aulas[1].title).toBe("Cadastre o primeiro aluno");
    expect(aulas[2].title).toBe("Marque a primeira aula");
    const saude = firstSteps(vazio, buildVocabulary("saude"));
    expect(saude[2].title).toBe("Marque a primeira consulta");
  });
});

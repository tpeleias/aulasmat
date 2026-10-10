import { describe, expect, it } from "vitest";
import { firstSteps } from "@/lib/firstSteps";
import { buildVocabulary } from "@/lib/vocabulary";

const vazio = { hasPayment: false, students: 0, lessons: 0, doneLessons: 0, portalLogins: 0 };

describe("firstSteps", () => {
  it("empresa nova: nada feito, na ordem cliente → atendimento → cobrança → pagamento → portal", () => {
    const s = firstSteps(vazio, buildVocabulary("aulas"));
    expect(s.map(x => x.key)).toEqual(["cliente", "atendimento", "cobranca", "pagamento", "portal"]);
    expect(s[0].to).toBe("/admin/alunos?novo=1");
    expect(s[1].to).toBe("/admin/agenda?new=1");
    expect(s.every(x => !x.done)).toBe(true);
  });

  it("cada passo se marca pelo que existe no banco", () => {
    const s = firstSteps({ hasPayment: true, students: 3, lessons: 0, doneLessons: 0, portalLogins: 1 }, buildVocabulary("aulas"));
    expect(s.filter(x => x.done).map(x => x.key)).toEqual(["cliente", "pagamento", "portal"]);
    const feito = firstSteps({ ...vazio, students: 1, lessons: 1, doneLessons: 1 }, buildVocabulary("aulas"));
    expect(feito.find(x => x.key === "cobranca")).toMatchObject({ done: true, to: "/admin/financeiro" });
  });

  it("fala a língua do ramo, com o gênero certo", () => {
    const aulas = firstSteps(vazio, buildVocabulary("aulas"));
    expect(aulas[0].title).toBe("Cadastre o primeiro aluno");
    expect(aulas[1].title).toBe("Marque a primeira aula");
    expect(aulas[2].title).toBe("Marque a aula como realizada e veja a cobrança");
    const saude = firstSteps(vazio, buildVocabulary("saude"));
    expect(saude[1].title).toBe("Marque a primeira consulta");
  });
});

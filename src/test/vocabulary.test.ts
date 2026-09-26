import { describe, expect, it } from "vitest";
import { BUSINESS_MODELS, PRESETS, TERM_KEYS, buildVocabulary, cap, DEFAULT_VOCABULARY } from "@/lib/vocabulary";
import { statusLabel } from "@/lib/lessonStatus";
import { dbErrorMessage } from "@/lib/dbErrors";
import { lessonErrorMessage } from "@/lib/lessonErrors";
import { buildCollectionMessage } from "@/lib/collectionMessage";
import { accountLabel } from "@/lib/balance";

describe("vocabulário por ramo", () => {
  it("os 7 ramos pedidos têm as palavras combinadas", () => {
    const esperado: Record<string, [string, string]> = {
      saude: ["Médico", "Consulta"],
      psicologia: ["Terapeuta", "Sessão"],
      beleza: ["Profissional", "Atendimento"],
      pet: ["Veterinário", "Consulta Pet"],
      esportes: ["Treinador", "Treino"],
      oficina: ["Mecânico", "Revisão"],
      aulas: ["Professor", "Aula"],
    };
    for (const [m, [staff, service]] of Object.entries(esperado)) {
      const v = buildVocabulary(m as never);
      expect(v.staff.s).toBe(staff);
      expect(v.appointment.s).toBe(service);
    }
  });

  it("todo ramo tem todas as palavras, com plural e gênero", () => {
    for (const m of BUSINESS_MODELS) {
      for (const k of TERM_KEYS) {
        const t = PRESETS[m].terms[k];
        expect(t.s.trim(), `${m}.${k}`).not.toBe("");
        expect(t.p.trim(), `${m}.${k}`).not.toBe("");
        expect(["m", "f"]).toContain(t.g);
      }
    }
  });

  it("plural irregular não vira 's' no fim", () => {
    expect(buildVocabulary("oficina").appointment.p).toBe("Revisões");
    expect(buildVocabulary("beleza").staff.p).toBe("Profissionais");
    expect(buildVocabulary("esportes").staff.p).toBe("Treinadores");
    expect(buildVocabulary("psicologia").appointment.p).toBe("Sessões");
    expect(buildVocabulary("pet").appointment.p).toBe("Consultas Pet");
  });

  it("concorda em gênero", () => {
    const aula = buildVocabulary("aulas").appointment;
    const atendimento = buildVocabulary("beleza").appointment;
    expect(`${aula.novo} ${aula.l}`).toBe("Nova aula");
    expect(`${atendimento.novo} ${atendimento.l}`).toBe("Novo atendimento");
    expect(`${cap(aula.um)} ${aula.l}`).toBe("Uma aula");
    expect(`${atendimento.nenhum} ${atendimento.l}`).toBe("Nenhum atendimento");
  });

  it("minúscula no meio da frase, inclusive com duas palavras", () => {
    expect(buildVocabulary("pet").appointment.l).toBe("consulta pet");
    expect(buildVocabulary("pet").appointment.lp).toBe("consultas pet");
  });

  it("sem ramo escolhido, usa as palavras genéricas", () => {
    const v = buildVocabulary(null);
    expect(v.staff.s).toBe("Profissional");
    expect(v.client.s).toBe("Cliente");
    expect(v.model).toBeNull();
  });

  it("palavras editadas valem por cima do ramo, só as válidas", () => {
    const v = buildVocabulary("saude", {
      staff: { s: "Dentista", p: "Dentistas", g: "m" },
      client: { s: "", p: "x", g: "m" },       // incompleta: ignorada
      appointment: { s: "X", p: "Xs", g: "z" }, // gênero inválido: ignorada
    });
    expect(v.staff.s).toBe("Dentista");
    expect(v.client.s).toBe("Paciente");
    expect(v.appointment.s).toBe("Consulta");
  });
});

describe("textos que usam o vocabulário", () => {
  it("o status concorda com a palavra da empresa", () => {
    expect(statusLabel("realizada")).toBe("realizada");
    expect(statusLabel("realizada", buildVocabulary("beleza"))).toBe("realizado");
    expect(statusLabel("cancelada", buildVocabulary("esportes"))).toBe("cancelado");
    expect(statusLabel("solicitada", buildVocabulary("beleza"))).toBe("aguardando aprovação");
    expect(statusLabel(null)).toBe("agendada");
  });

  it("a recusa do banco vira frase com as palavras da empresa", () => {
    const err = { message: "texto neutro", hint: "limite_profissionais_cadastrar:1" };
    expect(dbErrorMessage(err, buildVocabulary("saude"))).toBe(
      "O seu plano permite 1 médico ativo. Com o Cronys Pro por R$\u00a049,90/mês você tem mais.");
    expect(dbErrorMessage({ message: "x", hint: "limite_clientes_ativos:10" }, buildVocabulary("saude")))
      .toContain("10 pacientes ativos");
    expect(dbErrorMessage({ message: "x", hint: "limite_clientes_ativos:10" }, buildVocabulary("saude")))
      .toContain("Cronys Start por R$\u00a029,90/mês");
    expect(dbErrorMessage({ message: "x", hint: "limite_clientes_cadastrar:5" }, buildVocabulary("pet")))
      .toContain("5 pets liberados");
    expect(lessonErrorMessage({ message: "x", hint: "cliente_pausado" }, buildVocabulary("saude")))
      .toBe("Não é possível marcar consulta para este paciente agora: o cadastro está pausado.");
  });

  it("chave desconhecida ou ausente mantém a mensagem do banco", () => {
    expect(dbErrorMessage({ message: "outra coisa", hint: "nao_sei" })).toBe("outra coisa");
    expect(dbErrorMessage({ message: "sem hint" })).toBe("sem hint");
  });

  it("conflito de horário fala do profissional da empresa", () => {
    expect(lessonErrorMessage({ code: "23P01" }, buildVocabulary("oficina")))
      .toBe("Esse horário já está ocupado para este mecânico.");
  });

  it("a cobrança do WhatsApp usa a palavra da empresa", () => {
    const msg = buildCollectionMessage(
      [{ id: "1", date: "2026-09-10T13:00:00Z", student: "Rex", detail: "Banho (60 min)", amount: 80, partial: false }],
      { pixKey: null, paymentLink: null },
      buildVocabulary("pet"),
    );
    expect(msg).toContain("fechar as consultas pet de *Rex*");
    expect(msg).not.toMatch(/aula/i);
  });

  it("conta sem responsável se identifica pela palavra do cliente", () => {
    expect(accountLabel({ guardian_name: null, student_name: "Ana" })).toBe("Aluno: Ana");
    expect(accountLabel({ guardian_name: null, student_name: "Ana" }, buildVocabulary("saude"))).toBe("Paciente: Ana");
  });

  it("o padrão das funções puras continua sendo o de aulas", () => {
    expect(DEFAULT_VOCABULARY.appointment.s).toBe("Aula");
  });
});

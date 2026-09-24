// As palavras da tela, por ramo de negócio.
//
// O app faz a mesma coisa para uma escola, uma clínica ou uma oficina: agenda,
// cadastro de quem é atendido, cobrança, portal. O que muda são as palavras.
// A empresa escolhe o ramo (accounts.business_model) e, no Pro, pode editar
// cada palavra (accounts.vocabulary) - ver a migration 20260924060000.
//
// Os nomes internos continuam os de sempre (lessons, teachers, students):
// aqui "appointment" é a aula/consulta, "staff" o professor/médico, "client" o
// aluno/paciente e "guardian" o responsável por ele (quem entra no portal e
// paga - numa veterinária, o tutor do pet).
//
// Português tem plural irregular (Revisão → Revisões) e gênero ("Nova aula",
// "Novo atendimento"), então cada palavra guarda os três.

export type Gender = "m" | "f";
export type TermSpec = { s: string; p: string; g: Gender };

export const TERM_KEYS = ["business", "staff", "appointment", "client", "guardian", "topic"] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export type VocabularySpec = Record<TermKey, TermSpec>;

export const BUSINESS_MODELS = ["aulas", "saude", "psicologia", "beleza", "pet", "esportes", "oficina", "outro"] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

/** Para que serve cada termo - é o que a tela de configurações mostra. */
export const TERM_LABELS: Record<TermKey, string> = {
  business: "O seu negócio",
  staff: "Quem atende",
  appointment: "O horário marcado",
  client: "Quem é atendido",
  guardian: "Quem responde e paga",
  topic: "O assunto do atendimento",
};

const t = (s: string, p: string, g: Gender): TermSpec => ({ s, p, g });
const responsavel = t("Responsável", "Responsáveis", "m");

export const PRESETS: Record<BusinessModel, { nome: string; exemplo: string; terms: VocabularySpec }> = {
  aulas: {
    nome: "Aulas e tutoria",
    exemplo: "Aulas particulares, reforço, idiomas, música",
    terms: {
      business: t("Escola", "Escolas", "f"),
      staff: t("Professor", "Professores", "m"),
      appointment: t("Aula", "Aulas", "f"),
      client: t("Aluno", "Alunos", "m"),
      guardian: responsavel,
      topic: t("Matéria", "Matérias", "f"),
    },
  },
  saude: {
    nome: "Saúde e clínica médica",
    exemplo: "Consultórios, clínicas, fisioterapia, nutrição",
    terms: {
      business: t("Clínica", "Clínicas", "f"),
      staff: t("Médico", "Médicos", "m"),
      appointment: t("Consulta", "Consultas", "f"),
      client: t("Paciente", "Pacientes", "m"),
      guardian: responsavel,
      topic: t("Especialidade", "Especialidades", "f"),
    },
  },
  psicologia: {
    nome: "Psicologia e terapia",
    exemplo: "Psicólogos, terapeutas, fonoaudiologia",
    terms: {
      business: t("Consultório", "Consultórios", "m"),
      staff: t("Terapeuta", "Terapeutas", "m"),
      appointment: t("Sessão", "Sessões", "f"),
      client: t("Paciente", "Pacientes", "m"),
      guardian: responsavel,
      topic: t("Abordagem", "Abordagens", "f"),
    },
  },
  beleza: {
    nome: "Salão de beleza e estética",
    exemplo: "Cabeleireiros, manicures, barbearias, estética",
    terms: {
      business: t("Salão", "Salões", "m"),
      staff: t("Profissional", "Profissionais", "m"),
      appointment: t("Atendimento", "Atendimentos", "m"),
      client: t("Cliente", "Clientes", "m"),
      guardian: responsavel,
      topic: t("Serviço", "Serviços", "m"),
    },
  },
  pet: {
    nome: "Mundo pet e veterinária",
    exemplo: "Veterinários, banho e tosa, adestramento",
    terms: {
      business: t("Clínica veterinária", "Clínicas veterinárias", "f"),
      staff: t("Veterinário", "Veterinários", "m"),
      appointment: t("Consulta Pet", "Consultas Pet", "f"),
      // Quem é atendido é o pet; quem entra no portal e paga é o tutor.
      client: t("Pet", "Pets", "m"),
      guardian: t("Tutor", "Tutores", "m"),
      topic: t("Serviço", "Serviços", "m"),
    },
  },
  esportes: {
    nome: "Esportes e academias",
    exemplo: "Personal trainers, academias, escolinhas de esporte",
    terms: {
      business: t("Academia", "Academias", "f"),
      staff: t("Treinador", "Treinadores", "m"),
      appointment: t("Treino", "Treinos", "m"),
      client: t("Aluno", "Alunos", "m"),
      guardian: responsavel,
      topic: t("Modalidade", "Modalidades", "f"),
    },
  },
  oficina: {
    nome: "Oficinas e manutenção",
    exemplo: "Oficinas mecânicas, assistência técnica, reparos",
    terms: {
      business: t("Oficina", "Oficinas", "f"),
      staff: t("Mecânico", "Mecânicos", "m"),
      appointment: t("Revisão", "Revisões", "f"),
      client: t("Cliente", "Clientes", "m"),
      guardian: responsavel,
      topic: t("Serviço", "Serviços", "m"),
    },
  },
  outro: {
    nome: "Outro tipo de negócio",
    exemplo: "Qualquer serviço com hora marcada",
    terms: {
      business: t("Empresa", "Empresas", "f"),
      staff: t("Profissional", "Profissionais", "m"),
      appointment: t("Atendimento", "Atendimentos", "m"),
      client: t("Cliente", "Clientes", "m"),
      guardian: responsavel,
      topic: t("Serviço", "Serviços", "m"),
    },
  },
};

const lower = (x: string) => x.toLocaleLowerCase("pt-BR");

/** Primeira letra maiúscula: `${cap(w.um)} ${w.l}` → "Uma aula". */
export const cap = (x: string) => x.charAt(0).toLocaleUpperCase("pt-BR") + x.slice(1);

/**
 * Uma palavra da tela, com o que precisa para concordar.
 *
 *   `${w.novo} ${w.l}`        → "Nova aula" / "Novo atendimento"
 *   `Nenhum${w.pick("", "a")} ${w.l} hoje`
 *
 * `s`/`p` vêm como a empresa escreveu (em geral com maiúscula, para título e
 * botão); `l`/`lp` são as mesmas em minúscula, para o meio da frase.
 */
export class Word {
  readonly s: string;
  readonly p: string;
  readonly g: Gender;
  readonly l: string;
  readonly lp: string;

  constructor(spec: TermSpec) {
    this.s = spec.s;
    this.p = spec.p;
    this.g = spec.g;
    this.l = lower(spec.s);
    this.lp = lower(spec.p);
  }

  pick<T>(m: T, f: T): T { return this.g === "f" ? f : m; }

  get o() { return this.pick("o", "a"); }
  get os() { return this.pick("os", "as"); }
  get um() { return this.pick("um", "uma"); }
  get do() { return this.pick("do", "da"); }
  get dos() { return this.pick("dos", "das"); }
  get no() { return this.pick("no", "na"); }
  get ao() { return this.pick("ao", "à"); }
  get este() { return this.pick("este", "esta"); }
  get esse() { return this.pick("esse", "essa"); }
  get seu() { return this.pick("seu", "sua"); }
  get seus() { return this.pick("seus", "suas"); }
  get novo() { return this.pick("Novo", "Nova"); }
  get nenhum() { return this.pick("Nenhum", "Nenhuma"); }
  get proximo() { return this.pick("Próximo", "Próxima"); }
  get proximos() { return this.pick("Próximos", "Próximas"); }
}

export type Vocabulary = { model: BusinessModel | null } & Record<TermKey, Word>;

function isTermSpec(x: unknown): x is TermSpec {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.s === "string" && o.s.trim() !== ""
    && typeof o.p === "string" && o.p.trim() !== ""
    && (o.g === "m" || o.g === "f");
}

export function isBusinessModel(x: unknown): x is BusinessModel {
  return typeof x === "string" && (BUSINESS_MODELS as readonly string[]).includes(x);
}

/** As palavras do ramo (ou as genéricas, se não escolheu), com as editadas por cima. */
export function buildVocabulary(model: BusinessModel | null, custom?: unknown): Vocabulary {
  const base = PRESETS[model ?? "outro"].terms;
  const extra = (custom && typeof custom === "object" ? custom : {}) as Record<string, unknown>;
  const words = {} as Record<TermKey, Word>;
  for (const k of TERM_KEYS) {
    words[k] = new Word(isTermSpec(extra[k]) ? extra[k] as TermSpec : base[k]);
  }
  return { model, ...words };
}

/**
 * O que funções puras usam quando ninguém passa vocabulário - e o que os
 * testes antigos esperam. É o ramo em que o app nasceu.
 */
export const DEFAULT_VOCABULARY = buildVocabulary("aulas");
export const GENERIC_VOCABULARY = buildVocabulary(null);

/** "Médicos · Consultas · Pacientes" - o resumo que aparece ao escolher o ramo. */
export function vocabularySummary(v: Vocabulary): string {
  return [v.staff.p, v.appointment.p, v.client.p].join(" · ");
}

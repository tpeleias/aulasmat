import { getLocale, type Locale } from "@/lib/i18n";
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

// Em inglês não há gênero; `g` fica só para o tipo fechar.
const e = (s: string, p: string): TermSpec => ({ s, p, g: "m" });

/** As palavras de cada ramo em inglês (empresa com locale "en"). */
export const PRESETS_EN: Record<BusinessModel, { nome: string; exemplo: string; terms: VocabularySpec }> = {
  aulas: { nome: "Tutoring and lessons", exemplo: "Private lessons, tutoring, languages, music", terms: {
    business: e("School", "Schools"), staff: e("Teacher", "Teachers"), appointment: e("Lesson", "Lessons"),
    client: e("Student", "Students"), guardian: e("Parent", "Parents"), topic: e("Subject", "Subjects") } },
  saude: { nome: "Health and medical clinics", exemplo: "Doctors' offices, clinics, physiotherapy, nutrition", terms: {
    business: e("Clinic", "Clinics"), staff: e("Doctor", "Doctors"), appointment: e("Appointment", "Appointments"),
    client: e("Patient", "Patients"), guardian: e("Guardian", "Guardians"), topic: e("Specialty", "Specialties") } },
  psicologia: { nome: "Psychology and therapy", exemplo: "Psychologists, therapists, speech therapy", terms: {
    business: e("Practice", "Practices"), staff: e("Therapist", "Therapists"), appointment: e("Session", "Sessions"),
    client: e("Client", "Clients"), guardian: e("Guardian", "Guardians"), topic: e("Approach", "Approaches") } },
  beleza: { nome: "Beauty salons and aesthetics", exemplo: "Hairdressers, nail salons, barbershops, aesthetics", terms: {
    business: e("Salon", "Salons"), staff: e("Professional", "Professionals"), appointment: e("Appointment", "Appointments"),
    client: e("Client", "Clients"), guardian: e("Guardian", "Guardians"), topic: e("Service", "Services") } },
  pet: { nome: "Pets and veterinary", exemplo: "Vets, grooming, dog training", terms: {
    business: e("Vet clinic", "Vet clinics"), staff: e("Vet", "Vets"), appointment: e("Appointment", "Appointments"),
    client: e("Pet", "Pets"), guardian: e("Owner", "Owners"), topic: e("Service", "Services") } },
  esportes: { nome: "Sports and fitness", exemplo: "Personal trainers, gyms, sports schools", terms: {
    business: e("Gym", "Gyms"), staff: e("Coach", "Coaches"), appointment: e("Session", "Sessions"),
    client: e("Athlete", "Athletes"), guardian: e("Guardian", "Guardians"), topic: e("Activity", "Activities") } },
  oficina: { nome: "Repair shops and maintenance", exemplo: "Car repair, tech support, repairs", terms: {
    business: e("Shop", "Shops"), staff: e("Technician", "Technicians"), appointment: e("Service visit", "Service visits"),
    client: e("Customer", "Customers"), guardian: e("Owner", "Owners"), topic: e("Service", "Services") } },
  outro: { nome: "Other business", exemplo: "Any appointment-based service", terms: {
    business: e("Business", "Businesses"), staff: e("Professional", "Professionals"), appointment: e("Appointment", "Appointments"),
    client: e("Client", "Clients"), guardian: e("Guardian", "Guardians"), topic: e("Service", "Services") } },
};

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

/** O ramo na língua da empresa (nome, exemplo e palavras). */
export function presetFor(model: BusinessModel, locale: Locale = getLocale()) {
  return locale === "en" ? PRESETS_EN[model] : PRESETS[model];
}

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

  /** Em inglês os artigos e adjetivos não concordam: "the", "a", "New". */
  readonly en: boolean;

  constructor(spec: TermSpec, en = false) {
    this.en = en;
    this.s = spec.s;
    this.p = spec.p;
    this.g = spec.g;
    this.l = lower(spec.s);
    this.lp = lower(spec.p);
  }

  pick<T>(m: T, f: T): T { return this.g === "f" ? f : m; }

  private x(pt: string, en: string) { return this.en ? en : pt; }

  get o() { return this.x(this.pick("o", "a"), "the"); }
  get os() { return this.x(this.pick("os", "as"), "the"); }
  get um() { return this.x(this.pick("um", "uma"), /^[aeiou]/i.test(this.s) ? "an" : "a"); }
  get do() { return this.x(this.pick("do", "da"), "of the"); }
  get dos() { return this.x(this.pick("dos", "das"), "of the"); }
  get no() { return this.x(this.pick("no", "na"), "in the"); }
  get ao() { return this.x(this.pick("ao", "à"), "to the"); }
  get este() { return this.x(this.pick("este", "esta"), "this"); }
  get esse() { return this.x(this.pick("esse", "essa"), "that"); }
  get seu() { return this.x(this.pick("seu", "sua"), "your"); }
  get seus() { return this.x(this.pick("seus", "suas"), "your"); }
  get novo() { return this.x(this.pick("Novo", "Nova"), "New"); }
  get nenhum() { return this.x(this.pick("Nenhum", "Nenhuma"), "No"); }
  get proximo() { return this.x(this.pick("Próximo", "Próxima"), "Next"); }
  get proximos() { return this.x(this.pick("Próximos", "Próximas"), "Next"); }
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
export function buildVocabulary(model: BusinessModel | null, custom?: unknown, locale: Locale = getLocale()): Vocabulary {
  const en = locale === "en";
  const base = (en ? PRESETS_EN : PRESETS)[model ?? "outro"].terms;
  const extra = (custom && typeof custom === "object" ? custom : {}) as Record<string, unknown>;
  const words = {} as Record<TermKey, Word>;
  for (const k of TERM_KEYS) {
    words[k] = new Word(isTermSpec(extra[k]) ? extra[k] as TermSpec : base[k], en);
  }
  return { model, ...words };
}

/**
 * O que funções puras usam quando ninguém passa vocabulário - e o que os
 * testes antigos esperam. É o ramo em que o app nasceu.
 */
export const DEFAULT_VOCABULARY = buildVocabulary("aulas", null, "pt-BR");
export const GENERIC_VOCABULARY = buildVocabulary(null, null, "pt-BR");

/** "Médicos · Consultas · Pacientes" - o resumo que aparece ao escolher o ramo. */
export function vocabularySummary(v: Vocabulary): string {
  return [v.staff.p, v.appointment.p, v.client.p].join(" · ");
}

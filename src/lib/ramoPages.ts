import { L } from "@/lib/i18n";
import type { BusinessModel } from "@/lib/vocabulary";

/**
 * Páginas por ramo (`/para/<slug>`): uma porta de entrada por tipo de negócio,
 * para o Google e para o Thiago mandar o link certo a quem tem aquele ramo.
 *
 * Só entra aqui o que o app faz hoje (agenda sem choque, portal em que o
 * cliente pede horário, cobrança com Pix, pacotes, equipe, Google Agenda,
 * link público de horários). Nada de promessa de lembrete automático por
 * WhatsApp: ele ainda não existe.
 */
export type RamoPage = {
  slug: string;
  model: BusinessModel;
  /** Quem é, para "Agenda para ___" (já na língua atual). */
  quem: string;
  titulo: string;
  resumo: string;
  dores: { titulo: string; texto: string }[];
  dia: string[];
};

export const RAMO_SLUGS = ["professores", "clinicas", "psicologos", "saloes", "pet-shops", "personal-trainers", "oficinas"] as const;

export function ramoPages(): RamoPage[] {
  return [
    {
      slug: "professores", model: "aulas",
      quem: L("professores particulares", "private tutors"),
      titulo: L("Agenda e cobrança para professores particulares", "Scheduling and billing for private tutors"),
      resumo: L("Aulas particulares, reforço, idiomas e música: horários sem choque, pacote de aulas e a cobrança do mês sem planilha.",
        "Private lessons, tutoring, languages and music: no double-booking, lesson packages and monthly billing without a spreadsheet."),
      dores: [
        { titulo: L("Aula toda semana, sem remarcar na mão", "Weekly lessons without rebooking by hand"),
          texto: L("Repita a aula por dias da semana: \"toda segunda e quarta\", 8 vezes. Se um horário já estiver ocupado, o app avisa na hora.",
            "Repeat a lesson on chosen weekdays: \"every Monday and Wednesday\", 8 times. If a time is taken, the app tells you right away.") },
        { titulo: L("A família pede horário, você aprova", "Families request, you approve"),
          texto: L("O responsável vê os horários livres, pede uma aula ou uma troca e acompanha o que foi marcado. Você decide.",
            "A parent sees the free times, asks for a lesson or a change and follows what's booked. You decide.") },
        { titulo: L("Quem deve, quanto e desde quando", "Who owes what, and since when"),
          texto: L("Cada aula dada vira cobrança sozinha. Pacotes, desconto por família, Pix com o valor e recibo para o imposto de renda.",
            "Every lesson given becomes a charge automatically. Packages, family discounts, a payment message with the total and receipts.") },
      ],
      dia: [
        L("Segunda: 5 alunos, nenhum horário em cima do outro.", "Monday: 5 students, no overlapping times."),
        L("Quarta: a mãe do João pede para trocar a aula de quinta. Você aprova em um toque.", "Wednesday: a parent asks to move Thursday's lesson. You approve in one tap."),
        L("Fim do mês: a mensagem de cobrança sai com o total e o Pix.", "End of month: the payment message goes out with the total and the payment link."),
      ],
    },
    {
      slug: "clinicas", model: "saude",
      quem: L("clínicas e consultórios", "clinics and medical offices"),
      titulo: L("Agenda para clínicas e consultórios", "Scheduling for clinics and medical offices"),
      resumo: L("Consultas, fisioterapia e nutrição: agenda por profissional, retornos que se repetem e o financeiro de cada paciente.",
        "Appointments, physiotherapy and nutrition: a calendar per professional, recurring follow-ups and each patient's billing."),
      dores: [
        { titulo: L("Uma agenda por profissional", "One calendar per professional"),
          texto: L("Cada profissional vê a própria agenda e a recepção vê todas. Financeiro e configurações ficam só com quem administra.",
            "Each professional sees their own calendar and the front desk sees all. Billing and settings stay with the admins.") },
        { titulo: L("Retornos que se repetem", "Recurring follow-ups"),
          texto: L("Sessões semanais ou quinzenais em poucos toques, sempre sem marcar em cima de outro paciente.",
            "Weekly or biweekly sessions in a few taps, never on top of another patient.") },
        { titulo: L("Link de horários livres", "A link with free times"),
          texto: L("Um endereço para pôr no Instagram ou mandar no WhatsApp: o paciente vê o que está livre, sem ver quem ocupa o resto.",
            "One address for Instagram or WhatsApp: patients see what's free, without seeing who fills the rest.") },
      ],
      dia: [
        L("Manhã: três profissionais, três agendas, nenhum conflito.", "Morning: three professionals, three calendars, no conflicts."),
        L("Tarde: o paciente pede um retorno pelo portal. A recepção aprova.", "Afternoon: a patient requests a follow-up through the portal. The front desk approves."),
        L("Fim da semana: o resumo mostra o que foi atendido e o que está em aberto.", "End of the week: the summary shows what was seen and what's still open."),
      ],
    },
    {
      slug: "psicologos", model: "psicologia",
      quem: L("psicólogos e terapeutas", "psychologists and therapists"),
      titulo: L("Agenda para psicólogos e terapeutas", "Scheduling for psychologists and therapists"),
      resumo: L("Sessões semanais com horário fixo, cobrança por sessão ou por mês e um link de horários livres para novos pacientes.",
        "Weekly sessions at a fixed time, per-session or monthly billing and a free-times link for new clients."),
      dores: [
        { titulo: L("Horário fixo, toda semana", "A fixed slot, every week"),
          texto: L("\"Toda terça às 18h\" vira uma série. Férias e feriados entram como bloqueio e a agenda respeita.",
            "\"Every Tuesday at 6 PM\" becomes a series. Holidays and days off go in as blocks and the calendar respects them.") },
        { titulo: L("Cobrança sem constrangimento", "Billing without awkwardness"),
          texto: L("O app soma as sessões dadas e monta a mensagem de cobrança com o total e o Pix. Você só envia.",
            "The app adds up the sessions held and writes the payment message with the total and the payment link. You just send it.") },
        { titulo: L("Importa o que já está ocupado no Google", "Reads what's already busy on Google"),
          texto: L("Conecte o Google Agenda: o que estiver ocupado lá bloqueia a agenda daqui, sem mostrar o título do compromisso.",
            "Connect Google Calendar: what's busy there blocks your calendar here, without showing the event title.") },
      ],
      dia: [
        L("Segunda: sessões nos horários fixos de cada paciente.", "Monday: sessions at each client's fixed time."),
        L("Quinta: um paciente novo vê seus horários livres pelo link e te chama.", "Thursday: a new client sees your free times through the link and contacts you."),
        L("Dia 30: a cobrança de cada paciente já está calculada.", "The 30th: each client's charge is already calculated."),
      ],
    },
    {
      slug: "saloes", model: "beleza",
      quem: L("salões e estúdios de beleza", "salons and beauty studios"),
      titulo: L("Agenda para salões, barbearias e estética", "Scheduling for salons, barbershops and aesthetics"),
      resumo: L("Cada serviço com duração e preço, cada profissional com a sua agenda e a cliente escolhendo o horário que está livre.",
        "Each service with its duration and price, each professional with their own calendar and clients picking what's free."),
      dores: [
        { titulo: L("Serviços com duração e preço", "Services with duration and price"),
          texto: L("Corte, coloração, manicure: cada um com a sua duração, o seu valor e a sua cor na agenda.",
            "Haircut, color, manicure: each with its own duration, price and colour on the calendar.") },
        { titulo: L("Quem faz o quê", "Who does what"),
          texto: L("Defina quais serviços cada profissional faz. O link de horários mostra só quem pode atender aquele serviço.",
            "Choose which services each professional does. The free-times link shows only who can take that service.") },
        { titulo: L("Intervalo entre clientes", "Time between clients"),
          texto: L("Configure uma folga entre um atendimento e outro para limpar e preparar a cadeira.",
            "Set a gap between appointments to clean up and get the chair ready.") },
      ],
      dia: [
        L("Sábado cheio: três profissionais, cada um com a sua agenda.", "Busy Saturday: three professionals, each with their own calendar."),
        L("A cliente abre o link da bio do Instagram e vê o que está livre.", "A client opens the link in your Instagram bio and sees what's free."),
        L("No fim do dia: o que foi atendido e o que foi pago.", "End of the day: what was done and what was paid."),
      ],
    },
    {
      slug: "pet-shops", model: "pet",
      quem: L("pet shops e veterinários", "pet shops and vets"),
      titulo: L("Agenda para pet shops, banho e tosa e veterinários", "Scheduling for pet shops, grooming and vets"),
      resumo: L("Banho, tosa, consulta e adestramento: duração por serviço, pacote de banhos e o dono recebendo o valor certo.",
        "Grooming, vet visits and training: duration per service, bath packages and owners getting the right total."),
      dores: [
        { titulo: L("Pacote de banhos", "Bath packages"),
          texto: L("Venda 4 banhos e acompanhe quantos já foram usados. Cada banho dado baixa do pacote.",
            "Sell 4 baths and see how many are used. Each bath given draws from the package.") },
        { titulo: L("O dono responde, o pet é atendido", "The owner answers, the pet is served"),
          texto: L("Quem responde e paga é o dono; o atendimento é do animal. O cadastro separa as duas coisas.",
            "The owner is who answers and pays; the appointment is for the animal. The record keeps the two apart.") },
        { titulo: L("Horários que não se chocam", "No clashes"),
          texto: L("Duração diferente para cada serviço, e a agenda recusa o que já está ocupado.",
            "A different duration for each service, and the calendar refuses what's already taken.") },
      ],
      dia: [
        L("Manhã de banho e tosa: cada serviço com a sua duração.", "Grooming morning: each service with its own duration."),
        L("O dono pede o próximo banho pelo portal.", "The owner requests the next bath through the portal."),
        L("No fim do mês: o pacote usado e o que falta cobrar.", "At month end: the package used and what's left to charge."),
      ],
    },
    {
      slug: "personal-trainers", model: "esportes",
      quem: L("personal trainers e escolinhas", "personal trainers and sports schools"),
      titulo: L("Agenda para personal trainers, academias e escolinhas", "Scheduling for personal trainers, gyms and sports schools"),
      resumo: L("Treinos que se repetem por dias da semana, pacote mensal e a cobrança de cada aluno em um lugar só.",
        "Workouts that repeat on chosen weekdays, monthly packages and each client's billing in one place."),
      dores: [
        { titulo: L("Treino fixo na semana", "A fixed weekly routine"),
          texto: L("\"Segunda, quarta e sexta, 7h\" em uma série só. Se um dia cair em feriado, é só bloquear.",
            "\"Monday, Wednesday and Friday, 7 AM\" in a single series. If a day falls on a holiday, just block it.") },
        { titulo: L("Rota até o aluno", "Directions to the client"),
          texto: L("Atende em casa ou em academia? Abra o endereço no Waze ou no Google Maps com um toque.",
            "Training at home or at the gym? Open the address in Waze or Google Maps with a tap.") },
        { titulo: L("Pacote e mensalidade", "Packages and monthly fees"),
          texto: L("Pacotes de treinos e desconto por família, com a cobrança pronta no fim do mês.",
            "Workout packages and family discounts, with the charge ready at month end.") },
      ],
      dia: [
        L("Das 6h às 20h: cada treino no seu horário, sem choque.", "From 6 AM to 8 PM: each workout at its time, no clashes."),
        L("O aluno viaja e pede para trocar o treino. Você aprova.", "A client travels and asks to move a workout. You approve."),
        L("Dia 1º: quem pagou, quem deve e o link do Pix para cobrar.", "The 1st: who paid, who owes and the payment link to collect."),
      ],
    },
    {
      slug: "oficinas", model: "oficina",
      quem: L("oficinas e assistências técnicas", "repair shops and tech support"),
      titulo: L("Agenda para oficinas, assistência técnica e reparos", "Scheduling for repair shops, tech support and repairs"),
      resumo: L("Serviços com tempo estimado, cada técnico com a sua agenda e o cliente sabendo quando pode deixar o equipamento.",
        "Services with an estimated time, each technician with their own calendar and customers knowing when they can drop off."),
      dores: [
        { titulo: L("Tempo de cada serviço", "Time for each service"),
          texto: L("Troca de óleo, revisão, conserto: cada serviço com o seu tempo e o seu valor.",
            "Oil change, inspection, repair: each service with its time and price.") },
        { titulo: L("Cada técnico, uma agenda", "One calendar per technician"),
          texto: L("Veja o dia de cada técnico e quem está livre para o próximo serviço.",
            "See each technician's day and who is free for the next job.") },
        { titulo: L("Cliente vê o que está livre", "Customers see what's free"),
          texto: L("Um link com os horários livres para o cliente escolher, sem telefonema.",
            "A link with free times for customers to pick from, no phone call.") },
      ],
      dia: [
        L("Manhã: três serviços, três técnicos, nada em cima.", "Morning: three jobs, three technicians, no overlaps."),
        L("O cliente pede o horário pelo link e você confirma.", "A customer requests a slot through the link and you confirm."),
        L("No fim da semana: serviços feitos e valores a receber.", "End of the week: jobs done and amounts to collect."),
      ],
    },
  ];
}

export function ramoPage(slug: string | undefined) {
  return ramoPages().find(r => r.slug === slug) ?? null;
}

/** Ramo → página, para a Landing ligar os cartões de "Para quem". */
export function slugOfModel(model: BusinessModel): string | null {
  return ramoPages().find(r => r.model === model)?.slug ?? null;
}

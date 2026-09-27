// Empresa-modelo inventada para as fotos da loja. Nenhum dado real.
// STORE_LANG=en: a mesma empresa em inglês, em dólar (ficha en-US da loja).
export const EN = process.env.STORE_LANG === "en";
const DAY = 86400000;
const now = new Date();
const at = (dayOffset, h, m = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const USER_ID = "00000000-0000-4000-8000-000000000001";
export const ACCOUNT_ID = "00000000-0000-4000-8000-0000000000aa";

const studentsPt = [
  ["Lucas Almeida", "Carla Almeida", "Rua das Acácias, 120 - Pinheiros", "5511987650001"],
  ["Beatriz Souza", "Renata Souza", "Av. Paulista, 900, ap 52", "5511987650002"],
  ["Pedro Martins", "Marcos Martins", "Rua Harmonia, 45 - Vila Madalena", "5511987650003"],
  ["Júlia Costa", "Fernanda Costa", "Rua Oscar Freire, 300", "5511987650004"],
  ["Gabriel Rocha", "Paula Rocha", "Rua Augusta, 1500, ap 81", "5511987650005"],
  ["Sofia Lima", "Ricardo Lima", "Alameda Santos, 700", "5511987650006"],
  ["Miguel Ferreira", "Luciana Ferreira", "Rua Bela Cintra, 210", "5511987650007"],
  ["Laura Ribeiro", "Tatiana Ribeiro", "Rua Haddock Lobo, 95", "5511987650008"],
];
const studentsEn = [
  ["Lucas Miller", "Karen Miller", "120 Maple Ave, Brooklyn", "12125550101"],
  ["Emily Johnson", "Rachel Johnson", "900 Park Ave, Apt 5B", "12125550102"],
  ["Noah Williams", "Mark Williams", "45 Oak St, Hoboken", "12125550103"],
  ["Olivia Brown", "Jennifer Brown", "300 Elm St", "12125550104"],
  ["Ethan Davis", "Paula Davis", "1500 Broadway, Apt 8C", "12125550105"],
  ["Sophia Wilson", "Richard Wilson", "700 Lexington Ave", "12125550106"],
  ["Mason Moore", "Lucy Moore", "210 Hudson St", "12125550107"],
  ["Ava Taylor", "Tina Taylor", "95 Bedford Ave", "12125550108"],
];
export const FIRST_STUDENT = (EN ? studentsEn : studentsPt)[0][0];
const students = (EN ? studentsEn : studentsPt).map(([student_name, guardian_name, address, whatsapp], i) => ({
  id: `10000000-0000-4000-8000-00000000000${i}`,
  account_id: ACCOUNT_ID, student_name, guardian_name, address, whatsapp,
  user_id: `20000000-0000-4000-8000-00000000000${i}`,
  child_user_id: null, child_username: null, guardian_username: guardian_name.split(" ")[0].toLowerCase(),
  must_change_password: false, child_must_change_password: false, plan_locked: false,
  created_at: at(-60, 10), updated_at: at(-60, 10),
}));

const SUBJ = EN ? { mat: "Math", fis: "Physics", ing: "Spanish" } : { mat: "Matemática", fis: "Física", ing: "Inglês" };
const T = EN ? { ana: "anna", bruno: "ben", carol: "carol" } : { ana: "ana", bruno: "bruno", carol: "carol" };
const teachers = [
  { id: "30000000-0000-4000-8000-000000000001", name: T.ana, subject: SUBJ.mat, active: true, sort_order: 1, whatsapp: "5511900000001", whatsapp_enabled: true, plan_locked: false, user_id: USER_ID, created_at: at(-90, 9) },
  { id: "30000000-0000-4000-8000-000000000002", name: T.bruno, subject: SUBJ.fis, active: true, sort_order: 2, whatsapp: "5511900000002", whatsapp_enabled: true, plan_locked: false, user_id: null, created_at: at(-80, 9) },
  { id: "30000000-0000-4000-8000-000000000003", name: T.carol, subject: SUBJ.ing, active: true, sort_order: 3, whatsapp: "5511900000003", whatsapp_enabled: true, plan_locked: false, user_id: null, created_at: at(-70, 9) },
];

const PRICE = EN ? 60 : 150;
let n = 0;
const lesson = (si, teacher, day, h, m, status, subject, extra = {}) => {
  const s = students[si];
  n++;
  return {
    id: `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    account_id: ACCOUNT_ID, student_name: s.student_name, guardian_name: s.guardian_name,
    subject: ({ "Matemática": SUBJ.mat, "Física": SUBJ.fis, "Inglês": SUBJ.ing })[subject] ?? subject, start_at: at(day, h, m), duration_minutes: 60, price: PRICE,
    package_type: "single", payment_status: "pendente", notes: null,
    teacher: T[teacher] ?? teacher, address: s.address, is_online: false, status,
    class_summary: status === "realizada" ? (EN ? "We reviewed quadratic equations and did worksheet 3." : "Revisamos equações do 2º grau e fizemos a lista 3.") : null,
    absence_charged: false, reschedule_of: null,
    created_at: at(day - 7, 9), updated_at: at(day - 7, 9), ...extra,
  };
};

const lessons = [
  // Semana passada: realizadas
  lesson(0, "ana", -7, 15, 0, "realizada", "Matemática"),
  lesson(1, "ana", -6, 16, 0, "realizada", "Matemática"),
  lesson(2, "bruno", -6, 14, 0, "realizada", "Física"),
  lesson(3, "carol", -5, 10, 0, "realizada", "Inglês"),
  lesson(4, "ana", -4, 17, 0, "realizada", "Matemática"),
  lesson(5, "bruno", -3, 15, 0, "realizada", "Física"),
  lesson(6, "carol", -2, 11, 0, "realizada", "Inglês"),
  lesson(7, "ana", -1, 16, 0, "realizada", "Matemática"),
  // Hoje
  lesson(0, "ana", 0, 14, 0, "agendada", "Matemática"),
  lesson(3, "carol", 0, 15, 0, "agendada", "Inglês"),
  lesson(1, "ana", 0, 16, 30, "agendada", "Matemática"),
  lesson(2, "bruno", 0, 17, 0, "agendada", "Física"),
  lesson(5, "ana", 0, 18, 30, "agendada", "Matemática", { is_online: true, address: null }),
  // Próximos dias
  lesson(4, "ana", 1, 9, 0, "agendada", "Matemática"),
  lesson(6, "carol", 1, 10, 30, "agendada", "Inglês"),
  lesson(7, "bruno", 1, 14, 0, "agendada", "Física"),
  lesson(0, "ana", 2, 15, 0, "agendada", "Matemática"),
  lesson(2, "bruno", 2, 16, 0, "agendada", "Física"),
  lesson(3, "carol", 3, 10, 0, "agendada", "Inglês"),
  lesson(1, "ana", 3, 16, 0, "agendada", "Matemática"),
  lesson(5, "bruno", 4, 15, 0, "agendada", "Física"),
  lesson(4, "ana", 4, 17, 0, "agendada", "Matemática"),
  lesson(6, "carol", 5, 11, 0, "agendada", "Inglês"),
  lesson(7, "ana", 5, 14, 0, "agendada", "Matemática"),
  // Pedido de horário vindo do portal da família
  lesson(4, "ana", 2, 10, 0, "solicitada", "Matemática"),
];

let t = 0;
const tx = (si, amount, kind, extra = {}) => {
  const s = students[si];
  t++;
  return {
    id: `50000000-0000-4000-8000-${String(t).padStart(12, "0")}`,
    account_id: ACCOUNT_ID, student_name: s.student_name, guardian_name: s.guardian_name,
    amount, kind, lesson_id: null, description: null, created_at: at(-8, 12), ...extra,
  };
};
const wallet = [];
for (const l of lessons.filter(l => l.status === "realizada")) {
  const si = students.findIndex(s => s.student_name === l.student_name);
  wallet.push(tx(si, -PRICE, "lesson", { lesson_id: l.id, created_at: l.start_at, description: l.subject }));
}
// Algumas famílias pagaram, outras não.
const PAID = EN ? "Card" : "Pix";
const PKG10 = EN ? "10-lesson package" : "Pacote 10 aulas";
wallet.push(tx(0, PRICE, "package", { description: PAID, created_at: at(-6, 20) }));
wallet.push(tx(2, PRICE, "package", { description: PAID, created_at: at(-5, 9) }));
wallet.push(tx(3, PRICE, "package", { description: PAID, created_at: at(-4, 19) }));
wallet.push(tx(6, PRICE * 9, "package", { description: PKG10, created_at: at(-2, 12) }));
wallet.push(tx(6, PRICE, "voucher", { description: EN ? "10-lesson package voucher" : "Voucher pacote 10 aulas", created_at: at(-2, 12) }));

const settings = {
  id: 1, account_id: ACCOUNT_ID, allow_student_booking: true, contact_email: EN ? "hello@modelstudio.com" : "contato@estudiomodelo.com.br",
  default_lesson_price: PRICE, payment_link: EN ? "https://pay.example.com/model-studio" : null, pix_key: EN ? null : "contato@estudiomodelo.com.br",
  scarcity_weekday_max: 6, scarcity_weekday_min: 2, scarcity_weekend_max: 3, scarcity_weekend_min: 1,
  show_availability_to_students: true, show_payment_info_to_students: true, slot_minutes: 60,
  work_start: "08:00", work_end: "20:00", min_request_notice_hours: 12,
  charge_absence: true, absence_notice_hours: 24, absence_charge_percent: 100,
  whatsapp_thiago: null, whatsapp_mayara: null,
};

const packages = [
  { id: "60000000-0000-4000-8000-000000000001", account_id: ACCOUNT_ID, name: PKG10, lessons: 10, price: PRICE * 9, active: true, sort_order: 1, created_at: at(-30, 9) },
  { id: "60000000-0000-4000-8000-000000000002", account_id: ACCOUNT_ID, name: EN ? "5-lesson package" : "Pacote 5 aulas", lessons: 5, price: EN ? 280 : 700, active: true, sort_order: 2, created_at: at(-30, 9) },
];

const myPlan = {
  plano: "pro", tier: "pro", nome: "Cronys Max", max_teachers: null, included_teachers: 5, max_students: null,
  assistant: true, assistant_override: false, assistant_included: true, assistant_billed: false, assistant_on_sale: true,
  packages: true, recurring_blocks: true, vocabulary: true, whatsapp_link: true, whatsapp_auto: true, arrival_location: true,
  trial_ends_at: null, school_code: "estudio-modelo", billing_status: "active", billing_interval: "month",
  paid_until: at(20, 0), grace_until: null, extra_teachers: 0,
  assistant_usage: { used: 18, limit: 200, allowed: true },
};

export const tables = {
  students, teachers, lessons, wallet_transactions: wallet, settings: [settings],
  lesson_packages: packages, user_roles: [{ role: "admin", user_id: USER_ID, account_id: ACCOUNT_ID }],
  accounts: [{ id: ACCOUNT_ID, name: EN ? "Model Tutoring" : "Estúdio Modelo", slug: "estudio-modelo", plan: "pro", business_model: "aulas", locale: EN ? "en" : "pt-BR", currency: EN ? "USD" : "BRL" }],
  blocks: [], block_exceptions: [], homework: [], homework_submissions: [], student_materials: [], account_discounts: [],
};

export const rpcs = {
  my_plan: myPlan,
  is_platform_admin: false,
  my_vocabulary: { business_model: "aulas", custom: null, custom_saved: true, locale: EN ? "en" : "pt-BR", currency: EN ? "USD" : "BRL" },
  get_busy_ranges_by_teacher: [],
  get_busy_ranges: [],
  get_recurring_blocks_by_teacher: [],
  get_recurring_blocks: [],
};

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
export const session = {
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 7 * 86400, email: "ana@estudiomodelo.com.br" })}.c2ln`,
  refresh_token: "modelo",
  token_type: "bearer",
  expires_in: 7 * 86400,
  expires_at: Math.floor(Date.now() / 1000) + 7 * 86400,
  user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: "ana@estudiomodelo.com.br", app_metadata: { provider: "email" }, user_metadata: {}, created_at: at(-90, 9) },
};

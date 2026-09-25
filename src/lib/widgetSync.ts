import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { reminderMessage, whatsAppLink } from "@/lib/whatsapp";
import type { MessageTemplates } from "@/lib/messageTemplates";
import { supabase } from "@/integrations/supabase/client";
import { teacherSlug } from "@/hooks/useTeachers";
import { loadMessageTemplates } from "@/hooks/useMessageTemplates";
import type { Vocabulary } from "@/lib/vocabulary";

const LESSONS_KEY = "upcoming_lessons_widget";
const BILLING_KEY = "billing_widget";
const MAX_WIDGET_LESSONS = 4;
const MAX_WIDGET_DEBTORS = 3;

interface LessonsWidgetPlugin {
  refresh(): Promise<void>;
}

const LessonsWidget = registerPlugin<LessonsWidgetPlugin>("LessonsWidget");

export interface WidgetLessonInput {
  id: string;
  start_at: string;
  duration_minutes: number;
  student_name: string;
  subject: string | null;
  address: string | null;
  is_online: boolean;
  teacher: string;
  guardian_name?: string | null;
}

/** Atalhos do widget: o que o plano libera e onde achar o WhatsApp do cliente. */
export interface WidgetShortcuts {
  words: Vocabulary;
  remind: boolean;
  locate: boolean;
  phoneOf: (l: { student_name: string; guardian_name?: string | null }) => string | null;
  templates?: MessageTemplates | null;
}

async function publish(key: string, value: unknown) {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
    await LessonsWidget.refresh();
  } catch {
    // Widget plugin unavailable on this build; safe to ignore.
  }
}

// `teacherOrder`: apelidos dos professores na ordem da agenda. O widget pinta
// de outra cor a aula de quem não é o primeiro - antes era o nome "mayara"
// cravado no código Android.
export async function syncUpcomingLessonsWidget(lessons: WidgetLessonInput[], teacherOrder: string[] = [], shortcuts?: WidgetShortcuts) {
  if (!Capacitor.isNativePlatform()) return;
  const payload = lessons
    .slice()
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, MAX_WIDGET_LESSONS)
    .map((l) => ({
      id: l.id,
      day: format(new Date(l.start_at), "EEE dd/MM", { locale: ptBR }),
      time: format(new Date(l.start_at), "HH:mm"),
      student: l.student_name,
      subject: l.subject ?? "",
      address: l.address ?? "",
      isOnline: l.is_online,
      teacher: l.teacher,
      alt: teacherOrder.length > 1 && teacherOrder.indexOf(l.teacher) > 0,
      waUrl: shortcuts?.remind ? whatsAppLink(shortcuts.phoneOf(l), reminderMessage(l, shortcuts.words, shortcuts.templates)) : "",
      locate: !!shortcuts?.locate && !l.is_online,
    }));
  await publish(LESSONS_KEY, payload);
}

export interface WidgetBillingInput {
  totalOwed: number;
  accounts: { label: string; owed: number }[];
}

export async function syncBillingWidget(input: WidgetBillingInput) {
  if (!Capacitor.isNativePlatform()) return;
  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const debtors = input.accounts.filter(a => a.owed > 0);
  await publish(BILLING_KEY, {
    total: fmt(input.totalOwed),
    count: debtors.length,
    top: debtors.slice(0, MAX_WIDGET_DEBTORS).map(a => ({ label: a.label, owed: fmt(a.owed) })),
    updatedAt: format(new Date(), "HH:mm"),
  });
}

type PhoneRow = { student_name: string; guardian_name: string | null; whatsapp?: string | null };

/** WhatsApp do cadastro: pelo nome e, havendo homônimos, pelo responsável. */
export function phoneFinder(rows: PhoneRow[]) {
  return (l: { student_name: string; guardian_name?: string | null }) => {
    const same = rows.filter(p => p.student_name.toLowerCase() === l.student_name.trim().toLowerCase());
    const hit = same.length === 1 ? same[0]
      : same.find(p => (p.guardian_name ?? "").toLowerCase() === (l.guardian_name ?? "").trim().toLowerCase());
    return hit?.whatsapp ?? null;
  };
}

/**
 * Atualiza o widget de aulas sozinho, sem depender da Agenda estar aberta:
 * o app chama ao abrir. Sem isso o widget ficava com a lista da última vez
 * que a Agenda foi aberta (e sem os atalhos novos).
 */
export async function refreshLessonsWidget(opts: { words: Vocabulary; remind: boolean; locate: boolean }) {
  if (!Capacitor.isNativePlatform()) return;
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400000);
  const [up, st, te, templates] = await Promise.all([
    supabase.from("lessons").select("*").gte("start_at", now.toISOString()).lt("start_at", week.toISOString())
      .eq("status", "agendada").order("start_at").limit(100),
    supabase.from("students").select("*"),
    supabase.from("teachers").select("*").eq("active", true).order("sort_order" as never),
    loadMessageTemplates(),
  ]);
  if (up.error) return;
  await syncUpcomingLessonsWidget(
    (up.data ?? []) as unknown as WidgetLessonInput[],
    ((te.data ?? []) as unknown as { name: string }[]).map(t => teacherSlug(t.name)),
    { ...opts, phoneOf: phoneFinder((st.data ?? []) as PhoneRow[]), templates },
  );
}

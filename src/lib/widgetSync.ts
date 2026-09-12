import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

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
}

async function publish(key: string, value: unknown) {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
    await LessonsWidget.refresh();
  } catch {
    // Widget plugin unavailable on this build; safe to ignore.
  }
}

export async function syncUpcomingLessonsWidget(lessons: WidgetLessonInput[]) {
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

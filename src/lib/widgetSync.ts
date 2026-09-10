import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const WIDGET_PREFS_KEY = "upcoming_lessons_widget";
const MAX_WIDGET_LESSONS = 4;

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
}

export async function syncUpcomingLessonsWidget(lessons: WidgetLessonInput[]) {
  if (!Capacitor.isNativePlatform()) return;

  const payload = lessons
    .slice()
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, MAX_WIDGET_LESSONS)
    .map((l) => ({
      id: l.id,
      time: format(new Date(l.start_at), "dd/MM HH:mm", { locale: ptBR }),
      student: l.student_name,
      subject: l.subject ?? "",
      address: l.address ?? "",
      isOnline: l.is_online,
    }));

  try {
    await Preferences.set({ key: WIDGET_PREFS_KEY, value: JSON.stringify(payload) });
    await LessonsWidget.refresh();
  } catch {
    // Widget plugin unavailable on this build; safe to ignore.
  }
}

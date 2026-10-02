import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, startOfDay, format } from "date-fns";
import { computeFreeSlots, padRanges, fmtTime, visibleStarts, scarcityFor, SCARCITY_DEFAULT, type RecurringBlock } from "@/lib/availability";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Info, Clock, Flame } from "lucide-react";
import { useParams } from "react-router-dom";
import { capitalize, fmtMoney } from "@/lib/balance";
import { colorOf } from "@/lib/teacherColors";
import { CronysMark } from "@/components/brand";

import { dateLocale, isCurrency, isLocale, L, setLocale } from "@/lib/i18n";
type PublicService = { id: string; name: string; duration_minutes: number; price: number | null; mode: "presencial" | "online" | "ambos"; color: string | null };
type PublicTeacher = { slug: string; name: string; subject: string | null; scarcity: unknown; all_services: boolean; services: string[] };
type Span = { teacher: string; start_at: string; end_at: string };
type Recurring = RecurringBlock & { teacher: string; exceptions?: string[] };
/** O que `public_agenda` devolve (migration 20261002010000). */
type Agenda = {
  account: { slug: string; name: string; locale: string; currency: string; currency_symbol: string | null };
  settings: { work_start: string; work_end: string; slot_minutes: number; scarcity: unknown; buffer_minutes: number } | null;
  services: PublicService[];
  per_teacher: boolean;
  teachers: PublicTeacher[];
  lessons: Span[];
  blocks: Span[];
  recurring: Recurring[];
};
type DaySlots = { day: Date; slots: { start: Date; end: Date }[] };

const DAYS = 5;
const DEFAULT_SETTINGS = { work_start: "08:00", work_end: "22:00", slot_minutes: 60, scarcity: SCARCITY_DEFAULT, buffer_minutes: 0 };

/** Os horários de um profissional (ou da empresa toda, com `who` nulo). */
function slotsFor(agenda: Agenda, who: string | null, minutes: number, from: Date): DaySlots[] {
  const s = agenda.settings ?? DEFAULT_SETTINGS;
  const mine = (x: { teacher: string }) => !who || x.teacher === who || x.teacher === "both";
  const range = (x: Span) => ({ start: new Date(x.start_at), end: new Date(x.end_at) });
  const lessons = agenda.lessons.filter(l => !who || l.teacher === who).map(range);
  const blocks = agenda.blocks.filter(mine).map(range);
  const rec = agenda.recurring.filter(mine);
  const free = computeFreeSlots(from, DAYS, s.work_start, s.work_end, minutes, padRanges([...lessons, ...blocks], s.buffer_minutes ?? 0), rec);
  // A vitrine sorteada ignora os atendimentos, para não mudar a cada marcação.
  const candidatesPool = computeFreeSlots(from, DAYS, s.work_start, s.work_end, minutes, blocks, rec);
  const now = new Date();
  const teacherScarcity = agenda.teachers.find(t => t.slug === who)?.scarcity;
  return Array.from({ length: DAYS }, (_, i) => {
    const day = addDays(from, i);
    const sameDay = (d: Date) => d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
    const dayCandidates = candidatesPool.filter(f => sameDay(f.start) && f.end > now).map(f => f.start);
    const freeStartTimes = new Set(free.filter(f => sameDay(f.start) && f.end > now).map(f => f.start.getTime()));
    const picked = visibleStarts(day, dayCandidates, who ?? "all", scarcityFor(day, s.scarcity, teacherScarcity));
    // Horário sorteado que foi marcado some, sem outro no lugar.
    const slots = picked
      .filter(start => freeStartTimes.has(start.getTime()))
      .map(start => ({ start, end: new Date(start.getTime() + minutes * 60000) }));
    return { day, slots };
  });
}

export default function PublicAvailability() {
  // /horarios/<empresa>/<profissional>: a empresa vem do endereço. No antigo
  // /disponibilidade/<profissional> ela fica de fora, e o banco usa a do login
  // ou, sem login, a do endereço público.
  const { empresa, teacher } = useParams<{ empresa?: string; teacher?: string }>();
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serviceId, setServiceId] = useState<string>("");
  const [, setLangTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const from = startOfDay(new Date());
    supabase.rpc("public_agenda" as never, { _account: empresa ?? null, _from: from.toISOString(), _to: addDays(from, DAYS).toISOString() } as never)
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (!alive) return;
        const a = !error && data ? data as Agenda : null;
        // Quem abre a página de uma empresa vê na língua e na moeda dela.
        if (a && empresa && isLocale(a.account.locale)) {
          const cur = isCurrency(a.account.currency) ? a.account.currency : a.account.locale === "en" ? "USD" : "BRL";
          if (setLocale(a.account.locale, cur, a.account.currency_symbol)) setLangTick(x => x + 1);
        }
        setAgenda(a);
        setMissing(!a);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [empresa]);

  // Quem faz o serviço (fora do Max, todos fazem todos).
  const does = (slug: string, sid: string) => {
    if (!agenda?.per_teacher) return true;
    const t = agenda.teachers.find(x => x.slug === slug);
    return !t || t.all_services || t.services.includes(sid);
  };
  // Na página de um profissional, só os serviços que ele faz.
  const offered = (agenda?.services ?? []).filter(sv => !teacher || does(teacher, sv.id));
  const service = offered.find(sv => sv.id === serviceId) ?? offered[0] ?? null;

  const found = teacher ? agenda?.teachers.find(t => t.slug === teacher) : undefined;
  const meta = found ? { name: capitalize(found.name), subject: found.subject ?? null } : null;
  const company = empresa && agenda ? agenda.account.name : null;
  const title = meta
    ? `${L("Horários disponíveis", "Available times")} — ${meta.name}${meta.subject ? ` (${meta.subject})` : ""}`
    : company ? `${L("Horários disponíveis", "Available times")} — ${company}` : L("Horários disponíveis", "Available times");

  const who = meta ? `${meta.name}${meta.subject ? ` (${meta.subject})` : ""}` : company ?? "";
  useEffect(() => {
    document.title = title;
    const m = document.querySelector('meta[name="description"]') || (() => {
      const el = document.createElement("meta"); el.setAttribute("name", "description"); document.head.appendChild(el); return el;
    })();
    m.setAttribute("content", L(`Horários livres ${who ? `de ${who} ` : ""}para os próximos 5 dias.`, `Free times ${who ? `for ${who} ` : ""}for the next 5 days.`));
  }, [title, who]);

  const slotsByDay = useMemo<DaySlots[]>(() => {
    if (!agenda) return [];
    const from = startOfDay(new Date());
    // A duração do horário é a do serviço escolhido.
    const minutes = service?.duration_minutes ?? agenda.settings?.slot_minutes ?? DEFAULT_SETTINGS.slot_minutes;
    if (teacher) return slotsFor(agenda, teacher, minutes, from);
    const eligible = agenda.teachers.filter(t => service && does(t.slug, service.id));
    if (service && agenda.per_teacher && eligible.length < agenda.teachers.length) {
      // Nem todo profissional faz este serviço: junta só os horários de quem
      // faz, sem repetir o mesmo horário.
      const all = eligible.map(t => slotsFor(agenda, t.slug, minutes, from));
      return Array.from({ length: DAYS }, (_, i) => {
        const byStart = new Map<number, { start: Date; end: Date }>();
        for (const per of all) for (const sl of per[i]?.slots ?? []) byStart.set(sl.start.getTime(), sl);
        return { day: addDays(from, i), slots: [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime()) };
      });
    }
    return slotsFor(agenda, null, minutes, from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenda, teacher, service?.id]);

  if (!loading && missing) return (
    <div className="flex flex-1 items-center justify-center p-6 text-center" style={{ background: "var(--gradient-subtle)" }}>
      <div>
        <h1 className="text-xl font-semibold">{L("Página não encontrada", "Page not found")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{L("Confira o link com quem te enviou.", "Check the link with whoever sent it to you.")}</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1" style={{ background: "var(--gradient-subtle)" }}>
      <header className="bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
            <GraduationCap className="text-primary-foreground w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">
              {meta ? `${meta.subject ? meta.subject : L("Horários", "Schedule")} — ${meta.name}` : company ?? L("Horários disponíveis", "Available times")}
            </h1>
            <p className="text-xs text-muted-foreground">{L("Horários disponíveis para os próximos 5 dias", "Available times for the next 5 days")}</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {offered.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{offered.length > 1 ? L("Escolha o serviço", "Choose a service") : L("Serviço", "Service")}</p>
            <div className="flex flex-wrap gap-2">
              {offered.map(sv => {
                const c = colorOf(sv.color);
                const on = service?.id === sv.id;
                return (
                  <button key={sv.id} type="button" onClick={() => setServiceId(sv.id)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-sm transition-colors ${on ? "border-primary bg-primary/10 font-medium" : "border-border bg-card hover:bg-accent"}`}>
                    {c && <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />}
                    {sv.name}
                    <span className="text-xs text-muted-foreground">
                      {sv.duration_minutes} min
                      {sv.price != null ? ` · ${fmtMoney(Number(sv.price))}` : ""}
                      {sv.mode === "online" ? L(" · on-line", " · online") : sv.mode === "presencial" ? L(" · presencial", " · in person") : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Card className="p-4 flex gap-3 bg-accent border-accent">
          <Info className="w-5 h-5 text-accent-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-accent-foreground">
            <strong>{L("Estes são os horários livres para os próximos 5 dias.", "These are the free times for the next 5 days.")}</strong> {L("Entre em contato diretamente para reservar.", "Get in touch directly to book.")}
          </p>
        </Card>

        {loading && <p className="text-center text-muted-foreground py-12">{L("Carregando…", "Loading…")}</p>}

        {!loading && slotsByDay.map(({ day, slots }) => (
          <div key={day.toISOString()}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {format(day, L("EEEE, dd 'de' MMMM", "EEEE, MMMM d"), { locale: dateLocale() })}
              </h2>
              {slots.length > 0 && slots.length <= 2 && (
                <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1 animate-pulse">
                  <Flame className="w-3 h-3" /> {slots.length === 1 ? L("Último horário!", "Last slot!") : L("Restam poucos horários!", "Only a few slots left!")}
                </Badge>
              )}
            </div>
            {slots.length === 0 ? (
              <Card className="p-4 text-sm text-muted-foreground text-center">{L("Sem horários livres neste dia.", "No free times on this day.")}</Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {slots.map(s => (
                  <div key={s.start.toISOString()} className="bg-card border border-border rounded-lg p-3 text-center shadow-[var(--shadow-card)]">
                    <Clock className="w-3 h-3 inline mr-1 text-primary" />
                    <span className="font-semibold">{fmtTime(s.start)}</span>
                    <div className="text-[10px] text-muted-foreground">{L("até", "to")} {fmtTime(s.end)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <footer className="text-center text-xs text-muted-foreground pt-8 pb-4">
          <p>{L("Esta página é apenas informativa. Não há agendamento online.", "This page is for information only. There's no online booking here.")}</p>
          <p className="mt-3">
            <a href="https://cronys.com.br/?ref=disponibilidade" target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 hover:underline">
              <CronysMark className="h-3.5 w-3.5" />
              {L("Agenda gerenciada pelo Cronys", "Scheduling managed with Cronys")}
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}

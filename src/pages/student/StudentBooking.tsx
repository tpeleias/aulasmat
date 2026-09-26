import { useEffect, useMemo, useState } from "react";
import { addDays, startOfDay, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useStudent, useAppSettings } from "@/hooks/useStudent";
import { useTeachers } from "@/hooks/useTeachers";
import { computeFreeSlots, padRanges, fmtTime, pickScarcityCandidates, scarcityFor, SCARCITY_DEFAULT } from "@/lib/availability";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { lessonErrorMessage } from "@/lib/lessonErrors";
import { toast } from "sonner";
import { Calendar, Clock, AlertCircle, Flame, Repeat } from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { capitalize, fmtMoney } from "@/lib/balance";
import { useWords } from "@/hooks/useVocabulary";
import { cap } from "@/lib/vocabulary";
import { usePlan } from "@/hooks/usePlan";
import { useServices, teacherDoes } from "@/hooks/useServices";

import { dateLocale, L } from "@/lib/i18n";
// "Qualquer profissional" no seletor (Max): o app escolhe pela prioridade.
const ANY = "__qualquer__";

type Slot = { start: Date; end: Date; teacher: string };

const DAYS_AHEAD = 5;

// A aula que a família quer trocar (?troca=<id>, vindo de "Minhas aulas").
type Original = { id: string; start_at: string; teacher: string; subject: string | null; status: string; is_online: boolean; service_id?: string | null };

export default function StudentBooking() {
  const settings = useAppSettings();
  const w = useWords();
  const ap = w.appointment;
  const st = w.staff;
  const { student } = useStudent();
  const { teachers: allTeachers } = useTeachers(true);
  const { plan } = usePlan();
  const { services, links } = useServices(true);
  // Essencial: um serviço só (o banco não deixa ligar outro); se sobrar mais
  // de um ligado de outro plano, a família vê o primeiro.
  const offered = useMemo(() => (services ?? []).slice(0, plan.services_multi ? undefined : 1), [services, plan.services_multi]);
  const [serviceId, setServiceId] = useState<string>("");
  const service = offered.find(x => x.id === serviceId) ?? null;
  // Só quem faz o serviço escolhido, na ordem de prioridade do admin.
  const teachers = useMemo(
    () => allTeachers.filter(t => teacherDoes(t, service?.id, links, !!plan.teacher_services)),
    [allTeachers, service?.id, links, plan.teacher_services],
  );
  // "Qualquer profissional" só com serviços cadastrados: sem eles, cada um
  // atende uma coisa diferente e "qualquer um" não faz sentido.
  const anyAllowed = !!plan.any_teacher && offered.length > 0 && teachers.length > 1;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const trocaId = params.get("troca");
  const [original, setOriginal] = useState<Original | null>(null);
  // Horas de antecedência que a escola exige; o banco confere de novo no pedido.
  const noticeHours = Number(settings?.min_request_notice_hours ?? 0) || 0;
  const [teacher, setTeacher] = useState<string>("");
  const [slotsByDay, setSlotsByDay] = useState<{ day: Date; slots: Slot[] }[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Horário escolhido esperando confirmação. Antes, um toque já criava a aula.
  const [pending, setPending] = useState<Slot | null>(null);
  // O que a família escreve junto com o pedido. A disciplina é obrigatória: sem
  // ela o professor aprova no escuro. O resto é opcional, mas é o que faz ele
  // chegar preparado em vez de descobrir o assunto na hora.
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (!trocaId) { setOriginal(null); return; }
    supabase.from("lessons").select("*").eq("id", trocaId).maybeSingle()
      .then(({ data }) => {
        const o = data as Original | null;
        setOriginal(o);
        // Na troca, começa pelo mesmo profissional; a família pode mudar.
        if (o?.service_id) setServiceId(o.service_id);
        if (o && allTeachers.some(t => t.name === o.teacher)) setTeacher(o.teacher);
      });
  }, [trocaId, allTeachers]);

  // Começa pelo primeiro serviço. Sem serviços cadastrados, fica como antes.
  useEffect(() => {
    if (!serviceId && offered[0] && !trocaId) setServiceId(offered[0].id);
  }, [offered, serviceId, trocaId]);

  // Profissional que não faz o serviço escolhido sai da seleção.
  useEffect(() => {
    if (teacher === ANY ? !anyAllowed : (teacher && !teachers.some(t => t.name === teacher))) setTeacher("");
    else if (!teacher && teachers[0]) setTeacher(anyAllowed ? ANY : teachers[0].name);
  }, [teachers, teacher, anyAllowed]);

  // Serve de exemplo no campo, não de valor preenchido: quem escreve é a família.
  const teacherSubject = allTeachers.find(t => t.name === teacher)?.subject ?? null;

  // Duração do horário: a do serviço, ou o intervalo padrão da agenda.
  const slotMinutes = service?.duration_minutes ?? settings?.slot_minutes ?? 60;

  // Os horários que um profissional mostra, dia a dia (com a escassez dele).
  const slotsFor = async (name: string, from: Date, to: Date) => {
    if (!settings) return [];
    const [busyR, recR, lessonsR] = await Promise.all([
      supabase.rpc("get_busy_ranges_by_teacher", { _from: from.toISOString(), _to: to.toISOString(), _teacher: name }),
      supabase.rpc("get_recurring_blocks_by_teacher", { _teacher: name }),
      supabase.from("lessons").select("start_at, duration_minutes").eq("teacher", name).gte("start_at", from.toISOString()).lt("start_at", to.toISOString()),
    ]);
    const busyRanges = (busyR.data ?? []).map((r: any) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }));
    const lessonRanges = (lessonsR.data ?? []).map((l: any) => ({
      start: new Date(l.start_at),
      end: new Date(new Date(l.start_at).getTime() + (l.duration_minutes ?? 60) * 60000),
    }));
    // Candidate pool ignores lessons so the scarcity "shop window" stays fixed
    const blocksOnly = busyRanges.filter(b => !lessonRanges.some(l => l.start.getTime() === b.start.getTime() && l.end.getTime() === b.end.getTime()));
    const rec = (recR.data ?? []) as any[];
    const free = computeFreeSlots(from, DAYS_AHEAD, settings.work_start, settings.work_end, slotMinutes, padRanges(busyRanges, ((settings as any)?.buffer_minutes) ?? 0), rec);
    const candidatesPool = computeFreeSlots(from, DAYS_AHEAD, settings.work_start, settings.work_end, slotMinutes, blocksOnly, rec);
    const s: any = settings;
    const now = new Date();
    // Nada que comece antes da antecedência mínima: o banco recusaria o pedido.
    const earliest = new Date(now.getTime() + noticeHours * 3600_000);
    const grouped: { day: Date; slots: Slot[] }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const day = addDays(from, i);
      const sameDay = (d: Date) => d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
      const dayCandidates = candidatesPool.filter(f => sameDay(f.start) && f.end > now).map(f => f.start);
      const freeStartTimes = new Set(free.filter(f => sameDay(f.start) && f.end > now).map(f => f.start.getTime()));
      const { min: minN, max: maxN } = scarcityFor(day, s.scarcity, allTeachers.find(t => t.name === name)?.scarcity);
      const picked = pickScarcityCandidates(day, dayCandidates, name, minN, maxN);
      const visible = picked
        .filter(start => freeStartTimes.has(start.getTime()) && start >= earliest)
        .map(start => ({ start, end: new Date(start.getTime() + slotMinutes * 60000), teacher: name }));
      grouped.push({ day, slots: visible });
    }
    return grouped;
  };

  const load = async () => {
    if (!teacher || !settings) return;
    setLoading(true);
    const from = startOfDay(new Date());
    const to = addDays(from, DAYS_AHEAD);
    if (teacher !== ANY) {
      setSlotsByDay(await slotsFor(teacher, from, to));
      setLoading(false);
      return;
    }
    // Qualquer profissional: junta os horários de todos que fazem o serviço.
    // No mesmo horário, fica quem vem primeiro na prioridade do admin (a
    // ordem da lista de profissionais).
    const all = await Promise.all(teachers.map(t => slotsFor(t.name, from, to)));
    const merged = Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const byStart = new Map<number, Slot>();
      for (const perTeacher of all) {
        for (const sl of perTeacher[i]?.slots ?? []) {
          if (!byStart.has(sl.start.getTime())) byStart.set(sl.start.getTime(), sl);
        }
      }
      return { day: addDays(from, i), slots: [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime()) };
    });
    setSlotsByDay(merged);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [teacher, settings?.work_start, noticeHours, slotMinutes, teachers.length]);

  const request = async () => {
    if (!student || !pending) return;
    // A trava de verdade é o botão desabilitado; isto aqui é a rede, para o
    // caso de alguém chegar por outro caminho.
    if (!subject.trim()) return;
    const start = pending.start;
    const who = pending.teacher;
    setPending(null);
    setBusy(true);
    const { error } = await supabase.from("lessons").insert({
      student_name: student.student_name,
      guardian_name: student.guardian_name,
      // Endereço só acompanha aula presencial; numa online ele não diz nada.
      address: online ? null : student.address,
      subject: subject.trim(),
      start_at: start.toISOString(),
      duration_minutes: slotMinutes,
      // O preço sai do serviço, no banco (gatilho lessons_fill_price).
      ...(service ? { service_id: service.id } : {}),
      // Sem preço aqui de propósito: quem preenche é o banco, com o valor da
      // empresa dona da aula (gatilho lessons_fill_price). Mandar um número
      // daqui seria cravar o preço do professor dentro do portal da família.
      package_type: "single",
      payment_status: "pendente",
      teacher: who,
      // Pedido, não aula. Quem promove para "agendada" é o professor, e o banco
      // não aceita outro status vindo daqui (política students insert own lessons).
      status: "solicitada",
      notes: topic.trim() || null,
      is_online: online,
      // Numa troca, o pedido aponta a aula que sai. Ela só é desmarcada quando
      // o pedido for aprovado (gatilho lessons_apply_reschedule).
      ...(original ? { reschedule_of: original.id } : {}),
    } as never);
    if (error) {
      setBusy(false);
      // 42501: a política recusou - fora da antecedência mínima, ou a aula a
      // trocar já não está marcada.
      toast.error(error.code === "42501"
        ? noticeHours > 0
          ? L(`Pedidos precisam de pelo menos ${noticeHours}h de antecedência. Para algo mais em cima da hora, fale com ${st.o} ${st.l}.`, `Requests need at least ${noticeHours}h notice. For anything sooner, talk to the ${st.l}.`)
          : L(`Não foi possível enviar o pedido. Atualize a tela e tente de novo.`, `Could not send the request. Refresh the page and try again.`)
        : (error.hint ?? "").startsWith("limite_clientes_ativos")
          // Limite de clientes ativos do plano da empresa: assunto dela com a
          // Cronys, não da família.
          ? L(`A agenda não está aceitando pedidos novos agora. Fale com ${st.o} ${st.l}.`, `The schedule isn't taking new requests right now. Please contact the ${st.l}.`)
          : lessonErrorMessage(error, w));
      load();
      return;
    }
    if (original) {
      toast.success(L(`Pedido de troca enviado! ${cap(ap.o)} ${ap.l} de ${format(new Date(original.start_at), "dd/MM 'às' HH:mm")} continua ${ap.pick("marcado", "marcada")} até ${st.o} ${st.l} responder.`,
        `Reschedule request sent! The ${ap.l} on ${format(new Date(original.start_at), "MMM d 'at' HH:mm")} stays booked until the ${st.l} replies.`));
      setBusy(false);
      navigate("/aluno/aulas");
      return;
    }
    toast.success(L(`Pedido enviado! ${cap(st.o)} ${st.l} vai avaliar e você recebe a resposta por aqui.`, `Request sent! The ${st.l} will review it and you'll get the answer here.`));
    // Só libera os botões depois que a lista terminar de recarregar. Antes, o
    // horário recém-pedido continuava na tela por um instante, e um segundo
    // toque nele mandava o mesmo pedido de novo.
    await load();
    setBusy(false);
  };

  if (settings && !settings.allow_student_booking) {
    return <Navigate to="/aluno" replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          {original ? <><Repeat className="w-6 h-6" /> {L("Trocar horário", "Reschedule")}</> : <><Calendar className="w-6 h-6" /> {L(`Solicitar ${ap.l}`, `Request ${ap.um} ${ap.l}`)}</>}
        </h1>
        <p className="text-sm text-muted-foreground">
          {L(`Escolha ${st.o} ${st.l} e um horário livre. O pedido vai para ${st.o} ${st.l} aprovar — ${ap.o} ${ap.l} só entra na agenda depois disso.`,
            `Choose the ${st.l} and a free time. The request goes to the ${st.l} for approval — the ${ap.l} is only booked after that.`)}
          {noticeHours > 0 && L(` Pedidos com pelo menos ${noticeHours}h de antecedência.`, ` Requests need at least ${noticeHours}h notice.`)}
        </p>
      </div>

      {trocaId && original && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-primary/40 p-4 text-sm">
          <div>
            {L(`Trocando ${ap.o} ${ap.l} de `, `Rescheduling the ${ap.l} on `)}<b>{format(new Date(original.start_at), L("EEEE, dd/MM 'às' HH:mm", "EEEE, MMM d 'at' HH:mm"), { locale: dateLocale() })}</b>.
            <p className="text-xs text-muted-foreground">
              {L(`Ela continua ${ap.pick("marcado", "marcada")} até ${st.o} ${st.l} aprovar o horário novo; se recusar, nada muda.`, `It stays booked until the ${st.l} approves the new time; if declined, nothing changes.`)}
            </p>
          </div>
          <Button asChild size="sm" variant="ghost"><Link to="/aluno/agendar">{L(`Pedir ${ap.l} ${ap.pick("novo", "nova")} em vez disso`, `Request a new ${ap.l} instead`)}</Link></Button>
        </Card>
      )}
      {trocaId && !original && (
        <Card className="p-4 text-sm text-muted-foreground">
          {L(`Não encontramos ${ap.o} ${ap.l} a trocar.`, `We couldn't find the ${ap.l} to reschedule.`)} <Link to="/aluno/aulas" className="text-primary">{L("Voltar", "Back")}</Link>
        </Card>
      )}

      {offered.length > 1 && (
        <div className="max-w-xs">
          <label className="text-xs text-muted-foreground">{w.topic.s}</label>
          <Select value={serviceId} onValueChange={setServiceId}>
            <SelectTrigger><SelectValue placeholder={L(`Escolha ${w.topic.o} ${w.topic.l}`, `Choose the ${w.topic.l}`)} /></SelectTrigger>
            <SelectContent>
              {offered.map(sv => (
                <SelectItem key={sv.id} value={sv.id}>
                  {sv.name} · {sv.duration_minutes} min
                  {sv.price != null && settings?.show_payment_info_to_students ? ` · ${fmtMoney(Number(sv.price))}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {teachers.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {L(`${st.nenhum} ${st.l} disponível no momento.`, `No ${st.l} available right now.`)}</Card>
      ) : (
        <>
          <div className="max-w-xs">
            <label className="text-xs text-muted-foreground">{st.s}</label>
            <Select value={teacher} onValueChange={setTeacher}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {anyAllowed && <SelectItem value={ANY}>{L(`Qualquer ${st.l} disponível`, `Any available ${st.l}`)}</SelectItem>}
                {teachers.map(t => <SelectItem key={t.id} value={t.name}>{capitalize(t.name)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {loading && <p className="text-sm text-muted-foreground">{L("Carregando…", "Loading…")}</p>}

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
                <Card className="p-3 text-xs text-muted-foreground">{L("Sem horários livres.", "No free slots.")}</Card>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {slots.map(s => (
                    <Button
                      key={s.start.toISOString()}
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setSubject(service?.name ?? original?.subject ?? "");
                        setTopic("");
                        setOnline(service?.mode === "online" ? true : service?.mode === "presencial" ? false
                          : original ? original.is_online : !student?.address);
                        setPending(s);
                      }}
                      className="flex flex-col h-auto py-2"
                    >
                      <span className="flex items-center gap-1 text-sm font-semibold"><Clock className="w-3 h-3" />{fmtTime(s.start)}</span>
                      <span className="text-[10px] text-muted-foreground">{L("até", "to")} {fmtTime(s.end)}</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <AlertDialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{original ? L("Pedir a troca para este horário?", "Request to move to this time?") : L("Deseja solicitar este horário?", "Request this time?")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {original
                    ? <>{L(`Você vai pedir para trocar ${ap.o} ${ap.l} de ${format(new Date(original.start_at), "dd/MM 'às' HH:mm")} por este horário, com`, `You're asking to move the ${ap.l} on ${format(new Date(original.start_at), "MMM d 'at' HH:mm")} to this time, with`)} <strong>{capitalize(pending?.teacher ?? teacher)}</strong>:</>
                    : <>{L(`Você vai pedir ${ap.um} ${ap.l} com`, `You're requesting ${ap.um} ${ap.l} with`)} <strong>{capitalize(pending?.teacher ?? teacher)}</strong>:</>}
                </p>
                {pending && (
                  <p className="text-foreground font-medium">
                    {format(pending.start, L("EEEE, dd 'de' MMMM", "EEEE, MMMM d"), { locale: dateLocale() })}
                    <br />
                    {L(`das ${fmtTime(pending.start)} às ${fmtTime(pending.end)}`, `from ${fmtTime(pending.start)} to ${fmtTime(pending.end)}`)}
                  </p>
                )}
                <p>
                  {L(`O horário fica reservado enquanto ${st.o} ${st.l} não responde, e ${ap.o} ${ap.l} entra na agenda só depois da aprovação.`,
                    `The time is held while the ${st.l} hasn't replied, and the ${ap.l} is only booked after approval.`)}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            {service ? (
              <p className="text-sm"><span className="text-muted-foreground">{w.topic.s}:</span> <strong>{service.name}</strong> · {service.duration_minutes} min</p>
            ) : (
            <div>
              <Label htmlFor="disciplina">{w.topic.s}</Label>
              <Input
                id="disciplina"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={teacherSubject ? L(`Ex: ${teacherSubject}`, `E.g. ${teacherSubject}`) : w.model === "aulas" ? L("Ex: Matemática", "E.g. Math") : ""}
                autoComplete="off"
              />
            </div>
            )}

            <div>
              <Label htmlFor="assunto">{w.model === "aulas" ? L("O que você quer trabalhar?", "What do you want to work on?") : L("Quer contar algo antes?", "Anything to share beforehand?")} {L("(opcional)", "(optional)")}</Label>
              <Textarea
                id="assunto"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder={w.model === "aulas" ? L("Ex: prova na sexta sobre função quadrática; não entendi limites", "E.g. test on Friday about quadratics; I didn't get limits") : L("Ex: o que você precisa, sintomas, o que quer fazer", "E.g. what you need, symptoms, what you'd like to do")}
                rows={3}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {L(`Ajuda ${st.o} ${st.l} a chegar ${st.pick("preparado", "preparada")}, em vez de descobrir o assunto na hora.`, `Helps the ${st.l} come prepared instead of finding out on the spot.`)}
              </p>
            </div>

            {/* Só faz sentido perguntar a quem tem endereço cadastrado. Sem
                endereço a aula é online e não há escolha a fazer. */}
            {student?.address && (!service || service.mode === "ambos") && (
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="online" className="cursor-pointer">{L(`${ap.s} on-line`, `Online ${ap.l}`)}</Label>
                  <p className="text-xs text-muted-foreground">
                    {L(`Desligado, ${ap.o} ${ap.l} é presencial em ${student.address}.`, `When off, the ${ap.l} is in person at ${student.address}.`)}
                  </p>
                </div>
                <Switch id="online" checked={online} onCheckedChange={setOnline} />
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{L("Cancelar", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={request} disabled={!subject.trim()}>
              {original ? L("Pedir troca", "Request change") : L("Solicitar horário", "Request time")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

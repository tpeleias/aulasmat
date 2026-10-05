// Notificações no celular (05/10), pelo Firebase Cloud Messaging (API v1).
// Ver a migration 20261005020000_push_notifications.sql.
//
//   POST /cron {mode: "outbox"}     <- pg_cron, de minuto em minuto quando há fila
//   POST /cron {mode: "reminders"}  <- pg_cron, de 5 em 5 minutos: os lembretes
//                                      por horário entram na fila e saem juntos
//
// A conta de serviço do Firebase fica no cofre (fcm_service_account), lida
// pela push_secret; o segredo do cron também (push_cron_secret).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Admin = SupabaseClient;
const TZ = "America/Sao_Paulo";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

async function accessToken(sa: ServiceAccount): Promise<string> {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`google token ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token as string;
}

type Note = { title: string; body: string; url: string };

/** "ok", "gone" (o aparelho não existe mais: sai da lista) ou "fail". */
async function sendTo(sa: ServiceAccount, token: string, deviceToken: string, n: Note): Promise<"ok" | "gone" | "fail"> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: n.title.slice(0, 120), body: n.body.slice(0, 300) },
        data: { url: n.url },
        android: { priority: "HIGH", notification: { channel_id: "cronys", icon: "ic_stat_cronys", color: "#C9A24B" } },
      },
    }),
  });
  if (res.ok) return "ok";
  const err = await res.json().catch(() => null);
  const code = String(err?.error?.details?.find?.((d: { errorCode?: string }) => d?.errorCode)?.errorCode ?? err?.error?.status ?? "");
  if (res.status === 404 || code === "UNREGISTERED" || (res.status === 400 && code === "INVALID_ARGUMENT")) return "gone";
  console.error("fcm", res.status, JSON.stringify(err).slice(0, 300));
  return "fail";
}

// ---------------------------------------------------------------------------
// Palavras (as mesmas da função "emails")
// ---------------------------------------------------------------------------
const WORDS: Record<string, { pt: string; pp: string; g: "f" | "m"; en: string }> = {
  aulas: { pt: "Aula", pp: "Aulas", g: "f", en: "Lesson" },
  saude: { pt: "Consulta", pp: "Consultas", g: "f", en: "Appointment" },
  psicologia: { pt: "Sessão", pp: "Sessões", g: "f", en: "Session" },
  beleza: { pt: "Atendimento", pp: "Atendimentos", g: "m", en: "Appointment" },
  pet: { pt: "Atendimento", pp: "Atendimentos", g: "m", en: "Appointment" },
  esportes: { pt: "Treino", pp: "Treinos", g: "m", en: "Session" },
  oficina: { pt: "Atendimento", pp: "Atendimentos", g: "m", en: "Appointment" },
  outro: { pt: "Atendimento", pp: "Atendimentos", g: "m", en: "Appointment" },
};
const TASKS: Record<string, { pt: string; pp?: string; g: "f" | "m"; en: string }> = {
  aulas: { pt: "Tarefa", g: "f", en: "Task" }, saude: { pt: "Orientação", g: "f", en: "Home instruction" },
  psicologia: { pt: "Atividade", g: "f", en: "Exercise" }, beleza: { pt: "Cuidado", g: "m", en: "Aftercare tip" },
  pet: { pt: "Cuidado", g: "m", en: "Home care" }, esportes: { pt: "Treino para casa", g: "m", en: "Home workout" },
  oficina: { pt: "Tarefa", g: "f", en: "Task" }, outro: { pt: "Tarefa", g: "f", en: "Task" },
};

type Account = { id: string; locale: string; business_model: string | null; vocabulary: Record<string, { s?: string; p?: string; g?: string }> | null };
type W = { s: string; l: string; p: string; en: boolean; a: (f: string, m: string) => string };

function wordOf(acc: Account, key: "appointment" | "task"): W {
  const base = (key === "task" ? TASKS : WORDS)[acc.business_model ?? (key === "task" ? "aulas" : "outro")] ?? (key === "task" ? TASKS.aulas : WORDS.outro);
  const custom = acc.vocabulary?.[key];
  const en = acc.locale === "en";
  const s = (custom?.s || (en ? base.en : base.pt)).trim();
  const p = (custom?.p || (en ? `${base.en}s` : base.pp ?? `${base.pt}s`)).trim();
  const g = custom?.g === "f" || custom?.g === "m" ? custom.g : base.g;
  const low = (x: string) => x.toLocaleLowerCase(en ? "en" : "pt-BR");
  return { s, l: low(s), p: low(p), en, a: (f, m) => (g === "f" ? f : m) };
}

function localParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
const localMidnight = (date: string) => new Date(`${date}T00:00:00-03:00`);
const hhmm = (iso: string, en: boolean) => new Date(iso).toLocaleTimeString(en ? "en-US" : "pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: en });
/** "hoje", "amanhã" ou "ter, 07/10". */
function dayText(iso: string, en: boolean) {
  const d = localParts(new Date(iso)).date;
  const today = localParts(new Date()).date;
  const tomorrow = localParts(new Date(Date.now() + 86400000)).date;
  if (d === today) return en ? "today" : "hoje";
  if (d === tomorrow) return en ? "tomorrow" : "amanhã";
  return new Date(iso).toLocaleDateString(en ? "en-US" : "pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
}
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
const displayName = (n: string) => (n && n === n.toLocaleLowerCase("pt-BR") ? n.replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, c: string) => a + c.toLocaleUpperCase("pt-BR")) : n);
const safeLink = (u: unknown) => (typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);

// ---------------------------------------------------------------------------
// Preferências (os padrões: tudo ligado, "começa em" 30 min antes)
// ---------------------------------------------------------------------------
type Prefs = Record<string, unknown>;
const PREF_OF: Record<string, string> = {
  staff_soon: "soon", staff_request: "requests", staff_cancel: "requests", staff_day: "day",
  client_eve: "eve", client_hour: "hour", client_booked: "changes", client_approved: "changes",
  client_declined: "changes", client_cancelled: "changes", client_changed: "changes", client_homework: "homework",
};
const wants = (p: Prefs | undefined, kind: string) => (p?.[PREF_OF[kind]] ?? true) !== false;
const soonMinutes = (p: Prefs | undefined) => ([10, 15, 30, 60].includes(Number(p?.soon_minutes)) ? Number(p!.soon_minutes) : 30);
/** Só os lembretes de atendimento saem de madrugada; o resto espera as 8h. */
const REMINDER = new Set(["staff_soon", "client_eve", "client_hour", "staff_day"]);

// ---------------------------------------------------------------------------
// Os lembretes por horário entram na fila
// ---------------------------------------------------------------------------
type Lesson = { id: string; account_id: string; student_name: string; guardian_name: string | null; teacher: string; start_at: string; duration_minutes: number | null; status: string; is_online: boolean | null; address: string | null; meeting_url: string | null };

async function queueReminders(admin: Admin) {
  const { data: devs } = await admin.from("push_devices").select("user_id");
  const withDevice = new Set((devs ?? []).map(d => d.user_id as string));
  if (!withDevice.size) return 0;
  const { data: pr } = await admin.from("push_prefs").select("user_id, prefs").in("user_id", [...withDevice]);
  const prefs = new Map((pr ?? []).map(p => [p.user_id as string, p.prefs as Prefs]));

  const now = new Date();
  const { date, hour } = localParts(now);
  const rows: Record<string, unknown>[] = [];
  const add = (l: Lesson, user: string, kind: string, extra: Record<string, unknown> = {}) => {
    if (!withDevice.has(user) || !wants(prefs.get(user), kind)) return;
    rows.push({ account_id: l.account_id, user_id: user, kind, ref_id: l.id, data: extra, dedupe: `${kind}:${l.id}:${user}:${l.start_at}` });
  };
  const staffCache = new Map<string, string[]>();
  const staffOf = async (l: Lesson) => {
    const k = `${l.account_id}|${l.teacher}`;
    if (!staffCache.has(k)) {
      const { data } = await admin.rpc("push_staff_users", { _account: l.account_id, _teacher: l.teacher, _admins: false });
      staffCache.set(k, ((data ?? []) as unknown[]).map(x => String(typeof x === "object" && x ? Object.values(x)[0] : x)));
    }
    return staffCache.get(k)!;
  };
  const clientsOf = async (l: Lesson) => {
    const { data } = await admin.rpc("push_client_users", { _account: l.account_id, _student: l.student_name, _guardian: l.guardian_name });
    return (data ?? []) as { user_id: string; child: boolean }[];
  };

  // Daqui a pouco: o profissional (no tempo que ele escolheu) e o cliente (1h antes).
  const { data: soon } = await admin.from("lessons").select("id, account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, is_online, address, meeting_url")
    .eq("status", "agendada").gte("start_at", now.toISOString()).lte("start_at", new Date(now.getTime() + 65 * 60000).toISOString()).limit(1000);
  for (const l of (soon ?? []) as Lesson[]) {
    const mins = (new Date(l.start_at).getTime() - now.getTime()) / 60000;
    for (const u of await staffOf(l)) {
      const m = soonMinutes(prefs.get(u));
      if (mins <= m && mins > m - 10) add(l, u, "staff_soon", { minutes: m });
    }
    if (mins >= 45 && mins <= 62) for (const c of await clientsOf(l)) add(l, c.user_id, "client_hour", { child: c.child });
  }

  // 18h: os de amanhã, para o cliente.
  if (hour === 18) {
    const start = new Date(localMidnight(date).getTime() + 86400000);
    const { data: tomorrow } = await admin.from("lessons").select("id, account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, is_online, address, meeting_url")
      .eq("status", "agendada").gte("start_at", start.toISOString()).lt("start_at", new Date(start.getTime() + 86400000).toISOString()).limit(2000);
    for (const l of (tomorrow ?? []) as Lesson[]) for (const c of await clientsOf(l)) add(l, c.user_id, "client_eve", { child: c.child });
  }

  // 7h: o dia de cada profissional.
  if (hour === 7) {
    const start = localMidnight(date);
    const { data: today } = await admin.from("lessons").select("id, account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, is_online, address, meeting_url")
      .eq("status", "agendada").gte("start_at", now.toISOString()).lt("start_at", new Date(start.getTime() + 86400000).toISOString()).order("start_at").limit(3000);
    const perUser = new Map<string, { account: string; list: Lesson[] }>();
    for (const l of (today ?? []) as Lesson[]) {
      for (const u of await staffOf(l)) {
        const cur = perUser.get(u) ?? { account: l.account_id, list: [] };
        cur.list.push(l);
        perUser.set(u, cur);
      }
    }
    for (const [u, v] of perUser) {
      if (!withDevice.has(u) || !wants(prefs.get(u), "staff_day")) continue;
      const first = v.list[0];
      rows.push({ account_id: v.account, user_id: u, kind: "staff_day", ref_id: first.id,
        data: { count: v.list.length, first_at: first.start_at, first_name: first.student_name }, dedupe: `staff_day:${date}:${u}` });
    }
  }

  if (!rows.length) return 0;
  const { data } = await admin.from("push_outbox").upsert(rows, { onConflict: "dedupe", ignoreDuplicates: true }).select("id");
  return data?.length ?? 0;
}

// ---------------------------------------------------------------------------
// A fila
// ---------------------------------------------------------------------------
type Row = { id: string; account_id: string; user_id: string; kind: string; ref_id: string | null; data: Record<string, unknown> | null; attempts: number };

async function processOutbox(admin: Admin) {
  const { data: rows } = await admin.from("push_outbox").select("id, account_id, user_id, kind, ref_id, data, attempts")
    .is("sent_at", null).lt("attempts", 5).lte("process_after", new Date().toISOString()).order("created_at").limit(300);
  const list = (rows ?? []) as Row[];
  if (!list.length) return 0;

  const raw = await admin.rpc("push_secret", { _name: "fcm_service_account" });
  if (!raw.data) { console.error("push: sem a conta de serviço do Firebase"); return 0; }
  const sa = JSON.parse(String(raw.data)) as ServiceAccount;
  const token = await accessToken(sa);

  const accounts = new Map<string, Account>();
  const accountOf = async (id: string) => {
    if (!accounts.has(id)) {
      const { data } = await admin.from("accounts").select("id, locale, business_model, vocabulary").eq("id", id).maybeSingle();
      accounts.set(id, (data ?? { id, locale: "pt-BR", business_model: null, vocabulary: null }) as Account);
    }
    return accounts.get(id)!;
  };
  const teacherNames = new Map<string, string>();
  const teacherName = async (acc: string, slug: string) => {
    const k = `${acc}|${slug}`;
    if (!teacherNames.has(k)) {
      const { data } = await admin.from("teachers").select("name").eq("account_id", acc);
      const norm = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, "-");
      teacherNames.set(k, displayName((data ?? []).find(t => norm(t.name) === slug)?.name ?? slug));
    }
    return teacherNames.get(k)!;
  };
  const { data: pr } = await admin.from("push_prefs").select("user_id, prefs").in("user_id", [...new Set(list.map(r => r.user_id))]);
  const prefs = new Map((pr ?? []).map(p => [p.user_id as string, p.prefs as Prefs]));

  const done = async (ids: string[], err?: string, retry?: Date) => {
    if (!ids.length) return;
    if (err === undefined) await admin.from("push_outbox").update({ sent_at: new Date().toISOString(), last_error: null }).in("id", ids);
    else for (const id of ids) {
      const r = list.find(x => x.id === id)!;
      await admin.from("push_outbox").update({ attempts: r.attempts + 1, last_error: err.slice(0, 300), process_after: (retry ?? new Date(Date.now() + 5 * 60000)).toISOString() }).eq("id", id);
    }
  };

  // Entre 21h e 8h, o que não é lembrete espera.
  const { hour, date } = localParts(new Date());
  const night = hour >= 21 || hour < 8;
  const morning = hour >= 21 ? new Date(localMidnight(date).getTime() + 32 * 3600000) : new Date(localMidnight(date).getTime() + 8 * 3600000);

  // Vários "marcado" do mesmo cliente de uma vez (uma série): um aviso só.
  const groups = new Map<string, Row[]>();
  for (const r of list) {
    const k = r.kind === "client_booked" ? `${r.user_id}|booked` : r.id;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  let sent = 0;
  for (const g of groups.values()) {
    const r = g[0];
    const ids = g.map(x => x.id);
    try {
      if (!wants(prefs.get(r.user_id), r.kind)) { await done(ids); continue; }
      if (night && !REMINDER.has(r.kind)) {
        await admin.from("push_outbox").update({ process_after: morning.toISOString() }).in("id", ids);
        continue;
      }
      const acc = await accountOf(r.account_id);
      const note = await compose(admin, acc, r, g, teacherName);
      if (!note) { await done(ids); continue; }
      const { data: devices } = await admin.from("push_devices").select("token").eq("user_id", r.user_id);
      let ok = false, failed = false;
      for (const d of devices ?? []) {
        const res = await sendTo(sa, token, d.token, note);
        if (res === "ok") ok = true;
        else if (res === "gone") await admin.from("push_devices").delete().eq("token", d.token);
        else failed = true;
      }
      if (ok || !failed) { await done(ids); if (ok) sent++; }
      else await done(ids, "fcm");
    } catch (e) {
      await done(ids, String(e));
    }
  }
  return sent;
}

/** O texto de cada aviso; nulo = não mandar mais (a aula mudou ou sumiu). */
async function compose(admin: Admin, acc: Account, r: Row, group: Row[], teacherName: (acc: string, slug: string) => Promise<string>): Promise<Note | null> {
  const w = wordOf(acc, "appointment");
  const en = w.en;
  const d = r.data ?? {};

  if (r.kind === "client_homework") {
    const { data: h } = await admin.from("homework").select("title, deadline, status, student_id").eq("id", r.ref_id).maybeSingle();
    if (!h || h.status === "entregue") return null;
    const t = wordOf(acc, "task");
    const { data: child } = await admin.from("students").select("id").eq("id", h.student_id).eq("child_user_id", r.user_id).maybeSingle();
    return {
      title: en ? `New ${t.l}` : `${t.a("Nova", "Novo")} ${t.l}`,
      body: `${h.title} · ${en ? "due" : "prazo"} ${dayText(h.deadline, en)}`,
      url: child ? "/meu-painel/tarefas" : "/aluno/tarefas",
    };
  }

  const { data: l } = await admin.from("lessons").select("id, account_id, student_name, guardian_name, teacher, start_at, duration_minutes, status, is_online, address, meeting_url, reschedule_of")
    .eq("id", r.ref_id).maybeSingle();
  if (!l) return null;
  const when = `${dayText(l.start_at, en)} ${en ? "at" : "às"} ${hhmm(l.start_at, en)}`;
  const where = l.is_online ? (en ? " · online" : " · on-line") : l.address ? ` · ${l.address}` : "";
  const prof = await teacherName(l.account_id, l.teacher);
  const portal = d.child ? "/meu-painel" : "/aluno/aulas";
  const link = l.is_online ? safeLink(l.meeting_url) : null;

  switch (r.kind) {
    case "staff_soon":
      if (l.status !== "agendada") return null;
      return { title: en ? `${w.s} in ${d.minutes} min: ${l.student_name}` : `${w.s} em ${d.minutes} min: ${l.student_name}`,
        body: `${hhmm(l.start_at, en)}${where}${link ? (en ? " · tap to see the link" : " · toque para ver o link") : ""}`, url: "/admin" };
    case "staff_day": {
      const n = Number(d.count) || 1;
      return { title: en ? `Today: ${n} ${n === 1 ? w.l : w.p}` : `Hoje: ${n} ${n === 1 ? w.l : w.p}`,
        body: en ? `First at ${hhmm(String(d.first_at), true)} (${d.first_name})` : `${w.a("A primeira", "O primeiro")} às ${hhmm(String(d.first_at), false)} (${d.first_name})`, url: "/admin" };
    }
    case "staff_request":
      if (l.status !== "solicitada") return null;
      return { title: en ? "New request" : "Pedido novo", body: en ? `${l.student_name} asked for ${when}` : `${l.student_name} pediu ${when}`, url: "/admin/agenda" };
    case "staff_cancel":
      if (l.status !== "cancelada") return null;
      return { title: en ? `${w.s} canceled` : `${w.s} ${w.a("cancelada", "cancelado")}`,
        body: en ? `${l.student_name} canceled ${when}` : `${l.student_name} cancelou ${w.a("a", "o")} ${w.l} de ${when}`, url: "/admin/agenda" };
    case "client_eve":
    case "client_hour":
      if (l.status !== "agendada") return null;
      return {
        title: r.kind === "client_hour" ? (en ? `${w.s} in 1 hour` : `${w.s} daqui a 1 hora`) : (en ? `${w.s} tomorrow at ${hhmm(l.start_at, true)}` : `${w.s} amanhã às ${hhmm(l.start_at, false)}`),
        body: `${en ? "With" : "Com"} ${prof}${where}${link && r.kind === "client_hour" ? (en ? " · tap to join" : " · toque para entrar") : ""}`,
        url: link && r.kind === "client_hour" ? link : portal,
      };
    case "client_booked": {
      const ids = group.map(x => x.ref_id);
      const { data: all } = await admin.from("lessons").select("start_at, status").in("id", ids).eq("status", "agendada").order("start_at");
      if (!all?.length) return null;
      const n = all.length;
      const next = `${dayText(all[0].start_at, en)} ${en ? "at" : "às"} ${hhmm(all[0].start_at, en)}`;
      return n === 1
        ? { title: en ? `${w.s} booked` : `${w.s} ${w.a("marcada", "marcado")}`, body: `${cap(next)} ${en ? "with" : "com"} ${prof}`, url: portal }
        : { title: en ? `${n} ${w.p} booked` : `${n} ${w.p} ${w.a("marcadas", "marcados")}`, body: en ? `Next: ${next}` : `${w.a("A próxima", "O próximo")}: ${next}`, url: portal };
    }
    case "client_approved":
      if (l.status !== "agendada") return null;
      return { title: en ? "Request accepted" : "Pedido aceito", body: `${cap(when)} ${en ? "with" : "com"} ${prof}`, url: portal };
    case "client_declined":
      return { title: en ? "Request not accepted" : "Pedido não aceito", body: en ? `${cap(when)}. Pick another time in the app.` : `${cap(when)}. Escolha outro horário no app.`, url: "/aluno/agendar" };
    case "client_cancelled": {
      if (l.status !== "cancelada") return null;
      // Cancelada porque a troca foi aceita: quem avisa é o "pedido aceito".
      const { data: repl } = await admin.from("lessons").select("id").eq("reschedule_of", l.id).in("status", ["agendada", "solicitada"]).limit(1);
      if (repl?.length) return null;
      return { title: en ? `${w.s} canceled` : `${w.s} ${w.a("cancelada", "cancelado")}`, body: cap(when), url: portal };
    }
    case "client_changed":
      if (l.status !== "agendada") return null;
      return { title: en ? "New time" : "Horário alterado", body: en ? `Now: ${when}` : `Agora: ${when}`, url: portal };
  }
  return null;
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/cron") || req.method !== "POST") return json({ error: "not found" }, 404);
  const { data: secret } = await admin.rpc("push_secret", { _name: "push_cron_secret" });
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({})) as { mode?: string };
  try {
    const queued = body.mode === "reminders" ? await queueReminders(admin) : 0;
    const sent = await processOutbox(admin);
    // O que já saiu há mais de 30 dias não precisa ficar.
    if (body.mode === "reminders") await admin.from("push_outbox").delete().lt("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
    return json({ ok: true, queued, sent });
  } catch (e) {
    console.error("push", String(e));
    return json({ ok: false, error: String(e).slice(0, 200) }, 500);
  }
});

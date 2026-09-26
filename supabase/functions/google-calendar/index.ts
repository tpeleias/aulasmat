// Google Agenda por profissional (Pro e Max). Ver a migration
// 20260926140000_google_calendar.sql para o desenho completo.
//
//   POST {action: "connect", teacher_id, return_to?, tz?}  -> {url} do consentimento do Google
//   GET  /callback?code&state                              <- o Google devolve a pessoa aqui
//   POST {action: "sync", teacher_id?}                      -> sincroniza agora (a tela chama ao abrir)
//   POST {action: "disconnect", teacher_id}                 -> apaga a agenda "Cronys", revoga e esquece
//   POST /cron {mode: "push" | "pull"} + x-cron-secret      <- o pg_cron, pelo pg_net
//
// Permissões pedidas ao Google, as mais estreitas que resolvem:
//   calendar.freebusy        - só os intervalos ocupados (sem título, sem convidado)
//   calendar.app.created     - criar a agenda "Cronys" e mexer só nos eventos dela
//   openid email             - para mostrar qual conta Google está conectada
//
// Precisa dos segredos GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (Supabase ->
// Edge Functions -> Secrets). Sem eles, "connect" responde que não está
// configurado e o resto não faz nada.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Para onde a pessoa volta depois do Google. Só estes: um "voltar para" vindo
// do navegador sem conferência viraria redirecionamento aberto.
const SITES = ["https://cronys.com.br", "https://www.cronys.com.br", "https://cronys.netlify.app", "https://cronys.lovable.app"];
const RETURN_PATH = "/google-agenda";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.app.created",
];
const SCOPE_FREEBUSY = "https://www.googleapis.com/auth/calendar.freebusy";
const SCOPE_APP_CREATED = "https://www.googleapis.com/auth/calendar.app.created";

const DAY = 24 * 60 * 60 * 1000;
/** Janela do ocupado importado: de ontem até 60 dias para frente. */
const IMPORT_BACK = 1 * DAY, IMPORT_AHEAD = 60 * DAY;
/** Janela da exportação: de uma semana atrás até 180 dias para frente. */
const EXPORT_BACK = 7 * DAY, EXPORT_AHEAD = 180 * DAY;
/** Status que não vão para o Google: pedido ainda não aceito e o que foi descartado. */
const NOT_EXPORTED = ["solicitada", "cancelada", "recusada"];

const API = "https://www.googleapis.com/calendar/v3";

type Conn = {
  teacher_id: string;
  account_id: string;
  google_email: string | null;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  export_calendar_id: string | null;
  import_enabled: boolean;
  export_enabled: boolean;
  status: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

function redirect(to: string) {
  return new Response(null, { status: 302, headers: { location: to } });
}

// ---------------------------------------------------------------------------
// Estado assinado (vai e volta pelo Google)
// ---------------------------------------------------------------------------
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("GOOGLE_CLIENT_SECRET")!),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

type State = { t: string; u: string; a: string; r: string; tz: string; exp: number };

async function signState(s: State): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(s)));
  return `${body}.${await hmac(body)}`;
}

async function readState(raw: string | null): Promise<State | null> {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as State;
  return s.exp > Date.now() ? s : null;
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------
class GoogleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// O endereço de volta cadastrado no Google Cloud. Fica no cronys.com.br (o
// public/_redirects do Netlify repassa para cá) porque a verificação do app
// pelo Google exige domínio nosso; supabase.co não é.
function redirectUri() {
  return Deno.env.get("GOOGLE_REDIRECT_URI") ?? "https://cronys.com.br/google-agenda/callback";
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      ...params,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(res.status, String(body?.error ?? res.status));
  return body as { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string };
}

/** Access token válido, renovando pelo refresh token quando precisa. */
async function accessToken(admin: SupabaseClient, c: Conn): Promise<string> {
  if (c.access_token && c.access_expires_at && new Date(c.access_expires_at).getTime() > Date.now() + 60_000) {
    return c.access_token;
  }
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refresh_token });
    const expires = new Date(Date.now() + t.expires_in * 1000).toISOString();
    await admin.from("google_calendar_connections")
      .update({ access_token: t.access_token, access_expires_at: expires, updated_at: new Date().toISOString() })
      .eq("teacher_id", c.teacher_id);
    c.access_token = t.access_token;
    c.access_expires_at = expires;
    return t.access_token;
  } catch (e) {
    // invalid_grant: a pessoa tirou o acesso no Google (ou a senha mudou).
    if (e instanceof GoogleError && e.message === "invalid_grant") {
      await admin.from("google_calendar_connections")
        .update({ status: "revoked", last_error: "O acesso ao Google foi retirado. Conecte de novo.", updated_at: new Date().toISOString() })
        .eq("teacher_id", c.teacher_id);
      await admin.rpc("google_calendar_replace_busy", {
        _teacher: c.teacher_id, _from: new Date(Date.now() - 2 * DAY).toISOString(),
        _to: new Date(Date.now() + 365 * DAY).toISOString(), _ranges: [],
      });
    }
    throw e;
  }
}

async function gfetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new GoogleError(res.status, body?.error?.message ?? `Google ${res.status}`);
  return body;
}

// ---------------------------------------------------------------------------
// Importar: ocupado da agenda principal -> bloqueios
// ---------------------------------------------------------------------------
async function importBusy(admin: SupabaseClient, c: Conn, token: string) {
  const from = new Date(Date.now() - IMPORT_BACK).toISOString();
  const to = new Date(Date.now() + IMPORT_AHEAD).toISOString();
  const fb = await gfetch(token, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from, timeMax: to, items: [{ id: "primary" }] }),
  });
  const cal = fb?.calendars?.primary;
  if (cal?.errors?.length) throw new GoogleError(400, String(cal.errors[0]?.reason ?? "freeBusy"));
  const ranges = (cal?.busy ?? []) as { start: string; end: string }[];
  const { error } = await admin.rpc("google_calendar_replace_busy", { _teacher: c.teacher_id, _from: from, _to: to, _ranges: ranges });
  if (error) throw new Error(error.message);
  await admin.from("google_calendar_connections").update({ last_import_at: new Date().toISOString() }).eq("teacher_id", c.teacher_id);
}

// ---------------------------------------------------------------------------
// Exportar: agendamentos -> agenda "Cronys"
// ---------------------------------------------------------------------------

/** Id do evento no Google: fixo por aula, então repetir a exportação nunca duplica. */
const eventId = (lessonId: string) => "cr" + lessonId.replace(/-/g, "");

async function ensureCalendar(admin: SupabaseClient, c: Conn, token: string, tz: string): Promise<string> {
  if (c.export_calendar_id) return c.export_calendar_id;
  const cal = await gfetch(token, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: "Cronys", description: "Agendamentos do Cronys. Para mudar, use o app.", timeZone: tz }),
  });
  await admin.from("google_calendar_connections").update({ export_calendar_id: cal.id }).eq("teacher_id", c.teacher_id);
  c.export_calendar_id = cal.id;
  return cal.id;
}

type Desired = { id: string; summary: string; description: string; location?: string; start: string; end: string };

async function desiredEvents(admin: SupabaseClient, c: Conn): Promise<Desired[]> {
  if (!c.export_enabled) return [];
  const { data: t } = await admin.from("teachers").select("name").eq("id", c.teacher_id).maybeSingle();
  if (!t) return [];
  const { data: slug } = await admin.rpc("teacher_slug", { _name: t.name });
  const { data: acc } = await admin.from("accounts").select("locale").eq("id", c.account_id).maybeSingle();
  const en = acc?.locale === "en";
  const { data: lessons, error } = await admin.from("lessons")
    .select("id, student_name, subject, start_at, duration_minutes, status, address, is_online, services(name)")
    .eq("account_id", c.account_id)
    .eq("teacher", String(slug))
    .gte("start_at", new Date(Date.now() - EXPORT_BACK).toISOString())
    .lte("start_at", new Date(Date.now() + EXPORT_AHEAD).toISOString())
    .not("status", "in", `(${NOT_EXPORTED.join(",")})`)
    .limit(2000);
  if (error) throw new Error(error.message);
  const note = en
    ? "Booked in Cronys. To change it, use the app - edits made here are undone."
    : "Agendado pelo Cronys. Para mudar, use o app - o que for alterado aqui é desfeito.";
  return (lessons ?? []).map((l: any) => {
    const what = l.services?.name || l.subject || "";
    const start = new Date(l.start_at);
    return {
      id: eventId(l.id),
      summary: what ? `${l.student_name} · ${what}` : l.student_name,
      description: note,
      location: l.is_online ? "Online" : (l.address || undefined),
      start: start.toISOString(),
      end: new Date(start.getTime() + (l.duration_minutes ?? 60) * 60_000).toISOString(),
    };
  });
}

function eventBody(d: Desired) {
  return {
    id: d.id,
    summary: d.summary,
    description: d.description,
    location: d.location ?? "",
    start: { dateTime: d.start },
    end: { dateTime: d.end },
    status: "confirmed",
    extendedProperties: { private: { cronys: "1" } },
  };
}

const sameInstant = (a?: string, b?: string) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

async function exportEvents(admin: SupabaseClient, c: Conn, token: string, tz: string) {
  // Exportação desligada e agenda nunca criada: nada a esvaziar.
  if (!c.export_enabled && !c.export_calendar_id) return;
  let calId = await ensureCalendar(admin, c, token, tz);
  const want = await desiredEvents(admin, c);

  const list = async () => {
    const have = new Map<string, any>();
    let page: string | undefined;
    do {
      const q = new URLSearchParams({
        timeMin: new Date(Date.now() - EXPORT_BACK).toISOString(),
        timeMax: new Date(Date.now() + EXPORT_AHEAD + DAY).toISOString(),
        singleEvents: "true", maxResults: "2500", privateExtendedProperty: "cronys=1",
      });
      if (page) q.set("pageToken", page);
      const r = await gfetch(token, `/calendars/${encodeURIComponent(calId)}/events?${q}`);
      for (const e of r?.items ?? []) have.set(e.id, e);
      page = r?.nextPageToken;
    } while (page);
    return have;
  };

  let have: Map<string, any>;
  try {
    have = await list();
  } catch (e) {
    // A pessoa apagou a agenda "Cronys" no Google: cria de novo.
    if (!(e instanceof GoogleError) || e.status !== 404) throw e;
    await admin.from("google_calendar_connections").update({ export_calendar_id: null }).eq("teacher_id", c.teacher_id);
    c.export_calendar_id = null;
    if (!c.export_enabled) return;
    calId = await ensureCalendar(admin, c, token, tz);
    have = new Map();
  }
  const base = `/calendars/${encodeURIComponent(calId)}/events`;

  for (const d of want) {
    const e = have.get(d.id);
    have.delete(d.id);
    if (e && e.summary === d.summary && (e.description ?? "") === d.description && (e.location ?? "") === (d.location ?? "")
        && sameInstant(e.start?.dateTime, d.start) && sameInstant(e.end?.dateTime, d.end)) continue;
    if (e) {
      await gfetch(token, `${base}/${d.id}`, { method: "PUT", body: JSON.stringify(eventBody(d)) });
      continue;
    }
    try {
      await gfetch(token, base, { method: "POST", body: JSON.stringify(eventBody(d)) });
    } catch (err) {
      // 409: o id já existiu (evento apagado antes). Atualizar o traz de volta.
      if (!(err instanceof GoogleError) || err.status !== 409) throw err;
      await gfetch(token, `${base}/${d.id}`, { method: "PUT", body: JSON.stringify(eventBody(d)) });
    }
  }
  // O que sobrou é aula cancelada, apagada, trocada de profissional (ou exportação desligada).
  for (const id of have.keys()) {
    try {
      await gfetch(token, `${base}/${id}`, { method: "DELETE" });
    } catch (err) {
      if (!(err instanceof GoogleError) || (err.status !== 404 && err.status !== 410)) throw err;
    }
  }
  await admin.from("google_calendar_connections").update({ last_export_at: new Date().toISOString() }).eq("teacher_id", c.teacher_id);
}

// ---------------------------------------------------------------------------
// Uma passada por profissional
// ---------------------------------------------------------------------------
async function syncOne(admin: SupabaseClient, teacherId: string, opts: { importBusy: boolean; exportEvents: boolean; tz?: string }) {
  const { data: c } = await admin.from("google_calendar_connections").select("*").eq("teacher_id", teacherId).maybeSingle();
  if (!c || c.status === "revoked") return;
  const conn = c as Conn;
  const { data: allowed } = await admin.rpc("account_can", { _capability: "google_calendar", _account: conn.account_id });
  if (allowed !== true) {
    // Saiu do Pro/Max: o ocupado importado deixa de valer (a conexão fica, para quando voltar).
    await admin.rpc("google_calendar_replace_busy", {
      _teacher: teacherId, _from: new Date(Date.now() - 2 * DAY).toISOString(),
      _to: new Date(Date.now() + 365 * DAY).toISOString(), _ranges: [],
    });
    return;
  }
  try {
    const token = await accessToken(admin, conn);
    if (opts.importBusy && conn.import_enabled) await importBusy(admin, conn, token);
    if (opts.exportEvents) await exportEvents(admin, conn, token, opts.tz ?? "America/Sao_Paulo");
    if (conn.status !== "ok") {
      await admin.from("google_calendar_connections").update({ status: "ok", last_error: null }).eq("teacher_id", teacherId);
    }
  } catch (e) {
    // 403: a pessoa desmarcou uma das caixas na tela do Google.
    const msg = e instanceof GoogleError && e.status === 403
      ? "O Google não deu essa permissão. Desconecte e conecte de novo, marcando as duas caixas."
      : e instanceof Error ? e.message : String(e);
    console.error("google-calendar sync", teacherId, e instanceof Error ? e.message : e);
    await admin.from("google_calendar_connections")
      .update({ status: conn.status === "revoked" || msg === "invalid_grant" ? "revoked" : "error", last_error: msg.slice(0, 300) })
      .eq("teacher_id", teacherId);
  }
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const configured = !!Deno.env.get("GOOGLE_CLIENT_ID") && !!Deno.env.get("GOOGLE_CLIENT_SECRET");

  try {
    // --- volta do Google --------------------------------------------------
    if (url.pathname.endsWith("/callback")) {
      const state = configured ? await readState(url.searchParams.get("state")) : null;
      const back = (status: string) => redirect(`${state?.r ?? SITES[0] + RETURN_PATH}?status=${status}`);
      if (!state) return back("invalido");
      const code = url.searchParams.get("code");
      if (!code) return back(url.searchParams.get("error") === "access_denied" ? "negado" : "erro");

      const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }).catch(e => {
        console.error("google-calendar callback", e);
        return null;
      });
      if (!t?.refresh_token) return back("erro");
      const granted = new Set((t.scope ?? "").split(" "));
      let email: string | null = null;
      if (t.id_token) {
        try { email = JSON.parse(new TextDecoder().decode(fromB64url(t.id_token.split(".")[1]))).email ?? null; } catch { /* sem e-mail */ }
      }
      // Reconectar a mesma conta mantém a agenda "Cronys"; outra conta começa do zero.
      const { data: old } = await admin.from("google_calendar_connections").select("google_email, export_calendar_id").eq("teacher_id", state.t).maybeSingle();
      const { error } = await admin.from("google_calendar_connections").upsert({
        teacher_id: state.t,
        account_id: state.a,
        google_email: email,
        refresh_token: t.refresh_token,
        access_token: t.access_token,
        access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        export_calendar_id: old && old.google_email === email ? old.export_calendar_id : null,
        // Na tela do Google a pessoa pode desmarcar uma das permissões.
        import_enabled: granted.has(SCOPE_FREEBUSY),
        export_enabled: granted.has(SCOPE_APP_CREATED),
        status: "ok",
        last_error: null,
        connected_by: state.u,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error("google-calendar callback", error.message);
        return back("erro");
      }
      // Erro na primeira passada fica anotado na conexão (a tela mostra); a conexão vale.
      await syncOne(admin, state.t, { importBusy: true, exportEvents: true, tz: state.tz });
      return back("ok");
    }

    // --- pg_cron ------------------------------------------------------------
    if (url.pathname.endsWith("/cron")) {
      const { data: secret } = await admin.rpc("google_calendar_cron_secret");
      if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
      if (!configured) return json({ skipped: "not configured" });
      const { mode } = await req.json().catch(() => ({ mode: "push" }));
      const deadline = Date.now() + 50_000;
      let done = 0;
      if (mode === "pull") {
        const { data: conns } = await admin.from("google_calendar_connections").select("teacher_id").neq("status", "revoked");
        for (const c of conns ?? []) {
          if (Date.now() > deadline) break;
          await admin.from("google_sync_queue").delete().eq("teacher_id", c.teacher_id);
          await syncOne(admin, c.teacher_id, { importBusy: true, exportEvents: true });
          done++;
        }
      } else {
        const { data: queue } = await admin.from("google_sync_queue").select("teacher_id").order("queued_at").limit(50);
        for (const q of queue ?? []) {
          if (Date.now() > deadline) break;
          // Sai da fila ANTES: o que mudar durante a passada entra de novo.
          await admin.from("google_sync_queue").delete().eq("teacher_id", q.teacher_id);
          await syncOne(admin, q.teacher_id, { importBusy: false, exportEvents: true });
          done++;
        }
      }
      return json({ mode, done });
    }

    // --- chamadas da tela ---------------------------------------------------
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const teacherId = body?.teacher_id ? String(body.teacher_id) : null;

    const canManage = async (id: string) => (await userClient.rpc("google_calendar_can_manage", { _teacher: id })).data === true;

    if (action === "sync") {
      if (!configured) return json({ skipped: true });
      const { data: rows } = await userClient.rpc("google_calendar_status");
      const ids = ((rows ?? []) as { teacher_id: string; connected: boolean; last_import_at: string | null }[])
        .filter(r => r.connected && (!teacherId || r.teacher_id === teacherId))
        // Quem abre a tela várias vezes seguidas não martela o Google (um
        // profissional pedido pelo nome - depois de mexer no switch - passa).
        .filter(r => !!teacherId || !r.last_import_at || Date.now() - new Date(r.last_import_at).getTime() > 2 * 60_000)
        .map(r => r.teacher_id);
      for (const id of ids.slice(0, 10)) await syncOne(admin, id, { importBusy: true, exportEvents: true });
      return json({ synced: ids.length });
    }

    if (!teacherId || !(await canManage(teacherId))) return json({ error: "forbidden" }, 403);

    if (action === "connect") {
      if (!configured) return json({ error: "O Google Agenda ainda não foi configurado no Cronys." }, 503);
      const { data: allowed } = await userClient.rpc("account_can", { _capability: "google_calendar" });
      if (allowed !== true) return json({ error: "O Google Agenda faz parte do Pro e do Max.", hint: "plano:google_calendar" }, 402);
      const { data: t } = await admin.from("teachers").select("account_id").eq("id", teacherId).maybeSingle();
      const origin = String(body?.return_to ?? "");
      const site = SITES.includes(origin) ? origin : (Deno.env.get("PUBLIC_SITE_URL") ?? SITES[0]);
      const state = await signState({
        t: teacherId, u: user.id, a: t!.account_id, r: site + RETURN_PATH,
        tz: typeof body?.tz === "string" && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(body.tz) ? body.tz : "America/Sao_Paulo",
        exp: Date.now() + 15 * 60_000,
      });
      const q = new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
      });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
    }

    if (action === "disconnect") {
      const { data: c } = await admin.from("google_calendar_connections").select("*").eq("teacher_id", teacherId).maybeSingle();
      if (c && configured) {
        try {
          const token = await accessToken(admin, c as Conn);
          // Apagar a agenda "Cronys" leva todos os agendamentos exportados de uma vez.
          if (c.export_calendar_id) await gfetch(token, `/calendars/${encodeURIComponent(c.export_calendar_id)}`, { method: "DELETE" }).catch(() => null);
        } catch { /* já sem acesso: não há o que apagar lá */ }
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refresh_token)}`, { method: "POST" }).catch(() => null);
      }
      await admin.rpc("google_calendar_forget", { _teacher: teacherId });
      return json({ ok: true });
    }

    return json({ error: "ação desconhecida" }, 400);
  } catch (e) {
    console.error("google-calendar", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

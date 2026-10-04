import * as Sentry from "@sentry/react";
import { Capacitor } from "@capacitor/core";

/**
 * Erros do site e do app no Sentry (04/10). Só nas versões publicadas: em
 * desenvolvimento e nos testes fica desligado.
 *
 * Nada de dado pessoal: sem IP, sem cookies, sem o corpo das requisições, e
 * e-mails, telefones, CPFs e tokens saem trocados por [removido] antes do
 * envio. O usuário vai só pelo id (uuid), para juntar os erros da mesma pessoa.
 */
const DSN = "https://3b9d5042be140706ceb4b6f5d9fb9ef3@o4512199379845120.ingest.us.sentry.io/4512199397998592";

const PATTERNS: RegExp[] = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,                 // e-mail
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g,                               // JWT
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,                        // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,                // CNPJ
  /(\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,         // telefone
];
// Tokens na URL (?access_token=..., #refresh_token=...): fica o nome, sai o valor.
const URL_TOKEN = /([?&#](?:access_token|refresh_token|token|code|apikey|key)=)[^&#\s]+/gi;

export function scrub(text: string): string {
  let out = text.replace(URL_TOKEN, "$1[removido]");
  for (const re of PATTERNS) out = out.replace(re, "[removido]");
  return out;
}

// Ids do próprio Sentry e o endereço dos arquivos: não têm dado pessoal e
// não podem ser alterados.
const KEEP = new Set(["event_id", "trace_id", "span_id", "parent_span_id", "release", "dist", "debug_meta", "sdk", "filename", "abs_path", "module"]);

function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 6 || value == null) return value;
  if (typeof value === "string") return scrub(value) as T;
  if (Array.isArray(value)) return value.map(v => scrubDeep(v, depth + 1)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = KEEP.has(k) ? v : scrubDeep(v, depth + 1);
    return out as T;
  }
  return value;
}

export function scrubEvent<E extends Sentry.ErrorEvent>(event: E): E {
  delete event.request?.cookies;
  delete event.request?.data;
  if (event.request?.headers) event.request.headers = {};
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  event.server_name = undefined;
  return scrubDeep(event);
}

let started = false;

export function startMonitoring() {
  if (!import.meta.env.PROD || import.meta.env.MODE === "test" || started) return;
  started = true;
  const native = Capacitor.isNativePlatform();
  Sentry.init({
    dsn: DSN,
    release: `cronys@${__APP_VERSION__ !== "web" ? __APP_VERSION__ : __BUILD_SHA__.slice(0, 7)}`,
    environment: native ? "android" : "web",
    sendDefaultPii: false,
    // Só os erros: sem gravação de tela e sem medir desempenho.
    tracesSampleRate: 0,
    integrations: integrations => integrations.filter(i => i.name !== "BrowserSession"),
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
      /Failed to fetch dynamically imported module/,
      /Importing a module script failed/,
      /Load failed/,
      /NetworkError when attempting to fetch resource/,
    ],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-web-extension:\/\//],
    beforeSend: event => scrubEvent(event),
    beforeBreadcrumb: crumb => {
      // Cliques e campos dizem o texto da tela (nomes de clientes); fica só a navegação e os erros.
      if (crumb.category === "ui.click" || crumb.category === "ui.input") return null;
      return scrubDeep(crumb);
    },
  });
  Sentry.setTag("distribution", __DISTRIBUTION__);
}

/** Liga o erro ao id de quem está logado (sem e-mail nem nome). */
export function setMonitoringUser(id: string | null) {
  if (!started) return;
  Sentry.setUser(id ? { id } : null);
}

// Abre o app de verdade com a empresa-modelo e fotografa as telas.
import { chromium } from "playwright-core";
import { tables, rpcs, session } from "./mock.mjs";

const APP = "http://127.0.0.1:5174";
const OUT = process.argv[2] ?? "/tmp/claude-0/shots/raw";
const only = process.argv[3];

function applyFilters(rows, params) {
  let out = [...rows];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "or", "and"].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|in|is|ilike|like)\.(.*)$/s.exec(v);
    if (!m) continue;
    const [, not, op, raw] = m;
    const test = (val) => {
      const s = val == null ? null : String(val);
      switch (op) {
        case "eq": return s === raw;
        case "neq": return s !== raw;
        case "gt": return s > raw;
        case "gte": return s >= raw;
        case "lt": return s < raw;
        case "lte": return s <= raw;
        case "in": return raw.replace(/^\(|\)$/g, "").split(",").map(x => x.replace(/^"|"$/g, "")).includes(s);
        case "is": return raw === "null" ? val == null : String(val) === raw;
        case "ilike": case "like": {
          const re = new RegExp("^" + raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*") + "$", "i");
          return s != null && re.test(s);
        }
      }
      return true;
    };
    // Datas: compara como instante, não como texto.
    const cmp = (val) => {
      if (["gt", "gte", "lt", "lte"].includes(op) && /^\d{4}-\d\d-\d\d/.test(raw)) {
        const a = new Date(val).getTime(), b = new Date(raw).getTime();
        return op === "gt" ? a > b : op === "gte" ? a >= b : op === "lt" ? a < b : a <= b;
      }
      return test(val);
    };
    out = out.filter(r => (not ? !cmp(r[k]) : cmp(r[k])));
  }
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(",")[0].split(".");
    out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
  }
  const limit = params.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

async function mockBackend(context) {
  await context.route(/supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...headers }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (p.startsWith("/auth/v1/user")) return json(session.user);
    if (p.startsWith("/auth/v1/token")) return json(session);
    if (p.startsWith("/auth/v1/")) return json({});
    if (p.startsWith("/functions/v1/")) return json({ reply: "", messages: [] });
    if (p.startsWith("/rest/v1/rpc/")) {
      const name = p.split("/").pop();
      return json(name in rpcs ? rpcs[name] : null);
    }
    if (p.startsWith("/rest/v1/")) {
      const table = p.split("/").pop();
      const rows = applyFilters(tables[table] ?? [], url.searchParams);
      const headers = { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` };
      if (req.method() === "HEAD") return route.fulfill({ status: 200, headers: { ...headers, "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" } });
      if (req.method() !== "GET") return json(rows[0] ?? {}, 201);
      const accept = req.headers()["accept"] ?? "";
      if (accept.includes("vnd.pgrst.object")) return json(rows[0] ?? null, 200, headers);
      return json(rows, 200, headers);
    }
    return json({});
  });
  // Sem internet externa nas fotos (verificação de atualização etc.).
  await context.route(/api\.github\.com|realtime/, r => r.abort());
}

const shots = [
  { name: "inicio", path: "/admin" },
  { name: "agenda", path: "/admin/agenda" },
  { name: "clientes", path: "/admin/alunos" },
  { name: "financeiro", path: "/admin/financeiro" },
  { name: "cobranca", path: "/admin/financeiro", action: "scroll", y: 830 },
  { name: "assistente", path: "/admin/assistente" },
  { name: "aula", path: "/admin/agenda", action: "openLesson" },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--lang=pt-BR"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: "pt-BR", timezoneId: "America/Sao_Paulo",
  isMobile: true, hasTouch: true, colorScheme: "light",
});
await context.addInitScript(({ s }) => {
  localStorage.setItem("sb-dqfzuviwejlobrwebyum-auth-token", JSON.stringify(s));
  sessionStorage.setItem("assistant_chat_messages", JSON.stringify([
    { role: "user", content: [{ type: "text", text: "Marca uma aula do Lucas quinta às 15h" }] },
    { role: "assistant", content: [{ type: "text", text: "Encontrei o **Lucas Almeida** (resp.: Carla Almeida). Vou marcar:\n\n- **Quinta, 01/10, às 15:00**\n- Matemática com a Ana · 60 min\n- R$ 150,00\n- Rua das Acácias, 120 - Pinheiros\n\nPosso confirmar?" }] },
    { role: "user", content: [{ type: "text", text: "Pode" }] },
    { role: "assistant", content: [{ type: "text", text: "Pronto! Aula do Lucas marcada para **quinta, 01/10, às 15:00**. ✅" }] },
    { role: "user", content: [{ type: "text", text: "Quem ainda não pagou este mês?" }] },
    { role: "assistant", content: [{ type: "text", text: "Estão em aberto:\n\n- **Renata Souza** (Beatriz): R$ 150,00\n- **Paula Rocha** (Gabriel): R$ 150,00\n- **Tatiana Ribeiro** (Laura): R$ 150,00\n- **Ricardo Lima** (Sofia): R$ 150,00\n\nTotal: **R$ 600,00**." }] },
  ]));
  localStorage.setItem("cronys.vocabulary", JSON.stringify({ business_model: "aulas", custom: null, custom_saved: true }));
}, { s: session });
await mockBackend(context);

const page = await context.newPage();
page.on("pageerror", e => console.log("pageerror:", e.message));
for (const s of shots) {
  if (only && s.name !== only) continue;
  await page.goto(APP + s.path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (s.action === "openLesson") {
    const el = page.getByText("Lucas Almeida").first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const box = await el.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(1500);
  }
  if (s.action === "scroll") {
    await page.evaluate(y => window.scrollTo(0, y), s.y);
    await page.waitForTimeout(800);
  }
  if (s.full) {
    await page.screenshot({ path: `${OUT}/${s.name}-full.png`, fullPage: true });
  }
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  console.log("ok", s.name);
}
await browser.close();

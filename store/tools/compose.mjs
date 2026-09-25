// Monta as imagens da loja: moldura + frase + print real do app.
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";

const RAW = "/tmp/claude-0/shots/raw";
const OUT = process.argv[2] ?? "/tmp/claude-0/shots/store";
mkdirSync(OUT, { recursive: true });
const FONTS = "/home/user/aulasmat/public/fonts";
const font = f => `data:font/woff2;base64,${readFileSync(`${FONTS}/${f}`).toString("base64")}`;
const img = n => `data:image/png;base64,${readFileSync(`${RAW}/${n}.png`).toString("base64")}`;
const mark = readFileSync("/home/user/aulasmat/public/cronys-simbolo.svg", "utf8");

const css = `
@font-face { font-family: Fraunces; src: url(${font("fraunces-latin-var.woff2")}); font-weight: 100 900; }
@font-face { font-family: Work; src: url(${font("work-sans-latin-var.woff2")}); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { background: #151823; }
.gold { color: #c9a24b; }
.phone { border-radius: 64px; padding: 14px; background: #0c0e14;
  box-shadow: 0 40px 90px rgba(0,0,0,.55), 0 0 0 2px rgba(201,162,75,.35); }
.phone img { display: block; width: 100%; border-radius: 50px; }
`;

const screens = [
  ["inicio", "Seu dia inteiro <span class=gold>numa tela</span>", "Aulas de hoje, pedidos das famílias e o financeiro do mês."],
  ["aula", "Avise pelo WhatsApp <span class=gold>com um toque</span>", "Lembrete da aula e “estou a caminho” com a localização."],
  ["agenda", "A agenda da <span class=gold>equipe toda</span>", "Cada profissional com a sua; você enxerga todas."],
  ["clientes", "Saiba quem está <span class=gold>em dia</span>", "Clientes, responsáveis e o que falta receber."],
  ["cobranca", "Cobrança <span class=gold>sem planilha</span>", "Registre o Pix e o app quita as aulas sozinho."],
  ["assistente", "Marque <span class=gold>conversando</span>", "O assistente agenda, remarca e consulta o financeiro."],
  ["financeiro", "O mês fechado <span class=gold>em números</span>", "Recebido, a receber e aulas por profissional."],
];

const shot = (name, title, sub) => `<!doctype html><html><head><style>${css}
body { width: 1080px; height: 1920px; overflow: hidden; position: relative;
  background: radial-gradient(900px 700px at 50% 30%, #262a3a 0%, #151823 70%); }
.head { position: absolute; top: 110px; left: 80px; right: 80px; text-align: center; color: #f5f0e6; }
.head h1 { font-family: Fraunces; font-weight: 600; font-size: 78px; line-height: 1.08; letter-spacing: -1px; }
.head p { font-family: Work; font-size: 36px; line-height: 1.35; color: #b9b6c3; margin-top: 26px; }
.phone { position: absolute; left: 50%; transform: translateX(-50%); top: 470px; width: 676px; }
</style></head><body>
<div class="head"><h1>${title}</h1><p>${sub}</p></div>
<div class="phone"><img src="${img(name)}"></div>
</body></html>`;

const feature = () => `<!doctype html><html><head><style>${css}
body { width: 1024px; height: 500px; overflow: hidden; position: relative;
  background: radial-gradient(700px 500px at 75% 40%, #2a2e3f 0%, #151823 70%); }
.brand { position: absolute; left: 64px; top: 92px; display: flex; align-items: center; gap: 14px; }
.brand svg { width: 74px; height: 74px; }
.brand span { font-family: Fraunces; font-weight: 500; font-size: 72px; color: #f5f0e6; letter-spacing: -1px; }
h1 { position: absolute; left: 66px; top: 210px; width: 470px; font-family: Fraunces; font-weight: 600;
  font-size: 46px; line-height: 1.12; color: #f5f0e6; }
p { position: absolute; left: 68px; top: 385px; width: 450px; font-family: Work; font-size: 21px; color: #b9b6c3; line-height: 1.4; }
.p1, .p2 { position: absolute; width: 230px; padding: 7px; border-radius: 34px; }
.p1 img, .p2 img { border-radius: 27px; }
.p1 { left: 575px; top: 70px; transform: rotate(-6deg); }
.p2 { left: 770px; top: 40px; transform: rotate(5deg); }
</style></head><body>
<div class="brand">${mark}<span>Cronys</span></div>
<h1>Agenda, clientes e cobrança <span class=gold>num só lugar</span></h1>
<p>Para aulas particulares, clínicas, estúdios e quem atende com hora marcada.</p>
<div class="phone p1"><img src="${img("inicio")}"></div>
<div class="phone p2"><img src="${img("aula")}"></div>
</body></html>`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
let i = 0;
for (const [name, title, sub] of screens) {
  i++;
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.setContent(shot(name, title, sub), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/phone-${i}-${name}.png` });
}
await page.setViewportSize({ width: 1024, height: 500 });
await page.setContent(feature(), { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${OUT}/feature-graphic.png` });
await browser.close();
console.log("ok");

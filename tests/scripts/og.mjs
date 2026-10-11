// Картинки-прев'ю для посилань (Open Graph, 1200×630): панель викладача, гра наживо, тест.
// Їх показують Telegram, Viber, Facebook, Slack тощо, коли надсилають посилання на сайт.
//   cd tests && npm run og
// Після зміни картинок підняти ?v= в og:image / twitter:image у HTML.
import fs from "node:fs";
import { chromium } from "@playwright/test";

const OUT = new URL("../../assets/og/", import.meta.url);

// Знаки — як в іконках (tests/scripts/icons.mjs), сітка 24×24
const FLOW = `<g fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11a4 4 0 0 1 4 4v1"/><path d="M20 17H9a4 4 0 0 1-4-4v-1"/></g><circle cx="5" cy="7" r="1.6" fill="#fff"/><circle cx="19" cy="17" r="1.6" fill="#fff"/>`;
const BOLT = `<path d="M13.2 2.5L4 14h7l-1.2 7.5L20 10h-7l.2-7.5z" fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`;
const Q = `<g fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round"><circle cx="11.5" cy="11.5" r="7"/><path d="M15.5 15.5l4.5 4.5"/></g>`;

const CARDS = {
  teacher: {
    glyph: FLOW, tile: ["#6E9BFF", "#3B6BF6", "#2447C9"], bg: ["#0A1030", "#14215C", "#1E3A8A"], glow: "rgba(91,140,255,.35)",
    badge: "Для викладачів", title: "Тести, журнал і ігри наживо", sub: "Надсилайте тести посиланням, бачте оцінки одразу й проводьте вікторини для всього класу",
  },
  game: {
    glyph: BOLT, tile: ["#8B7FFF", "#5B4FE8", "#4A3FD1"], bg: ["#120B3A", "#2A1D7A", "#4A3FD1"], glow: "rgba(167,139,250,.38)",
    badge: "Гра наживо", title: "Приєднуйтесь до гри", sub: "Відкрийте посилання з телефона або введіть код з екрана — і відповідайте швидше за всіх",
  },
  test: {
    glyph: Q, tile: ["#5B8CFF", "#3B6BF6", "#1E40AF"], bg: ["#0B1437", "#152A6E", "#2447C9"], glow: "rgba(96,165,250,.35)",
    badge: "Тест", title: "Вас запрошено пройти тест", sub: "Відкрийте посилання, вкажіть прізвище та ім'я — і проходьте в браузері, без реєстрації",
  },
};

// Шрифти лежать поруч (tests/scripts/fonts, ліцензія SIL OFL) — генерація не залежить від мережі
const font = f => fs.readFileSync(new URL(`fonts/${f}.woff2`, import.meta.url)).toString("base64");
const FONTS = [
  ["Manrope", "600 800", "manrope-cyrillic", "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"],
  ["Manrope", "600 800", "manrope-latin", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
  ["Geist Mono", "600", "geistmono-latin", "U+0000-00FF"],
].map(([fam, w, file, range]) => `@font-face{font-family:"${fam}";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${font(file)}) format("woff2");unicode-range:${range}}`).join("");

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const svg = (glyph, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${glyph}</svg>`;

function html(c) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;font-family:Manrope,sans-serif;color:#fff;-webkit-font-smoothing:antialiased;
  background:radial-gradient(70% 90% at 100% 0%,${c.glow} 0%,transparent 60%),radial-gradient(60% 70% at 0% 100%,rgba(20,212,180,.14) 0%,transparent 60%),linear-gradient(135deg,${c.bg[0]} 0%,${c.bg[1]} 55%,${c.bg[2]} 100%)}
.ring{position:absolute;border-radius:50%;border:56px solid rgba(255,255,255,.05)}
.mark{position:absolute;right:70px;top:120px;opacity:.10}
.wrap{position:absolute;inset:0;padding:64px 72px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:18px}
.tile{width:76px;height:76px;border-radius:22px;display:grid;place-items:center;background:linear-gradient(140deg,${c.tile[0]},${c.tile[1]} 50%,${c.tile[2]});box-shadow:0 18px 40px -16px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.35)}
.word{font-weight:800;font-size:40px;letter-spacing:-.02em}
.word em{font-style:normal;background:linear-gradient(90deg,#A5C1FF,#6EE7D8);-webkit-background-clip:text;background-clip:text;color:transparent}
.badge{margin-left:8px;display:inline-flex;align-items:center;gap:10px;padding:9px 18px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);font-weight:700;font-size:22px}
.badge::before{content:"";width:10px;height:10px;border-radius:50%;background:#6EE7D8;box-shadow:0 0 12px rgba(110,231,216,.9)}
h1{margin-top:auto;font-weight:800;font-size:72px;line-height:1.05;letter-spacing:-.03em;max-width:880px}
p{margin-top:22px;font-weight:600;font-size:29px;line-height:1.4;color:rgba(255,255,255,.78);max-width:860px}
.foot{margin-top:40px;font:600 24px "Geist Mono",monospace;color:rgba(255,255,255,.6);letter-spacing:.02em}
</style></head><body>
<div class="ring" style="width:520px;height:520px;right:-140px;bottom:-220px"></div>
<div class="ring" style="width:300px;height:300px;right:200px;top:-170px;border-width:40px"></div>
<div class="mark">${svg(c.glyph, 380)}</div>
<div class="wrap">
  <div class="brand"><div class="tile">${svg(c.glyph, 44)}</div><div class="word">quiz<em>flow</em></div><span class="badge">${esc(c.badge)}</span></div>
  <h1>${esc(c.title)}</h1>
  <p>${esc(c.sub)}</p>
  <div class="foot">quizflow.space</div>
</div>
</body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [id, c] of Object.entries(CARDS)) {
  await page.setContent(html(c), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Без фірмового шрифту картинка виходить чужою — краще впасти, ніж зберегти таку
  const loaded = await page.evaluate(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family.replace(/"/g, "")));
  for (const fam of ["Manrope", "Geist Mono"]) if (!loaded.includes(fam)) throw new Error(`Шрифт ${fam} не завантажився`);
  await page.screenshot({ path: new URL(`${id}.jpg`, OUT).pathname, type: "jpeg", quality: 88 });
  console.log(`assets/og/${id}.jpg: готово`);
}
await browser.close();

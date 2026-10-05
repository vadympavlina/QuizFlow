// Іконки сайту: favicon.ico, icon.svg, PNG і site.webmanifest для чотирьох частин —
// панель викладача, адмінка, ігри наживо, тест студента. Малює Chromium з Playwright.
//   cd tests && npm run icons
// Після зміни іконок підняти ?v= у посиланнях на них (усі HTML).
import fs from "node:fs";
import { chromium } from "@playwright/test";

const ROOT = new URL("../../", import.meta.url);
const OUT = new URL("assets/icons/", ROOT);

// Знак quizflow (як у боковому меню), блискавка (бренд «live»), «Q» (шапка тесту) — у сітці 24×24
const FLOW = `<g fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11a4 4 0 0 1 4 4v1"/><path d="M20 17H9a4 4 0 0 1-4-4v-1"/></g><circle cx="5" cy="7" r="1.6" fill="#fff"/><circle cx="19" cy="17" r="1.6" fill="#fff"/>`;
const BOLT = `<path d="M13.2 2.5L4 14h7l-1.2 7.5L20 10h-7l.2-7.5z" fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`;
const Q = `<g fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round"><circle cx="11.5" cy="11.5" r="7"/><path d="M15.5 15.5l4.5 4.5"/></g>`;

const SETS = {
  teacher: { name: "QuizFlow — Панель викладача", short: "QuizFlow", start: "/", colors: ["#6E9BFF", "#3B6BF6", "#2447C9"], bg: "#F0F3FA", glyph: FLOW },
  admin:   { name: "QuizFlow — Адмінка", short: "Адмінка", start: "/admin/overview", colors: ["#A78BFA", "#7C3AED", "#4F46E5"], bg: "#F4F6FB", glyph: FLOW },
  game:    { name: "QuizFlow Live — гра наживо", short: "QuizFlow Live", colors: ["#8B7FFF", "#5B4FE8", "#4A3FD1"], bg: "#F6F5FF", glyph: BOLT },
  test:    { name: "QuizFlow — Тест", short: "Тест", colors: ["#5B8CFF", "#3B6BF6", "#1E40AF"], bg: "#EEF2FB", glyph: Q },
};

// full — квадрат без заокруглень (iPhone і Android самі обрізають форму), знак менший;
// small — для 16–48 px: знак більший і лінії товщі, щоб читався у вкладці
function svg(s, { full = false, small = false } = {}) {
  const pad = full ? 15 : small ? 8 : 10.5, k = (64 - pad * 2) / 24;
  const glyph = small ? s.glyph.replace(/stroke-width="([\d.]+)"/g, (m, w) => `stroke-width="${+(w * 1.2).toFixed(2)}"`) : s.glyph;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.colors[0]}"/><stop offset=".5" stop-color="${s.colors[1]}"/><stop offset="1" stop-color="${s.colors[2]}"/></linearGradient></defs>` +
    `<rect width="64" height="64"${full ? "" : ` rx="15"`} fill="url(#g)"/>` +
    `<g transform="translate(${pad} ${pad}) scale(${+k.toFixed(4)})">${glyph}</g></svg>`;
}

// ICO з PNG усередині (підтримують усі сучасні браузери й Windows)
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += buf.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.buf)]);
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
async function png(markup, size) {
  // Вікно завжди велике: у малому Chromium малює із зсувом
  await page.setViewportSize({ width: 600, height: 600 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

for (const [id, s] of Object.entries(SETS)) {
  const dir = new URL(id + "/", OUT);
  fs.mkdirSync(dir, { recursive: true });
  const round = svg(s), full = svg(s, { full: true }), tiny = svg(s, { small: true });
  fs.writeFileSync(new URL("icon.svg", dir), round + "\n");
  const small = [];
  for (const size of [16, 32, 48]) small.push({ size, buf: await png(tiny, size) });   // по черзі: сторінка одна
  fs.writeFileSync(new URL("favicon.ico", dir), ico(small));
  fs.writeFileSync(new URL("icon-192.png", dir), await png(round, 192));
  fs.writeFileSync(new URL("icon-512.png", dir), await png(round, 512));
  fs.writeFileSync(new URL("icon-maskable-512.png", dir), await png(full, 512));
  fs.writeFileSync(new URL("apple-touch-icon.png", dir), await png(full, 180));
  const v = "?v=1";
  fs.writeFileSync(new URL("site.webmanifest", dir), JSON.stringify({
    // Без start_url ярлик відкриває ту сторінку, з якої його додали (гра, тест за посиланням)
    name: s.name, short_name: s.short, lang: "uk", ...(s.start ? { start_url: s.start } : {}), scope: "/", display: "browser",
    background_color: s.bg,
    icons: [
      { src: `icon-192.png${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `icon-512.png${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `icon-maskable-512.png${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2) + "\n");
  console.log(`assets/icons/${id}: готово`);
}
// Корінь сайту: браузери й пошуковики самі шукають /favicon.ico і /apple-touch-icon.png
fs.copyFileSync(new URL("teacher/favicon.ico", OUT), new URL("favicon.ico", ROOT));
fs.copyFileSync(new URL("teacher/apple-touch-icon.png", OUT), new URL("apple-touch-icon.png", ROOT));
await browser.close();

// Картинки-прев'ю для посилань (Open Graph, 1200×630) для п'яти частин сайту: панель викладача (app), гра (play),
// тест (test), адмін-панель (admin) і головна (quizflow.space). Їх показують Telegram, Viber, WhatsApp, Facebook, Slack, X
// тощо, коли надсилають посилання на сайт.
//   cd tests && npm run og
// Потім скопіювати картинки в репозиторії частин і підняти ?v= в og:image / twitter:image їхніх HTML (інакше месенджери
// показують стару картинку зі свого кешу).
//
// Композиція: плакат у стилі фінальних екранів гри. Усе важливе (назва, рядок тексту, талісман) лежить у центральній
// колонці 640 px, тож картинка не втрачає головного при обрізанні: широка картка 1.91:1 (Telegram, Facebook, Viber),
// 2:1 (X, LinkedIn), квадратна мініатюра (WhatsApp, список чатів). Боки заповнює лише декор.
// Талісмани: assets/team/<duck|rabbit|sprout|owl|chick>.webp (420 px, прозорий фон), ті самі, що в іконках частин сайту.
// Ім'я файлу assets/og/<id>.jpg: app це teacher, play це game (так вони названі в репозиторіях частин).
import fs from "node:fs";
import { chromium } from "@playwright/test";

const HERE = new URL("./", import.meta.url);
const OUT = new URL("../../assets/og/", import.meta.url);
const TEAM = new URL("../../assets/team/", import.meta.url);
const b64 = (url) => fs.readFileSync(url).toString("base64");

// Шрифти лежать поруч (tests/scripts/fonts, ліцензія SIL OFL): генерація не залежить від мережі
const FONTS = [
  ["Manrope", "600 800", "manrope-cyrillic", "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"],
  ["Manrope", "600 800", "manrope-latin", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
  ["Geist Mono", "600", "geistmono-latin", "U+0000-00FF"],
].map(([fam, w, file, range]) => `@font-face{font-family:"${fam}";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64(new URL(`fonts/${file}.woff2`, HERE))}) format("woff2");unicode-range:${range}}`).join("");


// Декор по боках (x < 280 і x > 920): виходить за квадратну обрізку, тож у мініатюрі його немає, а в широкій картці він заповнює поле
const DECO = {
  teacher: `<svg class="d l" width="280" height="420" viewBox="0 0 280 420"><g fill="rgba(15,24,68,.1)"><rect x="24" y="250" width="40" height="170" rx="10"/><rect x="82" y="190" width="40" height="230" rx="10"/><rect x="140" y="120" width="40" height="300" rx="10"/><rect x="198" y="60" width="40" height="360" rx="10"/></g></svg>
        <svg class="d r" width="280" height="420" viewBox="0 0 280 420"><circle cx="150" cy="170" r="96" fill="none" stroke="rgba(15,24,68,.1)" stroke-width="30"/><path d="M104 172l34 34 62-70" fill="none" stroke="rgba(15,24,68,.16)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  game: `<svg class="d l" width="280" height="460" viewBox="0 0 280 460"><path d="M170 20L40 250h84l-16 190L250 190h-86l6-170z" fill="rgba(255,255,255,.09)"/></svg>
        <svg class="d r" width="280" height="460" viewBox="0 0 280 460"><circle cx="70" cy="90" r="22" fill="#FFC93C"/><circle cx="200" cy="230" r="14" fill="#34D3C0"/><rect x="60" y="300" width="42" height="42" rx="10" fill="#FF6FA5" transform="rotate(18 81 321)"/><path d="M180 40l26 46h-52z" fill="rgba(255,255,255,.16)"/><circle cx="130" cy="400" r="10" fill="#FFC93C"/></svg>`,
  test: `<svg class="d l" width="280" height="460" viewBox="0 0 280 460"><text x="30" y="400" font-family="Manrope" font-weight="800" font-size="470" fill="rgba(11,61,46,.1)">?</text></svg>
        <svg class="d r" width="280" height="460" viewBox="0 0 280 460"><g fill="none" stroke="rgba(11,61,46,.13)" stroke-width="22" stroke-linecap="round"><path d="M60 200l38 40 80-90"/><path d="M60 340h160"/><path d="M60 400h110"/></g></svg>`,
  landing: `<svg class="d l" width="280" height="460" viewBox="0 0 280 460"><g fill="rgba(255,255,255,.22)"><rect x="30" y="70" width="190" height="62" rx="16"/><rect x="30" y="150" width="190" height="62" rx="16"/><rect x="30" y="230" width="190" height="62" rx="16"/><rect x="30" y="310" width="190" height="62" rx="16"/></g><g fill="rgba(255,255,255,.34)"><circle cx="64" cy="101" r="15"/><circle cx="64" cy="181" r="15"/><circle cx="64" cy="261" r="15"/><circle cx="64" cy="341" r="15"/></g></svg>
        <svg class="d r" width="280" height="460" viewBox="0 0 280 460"><path d="M150 40l22 48 52 6-39 36 11 52-46-27-46 27 11-52-39-36 52-6z" fill="rgba(255,255,255,.34)"/><circle cx="60" cy="300" r="20" fill="#FFD23F"/><circle cx="210" cy="330" r="12" fill="#FF6FA5"/><rect x="120" y="380" width="36" height="36" rx="9" fill="#34D3C0" transform="rotate(20 138 398)"/></svg>`,
  admin: `<svg class="d l" width="280" height="460" viewBox="0 0 280 460"><g fill="rgba(255,255,255,.12)">${Array.from({ length: 30 }, (_, i) => `<circle cx="${30 + (i % 5) * 52}" cy="${60 + Math.floor(i / 5) * 62}" r="${i % 7 === 3 ? 9 : 5}"/>`).join("")}</g></svg>
        <svg class="d r" width="280" height="460" viewBox="0 0 280 460"><g fill="none" stroke="rgba(255,255,255,.14)" stroke-width="20" stroke-linejoin="round" stroke-linecap="round"><path d="M140 60l92 34v88c0 80-40 128-92 158-52-30-92-78-92-158V94z"/><path d="M96 190l32 32 58-66"/></g></svg>`,
};
const CARDS = {
  teacher: { mascot: "duck",   bg: "#FFD23F", bg2: "#FFB703", ink: "#0F1844", soft: "rgba(15,24,68,.72)", title: "Панель<br>викладача", sub: "Тести, журнал і ігри наживо", host: "app.quizflow.space", glow: "rgba(255,255,255,.5)" },
  game:  { mascot: "rabbit", bg: "#3A2BB5", bg2: "#241785", ink: "#fff", soft: "rgba(255,255,255,.8)", title: "Гра наживо", sub: "Введіть код і відповідайте швидше за всіх", host: "play.quizflow.space", glow: "rgba(167,139,250,.55)" },
  test:  { mascot: "sprout", bg: "#FFB48F", bg2: "#FF9A6C", ink: "#0B3D2E", soft: "rgba(11,61,46,.75)", title: "Вам надіслали<br>тест", sub: "Без реєстрації, прямо в браузері", host: "test.quizflow.space", glow: "rgba(255,255,255,.45)" },
  landing: { mascot: "chick", bg: "#86CBFF", bg2: "#3FA2F5", ink: "#0F1444", soft: "rgba(15,20,68,.74)", title: "Тести й ігри<br>для класу", sub: "Журнал і аналітика для викладачів", host: "quizflow.space", glow: "rgba(255,255,255,.55)" },
  admin: { mascot: "owl",    bg: "#14195A", bg2: "#0A0E3A", ink: "#fff", soft: "rgba(255,255,255,.75)", title: "Адмін-<br>панель", sub: "Лише для адміністраторів", host: "admin.quizflow.space", glow: "rgba(124,58,237,.7)" },
};
const html = (k, c) => `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;position:relative;font-family:Manrope,sans-serif;color:${c.ink};-webkit-font-smoothing:antialiased;
  background:linear-gradient(160deg,${c.bg} 0%,${c.bg2} 100%)}
.glow{position:absolute;left:50%;bottom:-120px;width:640px;height:640px;margin-left:-320px;border-radius:50%;background:radial-gradient(closest-side,${c.glow},transparent 72%)}
.d{position:absolute;top:100px}.d.l{left:0}.d.r{right:0}
.col{position:absolute;left:50%;top:0;width:640px;margin-left:-320px;height:630px;text-align:center}
.brand{position:absolute;top:34px;left:0;right:0;font-weight:800;font-size:27px;letter-spacing:-.03em}
.brand i{font-style:normal;opacity:.62}
h1{position:absolute;top:${c.title.includes("<br>") ? 80 : 122}px;left:0;right:0;font-weight:800;font-size:80px;line-height:.96;letter-spacing:-.045em}
.sub{position:absolute;left:0;right:0;font-weight:700;font-size:27px;letter-spacing:-.01em;color:${c.soft}}
.m{position:absolute;left:50%;bottom:-118px;width:452px;height:452px;margin-left:-226px;filter:drop-shadow(0 22px 28px rgba(0,0,0,.28))}
.host{position:absolute;left:28px;bottom:30px;font:600 18px "Geist Mono",monospace;letter-spacing:.01em;color:${c.soft}}
</style></head><body>
<div class="glow"></div>${DECO[k]}
<div class="col"><div class="brand">quiz<i>flow</i></div><h1>${c.title}</h1><div class="sub" style="top:${c.title.includes("<br>") ? 246 : 216}px">${c.sub}</div>
<img class="m" src="data:image/webp;base64,${b64(new URL(c.mascot + ".webp", TEAM))}"></div>
<div class="host">${c.host}</div>
</body></html>`;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [id, c] of Object.entries(CARDS)) {
  await page.setContent(html(id, c), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Без фірмового шрифту картинка виходить чужою: краще впасти, ніж зберегти таку
  const loaded = await page.evaluate(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family.replace(/"/g, "")));
  for (const fam of ["Manrope", "Geist Mono"]) if (!loaded.includes(fam)) throw new Error(`Шрифт ${fam} не завантажився`);
  const path = new URL(`${id}.jpg`, OUT);
  await page.screenshot({ path: path.pathname, type: "jpeg", quality: 88 });
  const kb = Math.round(fs.statSync(path).size / 1024);
  // WhatsApp не показує картинки важчі за 300 КБ
  if (kb > 280) throw new Error(`assets/og/${id}.jpg завеликий: ${kb} КБ`);
  console.log(`assets/og/${id}.jpg: готово (${kb} КБ)`);
}
await browser.close();

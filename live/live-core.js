// ═══════════════════════════════════════════════════════════════════════
// live/live-core.js — спільне ядро всіх сторінок QuizFlow Live
//
// Раніше кожна сторінка мала власну копію конфігу Firebase, тем, патернів,
// esc()/initialsOf() і логіки підрахунку балів — і вони встигли розійтися
// (прев'ю в setup показувало інші кольори, ніж бачили учні). Тепер усе тут.
// ═══════════════════════════════════════════════════════════════════════

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, remove, onValue, serverTimestamp, onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
// firebase-auth (≈100 КБ) підвантажуємо лише на сторінках викладача — учням він не потрібен.
const AUTH_URL = "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const FC = {apiKey:"AIzaSyDsA4IQkn5tV41LDK43vzgm0XnRnbdgvTc",authDomain:"quizflow-8a978.firebaseapp.com",databaseURL:"https://quizflow-8a978-default-rtdb.europe-west1.firebasedatabase.app",projectId:"quizflow-8a978",storageBucket:"quizflow-8a978.firebasestorage.app",messagingSenderId:"206469794166",appId:"1:206469794166:web:55cd7007b429607acd5257"};
export const app  = getApps().length ? getApps()[0] : initializeApp(FC);
export const db   = getDatabase(app);

export { ref, get, set, update, remove, onValue, serverTimestamp, onDisconnect };

// Шляхи відносно цього модуля — працює і в корені домену, і на GitHub Pages
// у підпапці (раніше було жорстко "/live/patterns/…" і "/play.html").
const HERE = new URL(".", import.meta.url);
export const pageUrl = (rel) => new URL(rel, HERE).href;
export const joinUrl = (code) => pageUrl(`../play?code=${encodeURIComponent(code)}`);
export const HOME_URL = pageUrl("../");

// ─── Auth ──────────────────────────────────────────────────────────────
export async function requireTeacher() {
  const { getAuth, onAuthStateChanged } = await import(AUTH_URL);
  const auth = getAuth(app);
  const user = await new Promise(r => { const u = onAuthStateChanged(auth, x => { u(); r(x); }); });
  if (!user) {
    const here = "live/" + (location.pathname.split("/").pop() || "") + location.search;
    location.href = pageUrl("../login") + "?next=" + encodeURIComponent(here);
    throw new Error("no auth");
  }
  return user;
}

// ─── Серверний час ─────────────────────────────────────────────────────
// Годинники викладача і учнів можуть розходитись на секунди — таймер і бали
// «за швидкість» рахуємо за часом сервера Firebase.
let _offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), s => { _offset = Number(s.val()) || 0; });
export const serverNow = () => Date.now() + _offset;

// ─── Присутність гравця ────────────────────────────────────────────────
// players/{pid}/online = true, поки вкладка відкрита; сервер сам ставить false,
// коли з'єднання обривається. Викладач не чекає тих, хто вже пішов.
export function trackPresence(code, pid) {
  const onlineRef = ref(db, `rooms/${code}/players/${pid}/online`);
  return onValue(ref(db, ".info/connected"), s => {
    if (s.val() !== true) return;
    onDisconnect(onlineRef).set(false).then(() => set(onlineRef, true)).catch(() => {});
  });
}
export const isActive = (p) => !!p && p.active !== false;
export const isOnline = (p) => isActive(p) && p.online !== false;

// ─── Кодування параметрів ──────────────────────────────────────────────
export function readParams(...keys) {
  const p = new URLSearchParams(location.search);
  return Object.fromEntries(keys.map(k => [k, p.get(k)]));
}
export const isValidCode = (c) => /^\d{8}$/.test(String(c || ""));

// ─── Рядки ─────────────────────────────────────────────────────────────
const ESC = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);

// Текст питання — HTML з конструктора (жирний, курсив, колір). Конструктор
// очищає його при збереженні, але старі тести могли зберегтися раніше — тож
// на екранах гри ще раз лишаємо лише безпечні теги.
const RICH_OK = new Set(["B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI", "CODE", "PRE", "MARK", "SMALL", "IMG"]);
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/i;
export function richHtml(html) {
  const src = String(html ?? "");
  if (!/[<&]/.test(src)) return esc(src).replace(/\r?\n/g, "<br>");
  const doc = new DOMParser().parseFromString(`<div>${src}</div>`, "text/html");
  const walk = (from, to) => {
    for (const n of [...from.childNodes]) {
      if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.textContent)); continue; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|TEMPLATE|FORM|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(n.tagName)) continue;
      if (!RICH_OK.has(n.tagName)) { walk(n, to); continue; }
      const el = document.createElement(n.tagName);
      if (n.tagName === "IMG") {
        const srcAttr = n.getAttribute("src") || "";
        if (!/^(https:\/\/|data:image\/(png|jpe?g|gif|webp);)/i.test(srcAttr)) continue;
        el.src = srcAttr; el.alt = n.getAttribute("alt") || ""; el.loading = "lazy";
      }
      const col = (n.style?.color || "").trim();
      if (col && COLOR_RE.test(col)) el.style.color = col;
      walk(n, el);
      to.appendChild(el);
    }
  };
  const out = document.createElement("div");
  walk(doc.body.firstChild, out);
  return out.innerHTML;
}

export function initialsOf(nick) {
  const parts = String(nick || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (String(nick || "").trim() || "??").slice(0, 2).toUpperCase();
}

const AV_COLORS = ["#5B4FE8","#2F7F9E","#3F8A5A","#B0563E","#7A4FB5","#B0457A","#2E8A86","#9A7A1E"];
export function avatarColor(name) {
  let h = 0;
  for (const ch of String(name || "?")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};
export const fmtNum = (n) => Number(n || 0).toLocaleString("uk");

// ─── Теми ──────────────────────────────────────────────────────────────
// Єдине джерело правди для прев'ю в setup і для екранів гри.
export const THEMES = {
  "g-default": { name:"Океан",     css:"linear-gradient(135deg,#1E3A8A,#0F1844)" },
  "g-night":   { name:"Ніч",       css:"linear-gradient(135deg,#0A0F2C,#1F1F3F)" },
  "g-forest":  { name:"Ліс",       css:"linear-gradient(135deg,#064E3B,#022C22)" },
  "g-amber":   { name:"Янтар",     css:"linear-gradient(135deg,#9A3412,#7C2D12)" },
  "g-grape":   { name:"Виноград",  css:"linear-gradient(135deg,#581C87,#312E81)" },
  "g-sun":     { name:"Сонце",     css:"linear-gradient(135deg,#D97706,#92400E)" },
  "g-ocean":   { name:"Глибина",   css:"linear-gradient(135deg,#0E7490,#1E3A8A)" },
  "g-violet":  { name:"Електрик",  css:"linear-gradient(135deg,#7C3AED,#4338CA)" },
  "g-mint":    { name:"Мʼята",     css:"linear-gradient(135deg,#0F9F75,#047857)" },
  "g-sky":     { name:"Небо",      css:"linear-gradient(135deg,#3B82F6,#1E40AF)" },
  "g-jade":    { name:"Джейд",     css:"linear-gradient(135deg,#14B8A6,#0F766E)" },
  "g-rose":    { name:"Троянда",   css:"linear-gradient(135deg,#E11D48,#9F1239)" },
  "g-magenta": { name:"Магента",   css:"linear-gradient(135deg,#C026D3,#86198F)" },
};

const PAT_DEFS = [
  ["grid","Сітка","64px 64px"], ["dots","Крапки","16px 16px"], ["waves","Хвилі","64px 48px"],
  ["hex","Соти","60px 66px"], ["diag","Діагоналі","48px 48px"], ["target","Мішень","64px 64px"],
  ["star","Зірки","40px 40px"], ["snow","Сніжинки","32px 32px"], ["heart","Серця","40px 32px"],
  ["flower","Квіти","48px 48px"], ["leaf","Листя","48px 48px"], ["prism","Призма","40px 36px"],
  ["wave2","Хвилі 2","48px 48px"],
];
export const PATTERNS = Object.fromEntries(PAT_DEFS.map(([id, name, size]) => [id, {
  name, size, bg: `url("${pageUrl(`patterns/${id}.svg`)}")`,
}]));

export const DEFAULT_THEME = { grad: "g-default", pat: "grid" };

export function applyTheme(theme, gradEl, patEl) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  if (gradEl) {
    gradEl.style.background = (THEMES[t.grad] || THEMES[DEFAULT_THEME.grad]).css;
    gradEl.style.opacity = "1";
  }
  if (patEl) {
    const p = PATTERNS[t.pat];
    patEl.style.backgroundImage = p ? p.bg : "none";
    patEl.style.backgroundSize = p ? p.size : "";
    patEl.style.backgroundRepeat = "repeat";
    patEl.style.opacity = p ? "1" : "0";
  }
}

// ─── Питання й оцінювання ──────────────────────────────────────────────
export const LIVE_TYPES = ["single", "multi", "text", "number"];
export const OPT_CLASSES = ["a","b","c","d","e","f"];
export const OPT_LETTERS = ["A","B","C","D","E","F"];
export const isFreeform = (q) => q?.type === "text" || q?.type === "number";

export const TYPE_LABELS = {
  single: { cls:"single", label:"◉ Одна правильна" },
  multi:  { cls:"multi",  label:"☑ Кілька правильних" },
  text:   { cls:"text",   label:"✏ Текстова відповідь" },
  number: { cls:"number", label:"# Числова відповідь" },
};

const normText = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[’ʼ`]/g, "'");
const toNum = (s) => parseFloat(String(s ?? "").trim().replace(",", "."));
// Набір індексів варіантів: без дублікатів і сміття. Firebase інколи віддає
// масив як об'єкт {0:1,1:2} — теж приймаємо.
export function asIndexList(v) {
  const raw = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [v];
  const nums = raw.filter(x => x !== null && x !== undefined && x !== "" && typeof x !== "boolean")
    .map(Number).filter(n => Number.isInteger(n) && n >= 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}
// Скільки варіантів має обрати учень (для підказки «Оберіть 2»)
export const pickCount = (correct) => asIndexList(correct).length;

// Суворе оцінювання «кількох правильних»: зараховується ЛИШЕ точний збіг.
//   правильні A,C:  A → ✗   A,C → ✓   A,B,C → ✗   A,B,C,D → ✗
// Тож вибрати «все підряд» чи вгадати половину не вийде.
export function checkCorrect(q, correct, value) {
  if (!q || value === undefined || value === null) return false;
  switch (q.type) {
    case "multi": {
      const want = asIndexList(correct), got = asIndexList(value);
      return want.length > 0 && got.length === want.length && got.every((v, i) => v === want[i]);
    }
    case "number": { const c = toNum(correct), u = toNum(value); return !isNaN(c) && !isNaN(u) && Math.abs(c - u) < 1e-9; }
    case "text":   return normText(value) !== "" && normText(value) === normText(correct);
    default: {
      // single: рівно один вибраний варіант і він правильний
      const want = asIndexList(correct), got = asIndexList(value);
      return got.length === 1 && want.includes(got[0]);
    }
  }
}

// Відповідь, надіслана пізніше за цей запас після кінця таймера, балів не отримує.
export const LATE_GRACE_MS = 1500;

export function calcPoints({ scoring, isCorrect, elapsedMs, timePerQ }) {
  if (!isCorrect) return 0;
  if (scoring !== "speed") return 1000;
  const ratio = Math.max(0, Math.min(1, 1 - (elapsedMs / 1000) / timePerQ));
  return Math.round(500 + 500 * ratio);
}

// Щільне ранжування: 1,1,2,3 — однаковий бал = однакове місце.
export function denseRank(list, key = "score") {
  let rank = 0, prev = null;
  list.forEach(p => { if (p[key] !== prev) { rank++; prev = p[key]; } p.rank = rank; });
  return list;
}

// Підсумки гри з вузла answers: { pid: { score, correct, answered } }
export function tallyAnswers(allAnswers) {
  const out = {};
  Object.values(allAnswers || {}).forEach(qA => {
    Object.entries(qA || {}).forEach(([pid, a]) => {
      const t = out[pid] || (out[pid] = { score: 0, correct: 0, answered: 0 });
      t.score += Number(a?.points) || 0;
      if (a?.isCorrect) t.correct++;
      t.answered++;
    });
  });
  return out;
}

export function standings(players, allAnswers) {
  const tally = tallyAnswers(allAnswers);
  const list = Object.entries(players || {})
    .filter(([, p]) => p && p.active !== false)
    .map(([pid, p]) => ({ pid, nickname: p.nickname || "—", ...(tally[pid] || { score: 0, correct: 0, answered: 0 }) }))
    .sort((a, b) => b.score - a.score || b.correct - a.correct || a.nickname.localeCompare(b.nickname, "uk"));
  return denseRank(list);
}

// Компактна таблиця для телефонів учнів: { pid: { r: місце, s: бали, g: до попереднього місця, n: гравців } }.
// Викладач пише її разом із розкриттям відповіді — учень слухає лише свій рядок
// замість усіх відповідей класу.
export function rankMap(list) {
  const out = {};
  let prevRankScore = null, lastScore = null, lastRank = 0;
  list.forEach(p => {
    if (p.rank !== lastRank) { prevRankScore = lastScore; lastRank = p.rank; lastScore = p.score; }
    out[p.pid] = { r: p.rank, s: p.score, g: p.rank > 1 && prevRankScore != null ? prevRankScore - p.score : 0, n: list.length };
  });
  return out;
}

// Детерміноване перемішування (однакове для учня після перезавантаження).
export function seededOrder(n, seedStr) {
  let h = 2166136261;
  for (const ch of String(seedStr)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1e6) / 1e6; };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

// ─── Підписки ──────────────────────────────────────────────────────────
// Слухає кілька вузлів і викликає cb один раз на «пачку» змін — multi-path
// update від викладача приходить як кілька подій в одному такті, тож без
// цього сторінка бачила б проміжні стани (новий currentQ зі старим статусом).
export function watchFields(base, fields, cb) {
  const state = {};
  const seen = new Set();
  let queued = false;
  const flush = () => { queued = false; if (seen.size === fields.length) cb({ ...state }); };
  const unsubs = fields.map(f => onValue(ref(db, `${base}/${f}`), s => {
    state[f] = s.val();
    seen.add(f);
    if (!queued) { queued = true; queueMicrotask(flush); }
  }));
  return () => unsubs.forEach(u => u());
}

// ─── Автопідбір розміру тексту ─────────────────────────────────────────
// Короткий текст — великим шрифтом, довгий — меншим, але так, щоб вміщувався
// в заданий простір без обрізання. Двійковий пошук по розміру шрифту.
export function fitText(el, { max, min, maxHeight }) {
  if (!el) return min;
  const fits = () => el.scrollHeight <= maxHeight + 1;
  el.style.fontSize = max + "px";
  if (fits()) return max;
  let lo = min, hi = max;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = mid + "px";
    if (fits()) lo = mid; else hi = mid;
  }
  el.style.fontSize = lo + "px";
  return lo;
}
// Однаковий розмір для групи (варіанти відповідей) — за найдовшим
export function fitGroup(els, opts) {
  const list = [...els];
  if (!list.length) return;
  const size = Math.min(...list.map(el => fitText(el, opts)));
  list.forEach(el => { el.style.fontSize = size + "px"; });
  return size;
}
// Перерахунок при зміні розміру вікна та після завантаження картинок у питанні
export function onRefit(fn, root) {
  let raf = 0;
  const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); };
  window.addEventListener("resize", run);
  root?.addEventListener("load", run, true);   // img load не спливає — ловимо на capture
  document.fonts?.ready?.then(run);
  return run;
}

// ─── UI-дрібниці ───────────────────────────────────────────────────────
export function toast(msg, kind = "info", ms = 3200) {
  let host = document.getElementById("lv-toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "lv-toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:max-content;max-width:calc(100vw - 32px)";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  const bg = kind === "err" ? "#B42323" : kind === "ok" ? "#1F7A4A" : "#201C33";
  el.style.cssText = `background:${bg};color:#fff;padding:11px 18px;border-radius:12px;font:600 14px/1.35 Manrope,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.28);pointer-events:auto;transition:opacity .25s,transform .25s;opacity:0;transform:translateY(8px)`;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "none"; });
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, ms);
}

// Власне вікно підтвердження замість confirm(): на проєкторі й телефонах
// системне вікно виглядає чужорідно, а в повноекранному режимі ще й виходить з нього.
export function confirmDlg({ title, text = "", ok = "Так", cancel = "Скасувати", danger = false } = {}) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const bd = document.createElement("div");
    bd.className = "lv-dlg-bd";
    bd.innerHTML = `<div class="lv-dlg" role="alertdialog" aria-modal="true" aria-labelledby="lv-dlg-t" aria-describedby="lv-dlg-x">
      <h2 id="lv-dlg-t">${esc(title)}</h2>${text ? `<p id="lv-dlg-x">${esc(text)}</p>` : ""}
      <div class="lv-dlg-a"><button type="button" data-v="0">${esc(cancel)}</button><button type="button" data-v="1" class="${danger ? "danger" : "ok"}">${esc(ok)}</button></div></div>`;
    if (!document.getElementById("lv-dlg-css")) {
      const st = document.createElement("style"); st.id = "lv-dlg-css";
      st.textContent = `.lv-dlg-bd{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:20px;background:rgba(8,10,30,.55);backdrop-filter:blur(6px);animation:lvDlgF .15s ease-out}
.lv-dlg{width:100%;max-width:400px;background:#fff;color:#1D1930;border-radius:18px;padding:22px 22px 18px;box-shadow:0 30px 70px -20px rgba(0,0,0,.5);font-family:Manrope,system-ui,sans-serif;animation:lvDlgU .2s cubic-bezier(.22,1,.36,1)}
.lv-dlg h2{margin:0;font-size:18px;font-weight:800;letter-spacing:-.01em;line-height:1.3}
.lv-dlg p{margin:8px 0 0;font-size:14px;line-height:1.5;color:#5F5876}
.lv-dlg-a{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}
.lv-dlg-a button{font:700 14px Manrope,system-ui,sans-serif;padding:11px 16px;border-radius:11px;border:1.5px solid #E4E1F4;background:#fff;color:#1D1930;cursor:pointer}
.lv-dlg-a button:hover{background:#F6F5FB}
.lv-dlg-a .ok{background:#5B4FE8;border-color:#5B4FE8;color:#fff}.lv-dlg-a .ok:hover{background:#4A3FD1}
.lv-dlg-a .danger{background:#D14343;border-color:#D14343;color:#fff}.lv-dlg-a .danger:hover{background:#B83636}
.lv-dlg-a button:focus-visible{outline:2.5px solid #5B4FE8;outline-offset:2px}
@keyframes lvDlgF{from{opacity:0}}@keyframes lvDlgU{from{opacity:0;transform:translateY(10px) scale(.98)}}`;
      document.head.appendChild(st);
    }
    const close = (v) => { document.removeEventListener("keydown", onKey, true); bd.remove(); prevFocus?.focus?.({ preventScroll: true }); resolve(v); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === "Tab") {           // фокус не виходить за межі вікна
        const b = [...bd.querySelectorAll("button")], i = b.indexOf(document.activeElement);
        e.preventDefault(); b[(i + (e.shiftKey ? -1 : 1) + b.length) % b.length].focus();
      } else e.stopPropagation();           // пробіл/Enter/P не доходять до гарячих клавіш сторінки
    };
    bd.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) close(b.dataset.v === "1"); else if (e.target === bd) close(false); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(bd);
    bd.querySelector(danger ? "[data-v='0']" : "[data-v='1']").focus();
  });
}

export function fatal(msg, backHref = HOME_URL) {
  document.body.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif;background:#F6F5FB;color:#201C33;text-align:center">
    <div style="max-width:420px"><div style="font-size:44px;margin-bottom:10px">⚠️</div>
    <h1 style="font-size:22px;margin:0 0 8px">${esc(msg)}</h1>
    <a href="${esc(backHref)}" style="display:inline-block;margin-top:14px;padding:11px 20px;border-radius:10px;background:#5B4FE8;color:#fff;text-decoration:none;font-weight:700">Повернутися</a></div></div>`;
  throw new Error(msg);
}

export const safeStore = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

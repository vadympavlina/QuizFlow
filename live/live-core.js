// ═══════════════════════════════════════════════════════════════════════
// live/live-core.js — спільне ядро всіх сторінок QuizFlow Live
//
// Раніше кожна сторінка мала власну копію конфігу Firebase, тем, патернів,
// esc()/initialsOf() і логіки підрахунку балів — і вони встигли розійтися
// (прев'ю в setup показувало інші кольори, ніж бачили учні). Тепер усе тут.
// ═══════════════════════════════════════════════════════════════════════

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, remove, onValue, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const FC = {apiKey:"AIzaSyDsA4IQkn5tV41LDK43vzgm0XnRnbdgvTc",authDomain:"quizflow-8a978.firebaseapp.com",databaseURL:"https://quizflow-8a978-default-rtdb.europe-west1.firebasedatabase.app",projectId:"quizflow-8a978",storageBucket:"quizflow-8a978.firebasestorage.app",messagingSenderId:"206469794166",appId:"1:206469794166:web:55cd7007b429607acd5257"};
export const app  = getApps().length ? getApps()[0] : initializeApp(FC);
export const db   = getDatabase(app);
export const auth = getAuth(app);

export { ref, get, set, update, remove, onValue, serverTimestamp };

// Шляхи відносно цього модуля — працює і в корені домену, і на GitHub Pages
// у підпапці (раніше було жорстко "/live/patterns/…" і "/play.html").
const HERE = new URL(".", import.meta.url);
export const pageUrl = (rel) => new URL(rel, HERE).href;
export const joinUrl = (code) => pageUrl(`../play?code=${encodeURIComponent(code)}`);
export const HOME_URL = pageUrl("../");

// ─── Auth ──────────────────────────────────────────────────────────────
export async function requireTeacher() {
  const user = await new Promise(r => { const u = onAuthStateChanged(auth, x => { u(); r(x); }); });
  if (!user) { location.href = pageUrl("../login"); throw new Error("no auth"); }
  return user;
}

// ─── Серверний час ─────────────────────────────────────────────────────
// Годинники викладача і учнів можуть розходитись на секунди — таймер і бали
// «за швидкість» рахуємо за часом сервера Firebase.
let _offset = 0;
onValue(ref(db, ".info/serverTimeOffset"), s => { _offset = Number(s.val()) || 0; });
export const serverNow = () => Date.now() + _offset;

// ─── Кодування параметрів ──────────────────────────────────────────────
export function readParams(...keys) {
  const p = new URLSearchParams(location.search);
  return Object.fromEntries(keys.map(k => [k, p.get(k)]));
}
export const isValidCode = (c) => /^\d{8}$/.test(String(c || ""));

// ─── Рядки ─────────────────────────────────────────────────────────────
const ESC = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);

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
const asIndexList = (v) => (Array.isArray(v) ? v : [v]).filter(x => x !== null && x !== undefined && x !== "").map(Number).sort((a, b) => a - b);

export function checkCorrect(q, correct, value) {
  if (!q || value === undefined || value === null) return false;
  switch (q.type) {
    case "multi":  return JSON.stringify(asIndexList(value)) === JSON.stringify(asIndexList(correct));
    case "number": { const c = toNum(correct), u = toNum(value); return !isNaN(c) && !isNaN(u) && Math.abs(c - u) < 1e-9; }
    case "text":   return normText(value) !== "" && normText(value) === normText(correct);
    default:       return Number(value) === Number(Array.isArray(correct) ? correct[0] : correct);
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
  el.style.cssText = `background:${bg};color:#fff;padding:11px 18px;border-radius:12px;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.28);pointer-events:auto;transition:opacity .25s,transform .25s;opacity:0;transform:translateY(8px)`;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "none"; });
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, ms);
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

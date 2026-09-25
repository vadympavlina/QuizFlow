// ═══════════════════════════════════════════════════════════════════════
// shared/app.js — ядро QuizFlow (Firebase, auth, sidebar, спільні утиліти)
//
// Експортує ES-модульно І вішає на window — щоб inline handlers
// (onclick="toast('...')", etc.) продовжували працювати
// ═══════════════════════════════════════════════════════════════════════

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, get, set, push, update, remove, onValue, off } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ─── Firebase ──────────────────────────────────────────────────────────
const FC = {
  apiKey: "AIzaSyDsA4IQkn5tV41LDK43vzgm0XnRnbdgvTc",
  authDomain: "quizflow-8a978.firebaseapp.com",
  databaseURL: "https://quizflow-8a978-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "quizflow-8a978",
  storageBucket: "quizflow-8a978.firebasestorage.app",
  messagingSenderId: "206469794216",
  appId: "1:206469794166:web:55cd7007b429607acd5257"
};
const app  = getApps().length ? getApps()[0] : initializeApp(FC);
const db   = getDatabase(app);
const auth = getAuth(app);

// Експонуємо на window — щоб features.js міг використати без імпорту
window._fb = { db, ref, get, set, push, update, remove, onValue, off };

export { db, ref, get, set, push, update, remove, onValue, off };

// ─── Auth через Firebase Auth ──────────────────────────────────────────
// Чекаємо поки Firebase відновить сесію з IndexedDB
const _fbUser = await new Promise((resolve) => {
  const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
});

if (!_fbUser) {
  location.href = "login";
  throw new Error("no auth");
}

// Зчитуємо профіль з Realtime DB
const _userSnap = await get(ref(db, `users/${_fbUser.uid}`));
if (!_userSnap.exists()) {
  await signOut(auth);
  location.href = "login";
  throw new Error("no user profile");
}

const _userDb = _userSnap.val();

// Перевіряємо чи не заблокований
if (_userDb.blocked === true) {
  await signOut(auth);
  alert("Ваш акаунт заблоковано. Зверніться до адміністратора.");
  location.href = "login";
  throw new Error("blocked");
}

// Збираємо _user з Firebase UID + даними з DB
const _user = {
  id:      _fbUser.uid,
  email:   _fbUser.email,
  name:    _userDb.name    || "",
  surname: _userDb.surname || "",
  role:    _userDb.role    || "teacher",
  // Кастомні ролі (окремий шар над системним admin/teacher, керується з admin/roles.html).
  // customRoleIds — мапа {roleId:true,...}; customRoleId — старе одиничне поле для сумісності.
  customRoleIds: _userDb.customRoleIds && typeof _userDb.customRoleIds === "object"
    ? Object.keys(_userDb.customRoleIds).filter(k => _userDb.customRoleIds[k])
    : (_userDb.customRoleId ? [_userDb.customRoleId] : []),
};

export const user = _user;
export const uid  = _fbUser.uid;

window._user = _user;
window._uid  = uid;

// ─── Path / DB helpers ─────────────────────────────────────────────────
export function tp(path) {
  return `teachers/${uid}/${path}`;
}
export async function dbGet(path) {
  return await get(ref(db, tp(path)));
}
window.tp = tp;
window.dbGet = dbGet;

// ─── Utilities ─────────────────────────────────────────────────────────
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const ts = () => Date.now();

export function toArr(snap) {
  if (!snap.exists()) return [];
  return Object.entries(snap.val()).map(([id, v]) => {
    if (v && v.questions && !Array.isArray(v.questions)) {
      v.questions = Object.values(v.questions);
    }
    if (v && !v.questions) v.questions = [];
    return { id, ...v };
  });
}

window.$ = $;
window.esc = esc;
window.ts = ts;
window.toArr = toArr;

// ─── Logout ────────────────────────────────────────────────────────────
window.doLogout = async () => {
  // Чистимо кеші навігації
  localStorage.removeItem("qf_nav_cache");
  localStorage.removeItem("qf_nav_ts");
  localStorage.removeItem("qf_user_cache");
  sessionStorage.clear();
  await signOut(auth);
  location.href = "login";
};

// ─── Toast ─────────────────────────────────────────────────────────────
let _toastTimer;
export function toast(msg, type = "ok") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "show " + (type === "err" ? "err" : "");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}
window.toast = toast;

// ─── Loader ────────────────────────────────────────────────────────────
export function ldr(show) {
  let el = document.getElementById("app-loader");
  // Якщо лоадера немає — створюємо (на випадок якщо скрипт викликається без HTML-лоадера)
  if (!el) {
    el = document.createElement("div");
    el.id = "app-loader";
    el.innerHTML = '<div style="width:44px;height:44px;border:3.5px solid rgba(45,91,227,.15);border-top-color:#2d5be3;border-radius:50%;animation:appSpin .8s linear infinite"></div><div style="font-size:13px;color:#6b7280;margin-top:12px;font-family:DM Sans,sans-serif">Завантаження...</div>';
    el.style.cssText = "position:fixed;inset:0;background:#f0f3fa;z-index:9998;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity .25s ease";
    document.body.appendChild(el);
    if (!document.getElementById("app-ldr-kf")) {
      const s = document.createElement("style");
      s.id = "app-ldr-kf";
      s.textContent = "@keyframes appSpin{to{transform:rotate(360deg)}}";
      document.head.appendChild(s);
    }
  }
  if (show) {
    el.style.display = "flex";
    requestAnimationFrame(() => { el.style.opacity = "1"; });
  } else {
    // Показуємо main (знімаємо opacity:0 з CSS); меню видно завжди
    if (!document.body.classList.contains("app-ready")) {
      document.body.classList.add("app-ready");
      document.dispatchEvent(new Event("qf:ready"));
    }
    el.style.opacity = "0";
    setTimeout(() => {
      el.style.display = "none";
      // Видаляємо з DOM щоб він не мішав
      try { el.remove(); } catch {}
    }, 260);
  }
}
window.ldr = ldr;
window.appReady = () => ldr(false);

// ─── Sidebar toggle ────────────────────────────────────────────────────
// Реалізація — у shared/nav.js (window.toggleSidebar)

// ─── Modal helpers ─────────────────────────────────────────────────────
// Стек відкритих модалок: Esc і клік по фону закривають лише верхню,
// фокус переходить у модалку й повертається на кнопку, що її відкрила,
// сторінка під модалкою не прокручується.
const _mStack = [];
function _syncBodyLock() { document.body.classList.toggle("mo-open", _mStack.length > 0); }
window.openM = function (id) {
  const el = document.getElementById(id);
  if (!el) { console.warn("[openM] модалку не знайдено:", id); return; }
  const i = _mStack.findIndex(m => m.el === el);
  if (i >= 0) _mStack.splice(i, 1);
  _mStack.push({ el, opener: document.activeElement });
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.style.display = "flex";
  void el.offsetWidth;          // reflow — щоб спрацювала анімація появи
  el.classList.add("on");
  _syncBodyLock();
  // Фокус: [autofocus] → перше порожнє поле → перша кнопка
  setTimeout(() => {
    if (!el.classList.contains("on") && el.style.display === "none") return;
    const f = el.querySelector("[autofocus]:not([disabled])")
      || [...el.querySelectorAll("input:not([type=hidden]):not([disabled]),textarea:not([disabled])")].find(x => x.offsetParent && !x.value)
      || el.querySelector(".mb button:not(.mcl):not([disabled])");
    try { f?.focus({ preventScroll: true }); } catch {}
  }, 60);
};
window.closeM = function (id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("on");
  const i = _mStack.findIndex(m => m.el === el);
  const entry = i >= 0 ? _mStack.splice(i, 1)[0] : null;
  _syncBodyLock();
  setTimeout(() => { if (!el.classList.contains("on")) el.style.display = "none"; }, 200);
  try { if (entry?.opener && document.contains(entry.opener)) entry.opener.focus({ preventScroll: true }); } catch {}
};
document.addEventListener("click", e => {
  if (e.target.classList && e.target.classList.contains("mo") && e.target.id) closeM(e.target.id);
});
// Esc закриває лише верхню модалку. Слухаємо в фазі capture й зупиняємо подію,
// щоб старі обробники сторінок не закривали одразу всі модалки.
window.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  // Відкритий поповер/дропдаун у модалці закривається першим (своїм обробником)
  if (document.querySelector('[data-open="1"], .cd-menu.open')) return;
  const top = [..._mStack].reverse().find(m => m.el.classList.contains("on") && m.el.style.display !== "none");
  if (!top) return;
  e.stopPropagation(); e.preventDefault();
  closeM(top.el.id);
}, true);

// ─── Sidebar: завантаження + підсвітка активної сторінки ───────────────
// ─── Модалки: завантажуються один раз з shared/modals.html ─────────────
async function loadModals() {
  // Якщо сторінка уже містить <div id="modals-root"> — туди й вставимо,
  // інакше створимо новий контейнер перед </body>
  try {
    const resp = await fetch("shared/modals?v=20");
    if (!resp.ok) throw new Error("modals.html " + resp.status);
    const html = await resp.text();
    let root = document.getElementById("modals-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "modals-root";
      document.body.appendChild(root);
    }
    root.innerHTML = html;
  } catch (e) {
    console.error("[app.js] loadModals failed:", e);
  }
}

// Меню малює shared/nav.js синхронно з кешу ще до Firebase (тому воно не
// зникає між сторінками). Тут — лише дані користувача й фонова звірка
// конфігу навігації з базою; initApp на це не чекає.
function ensureNavScript() {
  if (window.QFNav) return Promise.resolve();
  return new Promise(res => {
    const s = document.createElement("script");
    s.src = new URL("./nav.js?v=16", import.meta.url).href;
    s.onload = s.onerror = () => res();
    document.head.appendChild(s);
  });
}

async function loadSidebar(activePage) {
  await ensureNavScript();
  const nav = window.QFNav;
  if (!nav) return;
  if (!document.getElementById("sidebar")) nav.render(null);
  nav.setActive(activePage);
  nav.setUser(_user);
  refreshNavConfig();
}

async function refreshNavConfig() {
  const NAV_CACHE_KEY = "qf_nav_cache";
  const NAV_TS_KEY    = "qf_nav_ts";
  try {
    const cachedTs  = localStorage.getItem(NAV_TS_KEY);
    const cachedNav = localStorage.getItem(NAV_CACHE_KEY);
    const tsSnap = await get(ref(db, "settings/navigation_ts"));
    const serverTs = tsSnap.exists() ? String(tsSnap.val()) : null;
    if (cachedNav && cachedTs && serverTs && cachedTs === serverTs) return; // кеш свіжий
    const navSnap = await get(ref(db, "settings/navigation"));
    if (navSnap.exists() && Array.isArray(navSnap.val())) {
      const navData = navSnap.val();
      localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(navData));
      if (serverTs) localStorage.setItem(NAV_TS_KEY, serverTs);
      window.QFNav?.setNav(navData);
    } else {
      localStorage.removeItem(NAV_CACHE_KEY);
      localStorage.removeItem(NAV_TS_KEY);
      window.QFNav?.setNav(window.QFNav.DEFAULT_NAV);
    }
  } catch (e) {
    console.warn("[app.js] nav config refresh failed:", e.message);
  }
}

// ─── State ─────────────────────────────────────────────────────────────
// features.js читає і пише в window.folders / tests / links / attempts
window.folders = [];
window.tests = [];
window.links = [];
window.attempts = [];

const _dataReadyCbs = new Set();
export function onDataReady(cb) {
  _dataReadyCbs.add(cb);
  if (window._dataLoaded) cb();
  return () => _dataReadyCbs.delete(cb);
}
function notifyReady() {
  window._dataLoaded = true;
  _dataReadyCbs.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
}

// ─── Cache helpers (sessionStorage) ────────────────────────────────────
function tryLoadCache(key, maxAgeMs) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.savedAt || Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(key) {
  try {
    const data = {
      folders: window.folders,
      tests: window.tests,
      links: window.links,
      attempts: window.attempts,
      savedAt: Date.now()
    };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    // QuotaExceededError — просто не кешуємо, не критично
    console.warn("[app.js] cache save failed:", e.message);
  }
}

// Видалити кеш — виклик features.js після будь-якої мутації (create/update/delete)
window.invalidateQfCache = function() {
  try { sessionStorage.removeItem("qf_cache_v1"); } catch {}
};

async function loadAllData() {
  try {
    // ─── 1) Пробуємо sessionStorage-кеш ─────────────────────────────────
    const CACHE_KEY = "qf_cache_v1";
    const CACHE_MAX_AGE = 60 * 1000;

    const cached = tryLoadCache(CACHE_KEY, CACHE_MAX_AGE);
    if (cached) {
      window.folders  = cached.folders;
      window.tests    = cached.tests;
      window.links    = cached.links;
      window.attempts = cached.attempts;
      console.log(`⚡ [app.js] з кешу (${cached.tests.length} тестів, вік ${Math.round((Date.now()-cached.savedAt)/1000)}с)`);
      notifyReady();
      return;
    }

    // ─── 2) Кешу немає — тягнемо свіже з Firebase ───────────────────────
    const [fs, ts_, ls, as] = await Promise.all([
      dbGet("folders"), dbGet("tests"), dbGet("links"), dbGet("attempts")
    ]);
    window.folders  = toArr(fs).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    window.tests    = toArr(ts_).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    window.links    = toArr(ls).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    window.attempts = toArr(as).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    console.log(`✅ [app.js] data loaded (${window.tests.length} tests, ${window.attempts.length} attempts)`);

    saveCache(CACHE_KEY);
    notifyReady();
  } catch (e) {
    toast("Помилка завантаження: " + e.message, "err");
    console.error("[app.js] loadAllData:", e);
  }
}

// ─── Індекси для сторінки тесту ────────────────────────────────────────
// Студент на сторінці тесту не може читати всі спроби й картки студентів (правила
// бази), тому «вже проходив?» і «чия картка?» шукаються за ключем прізвище_ім'я:
//   attemptIndex/{testId}/{key} → attemptId,  studentIndex/{key} → studentId.
// Нові записи індексує сама сторінка тесту; тут раз на добу добудовуємо індекс
// для старих даних.
export function nameKey(name, surname){
  return `${String(surname||"").trim()}_${String(name||"").trim()}`.toLowerCase()
    .replace(/\s+/g, " ").replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, "_").slice(0, 200) || "_";
}
async function backfillIndexes(){
  const FLAG = `qf_idx_${uid}`;
  try { if (Date.now() - Number(localStorage.getItem(FLAG) || 0) < 864e5) return; } catch { return; }
  try {
    const [ai, si, st] = await Promise.all([dbGet("attemptIndex"), dbGet("studentIndex"), dbGet("students")]);
    const aIdx = ai.val() || {}, sIdx = si.val() || {}, upd = {};
    for (const a of (window.attempts || []).slice().sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))){
      if (!a.testId || !a.name || !a.surname) continue;
      const k = nameKey(a.name, a.surname);
      if (!aIdx[a.testId]?.[k]) upd[tp(`attemptIndex/${a.testId}/${k}`)] = a.id;
    }
    for (const [id, s] of Object.entries(st.val() || {})){
      if (!s?.name || !s?.surname) continue;
      const k = nameKey(s.name, s.surname);
      if (!sIdx[k]) upd[tp(`studentIndex/${k}`)] = id;
    }
    if (Object.keys(upd).length) await update(ref(db), upd);
    localStorage.setItem(FLAG, String(Date.now()));
  } catch (e) { console.warn("[app.js] index backfill:", e.message); }
}

// ─── Публічний ініціалізатор ───────────────────────────────────────────
/**
 * @param {string} pageName — що підсвітити в sidebar (data-page)
 * @param {Object} options — { skipData: true } якщо сторінка сама грузить
 */
export async function initApp(pageName, options = {}) {
  ldr(true);
  // Страховка: якщо сторінка впала до appReady(), не лишаємо її під лоадером
  const _safety = setTimeout(() => ldr(false), 12000);
  const _onFail = () => setTimeout(() => ldr(false), 1500);
  window.addEventListener("error", _onFail, { once: true });
  window.addEventListener("unhandledrejection", _onFail, { once: true });
  document.addEventListener("qf:ready", () => {
    clearTimeout(_safety);
    window.removeEventListener("error", _onFail);
    window.removeEventListener("unhandledrejection", _onFail);
  }, { once: true });
  // Sidebar + модалки завантажуємо паралельно
  await Promise.all([
    loadSidebar(pageName),
    loadModals()
  ]);
  if (!options.skipData) {
    await loadAllData();
    setTimeout(backfillIndexes, 3000);
  }
  // ldr(false) НЕ викликаємо — це робить сторінка після того як все відрендерить
  // (див. initFeatures → renderAll → specific hook → appReady())
}

// Явна функція щоб показати "все готово" — сторінка викликає після renderAll

// ─── Bug Report ────────────────────────────────────────────────────────────
window.openBugReport = () => {
  let ov = document.getElementById("qf-bug-ov");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "qf-bug-ov";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(11,20,55,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(5px)";
    ov.innerHTML = `<div style="background:#fff;border-radius:18px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(11,20,55,.2)">
      <h3 style="margin:0 0 4px;font-size:17px;font-weight:800;color:#0B1437;font-family:Manrope,sans-serif">Повідомити</h3>
      <p style="font-size:13px;color:#5B6A8F;margin:0 0 14px;font-family:Manrope,sans-serif">Оберіть тип та опишіть детально</p>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button id="qf-type-bug" onclick="window.selectBugType('bug')" style="flex:1;padding:9px 12px;border-radius:10px;font-family:Manrope,sans-serif;font-size:13px;font-weight:700;cursor:pointer;border:2px solid #EF4444;background:#FEE2E2;color:#B91C1C;transition:all .15s">Проблема</button>
        <button id="qf-type-imp" onclick="window.selectBugType('improvement')" style="flex:1;padding:9px 12px;border-radius:10px;font-family:Manrope,sans-serif;font-size:13px;font-weight:700;cursor:pointer;border:2px solid #E3E8F2;background:#F4F6FB;color:#5B6A8F;transition:all .15s">Покращення</button>
      </div>
      <div style="font-size:12px;font-family:monospace;background:#F4F6FB;border:1px solid #E3E8F2;border-radius:7px;padding:6px 10px;color:#1E3A8A;margin-bottom:12px" id="qf-bug-pg"></div>
      <textarea id="qf-bug-txt" placeholder="Опишіть детально..." style="width:100%;min-height:90px;border:1.5px solid #E3E8F2;border-radius:11px;padding:10px 12px;font-family:Manrope,sans-serif;font-size:14px;resize:vertical;outline:none;box-sizing:border-box;color:#0B1437"></textarea>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button onclick="window.closeBugReport()" style="flex:1;padding:10px;border-radius:9px;font-family:Manrope,sans-serif;font-size:14px;font-weight:700;cursor:pointer;border:1px solid #E3E8F2;background:#F4F6FB;color:#5B6A8F">Скасувати</button>
        <button id="qf-bug-sb" onclick="window.sendBugReport()" style="flex:1;padding:10px;border-radius:9px;font-family:Manrope,sans-serif;font-size:14px;font-weight:700;cursor:pointer;border:none;background:#1E3A8A;color:#fff">Надіслати</button>
      </div>
      <div id="qf-bug-ok" style="display:none;text-align:center;padding:16px;font-size:14px;font-weight:700;color:#059669;font-family:Manrope,sans-serif">Дякуємо! Повідомлення надіслано.</div>
    </div>`;
    ov.addEventListener("click", e => { if (e.target === ov) window.closeBugReport(); });
    document.body.appendChild(ov);
  }
  document.getElementById("qf-bug-pg").textContent = document.body.dataset.page || location.pathname.split("/").pop() || "—";
  document.getElementById("qf-bug-txt").value = "";
  window.selectBugType("bug");
  document.getElementById("qf-bug-ok").style.display = "none";
  const sb = document.getElementById("qf-bug-sb");
  if (sb) { sb.disabled = false; sb.textContent = "Надіслати"; }
  ov.style.display = "flex";
};
window.closeBugReport = () => {
  const ov = document.getElementById("qf-bug-ov");
  if (ov) ov.style.display = "none";
};
let _bugType = "bug";
window.selectBugType = (type) => {
  _bugType = type;
  const bugBtn = document.getElementById("qf-type-bug");
  const impBtn = document.getElementById("qf-type-imp");
  if (!bugBtn || !impBtn) return;
  if (type === "bug") {
    bugBtn.style.border = "2px solid #EF4444"; bugBtn.style.background = "#FEE2E2"; bugBtn.style.color = "#B91C1C";
    impBtn.style.border = "2px solid #E3E8F2"; impBtn.style.background = "#F4F6FB"; impBtn.style.color = "#5B6A8F";
  } else {
    impBtn.style.border = "2px solid #7C3AED"; impBtn.style.background = "#EDE9FE"; impBtn.style.color = "#6D28D9";
    bugBtn.style.border = "2px solid #E3E8F2"; bugBtn.style.background = "#F4F6FB"; bugBtn.style.color = "#5B6A8F";
  }
};
window.sendBugReport = async () => {
  const text = (document.getElementById("qf-bug-txt")?.value || "").trim();
  if (!text) { document.getElementById("qf-bug-txt")?.focus(); return; }
  const btn = document.getElementById("qf-bug-sb");
  if (btn) { btn.disabled = true; btn.textContent = "Надсилаємо..."; }
  const page = document.body.dataset.page || location.pathname.split("/").pop() || "—";
  const userName = document.getElementById("sb-teacher-name")?.textContent || "—";
  try {
    const { push, ref: fbR } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    await push(fbR(db, "bugReports"), {
      message: text,
      reportType: _bugType,
      page,
      uid: uid || "—",
      userName,
      createdAt: Date.now(),
      status: "new"
    });
    // Дублюємо в Telegram (не блокує основний флоу — помилка тут не заважає
    // самому репорту, який уже успішно збережено вище)
    notifyTelegramBugReport({ text, reportType: _bugType, page, userName }).catch(() => {});
    const ok = document.getElementById("qf-bug-ok");
    if (ok) ok.style.display = "block";
    setTimeout(() => window.closeBugReport(), 2000);
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = "Надіслати"; }
    alert("Помилка: " + e.message);
  }
};

// ─── Дублювання репортів у Telegram ────────────────────────────────────────
// Читає settings/telegramBot (токен + увімкнено) і telegramChats (кому надсилати,
// notify:true) — те саме сховище, яким керує адмінська сторінка admin/telegram.html.
function escTg(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function notifyTelegramBugReport({ text, reportType, page, userName }) {
  const { get: fbGet, ref: fbR } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const cfgSnap = await fbGet(fbR(db, "settings/telegramBot"));
  const cfg = cfgSnap.exists() ? cfgSnap.val() : null;
  if (!cfg?.enabled || !cfg?.token) return;

  // Отримувачі — у settings/telegramBot/recipients (admin/telegram). Старий шлях
  // через telegramChats (з усією історією переписки) лише як запасний.
  let recipients = Object.keys(cfg.recipients || {}).filter(id => cfg.recipients[id]);
  if (!cfg.recipients){
    const chatsSnap = await fbGet(fbR(db, "telegramChats"));
    const chats = chatsSnap.exists() ? chatsSnap.val() : {};
    recipients = Object.keys(chats).filter(id => chats[id]?.notify);
  }
  if (!recipients.length) return;

  const isImprovement = reportType === "improvement";
  const emoji = isImprovement ? "💡" : "🐞";
  const label = isImprovement ? "Ідея покращення" : "Проблема";
  const now = new Date().toLocaleString("uk-UA", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });

  const msg =
    `<b>${emoji} QuizFlow · ${label}</b>\n` +
    `<blockquote>${escTg(text)}</blockquote>\n` +
    `${escTg(userName)} · <code>${escTg(page)}</code> · ${now}`;

  await Promise.all(recipients.map(chatId =>
    fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML" })
    }).catch(() => {})
  ));
}

export function appReady() {
  ldr(false);
}

export default { initApp, appReady, onDataReady, db, tp, user, uid, toast, ldr, $, esc, toArr };

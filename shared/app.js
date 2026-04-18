// ═══════════════════════════════════════════════════════════════════════
// shared/app.js — ядро QuizFlow (Firebase, auth, sidebar, спільні утиліти)
//
// Експортує ES-модульно І вішає на window — щоб inline handlers
// (onclick="toast('...')", etc.) продовжували працювати
// ═══════════════════════════════════════════════════════════════════════

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, get, set, push, update, remove, onValue, off } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ─── Firebase ──────────────────────────────────────────────────────────
const FC = {
  apiKey: "AIzaSyDsA4IQkn5tV41LDK43vzgm0XnRnbdgvTc",
  authDomain: "quizflow-8a978.firebaseapp.com",
  databaseURL: "https://quizflow-8a978-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "quizflow-8a978",
  storageBucket: "quizflow-8a978.firebasestorage.app",
  messagingSenderId: "206469794166",
  appId: "1:206469794166:web:55cd7007b429607acd5257"
};
const app = getApps().length ? getApps()[0] : initializeApp(FC);
const db = getDatabase(app);

// Експонуємо на window — щоб features.js міг використати без імпорту
window._fb = { db, ref, get, set, push, update, remove, onValue, off };

export { db, ref, get, set, push, update, remove, onValue, off };

// ─── Auth ──────────────────────────────────────────────────────────────
const _sess = sessionStorage.getItem("qf_user");
if (!_sess) { location.href = "login.html"; throw new Error("no session"); }
let _user;
try { _user = JSON.parse(_sess); }
catch { sessionStorage.clear(); location.href = "login.html"; throw new Error("bad session"); }
if (!_user || !_user.id) { sessionStorage.clear(); location.href = "login.html"; throw new Error("no user id"); }

export const user = _user;
export const uid = _user.id;

window._user = _user;
window._uid = uid;

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
window.doLogout = () => {
  sessionStorage.clear();
  location.href = "login.html";
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
  if (!el) {
    el = document.createElement("div");
    el.id = "app-loader";
    el.innerHTML = '<div class="spin" style="width:44px;height:44px;border:3.5px solid rgba(45,91,227,.15);border-top-color:var(--primary);border-radius:50%;animation:appSpin .8s linear infinite"></div><div style="font-size:13px;color:var(--muted);margin-top:12px">Завантаження...</div>';
    el.style.cssText = "position:fixed;inset:0;background:var(--bg);z-index:9998;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity .2s";
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
    el.style.opacity = "1";
  } else {
    // Показуємо sidebar + main (знімаємо opacity:0 з CSS)
    document.body.classList.add("app-ready");
    el.style.opacity = "0";
    setTimeout(() => { el.style.display = "none"; }, 200);
  }
}
window.ldr = ldr;

// ─── Sidebar toggle ────────────────────────────────────────────────────
window.toggleSidebar = function () {
  const sb = document.getElementById("sidebar");
  const main = document.querySelector(".main");
  const icon = document.getElementById("sb-toggle-icon");
  const isCollapsed = sb.classList.toggle("collapsed");
  if (main) main.classList.toggle("sb-collapsed-main", isCollapsed);
  if (icon) icon.style.transform = isCollapsed ? "rotate(180deg)" : "";
  localStorage.setItem("qf_sb_collapsed", isCollapsed ? "1" : "0");
};

// ─── Modal helpers ─────────────────────────────────────────────────────
window.openM = function (id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = "flex"; el.classList.add("on"); }
};
window.closeM = function (id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove("on");
    setTimeout(() => { if (!el.classList.contains("on")) el.style.display = "none"; }, 200);
  }
};
document.addEventListener("click", e => {
  if (e.target.classList && e.target.classList.contains("mo")) {
    e.target.classList.remove("on");
    setTimeout(() => { if (!e.target.classList.contains("on")) e.target.style.display = "none"; }, 200);
  }
});

// ─── Sidebar: завантаження + підсвітка активної сторінки ───────────────
async function loadSidebar(activePage) {
  try {
    const resp = await fetch("shared/layout.html");
    if (!resp.ok) throw new Error("layout.html " + resp.status);
    const html = await resp.text();
    const mainEl = document.querySelector(".main");
    if (!mainEl) {
      console.error("[app.js] не знайдено <main class='main'>");
      return;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const sidebar = wrap.querySelector("aside#sidebar");
    if (sidebar) mainEl.parentNode.insertBefore(sidebar, mainEl);

    if (activePage) {
      const activeEl = document.querySelector(`#sidebar [data-page="${activePage}"]`);
      if (activeEl) activeEl.classList.add("active");
    }

    const sbName = document.getElementById("sb-teacher-name");
    if (sbName) sbName.textContent = _user.name || _user.login;
    const sbAva = document.getElementById("sb-ava");
    if (sbAva) sbAva.textContent = (_user.name || _user.login || "?").slice(0, 2).toUpperCase();
    const sbRole = document.getElementById("sb-role");
    if (sbRole) sbRole.textContent = _user.role === "admin" ? "Адміністратор" : "Викладач";
    if (_user.role === "admin") {
      const adminBtn = document.getElementById("admin-panel-btn");
      if (adminBtn) adminBtn.style.display = "";
    }

    if (localStorage.getItem("qf_sb_collapsed") === "1") {
      const sb = document.getElementById("sidebar");
      const main = document.querySelector(".main");
      const icon = document.getElementById("sb-toggle-icon");
      if (sb) sb.classList.add("collapsed");
      if (main) main.classList.add("sb-collapsed-main");
      if (icon) icon.style.transform = "rotate(180deg)";
    }
  } catch (e) {
    console.error("[app.js] loadSidebar failed:", e);
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

async function loadAllData() {
  try {
    const uSnap = await get(ref(db, `users/${uid}`));
    if (uSnap.exists() && uSnap.val().blocked === true) {
      sessionStorage.clear();
      alert("Ваш акаунт заблоковано. Зверніться до адміністратора.");
      location.href = "login.html";
      return;
    }
  } catch (e) { console.warn("[app.js] block check failed:", e.message); }

  try {
    const [fs, ts_, ls, as] = await Promise.all([
      dbGet("folders"), dbGet("tests"), dbGet("links"), dbGet("attempts")
    ]);
    window.folders = toArr(fs).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    window.tests = toArr(ts_).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    window.links = toArr(ls).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    window.attempts = toArr(as).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    console.log(`✅ [app.js] data loaded (${window.tests.length} tests, ${window.attempts.length} attempts)`);
    notifyReady();
  } catch (e) {
    toast("Помилка завантаження: " + e.message, "err");
    console.error("[app.js] loadAllData:", e);
  }
}

// ─── Публічний ініціалізатор ───────────────────────────────────────────
/**
 * @param {string} pageName — що підсвітити в sidebar (data-page)
 * @param {Object} options — { skipData: true } якщо сторінка сама грузить
 */
export async function initApp(pageName, options = {}) {
  ldr(true);
  await loadSidebar(pageName);
  if (!options.skipData) {
    await loadAllData();
  }
  ldr(false);
}

export default { initApp, onDataReady, db, tp, user, uid, toast, ldr, $, esc, toArr };

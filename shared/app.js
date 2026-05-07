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
// Читаємо обидва сховища: localStorage основне, sessionStorage — fallback (legacy).
// Так сесія переживає закриття вкладки/браузера.
const _sess = localStorage.getItem("qf_user") || sessionStorage.getItem("qf_user");
if (!_sess) { location.href = "login.html"; throw new Error("no session"); }
let _user;
try { _user = JSON.parse(_sess); }
catch {
  localStorage.removeItem("qf_user");
  sessionStorage.removeItem("qf_user");
  location.href = "login.html";
  throw new Error("bad session");
}
if (!_user || !_user.id) {
  localStorage.removeItem("qf_user");
  sessionStorage.removeItem("qf_user");
  location.href = "login.html";
  throw new Error("no user id");
}

// Якщо знайшли в sessionStorage — мігруємо в localStorage щоб надалі не губилось
if (!localStorage.getItem("qf_user")) {
  try { localStorage.setItem("qf_user", _sess); } catch {}
}

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
  // Чистимо обидва сховища (qf_user + кеші)
  localStorage.removeItem("qf_user");
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
    // Показуємо sidebar + main (знімаємо opacity:0 з CSS)
    document.body.classList.add("app-ready");
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
// ─── Модалки: завантажуються один раз з shared/modals.html ─────────────
async function loadModals() {
  // Якщо сторінка уже містить <div id="modals-root"> — туди й вставимо,
  // інакше створимо новий контейнер перед </body>
  try {
    const resp = await fetch("shared/modals.html");
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

async function loadSidebar(activePage) {
  try {
    // ─── 1) Тягнемо nav config з Firebase (з кешем в localStorage) ──────────
    let navData = null;
    const NAV_CACHE_KEY = "qf_nav_cache";
    const NAV_TS_KEY    = "qf_nav_ts";

    try {
      // Перевіряємо чи є свіжий кеш
      const cachedTs  = localStorage.getItem(NAV_TS_KEY);
      const cachedNav = localStorage.getItem(NAV_CACHE_KEY);
      // Читаємо серверний timestamp (легкий запит)
      const { getDatabase, ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const db = getDatabase();
      const tsSnap = await get(ref(db, "settings/navigation_ts"));
      const serverTs = tsSnap.exists() ? String(tsSnap.val()) : null;

      if (cachedNav && cachedTs && serverTs && cachedTs === serverTs) {
        // Кеш свіжий — використовуємо
        navData = JSON.parse(cachedNav);
      } else {
        // Тягнемо повну конфігурацію
        const navSnap = await get(ref(db, "settings/navigation"));
        if (navSnap.exists()) {
          navData = navSnap.val();
          localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(navData));
          if (serverTs) localStorage.setItem(NAV_TS_KEY, serverTs);
        }
      }
    } catch(e) {
      console.warn("[app.js] nav config load failed, fallback to layout.html:", e.message);
    }

    // ─── 2) Якщо Firebase-конфіг є — будуємо sidebar динамічно ─────────────
    if (navData && Array.isArray(navData) && navData.length > 0) {
      await buildDynamicSidebar(navData, activePage);
      return;
    }

    // ─── 3) Fallback — завантажуємо статичний layout.html ───────────────────
    const resp = await fetch("shared/layout.html?v=15");
    if (!resp.ok) throw new Error("layout.html " + resp.status);
    const html = await resp.text();
    const mainEl = document.querySelector(".main");
    if (!mainEl) { console.error("[app.js] не знайдено <main class='main'>"); return; }
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const sidebar = wrap.querySelector("aside#sidebar");
    if (sidebar) mainEl.parentNode.insertBefore(sidebar, mainEl);
    finishSidebar(activePage);

  } catch (e) {
    console.error("[app.js] loadSidebar failed:", e);
  }
}

// ─── Будує sidebar з Firebase-конфігу ───────────────────────────────────────
async function buildDynamicSidebar(navData, activePage) {
  const mainEl = document.querySelector(".main");
  if (!mainEl) return;

  // SVG іконки — мінімальний набір (ключ → SVG path)
  const ICONS = {
    dashboard:  '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    home:       '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    files:      '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    clock:      '<path d="M12 3v3"/><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/>',
    link:       '<path d="M10 13a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1.5 1.5"/><path d="M14 11a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1.5-1.5"/>',
    "chart-bar":'<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>',
    book:       '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
    users:      '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2.6 2-4.8 4.5-5"/>',
    bell:       '<path d="M6 15V11a6 6 0 1112 0v4l1.5 3h-15z"/><path d="M10 20a2 2 0 004 0"/>',
    shield:     '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    live:       '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
    news:       '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 9h6M7 13h6M7 17h4"/><path d="M17 8h3v9a2 2 0 01-2 2"/>',
    analytics:  '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>',
    star:       '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    activity:   '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    settings:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    file:       '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    search:     '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    zap:        '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    graduation: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5"/>',
    user:       '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    target:     '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    refresh:    '<path d="M4 12a8 8 0 0113.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 01-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>',
    trending:   '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    inbox:      '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
    percent:    '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    award:      '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>',
    "chart-line":'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    pie:        '<path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/>',
    grid:       '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    key:        '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    lock:       '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    filter:     '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    edit:       '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    clipboard:  '<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    "arrow-r":  '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    external:   '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  };

  function iconSvg(id) {
    const d = ICONS[id] || ICONS["file"];
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  }

  // Badge IDs по page-id (для динамічного оновлення лічильників)
  const BADGE_IDS = {
    tests: "nb-t", attempts: "nb-a", links: "nb-l",
    students: "nb-students", notifications: "nb-notif",
    suspicious: "nb-suspicious", online: "nb-online", news: "nb-news"
  };

  let sectionsHtml = "";
  navData.forEach(sec => {
    const enabledItems = sec.items.filter(it => it.enabled !== false);
    if (!enabledItems.length) return;

    const itemsHtml = enabledItems.map(item => {
      const badgeId = BADGE_IDS[item.id] || ("nb-" + item.id);
      const isExternal = item.file && (item.file.startsWith("http://") || item.file.startsWith("https://"));
      const href = item.file ? item.file : "#";
      return `<a class="ni" data-page="${item.id}" data-tip="${item.label}" href="${href}"${isExternal ? ' target="_blank" rel="noopener"' : ''}>
        <span class="sb-ico">${iconSvg(item.icon)}</span>
        <span class="ni-label">${item.label}</span>
        <span class="nb" id="${badgeId}" style="display:none">0</span>
      </a>`;
    }).join("");

    sectionsHtml += `<div class="sb-section">
      <div class="nav-sec">${sec.label}</div>
      ${itemsHtml}
    </div>`;
  });

  const sidebarHtml = `<aside class="sb" id="sidebar">
    <div class="sb-head">
      <div class="logo">
        <div class="logo-i">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h11a4 4 0 0 1 4 4v1"/>
            <path d="M20 17H9a4 4 0 0 1-4-4v-1"/>
            <circle cx="5" cy="7" r="1.3" fill="#fff"/>
            <circle cx="19" cy="17" r="1.3" fill="#fff"/>
          </svg>
        </div>
        <span class="logo-t">quiz<em>flow</em></span>
      </div>
      <button id="sb-toggle" onclick="toggleSidebar()" title="Згорнути меню" aria-label="Згорнути меню">
        <svg id="sb-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
    </div>
    <button id="sb-toggle-collapsed" onclick="toggleSidebar()" title="Розгорнути меню" aria-label="Розгорнути меню">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <nav class="sb-scroll"><div class="sb-section">${sectionsHtml}</div></nav>
    <div class="sb-bottom">
      <div class="sb-icon-row">
        <a href="live.html" target="_blank" data-tip="Live" class="ni ni-live ni-icon-only">
          <span class="sb-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg></span>
          <span class="ni-label">Live</span>
          <svg class="ni-ext sb-bottom-labels" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>
        </a>
        <a href="/admin/overview.html" id="admin-panel-btn" target="_blank" rel="noopener" data-tip="Адмін" class="ni ni-admin ni-icon-only" style="display:none">
          <span class="sb-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
          <span class="ni-label">Адмін-панель</span>
          <svg class="ni-ext sb-bottom-labels" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>
        </a>
        <button class="ni ni-help ni-icon-only" data-tip="Інструкція" onclick="window.openOnboarding && window.openOnboarding()">
          <span class="sb-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4"/><path d="M12 17h.01"/></svg></span>
          <span class="ni-label">Інструкція</span>
        </button>
        <button class="ni ni-report ni-icon-only" data-tip="Повідомити про помилку" onclick="openBugReport()">
          <span class="sb-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></span>
          <span class="ni-label">Повідомити про помилку</span>
        </button>
      </div>
      <div class="sb-foot-inner">
        <div class="ava" id="sb-ava">ВЧ</div>
        <div class="sb-texts">
          <div class="sb-name" id="sb-teacher-name">Викладач</div>
          <div class="sb-role" id="sb-role">Викладач</div>
        </div>
        <button onclick="doLogout()" title="Вийти" aria-label="Вийти" class="sb-logout sb-bottom-labels">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </div>
  </aside>`;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = sidebarHtml;
  const sidebar = wrapper.querySelector("aside#sidebar");
  if (sidebar) mainEl.parentNode.insertBefore(sidebar, mainEl);

  finishSidebar(activePage);
}

// ─── Спільне завершення після вставки sidebar ────────────────────────────────
function finishSidebar(activePage) {
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
    const uSnap = await get(ref(db, `users/${uid}`));
    if (uSnap.exists() && uSnap.val().blocked === true) {
      localStorage.removeItem("qf_user");
      sessionStorage.clear();
      alert("Ваш акаунт заблоковано. Зверніться до адміністратора.");
      location.href = "login.html";
      return;
    }
  } catch (e) { console.warn("[app.js] block check failed:", e.message); }

  // ─── 1) Пробуємо sessionStorage-кеш ─────────────────────────────────
  // Кеш живе поки вкладка відкрита і не старше 60 секунд.
  // При навігації між сторінками — дані показуються МИТТЄВО з кешу.
  const CACHE_KEY = "qf_cache_v1";
  const CACHE_MAX_AGE = 60 * 1000; // 60 сек

  const cached = tryLoadCache(CACHE_KEY, CACHE_MAX_AGE);
  if (cached) {
    window.folders = cached.folders;
    window.tests = cached.tests;
    window.links = cached.links;
    window.attempts = cached.attempts;
    console.log(`⚡ [app.js] з кешу (${cached.tests.length} тестів, вік ${Math.round((Date.now()-cached.savedAt)/1000)}с)`);
    notifyReady();
    // Фонове оновлення — realtime listeners з features.js все одно підпишуться,
    // тому окремий запит не потрібен. Дані автоматично оновляться через onValue.
    return;
  }

  // ─── 2) Кешу немає — тягнемо свіже з Firebase ───────────────────────
  try {
    const [fs, ts_, ls, as] = await Promise.all([
      dbGet("folders"), dbGet("tests"), dbGet("links"), dbGet("attempts")
    ]);
    window.folders = toArr(fs).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    window.tests = toArr(ts_).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    window.links = toArr(ls).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    window.attempts = toArr(as).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    console.log(`✅ [app.js] data loaded (${window.tests.length} tests, ${window.attempts.length} attempts)`);

    // Зберігаємо в кеш для наступної сторінки
    saveCache(CACHE_KEY);
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
  // Sidebar + модалки завантажуємо паралельно
  await Promise.all([
    loadSidebar(pageName),
    loadModals()
  ]);
  if (!options.skipData) {
    await loadAllData();
  }
  // ldr(false) НЕ викликаємо — це робить сторінка після того як все відрендерить
  // (див. initFeatures → renderAll → specific hook → appReady())
}

// Явна функція щоб показати "все готово" — сторінка викликає після renderAll
// ─── Bug Report ────────────────────────────────────────────────────────────
function injectBugModal() {
  if (document.getElementById("bug-overlay")) return;
  const el = document.createElement("div");
  el.id = "bug-overlay";
  el.className = "bug-overlay";
  el.innerHTML = `
    <div class="bug-modal">
      <h3>Повідомити про помилку</h3>
      <p class="bug-sub">Опишіть що сталось — ми розглянемо якомога швидше</p>
      <div class="bug-page">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/></svg>
        <span id="bug-page-label">—</span>
      </div>
      <textarea id="bug-text" placeholder="Опишіть помилку або проблему..."></textarea>
      <div class="bug-btns">
        <button class="bug-btn cancel" onclick="closeBugReport()">Скасувати</button>
        <button class="bug-btn send" id="bug-send-btn" onclick="sendBugReport()">Надіслати</button>
      </div>
      <div class="bug-ok" id="bug-ok">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        Дякуємо! Повідомлення надіслано.
      </div>
    </div>`;
  el.addEventListener("click", e => { if (e.target === el) closeBugReport(); });
  document.body.appendChild(el);
}

window.openBugReport = () => {
  injectBugModal();
  const page = document.body.dataset.page || location.pathname.split("/").pop() || "—";
  document.getElementById("bug-page-label").textContent = page;
  document.getElementById("bug-text").value = "";
  document.getElementById("bug-ok").style.display = "none";
  document.querySelector(".bug-modal .bug-btns").style.display = "flex";
  document.querySelector(".bug-modal textarea").style.display = "block";
  document.getElementById("bug-overlay").classList.add("open");
};
window.closeBugReport = () => {
  document.getElementById("bug-overlay")?.classList.remove("open");
};
window.sendBugReport = async () => {
  const text = document.getElementById("bug-text").value.trim();
  if (!text) { document.getElementById("bug-text").focus(); return; }
  const btn = document.getElementById("bug-send-btn");
  btn.disabled = true; btn.textContent = "Надсилаємо...";
  try {
    const { push, ref: dbRef } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    await push(dbRef(db, "bugReports"), {
      message: text,
      page: document.body.dataset.page || location.pathname.split("/").pop() || "—",
      url: location.href,
      uid: uid || "—",
      userName: document.getElementById("sb-teacher-name")?.textContent || "—",
      createdAt: Date.now(),
      status: "new"
    });
    document.querySelector(".bug-modal .bug-btns").style.display = "none";
    document.querySelector(".bug-modal textarea").style.display = "none";
    document.getElementById("bug-ok").style.display = "block";
    setTimeout(() => closeBugReport(), 2000);
  } catch(e) {
    btn.disabled = false; btn.textContent = "Надіслати";
    alert("Помилка: " + e.message);
  }
};

export function appReady() {
  ldr(false);
}

export default { initApp, appReady, onDataReady, db, tp, user, uid, toast, ldr, $, esc, toArr };

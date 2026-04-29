// ═══════════════════════════════════════════════════════════════════════════
//  admin-shell.js — спільний bootstrap для всіх сторінок адмінки
//
//  Кожна сторінка адмінки імпортує initAdminShell(activePage):
//
//    import { initAdminShell, dbGet } from "./shared/admin-shell.js";
//    await initAdminShell("overview");
//
//  Що робить:
//    1) Перевіряє auth: якщо немає sessionStorage.qf_user або це не admin —
//       редіректить на ../login.html
//    2) Інжектує sidebar + topbar (HTML-фрагмент) і підсвічує активний пункт
//    3) Запускає Firebase + експортує `db`, `dbGet`, `dbUpd`, etc.
//    4) Експортує стан `_user`, _users, _stats, _allAttempts через window
//    5) Дає утіли: esc, genPass, formatTimeAgo, openModal, closeModal, toast, doLogout
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, get, set, update, remove, onValue }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const cfg = {
  apiKey: "AIzaSyDsA4IQkn5tV41LDK43vzgm0XnRnbdgvTc",
  authDomain: "quizflow-8a978.firebaseapp.com",
  databaseURL: "https://quizflow-8a978-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "quizflow-8a978",
  storageBucket: "quizflow-8a978.firebasestorage.app",
  messagingSenderId: "206469794166",
  appId: "1:206469794166:web:55cd7007b429607acd5257"
};
const app = getApps().length ? getApps()[0] : initializeApp(cfg);
const db = getDatabase(app);

// ─── Helpers (чисті утіли, без DOM) ─────────────────────────────────────────

export const esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

export const genPass = () => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#";
  return Array.from({length:10}, () => c[Math.floor(Math.random()*c.length)]).join("");
};

export function formatTimeAgo(ts){
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60000) return "щойно";
  if (diff < 3600000) return Math.floor(diff/60000) + " хв тому";
  if (diff < 86400000) return Math.floor(diff/3600000) + " год тому";
  if (diff < 604800000) return Math.floor(diff/86400000) + " дн тому";
  return new Date(ts).toLocaleDateString("uk-UA", {day:"numeric", month:"short"});
}

// ─── Firebase helpers (export) ──────────────────────────────────────────────

export async function dbGet(path){
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}
export async function dbSet(path, value){ await set(ref(db, path), value); }
export async function dbUpd(path, value){ await update(ref(db, path), value); }
export async function dbRemove(path){ await remove(ref(db, path)); }
export { db, ref, get, set, update, remove, onValue };

// ─── Modal / Toast (DOM utilities) ──────────────────────────────────────────

export function openModal(id){
  const el = document.getElementById(id);
  if (el) el.classList.add("on");
}
export function closeModal(id){
  const el = document.getElementById(id);
  if (el) el.classList.remove("on");
}
let _toastT;
export function toast(msg){
  const el = document.getElementById("admin-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove("show"), 3000);
}

// ─── Auth ───────────────────────────────────────────────────────────────────

function getCurrentUser(){
  const sess = sessionStorage.getItem("qf_user");
  if (!sess) return null;
  try {
    const u = JSON.parse(sess);
    if (!u || u.role !== "admin") return null;
    return u;
  } catch { return null; }
}

export function doLogout(){
  sessionStorage.clear();
  location.href = "../login.html";
}

// ─── Sidebar / Topbar markup ────────────────────────────────────────────────

const NAV_ITEMS = [
  { sec:"ПАНЕЛЬ", items:[
    { id:"overview", icon:"overview", label:"Огляд",            href:"overview.html" },
    { id:"teachers", icon:"teachers", label:"Викладачі",        href:"teachers.html" },
    { id:"stats",    icon:"stats",    label:"Статистика",       href:"stats.html" },
    { id:"news",     icon:"news",     label:"Новини",           href:"news.html" },
    { id:"ai",       icon:"ai",       label:"AI Налаштування",  href:"ai-settings.html" },
  ]},
  { sec:"АКАУНТ", items:[
    { id:"dashboard", icon:"dashboard", label:"Дашборд викладача", href:"../index.html" },
    { id:"logout",    icon:"logout",    label:"Вийти",            href:"#", onClick:"doLogout" },
  ]}
];

const ICONS = {
  overview:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  teachers:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2.6 2-4.8 4.5-5"/></svg>',
  stats:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/></svg>',
  news:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 9h6M7 13h6M7 17h4"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/></svg>',
  ai:        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><rect x="6" y="3" width="12" height="14" rx="3"/><path d="M9 9h.01M15 9h.01"/><path d="M9 13c1 1 2 1.5 3 1.5s2-.5 3-1.5"/><path d="M12 17v3"/><path d="M9 21h6"/></svg>',
  dashboard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  logout:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  bell:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15V11a6 6 0 1 1 12 0v4l1.5 3h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  search:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  chevron:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  help:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/><circle cx="12" cy="17" r=".9" fill="currentColor"/></svg>',
};

function renderSidebar(activeId, user){
  const initials = (user.name || user.login || "?").slice(0, 2).toUpperCase();
  return `
  <aside class="sidebar">
    <div class="sb-brand">
      <div class="sb-brand-mark">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 7h11a4 4 0 0 1 4 4v1"/>
          <path d="M20 17H9a4 4 0 0 1-4-4v-1"/>
          <circle cx="5" cy="7" r="1.3" fill="#fff"/>
          <circle cx="19" cy="17" r="1.3" fill="#fff"/>
        </svg>
      </div>
      <div>
        <div class="sb-brand-name">quiz<em>flow</em></div>
        <div class="sb-admin-tag">Admin</div>
      </div>
    </div>

    ${NAV_ITEMS.map(sec => `
      <div class="sb-section">
        <div class="sb-section-label">${sec.sec}</div>
        ${sec.items.map(it => {
          const onClick = it.onClick ? `onclick="window.${it.onClick}(); return false;"` : "";
          return `<a href="${it.href}" ${onClick} class="sb-item${activeId === it.id ? " on" : ""}">
            <span class="ico">${ICONS[it.icon] || ""}</span>
            <span class="lbl">${it.label}</span>
          </a>`;
        }).join("")}
      </div>
    `).join("")}

    <div class="sb-spacer"></div>

    <div class="sb-user">
      <div class="sb-avatar">${esc(initials)}</div>
      <div style="flex:1; min-width:0">
        <div class="sb-user-name">${esc(user.name || user.login)}</div>
        <div class="sb-user-role">Адміністратор</div>
      </div>
      <span class="ico" style="color:#7889B5">${ICONS.chevron}</span>
    </div>
  </aside>`;
}

function renderTopbar(crumbs){
  const crumbsHtml = crumbs.map((c, i) => {
    const sep = i > 0 ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>` : "";
    const tag = i === crumbs.length - 1 ? `<b>${esc(c)}</b>` : `<span>${esc(c)}</span>`;
    return sep + tag;
  }).join("");

  return `
  <header class="topbar">
    <nav class="crumbs">
      <span>Admin</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
      ${crumbsHtml}
    </nav>
    <div class="tb-spacer"></div>
    <button class="tb-icon" id="tb-help" title="Допомога">${ICONS.help}</button>
    <div id="topbar-extras"></div>
  </header>`;
}

function renderMobileBlock(){
  return `
  <div class="mobile-block">
    <div class="mb-mark">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7h11a4 4 0 0 1 4 4v1"/>
        <path d="M20 17H9a4 4 0 0 1-4-4v-1"/>
      </svg>
    </div>
    <div class="mb-h">Адмінка недоступна на мобільному</div>
    <div class="mb-p">Адмін-панель оптимізовано під ПК або планшет з шириною від 1024px. Відкрийте з ширшого екрану.</div>
    <div class="mb-meta">мінімум: 1024px · рекомендовано 1280px+</div>
  </div>`;
}

// ─── Шаблон сторінки ────────────────────────────────────────────────────────
//
// Кожна .html має містити (МІНІМУМ):
//
//  <body>
//    <div id="admin-loader"><div class="spin"></div></div>
//    <div id="admin-root"></div>     ← сюди вставляється sidebar + main
//    <div id="admin-modals"></div>   ← модалки
//    <div id="admin-toast" class="toast"></div>
//    <script type="module" src="./your-page.js"></script>
//  </body>
//
// Сторінка ВСЕРЕДИНІ свого скрипта робить:
//   const { _user } = await initAdminShell({
//     activeId: "overview",
//     crumbs: ["Огляд"],
//     content: "<div>...your content with elements...</div>"
//   });

export async function initAdminShell({ activeId, crumbs, content, topbarRight }){
  // Auth
  const _user = getCurrentUser();
  if (!_user){
    location.href = "../login.html";
    throw new Error("not authenticated");
  }

  // Render shell
  const root = document.getElementById("admin-root");
  if (!root){
    console.error("admin-root not found in DOM");
    return null;
  }

  root.innerHTML = `
    <div class="app">
      ${renderSidebar(activeId, _user)}
      <main class="main">
        ${renderTopbar(crumbs || [activeId])}
        <div class="content" id="admin-content">${content || ""}</div>
      </main>
    </div>
    ${renderMobileBlock()}
  `;

  // Topbar extras
  if (topbarRight){
    const extras = document.getElementById("topbar-extras");
    if (extras) extras.innerHTML = topbarRight;
  }

  // Expose user globally
  window._user = _user;
  window.doLogout = doLogout;

  // Hide loader
  const ld = document.getElementById("admin-loader");
  if (ld){
    ld.style.opacity = "0";
    setTimeout(() => { ld.style.display = "none"; }, 250);
  }

  return { _user };
}

// ─── loadAll: спільний завантажувач даних викладачів (overview/teachers/stats) ──

export async function loadAllTeachers(){
  const snap = await get(ref(db, "users"));
  if (!snap.exists()) return { _users: [], _stats: {}, _allAttempts: [] };

  const _users = Object.entries(snap.val())
    .filter(([id,u]) => u && typeof u === "object")
    .map(([id,u]) => ({ id, ...u }));

  const _allAttempts = [];
  const _stats = {};

  await Promise.all(_users.map(async u => {
    const [ts, as, ss, ls] = await Promise.all([
      get(ref(db, `teachers/${u.id}/tests`)),
      get(ref(db, `teachers/${u.id}/attempts`)),
      get(ref(db, `teachers/${u.id}/students`)),
      get(ref(db, `teachers/${u.id}/links`))
    ]);
    const atArr = as.exists() ? Object.values(as.val()) : [];
    atArr.forEach(a => _allAttempts.push({ ...a, teacherId: u.id, teacherName: u.name || u.login }));
    const activeTests = ts.exists() ? Object.values(ts.val()).filter(t => t.status === "active").length : 0;
    const lastAct = atArr.length ? Math.max(...atArr.map(a => a.createdAt || 0)) : 0;
    const weekAgo = Date.now() - 7*24*60*60*1000;
    const weekAttempts = atArr.filter(a => (a.createdAt || 0) >= weekAgo).length;
    _stats[u.id] = {
      tests: ts.exists() ? Object.keys(ts.val()).length : 0,
      activeTests,
      attempts: atArr.length,
      weekAttempts,
      students: ss.exists() ? Object.keys(ss.val()).length : 0,
      links: ls.exists() ? Object.keys(ls.val()).length : 0,
      lastAct
    };
  }));

  // Зберігаємо в window для зручності
  window._users = _users;
  window._stats = _stats;
  window._allAttempts = _allAttempts;

  return { _users, _stats, _allAttempts };
}

// Оголосити утіли як глобальні (для inline onclick=)
window.openModal = openModal;
window.closeModal = closeModal;
window.toast = toast;

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
//       редіректить на admin-login.html
//    2) Інжектує topbar + контент; меню (admin-nav.js) лише підсвічує й оновлює
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

// Фокус переходить у модалку й повертається на кнопку, що її відкрила
const _modalOpeners = new Map();
export function openModal(id){
  const el = document.getElementById(id);
  if (!el) return;
  _modalOpeners.set(id, document.activeElement);
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.classList.add("on");
  setTimeout(() => {
    if (!el.classList.contains("on") || el.contains(document.activeElement)) return;
    const f = el.querySelector("[autofocus]:not([disabled])")
      || [...el.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([readonly]):not([disabled])")].find(x => x.offsetParent && !x.value)
      || el.querySelector(".modal-f button:not([disabled]):last-child");
    try { f?.focus({ preventScroll: true }); } catch {}
  }, 60);
}
export function closeModal(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("on");
  const op = _modalOpeners.get(id);
  _modalOpeners.delete(id);
  try { if (op && document.contains(op)) op.focus({ preventScroll: true }); } catch {}
}
let _toastT;
export function toast(msg, type){
  const el = document.getElementById("admin-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("err", type === "err");
  el.classList.add("show");
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove("show"), 3000);
}

// ─── Auth (Firebase Auth) ────────────────────────────────────────────────────
import { getAuth, onAuthStateChanged, signOut as _signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const _adminAuth = getAuth(app);

// Чекаємо Firebase Auth — визначаємо поточного юзера
const _adminFbUser = await new Promise(resolve => {
  const unsub = onAuthStateChanged(_adminAuth, u => { unsub(); resolve(u); });
});

if (!_adminFbUser) {
  location.href = "admin-login";
  throw new Error("no auth");
}

// Читаємо профіль з DB і перевіряємо role === "admin"
const _adminProfileSnap = await get(ref(db, `users/${_adminFbUser.uid}`));
if (!_adminProfileSnap.exists() || _adminProfileSnap.val().role !== "admin") {
  await _signOut(_adminAuth);
  location.href = "admin-login";
  throw new Error("not admin");
}

const _adminProfile = _adminProfileSnap.val();

let _currentAdminUser = {
  id:      _adminFbUser.uid,
  email:   _adminFbUser.email,
  name:    _adminProfile.name    || "",
  surname: _adminProfile.surname || "",
  role:    "admin"
};

function getCurrentUser(){
  return _currentAdminUser;
}

export function doLogout(){
  try { localStorage.removeItem("qf_admin_user"); } catch {}
  _signOut(_adminAuth);
  location.href = "admin-login";
}

// ─── Sidebar / Topbar markup ────────────────────────────────────────────────

const ICONS = {
  overview:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  teachers:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2.6 2-4.8 4.5-5"/></svg>',
  stats:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/></svg>',
  news:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 9h6M7 13h6M7 17h4"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/></svg>',
  problems:  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
  ai:        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><rect x="6" y="3" width="12" height="14" rx="3"/><path d="M9 9h.01M15 9h.01"/><path d="M9 13c1 1 2 1.5 3 1.5s2-.5 3-1.5"/><path d="M12 17v3"/><path d="M9 21h6"/></svg>',
  menu:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  dashboard: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  logout:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  bell:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15V11a6 6 0 1 1 12 0v4l1.5 3h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  search:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  chevron:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  help:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/><circle cx="12" cy="17" r=".9" fill="currentColor"/></svg>',
};

// Меню малює admin-nav.js синхронно ще до Firebase (тому воно не зникає між
// сторінками). Якщо сторінка його не підключила — довантажуємо тут.
function ensureAdminNav(){
  if (window.AdminNav) return Promise.resolve();
  return new Promise(res => {
    const s = document.createElement("script");
    s.src = new URL("./admin-nav.js?v=1", import.meta.url).href;
    s.onload = s.onerror = () => res();
    document.head.appendChild(s);
  });
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
    location.href = "admin-login";
    throw new Error("not authenticated");
  }

  // Render shell
  const root = document.getElementById("admin-root");
  if (!root){
    console.error("admin-root not found in DOM");
    return null;
  }

  await ensureAdminNav();
  window.AdminNav?.ensure();
  window.AdminNav?.setActive(activeId);
  window.AdminNav?.setUser(_user);

  root.innerHTML = `
    <div class="app">
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

  // Safety timeout: якщо за 15с сторінка не приховала loader — приховуємо самі
  // (захист від зависань на повільному з'єднанні / помилках у renderAll)
  setTimeout(() => {
    const ld = document.getElementById("admin-loader");
    if (ld && ld.style.display !== "none") {
      console.warn("[admin-shell] Loader auto-hidden by safety timeout (15s)");
      hideLoader();
    }
  }, 15000);

  // Realtime badge для нових проблем
  const { onValue, ref: dbRef } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  onValue(dbRef(db, "bugReports"), snap => {
    const newCount = snap.exists()
      ? Object.values(snap.val()).filter(p => p.status === "new").length
      : 0;
    window.AdminNav?.setBadge(newCount);
  });

  return { _user };
}

// ─── Loader control ─────────────────────────────────────────────────────────
// Сторінки явно викликають hideLoader() після першого рендеру даних.
// Це треба щоб людина не бачила порожні картки/таблиці поки тягнуться дані.

export function hideLoader(){
  const ld = document.getElementById("admin-loader");
  if (!ld) return;
  if (ld.style.display === "none") return;
  ld.style.opacity = "0";
  setTimeout(() => { ld.style.display = "none"; }, 250);
}

export function showLoader(){
  const ld = document.getElementById("admin-loader");
  if (!ld) return;
  ld.style.display = "";
  // Force reflow перед opacity → плавний fade-in
  void ld.offsetHeight;
  ld.style.opacity = "1";
}

// Експортуємо у window щоб inline-onclick могли використати
window.hideLoader = hideLoader;
window.showLoader = showLoader;

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
    atArr.forEach(a => _allAttempts.push({ ...a, teacherId: u.id, teacherName: (u.surname ? u.surname + " " + u.name : u.name) || u.email || "" }));
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

// ═══════════════════════════════════════════════════════════════════════
// shared/features.js — увесь функціонал QuizFlow
//
// Підключається ПІСЛЯ shared/app.js — потребує window._fb, _user, _uid,
// toast, ldr, tp, $, esc, toArr, folders, tests, links, attempts
// ═══════════════════════════════════════════════════════════════════════

import { sanitizeNewsHtml, newsPlainText, newsExcerpt, readMinutes, catOf, isPublished } from "./news-utils.js?v=1";
import { buildQuestions, qVersionKey } from "./qorder.js?v=1";

const { db, ref, get, set, push, update, remove, onValue, off } = window._fb;

// ─── Питання спроби ──────────────────────────────────────────────────────
// Нові спроби не тримають копію питань: лише qVer (ключ версії в
// teachers/{uid}/qVersions) і порядок, у якому студент їх бачив. Версію
// перевіряємо за SHA-256 — підкладений вміст під чужий ключ не пройде.
const _qv = new Map();   // qVer -> { p: Promise, v: питання | null, done }
function loadQVer(ver){
  let e = _qv.get(ver);
  if (!e) {
    e = { done: false, v: null };
    e.p = (async () => {
      try {
        const v = (await get(ref(db, tp(`qVersions/${ver}`)))).val();
        const base = Array.isArray(v) ? v : v ? Object.values(v) : null;
        return base && await qVersionKey(base) === ver ? base : null;
      } catch { return null; }
    })().then(v => { e.v = v; e.done = true; return v; });
    _qv.set(ver, e);
  }
  return e;
}
// Питання так, як їх бачив студент. undefined — версія ще вантажиться.
function attemptQs(a, t){
  if (Array.isArray(a.questionsSnapshot)) return a.questionsSnapshot;
  if (a.qVer) {
    const e = loadQVer(a.qVer);
    if (!e.done) return undefined;
    if (e.v) return buildQuestions(e.v, a.qOrder, a.optOrder);
  }
  return t?.questions || [];
}
async function attemptQsAsync(a, t){
  if (a.qVer && !Array.isArray(a.questionsSnapshot)) await loadQVer(a.qVer).p;
  return attemptQs(a, t) || [];
}
const _user = window._user;
const _uid = window._uid;
const tp = window.tp;
const dbGet = window.dbGet;
const $ = window.$;
const esc = window.esc;
// Рядок як JS-літерал для inline-обробників: onclick="G.fn(${jsq(title)})".
// '${esc(x)}' ламався на апострофі («Об'єкти»), а &#39; браузер декодує назад в '
// ще до виконання JS — тож кнопки мовчки не працювали.
const jsq = s => esc(JSON.stringify(String(s ?? "")));
const ts = window.ts;
const toArr = window.toArr;
const toast = window.toast;
const ldr = window.ldr;
const openM = window.openM;
const closeM = window.closeM;

// Ці змінні використовуються по всьому коду. Робимо їх window-aliases
// через getters/setters, щоб присвоєння "tests = ..." автоматично писало на window
let folders = window.folders || [];
let tests = window.tests || [];
let links = window.links || [];
let attempts = window.attempts || [];
let _notifications = [];
let _realtimeActive = false;
let _selectedStId = null;

// Декларації для browser/Node-compat: ці функції визначаються нижче,
// але посилаються на них з G-namespace. В browser window.X = X всюди доступне,
// у Node — ні. Тому тримаємо окремі let + sync у кінці.
let renderTests, fillSelects, renderAttempts, renderLinks;

// Коли app.js закінчить loadAllData — прочитати з window
window.addEventListener("_qfDataReady", () => {
  folders = window.folders;
  tests = window.tests;
  links = window.links;
  attempts = window.attempts;
  if (window.renderAll) window.renderAll();
});

// ─── Helpers що використовуються по всьому коду ────────────────────────
const timeAgo = t => {
  if(!t) return "—";
  const d = (Date.now()-t)/1e3;
  if(d<60) return "щойно";
  if(d<3600) return `${Math.floor(d/60)} хв тому`;
  if(d<86400) return `${Math.floor(d/3600)} год тому`;
  if(d<172800) return "вчора";
  if(d<604800) return `${Math.floor(d/86400)} дн тому`;
  return new Date(t).toLocaleDateString("uk-UA");
};
const fmtTime = s => {
  const m = Math.floor(s/60), sc = Math.floor(s%60);
  return `${m}:${sc.toString().padStart(2,"0")}`;
};
const grBdg = g => g>=10 ? "bg-g" : g>=6 ? "bg-b" : "bg-r";
const stripHtml = s => {
  const tmp = document.createElement("div");
  tmp.innerHTML = s || "";
  return tmp.textContent || "";
};
// DB shortcuts (використовують tp з app.js)
// DB shortcuts — автоматично інвалідують кеш при мутаціях
// (бо щоразу як дані змінюються, треба наступного разу перечитати свіжі)
const _bust = () => { try { window.invalidateQfCache && window.invalidateQfCache(); } catch {} };
const dbPush = async (path, val) => { const r = push(ref(db, tp(path))); await set(r, val); _bust(); return r.key; };
const dbSet  = async (path, val) => { const r = await set(ref(db, tp(path)), val); _bust(); return r; };
const dbUpd  = async (path, val) => { const r = await update(ref(db, tp(path)), val); _bust(); return r; };
const dbDel  = async path => { const r = await remove(ref(db, tp(path))); _bust(); return r; };

// Стан (деякі модалки/функції з G використовують ці змінні)
let _students = [], _fid = null, _pid = null;

// ─── buildChips: відображає вибрану папку у модалці m-test (в існуючий #nt-chips) ─
function buildChips(){
  // Рендеримо в елемент #nt-chips який вже є в modals.html
  const panel = document.getElementById("nt-chips");
  if(!panel) return;
  document.querySelectorAll("body > #nt-folder-drop").forEach(el => el.remove());   // старий «портал»

  const sel = folders.find(f => f.id === _fid);
  const folderColor = sel?.color || "#2d5be3";
  const label = sel ? sel.name : "Без папки";

  panel.innerHTML = `
    <div style="position:relative">
      <button id="nt-folder-btn" onclick="window._toggleFolderChips()" type="button"
        style="width:100%;display:flex;align-items:center;gap:8px;padding:9px 13px;border-radius:10px;border:1.5px solid #E3E8F2;background:#fff;font-size:13px;font-weight:500;cursor:pointer;text-align:left;transition:border-color .15s;font-family:inherit;color:${sel?"#0B1437":"#8691AC"}">
        ${sel
          ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;background:${folderColor};flex-shrink:0">
               <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg>
             </span>${esc(label)}`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.4"><path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg>Без папки`}
        <svg style="margin-left:auto;flex-shrink:0;opacity:.4" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div id="nt-folder-drop" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1.5px solid #E3E8F2;border-radius:12px;box-shadow:0 8px 24px rgba(30,58,138,.1);z-index:400;overflow:hidden">
        <div style="padding:6px 8px 4px">
          <input id="nt-folder-search" type="text" placeholder="Пошук папки..." autocomplete="off" oninput="window._filterFolderChips(this.value)"
            style="width:100%;padding:6px 10px;border-radius:8px;border:1.5px solid #E3E8F2;font-size:13px;outline:none;font-family:inherit"
            onfocus="this.style.borderColor='#3B82F6'" onblur="this.style.borderColor='#E3E8F2'">
        </div>
        <div id="nt-folder-list" style="overflow-y:auto;max-height:180px;padding:4px 0">
          <div onclick="window._selectFolderChip(null)"
            style="display:flex;align-items:center;gap:8px;padding:9px 13px;cursor:pointer;font-size:13px;color:${!_fid?"#1E3A8A":"#5B6A8F"};background:${!_fid?"#EEF2FB":"transparent"};font-weight:${!_fid?"600":"400"};transition:background .1s">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.4;flex-shrink:0"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Без папки
            ${!_fid?'<svg style="margin-left:auto" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>':""}
          </div>
          ${folders.map(f=>`
            <div data-fid="${f.id}" data-fname="${esc(f.name.toLowerCase())}" onclick="window._selectFolderChip('${f.id}')"
              style="display:flex;align-items:center;gap:8px;padding:9px 13px;cursor:pointer;font-size:13px;color:${_fid===f.id?"#1E3A8A":"#5B6A8F"};background:${_fid===f.id?"#EEF2FB":"transparent"};font-weight:${_fid===f.id?"600":"400"};transition:background .1s">
              <span style="width:18px;height:18px;border-radius:5px;background:${f.color||"#2d5be3"};flex-shrink:0;display:inline-flex;align-items:center;justify-content:center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg>
              </span>${esc(f.name)}
              ${_fid===f.id?'<svg style="margin-left:auto" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>':""}
            </div>`).join("")}
        </div>
      </div>
    </div>`;
}

// Список папок відкривається як «поповер» з position:fixed поверх модалки —
// інакше .mb (overflow:auto) обрізав його по краю форми.
function _placeFolderDrop(){
  const drop = document.getElementById("nt-folder-drop"), btn = document.getElementById("nt-folder-btn");
  if (!drop || !btn || drop.style.display === "none") return;
  const r = btn.getBoundingClientRect();
  const w = Math.max(r.width, 260);
  drop.style.width = w + "px";
  drop.style.left = Math.min(r.left, innerWidth - w - 8) + "px";
  const h = drop.offsetHeight, below = innerHeight - r.bottom - 8;
  drop.style.top = (below < h && r.top > below ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
}
function _closeFolderDrop(){
  const drop = document.getElementById("nt-folder-drop");
  if (drop && drop.style.display !== "none"){ drop.style.display = "none"; delete drop.dataset.open; }
  // Повертаємо список на місце (у модалку), щоб buildChips міг його перебудувати
  const home = document.querySelector("#nt-chips > div");
  if (drop && home && drop.parentElement === document.body) home.appendChild(drop);
  document.getElementById("nt-folder-btn")?.setAttribute("aria-expanded", "false");
}
window._toggleFolderChips = function(){
  const drop = document.getElementById("nt-folder-drop");
  if(!drop) return;
  if (drop.style.display !== "none"){ _closeFolderDrop(); return; }
  document.body.appendChild(drop);   // .mb має transform → fixed усередині нього теж обрізався б
  Object.assign(drop.style, { display: "block", position: "fixed", right: "auto", zIndex: "1000" });
  drop.dataset.open = "1";           // app.js: поки відкрито — Esc закриває список, а не модалку
  document.getElementById("nt-folder-btn")?.setAttribute("aria-expanded", "true");
  _placeFolderDrop();
  setTimeout(()=>document.getElementById("nt-folder-search")?.focus(), 30);
};
window.addEventListener("resize", _placeFolderDrop);
document.addEventListener("scroll", e => { if (!e.target.closest?.("#nt-folder-drop")) _closeFolderDrop(); }, true);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("nt-folder-drop")?.dataset.open){
    _closeFolderDrop(); document.getElementById("nt-folder-btn")?.focus();
  }
});

window._filterFolderChips = function(q){
  const lq = q.toLowerCase();
  document.querySelectorAll("#nt-folder-list [data-fid]").forEach(el=>{
    el.style.display = (el.dataset.fname||"").includes(lq) ? "" : "none";
  });
};

window._selectFolderChip = function(fid){
  _fid = fid || null;
  _closeFolderDrop();
  buildChips();
  document.getElementById("nt-folder-btn")?.focus();
};

// Закриваємо список папок при кліку поза кнопкою і самим списком
document.addEventListener("click", e=>{
  if(!e.target.closest("#nt-chips") && !e.target.closest("#nt-folder-drop")) _closeFolderDrop();
});

async function loadStoredNotifs(){
  try {
    const snap = await dbGet("notifications");
    _notifications = snap.exists()
      ? Object.entries(snap.val())
          .map(([id,v])=>({id,...v}))
          .sort((a,b)=>(b.ts||0)-(a.ts||0))
      : [];
    if (typeof updateNotifBadge === "function") updateNotifBadge();
  } catch(e){ console.warn("Notifs load error:", e.message); _notifications=[]; }
}

// ─── NOTIFICATION SOUND ──────────────────────────────────────────────
let _audioCtx = null;
let _soundEnabled = localStorage.getItem("qf_sound") !== "0"; // увімкнено за замовчуванням

function playNotifSound(isWarning = false){
  if(!_soundEnabled) return;
  try {
    if(!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;

    if(isWarning){
      // Попередження — два коротких низьких сигнали
      [0, 180].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(380, ctx.currentTime + delay/1000);
        osc.frequency.exponentialRampToValueAtTime(280, ctx.currentTime + delay/1000 + 0.15);
        gain.gain.setValueAtTime(0.18, ctx.currentTime + delay/1000);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay/1000 + 0.2);
        osc.start(ctx.currentTime + delay/1000);
        osc.stop(ctx.currentTime + delay/1000 + 0.2);
      });
    } else {
      // Звичайне — приємний короткий "ping" два тони вгору
      [[0, 600], [120, 900]].forEach(([delay, freq]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay/1000);
        gain.gain.setValueAtTime(0.14, ctx.currentTime + delay/1000);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay/1000 + 0.25);
        osc.start(ctx.currentTime + delay/1000);
        osc.stop(ctx.currentTime + delay/1000 + 0.25);
      });
    }
  } catch(e){ /* AudioContext може бути заблокований до першого кліку */ }
}

async function addNotification(notif){
  const id = Date.now()+"_"+Math.random().toString(36).slice(2);
  const item = { ...notif, id, read: false, ts: notif.ts||Date.now() };
  _notifications.unshift(item);
  updateNotifBadge();
  playNotifSound(!!notif.isWarning);
  if(document.querySelector("#sec-notifications.on")) G.renderNotifications();
  // Зберігаємо в Firebase асинхронно
  try { await dbSet(`notifications/${id}`, item); } catch(e){ console.warn(e.message); }
}

async function markNotifRead(id){
  _notifications = _notifications.map(n=>n.id===id?{...n,read:true}:n);
  updateNotifBadge();
  try { await dbUpd(`notifications/${id}`, {read:true}); } catch{}
}

async function markAllNotifsRead(){
  const unread = _notifications.filter(n=>!n.read);
  _notifications = _notifications.map(n=>({...n,read:true}));
  updateNotifBadge();
  // Оновлюємо в Firebase паралельно
  await Promise.all(unread.map(n=>dbUpd(`notifications/${n.id}`,{read:true}).catch(()=>{})));
}

function updateNotifBadge(){
  const unread = _notifications.filter(n=>!n.read).length;
  const badge = $("nb-notif");
  if(!badge) return;
  if(unread > 0){
    badge.textContent = unread > 99 ? "99+" : unread;
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }
}
loadStoredNotifs();
// Синхронізуємо кнопку звуку при завантаженні
setTimeout(()=>{
  const btn = document.getElementById("notif-sound-btn");
  if(btn && !_soundEnabled){ btn.textContent="🔕"; btn.style.opacity="0.5"; }
}, 500);


// ─── Нотифікації ─────────────────────────────────────────────────────────────
let _notifQueue = [];
let _notifActive = false;

function showNotification(attempt, type){
  const test = tests.find(t=>t.id===attempt.testId);
  const name = `${attempt.name} ${attempt.surname}`;
  const testTitle = test?.title || "—";

  let icon, title, desc, color, isWarning = false;

  if(type==="completed"){
    icon  = "✅";
    title = `${name} завершив(ла) тест`;
    desc  = `${testTitle}${attempt.grade12 ? ` · Оцінка ${attempt.grade12}/12` : ""}`;
    color = "#0d9e85";
    // Підозріла активність — показуємо тільки у вкладці "Підозрілі", не в сповіщеннях
  } else if(type==="started"){
    icon  = "🎓";
    title = `${name} розпочав(ла) тест`;
    desc  = testTitle;
    color = "#2d5be3";
  } else {
    icon  = "🎯";
    title = `${name} завершив(ла) тест`;
    desc  = testTitle;
    color = "#0d9e85";
  }

  // Зберігаємо в store
  addNotification({ icon, title, desc, color, isWarning, attemptId: attempt.id, type, ts: Date.now() });

  // Показуємо банер
  const bannerMsg = isWarning
    ? `${icon} ${name} — ${testTitle} ⚠️`
    : `${icon} ${name} — ${testTitle}`;
  _notifQueue.push({icon, msg: `<strong>${name}</strong> · ${desc}`, color, id: attempt.id});
  if(!_notifActive) processNotifQueue();
}

function processNotifQueue(){
  if(!_notifQueue.length){ _notifActive=false; return; }
  _notifActive = true;
  const notif = _notifQueue.shift();
  showNotifBanner(notif);
  setTimeout(processNotifQueue, 4200);
}

function showNotifBanner({icon, msg, color, id}){
  // Створюємо або отримуємо контейнер
  let container = document.getElementById("notif-container");
  if(!container){
    container = document.createElement("div");
    container.id = "notif-container";
    container.style.cssText = "position:fixed;bottom:24px;left:24px;z-index:500;display:flex;flex-direction:column;gap:8px;pointer-events:none";
    document.body.appendChild(container);
  }

  const el = document.createElement("div");
  el.style.cssText = `
    display:flex;align-items:center;gap:12px;
    background:#0d1340;color:white;
    padding:12px 16px;border-radius:14px;
    box-shadow:0 8px 28px rgba(0,0,0,.25);
    font-family:'DM Sans',sans-serif;font-size:14px;
    max-width:320px;pointer-events:all;cursor:pointer;
    border-left:4px solid ${color};
    animation:notifIn .3s cubic-bezier(.34,1.56,.64,1);
  `;
  el.innerHTML = `
    <span style="font-size:20px;flex-shrink:0">${icon}</span>
    <div style="flex:1;line-height:1.4">${msg}</div>
    <button onclick="this.closest('[style]').remove()" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:18px;padding:0;line-height:1;flex-shrink:0">×</button>
  `;
  el.addEventListener("click", (e) => {
    if(e.target.tagName==="BUTTON") return;
    G.viewAtt(id);
    el.remove();
  });

  container.appendChild(el);

  // Автовидалення через 4 секунди
  setTimeout(() => {
    el.style.animation = "notifOut .25s ease forwards";
    setTimeout(() => el.remove(), 250);
  }, 3800);
}


function renderAll(){
  // Smart dispatch: викликаємо тільки ті рендерери чиї елементи є на сторінці.
  // Кожен рендерер має "якірний" DOM-елемент — якщо його немає, рендерер не запускається.
  // Це чистіше за try/catch: немає жодного warning у Console.
  const has = id => document.getElementById(id) !== null;
  // Дашборд: привітання, блок спроб, статистика
  if (has("dash-greeting") || has("d-att")) renderDashAtt();
  // Дашборд: активні посилання
  if (has("d-lnk")) renderDashLinks();
  // Дашборд: таблиця "Ваші тести"
  if (has("d-tests-tbody")) renderDashTests();
  // Дашборд: KPI картки
  if (has("s-t") || has("s-a") || has("s-l") || has("s-pending") || has("s-passrate")) renderStats();
  // Тести + папки
  if (has("tc")) renderTests();
  // Таблиця спроб
  if (has("att-tbl")) renderAttempts();
  // Таблиця посилань
  if (has("lnk-tbl")) renderLinks();
  // Селекти фільтрів (заповнюються лише якщо хоч один select існує)
  if (has("nl-t") || has("an-test") || has("an-group")) fillSelects();
  // Бейджі в sidebar (завжди, бо sidebar підвантажений на кожній сторінці)
  updateBadges();
  // Архів
  const archiveCnt = document.getElementById("archive-count");
  if(archiveCnt) archiveCnt.textContent = tests.filter(t=>t.status==="archived").length || "";
  const nbArchive = document.getElementById("nb-archive");
  if(nbArchive) nbArchive.textContent = tests.filter(t=>t.status==="archived").length;
}
// STATS
function renderStats(){
  const al = links.filter(l=>_isOpenState(linkState(l))).length;
  const cp = attempts.filter(a=>a.status==="completed");
  const pending = attempts.filter(a=>a.status==="pending_review").length;
  const passRate = cp.length ? Math.round(cp.filter(a=>a.grade12>=4).length/cp.length*100) : 0;
  const st = $("s-t"); if(st) st.textContent=tests.length;
  const sa = $("s-a"); if(sa) sa.textContent=attempts.length;
  const sl = $("s-l"); if(sl) sl.textContent=al;
  const spEl=$("s-pending"); if(spEl) spEl.textContent=pending;
  const srEl=$("s-passrate"); if(srEl) srEl.textContent=cp.length?passRate+"%":"—";
}
function updateBadges(){
  const nbt = $("nb-t"); if(nbt) nbt.textContent=tests.filter(t=>t.status!=="archived").length;
  const nba = $("nb-a"); if(nba) nba.textContent=attempts.length;
  const nbl = $("nb-l"); if(nbl) nbl.textContent=links.filter(l=>_isOpenState(linkState(l))).length;
  // Підозрілі
  const suspCount = attempts.filter(a=>(a.tabSwitches||0)*2+(a.copyAttempts||0)*3+(a.screenshots||0)*5>0&&(a.status==="completed"||a.status==="pending_review")).length;
  // Підозрілі — порівнюємо з збереженим в Firebase
  dbGet("meta/suspReadCount").then(snap=>{
    const suspRead = snap.exists() ? (snap.val()||0) : 0;
    const suspNew = Math.max(0, suspCount - suspRead);
    const nbS=$("nb-suspicious");
    if(nbS){ nbS.textContent=suspNew; nbS.style.display=suspNew>0?"":"none"; }
  }).catch(()=>{
    const nbS=$("nb-suspicious");
    if(nbS){ nbS.textContent=suspCount; nbS.style.display=suspCount>0?"":"none"; }
  });
  // Архів
  const nbArc=document.getElementById("nb-archive");
  if(nbArc) nbArc.textContent=tests.filter(t=>t.status==="archived").length;
}

// ─── ДАШБОРД (index) ────────────────────────────────────────────────────
// Відмінювання: plural(5, ["студент","студенти","студентів"])
function plural(n, forms){
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}
const _DAY = 864e5;
function _dayStart(t){ const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); }
// Кількість подій по днях за останні n днів (старі → нові)
function _perDay(items, n, getT){
  const start = _dayStart(Date.now()) - (n - 1) * _DAY;
  const out = new Array(n).fill(0);
  items.forEach(x => { const t = getT(x); if (!t || t < start) return; const i = Math.floor((t - start) / _DAY); if (i >= 0 && i < n) out[i]++; });
  return out;
}
// Справжній спарклайн з даних (а не декоративна крива)
function _spark(vals, color){
  const w = 160, h = 44, max = Math.max(1, ...vals), step = w / (vals.length - 1 || 1);
  const pts = vals.map((v, i) => [+(i * step).toFixed(1), +(h - 4 - (v / max) * (h - 10)).toFixed(1)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
  const gid = "sg" + color.replace(/[^a-z0-9]/gi, "");
  return `<svg class="kpi-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function _isSusp(a){
  return (a.tabSwitches || 0) * 2 + (a.copyAttempts || 0) * 3 + (a.screenshots || 0) * 5 > 0
    && (a.status === "completed" || a.status === "pending_review");
}
function _gradeTone(a){
  if (a.grade12 != null) return { txt: a.grade12 + "/12", tone: a.grade12 >= 10 ? "ok" : a.grade12 >= 4 ? "mid" : "bad" };
  const pct = a.score?.percent;
  if (pct != null) return { txt: pct + "%", tone: pct >= 70 ? "ok" : pct >= 40 ? "mid" : "bad" };
  return { txt: "—", tone: "mid" };
}

function renderDashKpi(){
  const box = $("dash-kpi");
  if (!box) return;
  const now = Date.now();
  const live = tests.filter(t => t.status !== "archived");
  const act = live.filter(t => t.status === "active").length;
  const drafts = live.filter(t => t.status === "draft").length;
  const wk = attempts.filter(a => (a.createdAt || 0) >= now - 7 * _DAY).length;
  const prevWk = attempts.filter(a => (a.createdAt || 0) >= now - 14 * _DAY && (a.createdAt || 0) < now - 7 * _DAY).length;
  const done = attempts.filter(a => a.status === "completed");
  const grades = done.map(a => a.grade12).filter(g => g != null);
  const avg = grades.length ? grades.reduce((s, g) => s + g, 0) / grades.length : null;
  const pass = grades.length ? Math.round(grades.filter(g => g >= 4).length / grades.length * 100) : null;
  const activeLinks = links.filter(l => l.status === "active");
  const pending = attempts.filter(a => a.status === "pending_review").length;

  const delta = wk - prevWk;
  const deltaHtml = (wk || prevWk)
    ? `<span class="kpi-delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}">${delta > 0 ? "▲ " + delta : delta < 0 ? "▼ " + Math.abs(delta) : "="}</span> за тиждень`
    : "Ще немає спроб";
  // Накопичена кількість тестів за 14 днів
  const created = _perDay(live, 14, t => t.createdAt);
  const before = live.filter(t => (t.createdAt || 0) < _dayStart(now) - 13 * _DAY).length;
  let acc = before; const cum = created.map(c => (acc += c));

  const card = (o) => `<button type="button" class="kpi${o.cls ? " " + o.cls : ""}" onclick="showSec('${o.go}')">
      <div class="kpi-head"><span class="kpi-label">${o.label}</span><span class="kpi-ico ${o.ico}">${o.svg}</span></div>
      <div class="kpi-value">${o.value}</div>
      <div class="kpi-trend">${o.sub}</div>
      ${o.spark || ""}
    </button>`;
  const I = p => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  box.innerHTML = [
    card({ go: "tests", label: "Тести", ico: "", value: live.length,
      svg: I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
      sub: live.length ? `<b>${act}</b> ${plural(act, ["активний", "активні", "активних"])} · <b>${drafts}</b> ${plural(drafts, ["чернетка", "чернетки", "чернеток"])}` : "Створіть перший тест",
      spark: live.length ? _spark(cum, "#3B82F6") : "" }),
    card({ go: "attempts", label: "Спроби", ico: "v2", value: attempts.length,
      svg: I('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
      sub: deltaHtml, spark: attempts.length ? _spark(_perDay(attempts, 14, a => a.createdAt), "#16A34A") : "" }),
    card({ go: "analytics", label: "Середня оцінка", ico: "v4", value: avg != null ? avg.toFixed(1) + '<small>/12</small>' : "—",
      svg: I('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>'),
      sub: pass != null ? `Здали <b>${pass}%</b> · ${grades.length} ${plural(grades.length, ["оцінка", "оцінки", "оцінок"])}` : "Ще немає оцінок" }),
    card({ go: "attempts", label: "На перевірці", ico: "v3", value: pending, cls: pending ? "attn" : "",
      svg: I('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
      sub: pending ? `Потребу${pending === 1 ? "є" : "ють"} ручної оцінки →` : `Усе перевірено · <b>${activeLinks.length}</b> ${plural(activeLinks.length, ["активне посилання", "активні посилання", "активних посилань"])}` }),
  ].join("");
}

// Картка «Почніть роботу» — поки не пройдено всі кроки
function renderDashStart(){
  const box = $("dash-start");
  if (!box) return;
  const steps = [
    { done: tests.some(t => t.status !== "archived"), t: "Створіть тест", s: "Додайте питання вручну або імпортуйте", act: "G.openTestInFolder(null)", btn: "Створити" },
    { done: links.length > 0, t: "Відкрийте доступ", s: "Посилання або код для групи студентів", act: "showSec('links')", btn: "До посилань" },
    { done: attempts.length > 0, t: "Отримайте перші результати", s: "Спроби з'являться тут у реальному часі", act: "showSec('attempts')", btn: "Спроби" },
  ];
  const n = steps.filter(x => x.done).length;
  if (n === steps.length){ box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const next = steps.findIndex(x => !x.done);
  box.innerHTML = `<div class="ds-head">
      <div><div class="ds-title">Почніть роботу з QuizFlow</div><div class="ds-sub">${n} з ${steps.length} кроків виконано</div></div>
      <div class="ds-bar"><i style="width:${Math.round(n / steps.length * 100)}%"></i></div>
    </div>
    <ol class="ds-steps">${steps.map((x, i) => `<li class="${x.done ? "done" : i === next ? "next" : ""}">
      <span class="ds-num">${x.done ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : i + 1}</span>
      <span class="ds-txt"><b>${x.t}</b><small>${x.s}</small></span>
      ${i === next ? `<button type="button" class="d-btn primary" onclick="${x.act}">${x.btn}</button>` : ""}
    </li>`).join("")}</ol>`;
}

function renderDashAtt(){
  if (!$("sec-dashboard")) return;
  // Привітання і дата
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 5 ? "Доброї ночі" : h < 12 ? "Доброго ранку" : h < 18 ? "Добрий день" : "Добрий вечір";
  const teacherFirstName = (_user.name || "").split(" ")[0] || _user.login || "";
  const el = $("dash-greeting");
  if (el) el.textContent = greeting + (teacherFirstName ? ", " + teacherFirstName : "") + " 👋";
  const dateEl = $("dash-date");
  if (dateEl){
    const s = now.toLocaleDateString("uk-UA", { weekday:"long", day:"numeric", month:"long" });
    dateEl.textContent = s.charAt(0).toUpperCase() + s.slice(1);
  }

  renderDashKpi();
  renderDashStart();

  // Онлайн банер
  const online = attempts.filter(a => a.status === "in_progress");
  const banner = $("dash-online-banner");
  if (banner){
    banner.hidden = !online.length;
    const txt = $("dash-online-text");
    if (txt && online.length) txt.textContent = `${online.length} ${plural(online.length, ["студент проходить", "студенти проходять", "студентів проходять"])} тест прямо зараз`;
  }

  // Підозрілі (нові)
  const suspBlock = $("dash-suspicious-block");
  if (suspBlock){
    dbGet("meta/suspReadCount").then(snap => {
      const suspRead = snap.exists() ? (snap.val() || 0) : 0;
      const suspNew = Math.max(0, attempts.filter(_isSusp).length - suspRead);
      suspBlock.hidden = !suspNew;
      const txt = $("dash-suspicious-text");
      if (txt && suspNew) txt.textContent = `${suspNew} ${plural(suspNew, ["нова підозріла спроба", "нові підозрілі спроби", "нових підозрілих спроб"])} — перевірте деталі`;
    }).catch(() => { suspBlock.hidden = true; });
  }

  renderDashTests();

  // ── Остання активність ──
  const tb = $("d-att");
  if (!tb) return;
  const r = attempts.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 6);
  const cnt = $("d-att-count");
  if (cnt){
    const today = attempts.filter(a => (a.createdAt || 0) >= _dayStart(Date.now())).length;
    cnt.textContent = today ? `${today} сьогодні` : "";
  }
  if (!r.length){
    tb.innerHTML = `<div class="d-empty">
      <div class="d-empty-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
      <div class="d-empty-t">Ще немає спроб</div>
      <div class="d-empty-s">Щойно студенти почнуть проходити тести, їхні результати з'являться тут</div>
    </div>`;
    return;
  }

  // Палітра кольорів аватарів — детермінована за іменем
  const avaColors = ["#3B82F6","#DB2777","#F59E0B","#16A34A","#6366F1","#0EA5E9","#8B5CF6","#EF4444","#14B8A6","#F97316"];
  tb.innerHTML = r.map(a => {
    const t = tests.find(x => x.id === a.testId);
    const fullName = `${a.surname || ""} ${a.name || ""}`.trim() || "Студент";
    const initials = ((a.surname?.[0] || "") + (a.name?.[0] || "")).toUpperCase() || fullName.slice(0, 2).toUpperCase();
    let hash = 0; for (let i = 0; i < fullName.length; i++) hash = (hash + fullName.charCodeAt(i)) | 0;
    const c = avaColors[Math.abs(hash) % avaColors.length];

    let badge, state;
    if (_isSusp(a)){
      badge = { txt: "Підозра", tone: "bad" };
      const issues = [];
      if (a.tabSwitches) issues.push(`${a.tabSwitches} ${plural(a.tabSwitches, ["перемикання", "перемикання", "перемикань"])}`);
      if (a.copyAttempts) issues.push(`${a.copyAttempts} ${plural(a.copyAttempts, ["копіювання", "копіювання", "копіювань"])}`);
      if (a.screenshots) issues.push(`${a.screenshots} ${plural(a.screenshots, ["скріншот", "скріншоти", "скріншотів"])}`);
      state = issues.join(", ");
    } else if (a.status === "in_progress"){
      badge = { txt: "Проходить", tone: "live" };
      state = "зараз онлайн";
    } else if (a.status === "pending_review"){
      badge = { txt: "Перевірити", tone: "mid" };
      state = "чекає на оцінку";
    } else if (a.status === "completed"){
      badge = _gradeTone(a);
      state = a.score?.correct != null && a.score?.total != null ? `${a.score.correct}/${a.score.total} правильних` : "завершено";
    } else {
      badge = { txt: "Нова", tone: "mid" };
      state = "";
    }
    return `<button type="button" class="d-act-item" onclick="G.viewAtt && G.viewAtt('${esc(a.id)}')">
      <span class="d-act-ava" style="background:linear-gradient(135deg, ${c}CC, ${c})">${esc(initials)}</span>
      <span class="d-act-body">
        <span class="d-act-text"><b>${esc(fullName)}</b>${a.group ? `<span class="d-act-grp">${esc(a.group)}</span>` : ""}</span>
        <span class="d-act-meta"><span class="d-act-test">${esc(t?.title || "Тест видалено")}</span><span>${esc(timeAgo(a.createdAt))}</span>${state ? `<span>${esc(state)}</span>` : ""}</span>
      </span>
      <span class="d-act-badge ${badge.tone}">${esc(badge.txt)}</span>
    </button>`;
  }).join("");
}

// ─── 2) НОВА ФУНКЦІЯ: renderDashTests ──────────────────────────────────────
// Малює таблицю "Ваші тести" в #d-tests-tbody + лічильник "X активні · Y чернетки"
// Плюс прогрес-бар групи на основі links з тим самим testId
 
// ═══════════════════════════════════════════════════════════════════════════
// ПОВНА ЗАМІНА ФУНКЦІЇ renderDashTests у shared/features.js
//
// Тепер рендерить ПОСИЛАННЯ (links) — не тести.
// Кожен рядок = одне посилання: тест + група + статус + use/max + середня
// оцінка по спробах через це посилання + прогрес + дедлайн (createdAt поки що).
//
// HTML-розмітка таблиці в index.html не змінюється (#d-tests-tbody, #d-tests-count).
// ═══════════════════════════════════════════════════════════════════════════

function renderDashTests(){
  const tb = $("d-tests-tbody");
  if (!tb) return;

  // Беремо всі посилання, сортуємо: спочатку active, потім за датою (новіші зверху)
  const list = links
    .slice()
    .sort((a, b) => {
      // Активні зверху
      const aActive = a.status === "active" ? 0 : 1;
      const bActive = b.status === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (b.createdAt || 0) - (a.createdAt || 0);
    })
    .slice(0, 5);

  // Лічильник
  const lbl = $("d-tests-count");
  if (lbl){
    const act = links.filter(l => l.status === "active").length;
    const cls = links.filter(l => l.status !== "active").length;
    lbl.textContent = `${act} ${plural(act, ["активне", "активні", "активних"])} · ${cls} ${plural(cls, ["закрите", "закриті", "закритих"])}`;
  }

  if (!list.length){
    tb.innerHTML = `<tr><td colspan="6"><div class="d-empty">
      <div class="d-empty-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1.5 1.5"/><path d="M14 11a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1.5-1.5"/></svg></div>
      <div class="d-empty-t">Ще немає посилань</div>
      <div class="d-empty-s">Створіть посилання на тест, щоб студенти могли його пройти</div>
      <button type="button" class="d-btn" onclick="showSec('links')">Перейти до посилань</button>
    </div></td></tr>`;
    return;
  }

  // 5 кольорових варіантів плитки за хешем title
  const tilePalette = [
    { bg:"linear-gradient(135deg, #DBEAFE, #93C5FD)", color:"#1E3A8A" },
    { bg:"linear-gradient(135deg, #E9D5FF, #C084FC)", color:"#6B21A8" },
    { bg:"linear-gradient(135deg, #BBF7D0, #4ADE80)", color:"#14532D" },
    { bg:"linear-gradient(135deg, #FED7AA, #FB923C)", color:"#7C2D12" },
    { bg:"linear-gradient(135deg, #FBCFE8, #F472B6)", color:"#831843" },
  ];

  // Скорочена абревіатура з назви
  const abbr = (title) => {
    if (!title) return "TST";
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 3) return words.slice(0,3).map(w => w[0]).join("").toUpperCase();
    if (words.length === 2) return (words[0].slice(0,2) + words[1][0]).toUpperCase();
    return title.replace(/[^A-Za-zА-Яа-яҐЄІЇґєії0-9]/g,"").substring(0,3).toUpperCase() || "TST";
  };

  const statusMap = {
    active: { cls:"on",     txt:"Активне" },
    closed: { cls:"closed", txt:"Закрите" },
    draft:  { cls:"draft",  txt:"Чернетка" },
  };

  tb.innerHTML = list.map(l => {
    const t = tests.find(x => x.id === l.testId);
    const title = t?.title || "—";

    // Хеш для вибору плитки (за testId або назвою)
    const seed = String(l.testId || title);
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i)) | 0;
    const tile = tilePalette[Math.abs(h) % tilePalette.length];

    // Спроби через ЦЕ посилання
    const lAttempts = attempts.filter(a => a.linkId === l.id);

    // Середня оцінка
    const completed = lAttempts.filter(a => a.status === "completed" && a.score?.percent != null);
    const avgPct = completed.length ? Math.round(completed.reduce((s,a) => s + a.score.percent, 0) / completed.length) : null;

    // Прогрес = used/max
    const used = l.usedAttempts || 0;
    const max = l.maxAttempts || 0;
    const pct = max > 0 ? Math.min(100, Math.round(used / max * 100)) : 0;
    const barColor = pct >= 100 ? "#16A34A" : pct >= 70 ? "#F59E0B" : pct >= 30 ? "#3B82F6" : "#94A3B8";

    // Дедлайн / статус-дата:
    //   - якщо closed → "Закрито"
    //   - якщо expiresAt → дата
    //   - інакше → дата створення
    let deadlineStr = "—";
    if (l.status === "closed") deadlineStr = "Закрито";
    else if (l.expiresAt) deadlineStr = new Date(l.expiresAt).toLocaleDateString("uk-UA", { day:"numeric", month:"short" });
    else if (l.createdAt) deadlineStr = "від " + new Date(l.createdAt).toLocaleDateString("uk-UA", { day:"numeric", month:"short" });

    // Підрядок: група · N питань · M хв
    const subParts = [];
    if (l.group) subParts.push(l.group);
    const qCnt = (t?.questions || []).length;
    if (qCnt) subParts.push(`${qCnt} питань`);
    if (t?.timeLimit) subParts.push(`${Math.round(t.timeLimit / 60)} хв`);

    const s = statusMap[l.status] || statusMap.active;

    return `<tr onclick="showSec('links')" style="cursor:pointer">
      <td>
        <div class="d-q-name">
          <div class="d-q-icon" style="background:${tile.bg};color:${tile.color}">${esc(abbr(title))}</div>
          <div style="min-width:0">
            <div class="d-q-title">${esc(title)}</div>
            <div class="d-q-sub">${subParts.length ? subParts.map(esc).join(" · ") : "—"}</div>
          </div>
        </div>
      </td>
      <td><span class="d-q-pill ${s.cls}">${s.txt}</span></td>
      <td class="d-mono">${used}${max > 0 ? `/${max}` : ""}</td>
      <td class="d-mono" style="font-weight:600;color:${avgPct != null ? (avgPct >= 70 ? "#15803D" : avgPct >= 40 ? "#1E40AF" : "#B91C1C") : "var(--ink-400)"}">${avgPct != null ? avgPct + "%" : "—"}</td>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="d-q-bar"><i style="width:${pct}%;background:${barColor}"></i></div>
          <span class="d-mono" style="font-size:11px;color:var(--ink-500);width:36px;text-align:right">${pct}%</span>
        </div>
      </td>
      <td class="d-mono" style="color:${l.status === 'closed' ? '#B91C1C' : 'var(--ink-500)'};white-space:nowrap;font-size:11.5px">${esc(deadlineStr)}</td>
    </tr>`;
  }).join("");
}
 
 
function renderDashLinks(){
  const c = $("d-lnk"); if (!c) return;
  const now = Date.now();
  const al = links.filter(l => _isOpenState(linkState(l, now))).slice(0, 4);
  if (!al.length){ c.innerHTML = `<div style="text-align:center;color:var(--muted);padding:18px;font-size:14px">Немає активних посилань</div>`; return; }
  c.innerHTML = al.map(l => {
    const t = tests.find(x => x.id === l.testId), max = _lnkMax(l), used = l.usedAttempts || 0;
    const pct = max ? Math.min(100, Math.round(used / max * 100)) : 0;
    const barColor = pct >= 100 ? "#f43f5e" : pct >= 80 ? "#f59e0b" : "#2d5be3";
    const st = linkState(l, now);
    const sub = [l.group, st === "scheduled" ? `відкриється ${_fmtDT(l.openAt)}` : l.closeAt ? `до ${_fmtDT(l.closeAt)}` : ""].filter(Boolean).join(" · ");
    return `<a href="links" style="display:block;padding:12px 16px;border-bottom:1px solid var(--border);color:inherit;text-decoration:none">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${esc(t?.title || "—")}</span>
        <span style="font-size:12px;color:var(--muted);flex-shrink:0;margin-left:8px">${used}${max ? `/${max}` : " · ∞"}</span>
      </div>
      ${max ? `<div style="background:var(--border);border-radius:4px;height:5px;overflow:hidden"><div style="background:${barColor};height:100%;border-radius:4px;width:${pct}%;transition:width .4s"></div></div>` : ""}
      ${sub ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${esc(sub)}</div>` : ""}
    </a>`;
  }).join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS & FOLDERS — сторінка «Тести»
//
// Усі дії — через data-act + data-id і ОДИН делегований обробник кліків.
// Назви тестів/папок більше не вставляються в onclick="...('назва')":
// апостроф у назві («Об'єкти», «м'яч») ламав JS і кнопки мовчки не працювали.
// ═══════════════════════════════════════════════════════════════════════════
let _fFilter = "all";
function setFolderFilter(v){ G.setFF(v); }

const _TSTORE = "qf_tests_ui";
const TS = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(_TSTORE) || "{}"); } catch {}
  return { q: "", status: "", sort: s.sort || "new", view: s.view === "list" ? "list" : "grid" };
})();
const _saveTS = () => { try { localStorage.setItem(_TSTORE, JSON.stringify({ sort: TS.sort, view: TS.view })); } catch {} };
// Сумісність зі старим кодом, що читає ці глобали
window._testsView = TS.view;
window._testsStatus = TS.status;

const _plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};
const _nTests = n => `${n} ${_plural(n, "тест", "тести", "тестів")}`;
const _fmtDate = t => t ? new Date(t).toLocaleDateString("uk-UA", { day: "numeric", month: "short" }) : "";
const _ICON = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  edit: _ICON('<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  link: _ICON('<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>'),
  live: _ICON('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
  share: _ICON('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>'),
  move: _ICON('<path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/><path d="M12 11l3 3-3 3M9 14h6"/>'),
  dup: _ICON('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'),
  del: _ICON('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>'),
  more: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>`,
  folder: _ICON('<path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>'),
  plus: _ICON('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  cal: _ICON('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  clock: _ICON('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  users: _ICON('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/>'),
  restore: _ICON('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/>'),
  home: _ICON('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  search: _ICON('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>'),
  archive: _ICON('<rect x="2" y="4" width="20" height="5" rx="2"/><path d="M4 9v9a2 2 0 002 2h12a2 2 0 002-2V9"/><line x1="10" y1="13" x2="14" y2="13"/>'),
};

// Палітра для превью тестів без папки
const _testPalette = [
  ["#a8c8f8","#c9b8f5","#6b9ef0"], ["#b8f0e0","#a0e8d0","#5dd4b0"], ["#ffd6a0","#ffb8b8","#ff9a6c"],
  ["#f5b8d8","#e8a0f0","#d06bc0"], ["#a0d8f8","#b8eaf8","#5bb8e8"], ["#c8f0a0","#e8f8b0","#8acc50"],
];
const _folderFallbacks = ["#2d5be3","#0d9e85","#9333ea","#f59e0b","#f43f5e","#0ea5e9"];

// Абревіатура лише з літер і цифр (раніше «CSS Grid <script>» давало «CG<»)
function _testAbbr(title){
  const words = String(title || "").match(/[\p{L}\p{N}]+/gu) || ["?"];
  if (words.length === 1) return words[0].substring(0, 3).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join("").toUpperCase();
}
function _mixHex(hex, amt, toWhite){
  const h = String(hex || "#2d5be3").replace("#", "").padEnd(6, "0");
  const ch = i => parseInt(h.substring(i, i + 2), 16) || 0;
  const f = c => Math.round(toWhite ? c + (255 - c) * amt : c * (1 - amt)).toString(16).padStart(2, "0");
  return `#${f(ch(0))}${f(ch(2))}${f(ch(4))}`;
}
const _lightenHex = (hex, amt = 0.35) => _mixHex(hex, amt, true);
const _darkenHex = (hex, amt = 0.25) => _mixHex(hex, amt, false);
function _folderColor(f){
  if (f?.color) return f.color;
  const idx = folders.indexOf(f);
  return _folderFallbacks[Math.max(0, idx) % _folderFallbacks.length];
}
const _folderOf = t => folders.find(f => f.id === t.folderId) || null;
function _quizCoverGradient(t, idx){
  const folder = _folderOf(t);
  if (folder){ const c = _folderColor(folder); return `linear-gradient(135deg, ${_lightenHex(c, 0.5)}, ${c})`; }
  const p = _testPalette[idx % _testPalette.length];
  return `linear-gradient(135deg, ${p[0]}, ${p[2]})`;
}

// ─── Статистика: ОДИН прохід по всіх спробах замість трьох фільтрів на кожну картку ──
function _testStats(){
  const m = new Map();
  for (const a of attempts){
    let s = m.get(a.testId);
    if (!s) m.set(a.testId, s = { cnt: 0, passed: 0, sum: 0, graded: 0, last: 0 });
    s.cnt++;
    if ((a.grade12 || 0) >= 4) s.passed++;
    if (a.grade12 != null){ s.sum += a.grade12; s.graded++; }
    if ((a.createdAt || 0) > s.last) s.last = a.createdAt;
  }
  for (const s of m.values()) s.avg = s.graded ? Math.round(s.sum / s.graded / 12 * 100) : null;
  return m;
}
const _EMPTY_STATS = { cnt: 0, passed: 0, avg: null, last: 0 };
const _activity = (t, st) => Math.max(t.updatedAt || 0, t.createdAt || 0, st?.last || 0);
const _avgColor = v => v == null ? "var(--ink-400)" : v >= 70 ? "#15803D" : v >= 40 ? "#1E40AF" : "#B91C1C";
const STATUS = {
  active: { cls: "on",     label: "Активний" },
  draft:  { cls: "draft",  label: "Чернетка" },
  closed: { cls: "closed", label: "Закритий" },
};
const _sc = t => STATUS[t.status] || STATUS.draft;

function _matches(t, q){
  if (!q) return true;
  const hay = [t.title, t.description, ...(t.tags || [])].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
function _sortTests(lst, stats){
  const by = {
    new:  (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    old:  (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    name: (a, b) => String(a.title || "").localeCompare(String(b.title || ""), "uk"),
    att:  (a, b) => (stats.get(b.id)?.cnt || 0) - (stats.get(a.id)?.cnt || 0),
    act:  (a, b) => _activity(b, stats.get(b.id)) - _activity(a, stats.get(a.id)),
  }[TS.sort] || ((a, b) => 0);
  return [...lst].sort(by);
}

// ─── Картка тесту (сітка) ──────────────────────────────────────────────
function buildTestCard(t, idx, stats, showFolder){
  const st = stats?.get(t.id) || _EMPTY_STATS;
  const sc = _sc(t);
  const qCnt = (t.questions || []).length;
  const folder = showFolder ? _folderOf(t) : null;
  return `<div class="t-quiz-card" data-id="${esc(t.id)}">
    <button class="t-qc-cover" style="background:${_quizCoverGradient(t, idx)}" data-act="edit" data-id="${esc(t.id)}" aria-label="Редагувати ${esc(t.title)}">
      <span class="t-qc-code">${esc(_testAbbr(t.title))}</span>
      <span class="t-qc-status"><span class="t-pill ${sc.cls}">${sc.label}</span></span>
    </button>
    <div>
      <button class="t-qc-title" data-act="edit" data-id="${esc(t.id)}" title="${esc(t.title)}">${esc(t.title)}</button>
      <div class="t-qc-meta">
        <span>${I.cal}${qCnt} пит.</span>
        ${t.timeLimit ? `<span>${I.clock}${Math.round(t.timeLimit / 60)} хв</span>` : ""}
        ${folder ? `<span class="t-qc-folder" style="--fc:${_folderColor(folder)}">${esc(folder.name)}</span>` : showFolder ? `<span class="t-qc-folder" style="--fc:#8691AC">Без папки</span>` : ""}
      </div>
    </div>
    <div class="t-qc-stats">
      <div><div class="t-qc-stat-val">${st.cnt}</div><div class="t-qc-stat-lbl">Спроб</div></div>
      <div><div class="t-qc-stat-val">${st.passed}</div><div class="t-qc-stat-lbl">Здали</div></div>
      <div><div class="t-qc-stat-val" style="color:${_avgColor(st.avg)}">${st.avg != null ? st.avg + "%" : "—"}</div><div class="t-qc-stat-lbl">Середній</div></div>
    </div>
    <div class="t-qc-foot">
      <span class="t-qc-date">${t.createdAt ? "Створено " + _fmtDate(t.createdAt) : ""}</span>
      <div class="t-qc-foot-actions">
        <button class="t-edit-btn" data-act="edit" data-id="${esc(t.id)}">${I.edit}Редагувати</button>
        <button class="t-menu-btn" data-act="menu" data-id="${esc(t.id)}" aria-haspopup="menu" aria-label="Більше дій">${I.more}</button>
      </div>
    </div>
  </div>`;
}

// ─── Рядок тесту (список) ──────────────────────────────────────────────
function buildTestRow(t, idx, stats, showFolder){
  const st = stats?.get(t.id) || _EMPTY_STATS;
  const sc = _sc(t);
  const folder = showFolder ? _folderOf(t) : null;
  return `<tr data-id="${esc(t.id)}">
    <td>
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        <div class="t-tile" style="background:${_quizCoverGradient(t, idx || 0)}">${esc(_testAbbr(t.title))}</div>
        <div style="min-width:0">
          <button class="t-row-title" data-act="edit" data-id="${esc(t.id)}" title="${esc(t.title)}">${esc(t.title)}</button>
          ${showFolder ? `<div class="t-row-sub">${esc(folder?.name || "Без папки")}</div>`
            : t.description ? `<div class="t-row-sub">${esc(t.description)}</div>` : ""}
        </div>
      </div>
    </td>
    <td style="white-space:nowrap"><button class="t-pill-btn" data-act="menu" data-id="${esc(t.id)}" data-focus="status" title="Змінити статус"><span class="t-pill ${sc.cls}">${sc.label}</span></button></td>
    <td class="t-mono">${(t.questions || []).length}</td>
    <td class="t-mono" style="color:${st.cnt ? "var(--ink-700)" : "var(--ink-400)"};font-weight:600">${st.cnt}</td>
    <td class="t-mono" style="color:${_avgColor(st.avg)};font-weight:600">${st.avg != null ? st.avg + "%" : "—"}</td>
    <td class="t-mono t-muted" style="white-space:nowrap">${_fmtDate(t.createdAt)}</td>
    <td>
      <div class="t-ra">
        <button class="t-ib" title="Редагувати" data-act="edit" data-id="${esc(t.id)}">${I.edit}</button>
        <button class="t-ib" title="Нове посилання" data-act="link" data-id="${esc(t.id)}">${I.link}</button>
        <button class="t-ib" title="Більше дій" data-act="menu" data-id="${esc(t.id)}" aria-haspopup="menu">${I.more}</button>
      </div>
    </td>
  </tr>`;
}

function _renderTestsContent(lst, total, stats, showFolder, emptyTitle, emptyHint){
  if (!lst.length){
    return `<div class="t-empty">
      <div class="t-empty-ico">${I.cal}</div>
      <div class="t-empty-title">${esc(emptyTitle || (total === 0 ? "Тут ще немає тестів" : "Нічого не знайдено"))}</div>
      <div class="t-empty-hint">${esc(emptyHint || (total === 0 ? "Створіть перший тест" : "Спробуйте інший запит або скиньте фільтр"))}</div>
      ${total !== 0 && (TS.q || TS.status) ? `<button class="t-btn" data-act="reset-filters" style="margin:0 auto">Скинути фільтри</button>` : ""}
    </div>`;
  }
  if (TS.view === "list"){
    return `<div style="overflow-x:auto"><table class="t-dtable">
      <thead><tr><th>Назва</th><th>Статус</th><th>Питань</th><th>Спроб</th><th>Середній</th><th>Створено</th><th style="width:120px"></th></tr></thead>
      <tbody>${lst.map((t, i) => buildTestRow(t, i, stats, showFolder)).join("")}</tbody>
    </table></div>`;
  }
  return `<div class="t-quizzes-grid">${lst.map((t, i) => buildTestCard(t, i, stats, showFolder)).join("")}</div>`;
}

// ─── Картка папки ──────────────────────────────────────────────────────
function _folderCard(f, fTests, stats){
  const isNone = f === null;
  const col = isNone ? "#8691AC" : _folderColor(f);
  const colDark = _darkenHex(col, 0.15);
  const id = isNone ? "none" : f.id;
  const att = fTests.reduce((s, t) => s + (stats.get(t.id)?.cnt || 0), 0);
  const last = fTests.reduce((m, t) => Math.max(m, _activity(t, stats.get(t.id))), 0);
  const preview = fTests.slice(0, 4);
  const more = fTests.length - preview.length;
  const thumbs = preview.length
    ? preview.map(t => `<div class="t-fc-thumb" style="background:linear-gradient(135deg,${_lightenHex(col, 0.6)},${_lightenHex(col, 0.3)});color:${colDark}" title="${esc(t.title)}">${esc(_testAbbr(t.title))}</div>`).join("")
      + (more > 0 ? `<span class="t-fc-more">+${more}</span>` : "")
    : `<span class="t-muted" style="font-size:11.5px;font-style:italic">Порожня — додайте тест</span>`;
  return `<div class="t-folder-card" data-act="open-folder" data-id="${esc(id)}" role="button" tabindex="0" aria-label="Відкрити папку ${esc(isNone ? "Без папки" : f.name)}">
    ${isNone ? "" : `<div class="t-fc-actions">
      <button title="Додати тест у папку" data-act="add-test" data-id="${esc(id)}">${I.plus}</button>
      <button title="Дії з папкою" data-act="folder-menu" data-id="${esc(id)}" aria-haspopup="menu">${I.more}</button>
    </div>`}
    <div class="t-fc-head">
      <div class="t-fc-ico" style="background:linear-gradient(135deg,${_lightenHex(col, 0.35)},${col})">${isNone ? _ICON('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>') : I.folder}</div>
      <div style="flex:1;min-width:0">
        <div class="t-fc-title" title="${esc(isNone ? "Без папки" : f.name)}">${esc(isNone ? "Без папки" : f.name)}</div>
        <div class="t-fc-meta">${fTests.length ? _nTests(fTests.length) : "Порожня"}</div>
      </div>
    </div>
    <div class="t-fc-meta-row">
      <span title="Спроб у тестах папки">${I.users}${att} ${_plural(att, "спроба", "спроби", "спроб")}</span>
      <span title="Остання активність">${I.clock}${last ? _fmtDate(last) : "—"}</span>
    </div>
    <div class="t-fc-foot">
      <div class="t-fc-thumbs">${thumbs}</div>
      <span class="t-fc-cta" style="color:${colDark}">Відкрити ${_ICON('<path d="M9 6l6 6-6 6"/>')}</span>
    </div>
  </div>`;
}

// ─── Панель інструментів (статична в tests.html — поле пошуку не перестворюється) ──
function _syncToolbar(ctx){
  const bar = document.getElementById("t-toolbar");
  if (!bar) return;
  const inp = document.getElementById("srch");
  if (inp && inp.value !== TS.q && document.activeElement !== inp) inp.value = TS.q;
  if (inp) inp.placeholder = ctx.scope === "folder" ? `Пошук у папці «${ctx.name}»…` : "Пошук тестів у всіх папках…  ( / )";
  const clr = document.getElementById("srch-clear");
  if (clr) clr.hidden = !TS.q;
  // Фільтри статусу/сортування/вигляд потрібні лише коли показуємо тести
  bar.querySelectorAll("[data-tests-only]").forEach(el => { el.hidden = !ctx.showsTests; });
  const counts = ctx.counts || {};
  bar.querySelectorAll("[data-status]").forEach(b => {
    const v = b.dataset.status;
    b.classList.toggle("active", v === TS.status);
    b.setAttribute("aria-pressed", v === TS.status);
    const n = b.querySelector(".t-tab-n"); if (n) n.textContent = counts[v || "all"] ?? 0;
  });
  const lbl = document.getElementById("cd-tsort-label");
  const cur = document.querySelector(`#cd-tsort-menu [data-sort="${TS.sort}"]`);
  if (lbl && cur) lbl.textContent = cur.textContent.trim();
  document.querySelectorAll("#cd-tsort-menu [data-sort]").forEach(el => el.classList.toggle("cd-active", el.dataset.sort === TS.sort));
  bar.querySelectorAll("[data-view]").forEach(b => { b.classList.toggle("on", b.dataset.view === TS.view); b.setAttribute("aria-pressed", b.dataset.view === TS.view); });
}
function _statusCounts(lst){
  const c = { all: lst.length, active: 0, draft: 0, closed: 0 };
  lst.forEach(t => { if (c[t.status] != null) c[t.status]++; });
  return c;
}

// ─── Головний рендер ───────────────────────────────────────────────────
renderTests = function(q){
  if (typeof q === "string") TS.q = q;
  const c = $("tc");
  if (!c) return;
  _closeTMenu();
  const stats = _testStats();
  const live = tests.filter(t => t.status !== "archived");
  const inFolder = _fFilter && _fFilter !== "all" && _fFilter !== "none";
  const inOrphan = _fFilter === "none";
  const folder = inFolder ? folders.find(f => f.id === _fFilter) : null;
  if (inFolder && !folder){ _fFilter = "all"; window._fFilter = "all"; }   // папку видалили в іншій вкладці
  const orphans = live.filter(t => !_folderOf(t));

  const nb = document.getElementById("nb-archive");
  if (nb) nb.textContent = tests.length - live.length;
  const crumbs = document.getElementById("t-crumbs");
  const sub = document.getElementById("t-subtitle");

  // ─── Всередині папки ─────────────────────────────────────────────────
  if (folder || inOrphan){
    const name = folder ? folder.name : "Без папки";
    const col = folder ? _folderColor(folder) : "#8691AC";
    const all = folder ? live.filter(t => t.folderId === folder.id) : orphans;
    const counts = _statusCounts(all.filter(t => _matches(t, TS.q)));
    let lst = all.filter(t => _matches(t, TS.q));
    if (TS.status) lst = lst.filter(t => t.status === TS.status);
    lst = _sortTests(lst, stats);
    if (sub) sub.textContent = `${_nTests(all.length)} у папці`;
    if (crumbs){
      crumbs.hidden = false;
      crumbs.innerHTML = `<button class="t-crumb" data-act="open-folder" data-id="all">${I.home}Усі папки</button>
        <span class="t-sep">/</span>
        <span class="t-crumb active"><span class="t-dot" style="background:linear-gradient(135deg,${_lightenHex(col, .4)},${col})"></span>${esc(name)}</span>
        <div class="t-crumb-actions">
          ${folder ? `<button class="t-btn" data-act="add-test" data-id="${esc(folder.id)}">${I.plus}Додати тест</button>
          <button class="t-btn ghost" data-act="folder-edit" data-id="${esc(folder.id)}">${I.edit}Редагувати папку</button>
          <button class="t-btn ghost danger" data-act="folder-delete" data-id="${esc(folder.id)}">${I.del}Видалити</button>` : ""}
        </div>`;
    }
    _syncToolbar({ scope: "folder", name, showsTests: true, counts });
    c.innerHTML = `<div class="t-card">${_renderTestsContent(lst, all.length, stats, false,
      all.length ? null : "У папці ще немає тестів", all.length ? null : "Натисніть «Додати тест», щоб створити перший")}</div>`;
    return;
  }

  if (crumbs){ crumbs.hidden = true; crumbs.innerHTML = ""; }
  if (sub) sub.textContent = `${folders.length} ${_plural(folders.length, "папка", "папки", "папок")} · ${_nTests(live.length)}`;

  // ─── Порожньо взагалі ────────────────────────────────────────────────
  if (!live.length && !folders.length){
    _syncToolbar({ scope: "root", showsTests: false });
    c.innerHTML = `<div class="t-card"><div class="t-empty">
      <div class="t-empty-ico">${I.folder}</div>
      <div class="t-empty-title">Ще немає папок чи тестів</div>
      <div class="t-empty-hint">Створіть папку для курсу або одразу перший тест</div>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="t-btn" data-act="new-folder">${I.folder}Нова папка</button>
        <button class="t-btn primary" data-act="add-test" data-id="">${I.plus}Новий тест</button>
      </div>
    </div></div>`;
    return;
  }

  // ─── Пошук по всіх папках ────────────────────────────────────────────
  if (TS.q){
    const found = live.filter(t => _matches(t, TS.q));
    const counts = _statusCounts(found);
    let lst = TS.status ? found.filter(t => t.status === TS.status) : found;
    lst = _sortTests(lst, stats);
    _syncToolbar({ scope: "root", showsTests: true, counts });
    c.innerHTML = `<div class="t-card">
      <div class="t-section-label"><span>Результати пошуку</span><span class="t-n">${lst.length}</span></div>
      ${_renderTestsContent(lst, found.length ? found.length : 1, stats, true, "Нічого не знайдено", `За запитом «${TS.q}» тестів немає`)}
    </div>`;
    return;
  }

  // ─── Головна: нещодавні (компактно, зверху) + папки ──────────────────
  _syncToolbar({ scope: "root", showsTests: false });
  const cards = folders.map(f => _folderCard(f, live.filter(t => t.folderId === f.id), stats));
  if (orphans.length) cards.push(_folderCard(null, orphans, stats));
  cards.push(`<button class="t-new-folder" data-act="new-folder">
    <div class="t-nf-ico">${I.plus}</div>
    <div class="t-nf-title">Нова папка</div>
    <div class="t-nf-hint">Згрупувати тести в курс</div>
  </button>`);
  const recent = [...live].sort((a, b) => _activity(b, stats.get(b.id)) - _activity(a, stats.get(a.id))).slice(0, 8);
  c.innerHTML = `${recent.length ? `<section class="t-recent" aria-label="Нещодавні тести">
      <div class="t-recent-h"><span>Нещодавні</span><span class="t-n">швидкий доступ</span></div>
      <div class="t-recent-list">${recent.map((t, i) => _recentChip(t, i, stats)).join("")}</div>
    </section>` : ""}
    <div class="t-card">
      <div class="t-section-label"><span>Папки</span><span class="t-n">${folders.length + (orphans.length ? 1 : 0)}</span></div>
      <div class="t-folders-grid">${cards.join("")}</div>
    </div>`;
};

// Компактний рядок «нещодавнього» тесту: клік — одразу в конструктор, ⋯ — усі дії
function _recentChip(t, idx, stats){
  const st = stats.get(t.id) || _EMPTY_STATS;
  const f = _folderOf(t);
  const sc = _sc(t);
  return `<div class="t-rc">
    <button class="t-rc-main" data-act="edit" data-id="${esc(t.id)}" title="Відкрити «${esc(t.title)}» у конструкторі">
      <span class="t-rc-tile" style="background:${_quizCoverGradient(t, idx)}">${esc(_testAbbr(t.title))}</span>
      <span class="t-rc-txt">
        <span class="t-rc-title">${esc(t.title)}</span>
        <span class="t-rc-meta"><i class="t-rc-dot ${sc.cls}" title="${sc.label}"></i>${esc(f?.name || "Без папки")} · ${st.cnt} ${_plural(st.cnt, "спроба", "спроби", "спроб")}</span>
      </span>
    </button>
    <button class="t-rc-more" data-act="menu" data-id="${esc(t.id)}" aria-haspopup="menu" aria-label="Дії з тестом">${I.more}</button>
  </div>`;
}

// ─── Плаваюче меню дій (одне на сторінку, не обрізається карткою) ──────
let _tMenuFor = null;
function _closeTMenu(){
  const m = document.getElementById("t-float-menu");
  if (m){ m.remove(); }
  if (_tMenuFor){ _tMenuFor.setAttribute("aria-expanded", "false"); _tMenuFor = null; }
}
function _openTMenu(anchor, html){
  _closeTMenu();
  const m = document.createElement("div");
  m.id = "t-float-menu";
  m.className = "t-float-menu";
  m.setAttribute("role", "menu");
  m.innerHTML = html;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  const left = Math.min(Math.max(8, r.right - mw), innerWidth - mw - 8);
  const top = r.bottom + 6 + mh > innerHeight - 8 ? Math.max(8, r.top - mh - 6) : r.bottom + 6;
  m.style.left = left + "px"; m.style.top = top + "px";
  _tMenuFor = anchor; anchor.setAttribute("aria-expanded", "true");
  m.querySelector("[data-act]:not([disabled])")?.focus({ preventScroll: true });
}
function _testMenuHtml(t){
  const it = (act, icon, label, extra = "") => `<button class="t-fm-item${extra}" role="menuitem" data-act="${act}" data-id="${esc(t.id)}">${icon}<span>${label}</span></button>`;
  const statusBtns = Object.entries(STATUS).map(([k, v]) =>
    `<button class="t-fm-status${t.status === k ? " cur" : ""}" role="menuitemradio" aria-checked="${t.status === k}" data-act="status" data-id="${esc(t.id)}" data-val="${k}"><span class="t-pill ${v.cls}">${v.label}</span></button>`).join("");
  return `<div class="t-fm-head" title="${esc(t.title)}">${esc(t.title)}</div>
    ${it("edit", I.edit, "Редагувати")}
    ${it("link", I.link, "Нове посилання для студентів")}
    ${it("live", I.live, "Live гра")}
    <div class="t-fm-sep"></div>
    <div class="t-fm-label">Статус</div>
    <div class="t-fm-statuses">${statusBtns}</div>
    <div class="t-fm-sep"></div>
    ${it("move", I.move, "Перемістити в папку")}
    ${it("dup", I.dup, "Дублювати")}
    ${it("share", I.share, "Поділитись з викладачем")}
    <div class="t-fm-sep"></div>
    ${it("delete", I.del, "Архівувати або видалити…", " d")}`;
}
function _folderMenuHtml(f){
  const it = (act, icon, label, extra = "") => `<button class="t-fm-item${extra}" role="menuitem" data-act="${act}" data-id="${esc(f.id)}">${icon}<span>${label}</span></button>`;
  return `<div class="t-fm-head">${esc(f.name)}</div>
    ${it("open-folder", I.folder, "Відкрити")}
    ${it("add-test", I.plus, "Додати тест")}
    ${it("folder-edit", I.edit, "Перейменувати / колір")}
    <div class="t-fm-sep"></div>
    ${it("folder-delete", I.del, "Видалити папку", " d")}`;
}

// ─── Делегований обробник: усі кнопки сторінки «Тести» ─────────────────
function _testsAction(act, id, el){
  const t = tests.find(x => x.id === id);
  switch (act){
    case "edit":          if (t) location.href = `constructor?id=${encodeURIComponent(id)}`; break;
    case "menu":          if (t){ if (_tMenuFor === el) _closeTMenu(); else _openTMenu(el, _testMenuHtml(t)); } break;
    case "folder-menu":   { const f = folders.find(x => x.id === id); if (f){ if (_tMenuFor === el) _closeTMenu(); else _openTMenu(el, _folderMenuHtml(f)); } } break;
    case "link":          _closeTMenu(); G.qLink(id); break;
    case "live":          _closeTMenu(); G.startLiveGame(id); break;
    case "status":        _closeTMenu(); G.setTestStatus(id, el.dataset.val); break;
    case "move":          _closeTMenu(); G.openMoveModal(id); break;
    case "dup":           _closeTMenu(); G.duplicateTest(id); break;
    case "share":         _closeTMenu(); if (t) G.openShareModal(id, t.title); break;
    case "delete":        _closeTMenu(); G.confDelTest(id); break;
    case "open-folder":   _closeTMenu(); G.setFF(id || "all"); break;
    case "add-test": {
      _closeTMenu();
      // Без явної папки — створюємо в тій, яку зараз відкрито
      const cur = _fFilter && _fFilter !== "all" && _fFilter !== "none" ? _fFilter : null;
      G.openTestInFolder(id && id !== "none" ? id : cur);
      break;
    }
    case "new-folder":    _closeTMenu(); G.openFolderModal(); break;
    case "folder-edit":   _closeTMenu(); G.openFolderModal(id); break;
    case "folder-delete": _closeTMenu(); G.confDelFolder(id); break;
    case "restore":       G.restoreTest(id); break;
    case "purge":         G.confDelTest(id); break;
    case "reset-filters": { TS.q = ""; TS.status = ""; window._testsStatus = ""; const i = $("srch"); if (i) i.value = ""; renderTests(); break; }
  }
}
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  const inScope = el && (el.closest("#sec-tests") || el.closest("#sec-archive") || el.closest("#t-float-menu"));
  if (!inScope){
    if (!e.target.closest("#t-float-menu")) _closeTMenu();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  _testsAction(el.dataset.act, el.dataset.id || "", el);
});
document.addEventListener("keydown", e => {
  const menu = document.getElementById("t-float-menu");
  if (e.key === "Escape" && menu){ const a = _tMenuFor; _closeTMenu(); a?.focus(); return; }
  if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")){
    const items = [...menu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault(); return;
  }
  // Enter/пробіл на картці папки (вона div з role=button)
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".t-folder-card")){
    e.preventDefault(); _testsAction("open-folder", e.target.dataset.id, e.target); return;
  }
  // «/» — фокус у пошук
  if (e.key === "/" && !e.target.closest("input,textarea,select,[contenteditable]") && document.getElementById("srch")?.offsetParent){
    e.preventDefault(); document.getElementById("srch").focus();
  }
});
window.addEventListener("resize", () => _closeTMenu());
document.addEventListener("scroll", () => _closeTMenu(), true);

function _closeCdMenus(){
  document.querySelectorAll(".cd-menu.open").forEach(m => m.classList.remove("open"));
  document.querySelectorAll(".cd-btn.active").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-expanded", "false"); });
}
document.addEventListener("click", e => { if (!e.target.closest(".cd-wrap")) _closeCdMenus(); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const open = document.querySelector(".cd-menu.open");
  if (open){ const btn = open.closest(".cd-wrap")?.querySelector(".cd-btn"); _closeCdMenus(); btn?.focus(); }
});

// Панель інструментів: пошук з невеликою затримкою, фільтри, сортування, вигляд
(function _wireToolbar(){
  const bar = document.getElementById("t-toolbar");
  if (!bar) return;
  let timer;
  const inp = document.getElementById("srch");
  inp?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { TS.q = inp.value.trim(); renderTests(); }, 120); });
  inp?.addEventListener("keydown", e => { if (e.key === "Escape" && inp.value){ e.stopPropagation(); inp.value = ""; TS.q = ""; renderTests(); } });
  document.getElementById("srch-clear")?.addEventListener("click", () => { inp.value = ""; TS.q = ""; renderTests(); inp.focus(); });
  bar.addEventListener("click", e => {
    const s = e.target.closest("[data-status]");
    if (s){ TS.status = s.dataset.status; window._testsStatus = TS.status; renderTests(); return; }
    const v = e.target.closest("[data-view]");
    if (v){ TS.view = v.dataset.view; window._testsView = TS.view; _saveTS(); renderTests(); }
  });
  bar.addEventListener("click", e => {
    const it = e.target.closest("[data-sort]");
    if (it){ TS.sort = it.dataset.sort; _saveTS(); _closeCdMenus(); renderTests(); document.querySelector("#cd-tsort .cd-btn")?.focus(); }
  });
})();

// Папка в адресі (?folder=ID): кнопка «Назад» у браузері повертає до всіх папок
(function _initFolderFromUrl(){
  if (!document.getElementById("tc")) return;
  const f = new URLSearchParams(location.search).get("folder");
  if (f){ _fFilter = f; window._fFilter = f; }
  window.addEventListener("popstate", () => {
    const v = new URLSearchParams(location.search).get("folder") || "all";
    G.setFF(v, { fromHistory: true });
  });
})();

// ATTEMPTS
fillSelects = function(){
  // Групи з посилань (без прихованих через архівацію студентської групи)
  const groups=[...new Set(links.filter(l=>!l.groupHidden).map(l=>l.group).filter(Boolean))].sort();
  // Аналітика - тести
  const anTest=$("an-test");
  if(anTest){
    const prev=anTest.value;
    anTest.innerHTML=`<option value="">Оберіть тест...</option>`+
      tests.filter(t=>t.status!=="archived").map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");
    if(prev) anTest.value=prev;
  }
  const anMenu=document.getElementById("cd-an-test-menu");
  if(anMenu){
    const curAn=$("an-test")?.value||"";
    anMenu.innerHTML=`<div class="cd-item${!curAn?" cd-active":""}" data-val="_none" onclick="G.selectAnalyticsDrop('test','','Оберіть тест...')">— Без фільтру</div>`+
      tests.filter(t=>t.status!=="archived").map(t=>
        `<div class="cd-item${curAn===t.id?" cd-active":""}" data-val="${t.id}" onclick="G.selectAnalyticsDrop('test','${t.id}',${jsq(t.title)})">${esc(t.title)}</div>`
      ).join("");
  }
  // Аналітика - групи
  const anGrp=$("an-group");
  if(anGrp){
    anGrp.innerHTML=`<option value="">Всі групи</option>`+groups.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join("");
  }
  const anGrpMenu=document.getElementById("cd-an-group-menu");
  if(anGrpMenu){
    const curGrpAn=$("an-group")?.value||"";
    anGrpMenu.innerHTML=`<div class="cd-item${!curGrpAn?" cd-active":""}" data-val="_none" onclick="G.selectAnalyticsDrop('group','','Всі групи')">Всі групи</div>`+
      groups.map(g=>`<div class="cd-item${curGrpAn===g?" cd-active":""}" data-val="${esc(g)}" onclick="G.selectAnalyticsDrop('group',${jsq(g)},${jsq(g)})">${esc(g)}</div>`
      ).join("");
  }
  // Посилання - тест у модалі (тепер покроковий пікер папка→тест; оновлюємо
  // лише якщо модалка зараз відкрита і пікер видимий, щоб список був актуальний після змін)
  if (document.getElementById("nl-picker-content") && document.getElementById("nl-picker-box")?.style.display !== "none") G.renderNlPicker();
}



// ═════════════════════════════════════════════════════════════════════
// qfDrop — власний дропдаун (стандартних <select> у панелі немає).
// Меню рендериться в body (не обрізається overflow картки), з пошуком
// для довгих списків, клавіатурою (↑↓ Enter Esc) і лічильниками.
//   const d = qfDrop(hostEl, { items:[{value,label,count?,sub?}], value, placeholder, search, onChange, icon })
//   d.set(value) · d.setItems(items) · d.value
// ═════════════════════════════════════════════════════════════════════
function qfDrop(host, opt = {}){
  const st = { items: opt.items || [], value: opt.value ?? "" };
  host.classList.add("qd");
  host.innerHTML = `<button type="button" class="qd-btn" aria-haspopup="listbox" aria-expanded="false">${opt.icon || ""}<span class="qd-lbl"></span><svg class="qd-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>`;
  const btn = host.firstElementChild, lbl = btn.querySelector(".qd-lbl");
  const def = opt.defaultValue ?? "";
  const paint = () => {
    const it = st.items.find(i => i.value === st.value);
    lbl.textContent = it ? (opt.prefix ? opt.prefix + it.label : it.label) : (opt.placeholder || "—");
    btn.classList.toggle("set", st.value !== def);
    btn.title = lbl.textContent;
  };
  let pop = null, kb = -1, q = "";
  const list = () => {
    const f = q.trim().toLowerCase();
    return f ? st.items.filter(i => String(i.label).toLowerCase().includes(f)) : st.items;
  };
  const renderList = () => {
    const box = pop.querySelector(".qd-list"), items = list();
    kb = Math.min(kb, items.length - 1);
    box.innerHTML = items.length ? items.map((i, k) => `<button type="button" role="option" class="qd-it${i.value === st.value ? " on" : ""}${k === kb ? " kb" : ""}" data-k="${k}" aria-selected="${i.value === st.value}">
        <span class="qd-it-t">${esc(i.label)}${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span>
        ${i.count != null ? `<span class="qd-n">${i.count}</span>` : ""}
        ${i.value === st.value ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>` : ""}
      </button>`).join("") : `<div class="qd-empty">Нічого не знайдено</div>`;
    box.querySelector(".kb")?.scrollIntoView({ block: "nearest" });
  };
  const place = () => {
    if (!pop) return;
    const r = btn.getBoundingClientRect(), w = Math.max(r.width, opt.width || 200);
    pop.style.minWidth = w + "px";
    const pr = pop.getBoundingClientRect();
    let left = Math.min(r.left, innerWidth - pr.width - 8), top = r.bottom + 6;
    if (top + pr.height > innerHeight - 8 && r.top - pr.height - 6 > 8) top = r.top - pr.height - 6;
    pop.style.left = Math.max(8, left) + "px"; pop.style.top = top + "px";
  };
  const pick = v => { close(); if (v === st.value) return; st.value = v; paint(); opt.onChange?.(v); };
  const outside = e => { if (pop && !pop.contains(e.target) && !host.contains(e.target)) close(); };
  const onKey = e => {
    if (!pop) return;
    const items = list();
    if (e.key === "Escape"){ e.preventDefault(); e.stopImmediatePropagation(); close(); btn.focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); kb = (kb + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length); renderList(); }
    else if (e.key === "Enter" && kb >= 0 && items[kb]){ e.preventDefault(); pick(items[kb].value); }
  };
  const onScroll = e => { if (pop && !pop.contains(e.target)) close(); };
  function open(){
    document.querySelectorAll(".qd-pop").forEach(p => p._close?.());
    q = ""; kb = Math.max(0, st.items.findIndex(i => i.value === st.value));
    pop = document.createElement("div");
    pop.className = "qd-pop"; pop.dataset.open = "1"; pop.setAttribute("role", "listbox");
    pop._close = close;
    const withSearch = opt.search ?? st.items.length > 8;
    pop.innerHTML = `${withSearch ? `<div class="qd-s"><input type="text" placeholder="${esc(opt.searchPlaceholder || "Пошук…")}" autocomplete="off"></div>` : ""}<div class="qd-list"></div>`;
    document.body.appendChild(pop);
    renderList(); place();
    btn.classList.add("open"); btn.setAttribute("aria-expanded", "true");
    pop.addEventListener("mousedown", e => { if (!e.target.closest("input")) e.preventDefault(); });
    pop.addEventListener("click", e => { const b = e.target.closest(".qd-it"); if (b) pick(list()[+b.dataset.k].value); });
    const inp = pop.querySelector("input");
    if (inp){ inp.addEventListener("input", () => { q = inp.value; kb = 0; renderList(); place(); }); setTimeout(() => inp.focus(), 0); }
    document.addEventListener("mousedown", outside, true);
    addEventListener("keydown", onKey, true);
    addEventListener("resize", close);
    addEventListener("scroll", onScroll, true);
  }
  function close(){
    if (!pop) return;
    pop.remove(); pop = null;
    btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", outside, true);
    removeEventListener("keydown", onKey, true);
    removeEventListener("resize", close);
    removeEventListener("scroll", onScroll, true);
  }
  btn.addEventListener("click", () => pop ? close() : open());
  btn.addEventListener("keydown", e => { if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !pop){ e.preventDefault(); open(); } });
  paint();
  return {
    get value(){ return st.value; },
    set(v){ st.value = v; paint(); },
    setItems(items){ st.items = items; paint(); if (pop){ renderList(); place(); } },
    close,
  };
}
window.qfDrop = qfDrop;

// ═════════════════════════════════════════════════════════════════════
// СПРОБИ — сторінка «Спроби» (attempts.html)
//
// Швидкодія: рядки (тест, група, пошуковий рядок, порушення, тривалість)
// рахуються ОДИН раз на зміну даних і кешуються — фільтри, пошук, сортування
// й сторінки працюють з готовим масивом. Живі оновлення приходять пачкою
// (див. startRealtimeListeners), таблиця малює лише поточну сторінку.
// ═════════════════════════════════════════════════════════════════════
const AT = {
  q: "", test: "", group: "", period: "", status: "",
  sort: { f: "date", d: "desc" }, page: 1, per: 20,
  sel: new Set(), drops: {}, bound: false, urlDone: false,
};
try {
  const saved = JSON.parse(localStorage.getItem("qf_att_prefs") || "{}");
  if ([20, 50, 100].includes(saved.per)) AT.per = saved.per;
  if (saved.sort?.f) AT.sort = saved.sort;
} catch {}
const _atSavePrefs = () => { try { localStorage.setItem("qf_att_prefs", JSON.stringify({ per: AT.per, sort: AT.sort })); } catch {} };
window._attPage = 1;   // сумісність зі старими викликами

const AT_STATUS = {
  completed:      { label: "Завершено",     cls: "on" },
  in_progress:    { label: "Проходить",     cls: "info" },
  pending_review: { label: "На перевірці",  cls: "draft" },
};
const AT_PERIODS = [
  { value: "", label: "Увесь час" }, { value: "today", label: "Сьогодні" },
  { value: "7d", label: "Останні 7 днів" }, { value: "30d", label: "Останні 30 днів" },
];
const _atPeriodFrom = p => p === "today" ? new Date().setHours(0, 0, 0, 0) : p === "7d" ? Date.now() - 7 * 864e5 : p === "30d" ? Date.now() - 30 * 864e5 : 0;
function _atAgo(t){
  if (!t) return "—";
  const d = Date.now() - t, m = Math.round(d / 60000);
  if (m < 1) return "щойно";
  if (m < 60) return `${m} хв тому`;
  const h = Math.round(m / 60);
  const dt = new Date(t), today = new Date().setHours(0, 0, 0, 0);
  const hm = dt.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  if (t >= today) return h < 6 ? `${h} год тому` : `сьогодні ${hm}`;
  if (t >= today - 864e5) return `вчора ${hm}`;
  return dt.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }) + ` ${hm}`;
}
const _atDur = a => (a.finishedAt && a.startedAt && a.finishedAt > a.startedAt) ? a.finishedAt - a.startedAt : null;
const _atFmtDur = ms => { if (ms == null) return "—"; const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// Кеш підготовлених рядків
let _atRowsSrc = null, _atRows = [];
function _atPrepare(){
  if (_atRowsSrc && _atRowsSrc.a === attempts && _atRowsSrc.t === tests && _atRowsSrc.l === links) return _atRows;
  const tMap = new Map(tests.map(t => [t.id, t])), lMap = new Map(links.map(l => [l.id, l]));
  _atRows = attempts.map(a => {
    const t = tMap.get(a.testId), group = a.group || lMap.get(a.linkId)?.group || "";
    const name = `${a.surname || ""} ${a.name || ""}`.trim() || "Без імені";
    const title = t?.title || "Тест видалено";
    return {
      a, id: a.id, t, title, group, name,
      nameKey: name.toLowerCase(),
      hay: `${name} ${a.name || ""} ${title} ${group}`.toLowerCase(),
      viol: _attViolation(a), dur: _atDur(a),
      pct: a.score?.percent ?? null, at: a.createdAt || 0,
    };
  });
  _atRowsSrc = { a: attempts, t: tests, l: links };
  return _atRows;
}
const _atIsFlagged = r => r.viol > 0;

renderAttempts = function(resetPage = false){
  const tb = $("att-tbl");
  if (!tb) return;
  _atBind();
  if (resetPage) AT.page = 1;
  const rows = _atPrepare();
  _atApplyUrl(rows);

  // ── KPI (увесь масив, один прохід) ──
  let done = 0, live = 0, pending = 0, flagged = 0, gsum = 0, gn = 0;
  for (const r of rows){
    const s = r.a.status;
    if (s === "completed") done++;
    else if (s === "in_progress") live++;
    else if (s === "pending_review") pending++;
    if (_atIsFlagged(r)) flagged++;
    if (r.a.grade12 != null && s !== "in_progress"){ gsum += Number(r.a.grade12) || 0; gn++; }
  }
  const setT = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setT("stat-total", rows.length); setT("stat-avg", gn ? (Math.round(gsum / gn * 10) / 10) : "—");
  setT("stat-inprog", live); setT("stat-pending", pending); setT("stat-flagged", flagged);
  $("att-kpi-live")?.classList.toggle("is-live", live > 0);
  $("att-kpi-pending")?.classList.toggle("is-hot", pending > 0);
  const chip = $("att-live-chip");
  if (chip){ chip.hidden = !live; setT("att-live-count", live); }

  // ── Випадаючі фільтри (варіанти рахуються з даних) ──
  _atSyncDrops(rows);

  // ── Фільтри без статусу → лічильники вкладок ──
  const from = _atPeriodFrom(AT.period);
  const words = AT.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const scoped = rows.filter(r =>
    (!AT.test || r.a.testId === AT.test) &&
    (!AT.group || r.group === AT.group) &&
    (!from || r.at >= from) &&
    (!words.length || words.every(w => r.hay.includes(w))));
  const cnt = { "": scoped.length, completed: 0, in_progress: 0, pending_review: 0, flagged: 0 };
  for (const r of scoped){ if (cnt[r.a.status] != null) cnt[r.a.status]++; if (_atIsFlagged(r)) cnt.flagged++; }
  document.querySelectorAll("#fst-tabs .tab").forEach(t => {
    const s = t.dataset.status; t.classList.toggle("active", s === AT.status); t.setAttribute("aria-selected", s === AT.status);
    const n = t.querySelector(".tab-n"); if (n) n.textContent = cnt[s] ?? 0;
  });
  let lst = AT.status === "flagged" ? scoped.filter(_atIsFlagged) : AT.status ? scoped.filter(r => r.a.status === AT.status) : scoped;

  // ── Сортування ──
  const { f, d } = AT.sort, dir = d === "asc" ? 1 : -1;
  const key = f === "name" ? r => r.nameKey : f === "grade" ? r => r.a.grade12 ?? -1 : f === "time" ? r => r.dur ?? -1 : f === "test" ? r => r.title.toLowerCase() : r => r.at;
  const coll = new Intl.Collator("uk");
  lst = lst.slice().sort((x, y) => {
    const a = key(x), b = key(y);
    return (typeof a === "string" ? coll.compare(a, b) : a - b) * dir || (y.at - x.at);
  });
  document.querySelectorAll("#att-thead th[data-sort]").forEach(th => {
    const on = th.dataset.sort === f;
    th.classList.toggle("sorted", on);
    th.setAttribute("aria-sort", on ? (d === "asc" ? "ascending" : "descending") : "none");
    const ind = th.querySelector(".sort-ind"); if (ind) ind.textContent = on ? (d === "asc" ? "↑" : "↓") : "↕";
  });

  // ── Підписи ──
  const filtered = !!(words.length || AT.test || AT.group || AT.period || AT.status);
  $("att-reset")?.toggleAttribute("hidden", !filtered);
  setT("att-count-right", filtered ? `${lst.length} з ${rows.length}` : `${rows.length} ${_plural(rows.length, "спроба", "спроби", "спроб")}`);
  setT("att-count-label", filtered
    ? `Знайдено ${lst.length} ${_plural(lst.length, "спробу", "спроби", "спроб")} за фільтром`
    : "Усі проходження тестів студентами · оновлюється в реальному часі");

  // Виділення: прибираємо зниклі
  if (AT.sel.size){ const ids = new Set(rows.map(r => r.id)); for (const id of AT.sel) if (!ids.has(id)) AT.sel.delete(id); }
  AT._lst = lst;

  // ── Порожньо ──
  const pagEl = $("att-pagination");
  if (!lst.length){
    tb.innerHTML = `<tr><td colspan="9" style="padding:0"><div class="empty-state">
      <div class="es-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
      <div class="es-title">${filtered ? "Нічого не знайдено" : "Ще немає спроб"}</div>
      <div class="es-hint">${filtered ? "Змініть фільтри або пошуковий запит" : "Коли студенти почнуть проходити тести за посиланнями, спроби з'являться тут"}</div>
      ${filtered ? `<button class="btn-reset" data-aact="reset" style="margin:14px auto 0">Скинути фільтри</button>` : `<a class="btn-reset" href="links" style="margin:14px auto 0;display:inline-flex">Створити посилання →</a>`}
    </div></td></tr>`;
    if (pagEl) pagEl.innerHTML = "";
    _atSyncBulk();
    return;
  }

  // ── Сторінка ──
  const pages = Math.max(1, Math.ceil(lst.length / AT.per));
  AT.page = Math.min(Math.max(1, AT.page), pages); window._attPage = AT.page;
  const start = (AT.page - 1) * AT.per, pageRows = lst.slice(start, start + AT.per);
  tb.innerHTML = pageRows.map(_atRow).join("");

  if (pagEl){
    let nums = [];
    for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - AT.page) <= 1) nums.push(p); else if (nums[nums.length - 1] !== "…") nums.push("…");
    pagEl.innerHTML = `<div class="pg">
      <span class="pg-info">${start + 1}–${Math.min(start + AT.per, lst.length)} з ${lst.length}</span>
      <div class="pg-nums">${pages > 1 ? `
        <button data-page="${AT.page - 1}" ${AT.page === 1 ? "disabled" : ""} aria-label="Попередня">‹</button>
        ${nums.map(p => p === "…" ? `<span class="pg-ellipsis">…</span>` : `<button data-page="${p}" class="${p === AT.page ? "active" : ""}">${p}</button>`).join("")}
        <button data-page="${AT.page + 1}" ${AT.page === pages ? "disabled" : ""} aria-label="Наступна">›</button>` : ""}</div>
      <div class="pg-per"><span>На сторінці</span><div id="att-per"></div></div>
    </div>`;
    AT.drops.per = qfDrop($("att-per"), { items: [20, 50, 100].map(n => ({ value: n, label: String(n) })), value: AT.per, defaultValue: AT.per, width: 90,
      onChange: v => { AT.per = v; AT.page = 1; _atSavePrefs(); renderAttempts(); } });
  }
  _atSyncBulk();
};

function _atRow(r){
  const a = r.a, st = AT_STATUS[a.status] || { label: a.status || "—", cls: "off" };
  const gc = _attGradeColors(a.grade12);
  const grade = a.grade12 != null
    ? `<span class="grade-chip" style="background:${gc.bg};color:${gc.fg}">${a.grade12}</span>${r.pct != null ? `<span class="pct">${r.pct}%</span>` : ""}`
    : a.status === "pending_review" ? `<button class="review-btn" data-aact="view" data-id="${a.id}">Оцінити</button>` : `<span class="muted mono">—</span>`;
  const c = a.score?.correct, tot = a.score?.total ?? (r.t?.questions?.length || null);
  const correct = c != null && tot ? `<div class="cor"><span class="mono">${c}/${tot}</span><i><b style="width:${Math.round(c / tot * 100)}%"></b></i></div>` : `<span class="muted mono">—</span>`;
  let status = `<span class="pill ${st.cls}">${st.label}</span>`;
  if (a.status === "in_progress"){
    const online = a.lastSeen && Date.now() - a.lastSeen < 120000;
    status = `<div class="live-cell"><span class="pill ${online ? "live" : "off"}">${online ? "Проходить" : "Неактивний"}</span>${a.currentQ && a.totalQ ? `<small>питання ${a.currentQ} з ${a.totalQ}</small>` : ""}</div>`;
  }
  const flag = r.viol > 0 ? `<span class="flag-icon" title="${[a.tabSwitches ? `переключень вкладок: ${a.tabSwitches}` : "", a.copyAttempts ? `спроб копіювання: ${a.copyAttempts}` : "", a.screenshots ? `скріншотів: ${a.screenshots}` : ""].filter(Boolean).join(", ")}">⚑ ${r.viol}</span>` : "";
  const sel = AT.sel.has(a.id);
  return `<tr class="clickable${sel ? " sel" : ""}" data-id="${a.id}">
    <td class="ck" data-aact="ck"><input type="checkbox" ${sel ? "checked" : ""} aria-label="Вибрати"></td>
    <td><div class="stu">${_attAva(a.name, a.surname)}<div class="stu-n"><b>${esc(r.name)}</b>${flag}</div></div></td>
    <td class="tcell"><span title="${esc(r.title)}"${r.t ? "" : ' class="muted"'}>${esc(r.title)}</span></td>
    <td>${r.group ? `<span class="pill grp">${esc(r.group)}</span>` : '<span class="muted">—</span>'}</td>
    <td><div class="grade">${grade}</div></td>
    <td>${correct}</td>
    <td class="mono muted">${_atFmtDur(r.dur)}</td>
    <td class="when" title="${a.createdAt ? new Date(a.createdAt).toLocaleString("uk-UA") : ""}">${_atAgo(a.createdAt)}</td>
    <td>${status}</td>
    <td><div class="row-actions">
      <button class="ic-btn" title="Переглянути" data-aact="view" data-id="${a.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
      <button class="ic-btn danger" title="Видалити" data-aact="del" data-id="${a.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
    </div></td>
  </tr>`;
}

// Дропдауни «Тест», «Група», «Період» (qfDrop) — варіанти з лічильниками
function _atSyncDrops(rows){
  if (!$("att-f-test")) return;
  const tc = new Map(), gc = new Map();
  for (const r of rows){ tc.set(r.a.testId, (tc.get(r.a.testId) || 0) + 1); if (r.group) gc.set(r.group, (gc.get(r.group) || 0) + 1); }
  const tItems = [{ value: "", label: "Усі тести" }, ...[...tc].map(([id, n]) => ({ value: id, label: tests.find(t => t.id === id)?.title || "Тест видалено", count: n }))
    .sort((a, b) => a.label.localeCompare(b.label, "uk"))];
  const gItems = [{ value: "", label: "Усі групи" }, ...[...gc].map(([g, n]) => ({ value: g, label: g, count: n })).sort((a, b) => a.label.localeCompare(b.label, "uk"))];
  if (AT.test && !tc.has(AT.test)) tItems.push({ value: AT.test, label: tests.find(t => t.id === AT.test)?.title || "Тест", count: 0 });
  if (AT.group && !gc.has(AT.group)) gItems.push({ value: AT.group, label: AT.group, count: 0 });
  const ic = p => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  if (!AT.drops.test){
    AT.drops.test = qfDrop($("att-f-test"), { items: tItems, value: AT.test, width: 260, searchPlaceholder: "Пошук тесту…", icon: ic('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>'),
      onChange: v => { AT.test = v; renderAttempts(true); } });
    AT.drops.group = qfDrop($("att-f-group"), { items: gItems, value: AT.group, width: 200, searchPlaceholder: "Пошук групи…", icon: ic('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>'),
      onChange: v => { AT.group = v; renderAttempts(true); } });
    AT.drops.period = qfDrop($("att-f-period"), { items: AT_PERIODS, value: AT.period, width: 180, search: false, icon: ic('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
      onChange: v => { AT.period = v; renderAttempts(true); } });
  } else {
    AT.drops.test.setItems(tItems); AT.drops.test.set(AT.test);
    AT.drops.group.setItems(gItems); AT.drops.group.set(AT.group);
    AT.drops.period.set(AT.period);
  }
}

// Фільтри з адреси: attempts?test=…&group=…&status=…
function _atApplyUrl(rows){
  if (AT.urlDone) return;
  const p = new URLSearchParams(location.search);
  if (!p.has("test") && !p.has("group") && !p.has("status")){ AT.urlDone = true; return; }
  if (p.get("test") && !rows.length && !tests.length) return;   // дані ще не прийшли
  AT.urlDone = true;
  AT.test = p.get("test") || ""; AT.group = p.get("group") || "";
  const s = p.get("status"); if (["completed", "in_progress", "pending_review", "flagged"].includes(s)) AT.status = s;
}

function _atSyncBulk(){
  const bar = $("att-bulk"); if (!bar) return;
  const n = AT.sel.size;
  bar.hidden = !n;
  if (n) $("att-bulk-n").textContent = `Вибрано ${n} ${_plural(n, "спробу", "спроби", "спроб")}`;
  const all = $("att-ck-all");
  if (all){
    const ids = [...document.querySelectorAll("#att-tbl tr[data-id]")].map(tr => tr.dataset.id);
    const k = ids.filter(id => AT.sel.has(id)).length;
    all.checked = !!ids.length && k === ids.length; all.indeterminate = k > 0 && k < ids.length;
  }
}

// CSV (Excel відкриває з кирилицею завдяки BOM і «;»)
function _atExportCSV(rowsToExport){
  const cell = v => { const s = String(v ?? ""); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Прізвище", "Ім'я", "Група", "Тест", "Оцінка (1–12)", "Відсоток", "Правильних", "Питань", "Тривалість", "Дата", "Статус", "Порушення"];
  const lines = rowsToExport.map(r => {
    const a = r.a;
    return [a.surname, a.name, r.group, r.title, a.grade12 ?? "", r.pct != null ? r.pct + "%" : "", a.score?.correct ?? "", a.score?.total ?? "",
      _atFmtDur(r.dur).replace("—", ""), a.createdAt ? new Date(a.createdAt).toLocaleString("uk-UA") : "", (AT_STATUS[a.status]?.label || a.status || ""), r.viol || ""].map(cell).join(";");
  });
  const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const el = document.createElement("a");
  const t = AT.test ? (tests.find(x => x.id === AT.test)?.title || "тест") : "усі";
  el.download = `Спроби — ${t}${AT.group ? " — " + AT.group : ""} — ${new Date().toLocaleDateString("uk-UA")}.csv`.replace(/[\\/:*?"<>|]/g, "_");
  el.href = URL.createObjectURL(blob);
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  toast(`Експортовано ${rowsToExport.length} ${_plural(rowsToExport.length, "спробу", "спроби", "спроб")}`);
}

// Один делегований обробник + оновлення «хв тому» щохвилини
function _atBind(){
  if (AT.bound) return;
  AT.bound = true;
  const tb = $("att-tbl");
  tb.addEventListener("click", e => {
    const act = e.target.closest("[data-aact]");
    const tr = e.target.closest("tr[data-id]");
    if (act?.dataset.aact === "ck" || e.target.matches("input[type=checkbox]")){
      if (!tr) return;
      const id = tr.dataset.id, on = !AT.sel.has(id);
      on ? AT.sel.add(id) : AT.sel.delete(id);
      tr.classList.toggle("sel", on);
      const cb = tr.querySelector("input[type=checkbox]"); if (cb) cb.checked = on;
      _atSyncBulk();
      return;
    }
    if (act?.dataset.aact === "del"){ const r = _atRows.find(x => x.id === act.dataset.id); return G.confDelAttempt(act.dataset.id, r?.name || ""); }
    if (act?.dataset.aact === "reset") return _atReset();
    if (tr) G.viewAtt(tr.dataset.id);
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-aact]"); if (!b || tb.contains(b)) return;
    const a = b.dataset.aact;
    if (a === "reset") _atReset();
    else if (a === "kpi"){ AT.status = b.dataset.status || ""; renderAttempts(true); }
    else if (a === "export") _atExportCSV(AT._lst || []);
    else if (a === "bulk-export") _atExportCSV(_atRows.filter(r => AT.sel.has(r.id)));
    else if (a === "bulk-del") G.confDelAttempts([...AT.sel]);
    else if (a === "bulk-clear"){ AT.sel.clear(); renderAttempts(); }
  });
  $("att-pagination")?.addEventListener("click", e => {
    const b = e.target.closest("button[data-page]"); if (!b || b.disabled) return;
    AT.page = +b.dataset.page; renderAttempts();
    $("sec-attempts")?.querySelector(".card")?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  $("fst-tabs")?.addEventListener("click", e => {
    const t = e.target.closest(".tab"); if (!t) return;
    AT.status = t.dataset.status; renderAttempts(true);
  });
  $("att-thead")?.addEventListener("click", e => {
    const th = e.target.closest("th[data-sort]");
    if (th){
      const f = th.dataset.sort;
      AT.sort = AT.sort.f === f ? { f, d: AT.sort.d === "asc" ? "desc" : "asc" } : { f, d: f === "date" || f === "grade" || f === "time" ? "desc" : "asc" };
      _atSavePrefs(); renderAttempts();
      return;
    }
    if (e.target.id === "att-ck-all"){
      const ids = [...document.querySelectorAll("#att-tbl tr[data-id]")].map(tr => tr.dataset.id);
      const on = e.target.checked;
      ids.forEach(id => on ? AT.sel.add(id) : AT.sel.delete(id));
      renderAttempts();
    }
  });
  const srch = $("att-srch");
  let tm = 0;
  srch?.addEventListener("input", () => {
    $("att-srch-wrap")?.classList.toggle("has-q", !!srch.value);
    clearTimeout(tm); tm = setTimeout(() => { AT.q = srch.value; renderAttempts(true); }, 120);
  });
  $("att-srch-clear")?.addEventListener("click", () => { srch.value = ""; AT.q = ""; $("att-srch-wrap")?.classList.remove("has-q"); srch.focus(); renderAttempts(true); });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !e.target.closest("input,textarea,[contenteditable]") && !document.querySelector(".mo.on")){ e.preventDefault(); srch?.focus(); }
  });
  setInterval(() => { if (document.visibilityState === "visible" && !document.querySelector(".mo.on")) renderAttempts(); }, 60000);
}
function _atReset(){
  AT.q = ""; AT.test = ""; AT.group = ""; AT.period = ""; AT.status = "";
  const s = $("att-srch"); if (s) s.value = "";
  $("att-srch-wrap")?.classList.remove("has-q");
  if (location.search) history.replaceState(null, "", location.pathname);
  renderAttempts(true);
}

// ═════════════════════════════════════════════════════════════════════
// ПОСИЛАННЯ — сторінка «Посилання» (links.html)
//
// Посилання = тест + група + ліміт студентів + розклад (відкриття/закриття).
// Фактичний стан рахується тут (linkState), а не лише з поля status:
// термін міг минути, ліміт — вичерпатись, тест — стати чернеткою.
// Усі дії на картках — через data-lact і один делегований обробник.
// ═════════════════════════════════════════════════════════════════════
const linkUrl = id => `${location.origin}${location.pathname.replace(/[^/]*$/, "")}test?link=${encodeURIComponent(id)}&t=${encodeURIComponent(_uid)}`;
const _lnkMax = l => Number(l.maxAttempts) > 0 ? Number(l.maxAttempts) : 0;   // 0 — без ліміту
const _fmtDT = t => new Date(t).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function _inWords(ms){
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 1) return "менше хвилини";
  if (m < 60) return `${m} хв`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} год`;
  const d = Math.round(h / 24);
  return `${d} ${_plural(d, "день", "дні", "днів")}`;
}
// Проблема з тестом, через яку студенти не зможуть пройти посилання
function linkTestIssue(t){
  if (!t) return { kind: "deleted", text: "Тест видалено — посилання не працює" };
  if (t.status === "archived") return { kind: "archived", text: "Тест в архіві — студенти побачать помилку" };
  if (t.status === "draft") return { kind: "draft", text: "Тест — чернетка, студенти не зможуть його відкрити" };
  if (t.status === "closed") return { kind: "closed", text: "Тест закрито — студенти не зможуть його відкрити" };
  if (!(t.questions || []).length) return { kind: "empty", text: "У тесті немає питань" };
  return null;
}
// Стан посилання: active | scheduled | full | expired | closed
function linkState(l, now = Date.now()){
  if (l.status !== "active") return l.closedReason === "expired" ? "expired" : "closed";
  if (l.closeAt && now > l.closeAt) return "expired";
  const max = _lnkMax(l);
  if (max && (l.usedAttempts || 0) >= max) return "full";
  if (l.openAt && now < l.openAt) return "scheduled";
  return "active";
}
const LINK_STATE = {
  active:    { label: "Активне",        cls: "on" },
  scheduled: { label: "Заплановане",    cls: "sched" },
  full:      { label: "Ліміт вичерпано", cls: "warn" },
  expired:   { label: "Термін минув",   cls: "closed" },
  closed:    { label: "Закрите",        cls: "off" },
};
const _isOpenState = s => s === "active" || s === "scheduled" || s === "full";
window.linkState = linkState;

// Статистика спроб по кожному посиланню за один прохід
function _linkStats(){
  const m = new Map(), dayStart = new Date().setHours(0, 0, 0, 0);
  for (const a of attempts){
    if (!a.linkId) continue;
    let s = m.get(a.linkId);
    if (!s) m.set(a.linkId, s = { done: 0, now: 0, today: 0, sum: 0, graded: 0, last: 0 });
    if (a.status === "in_progress") s.now++;
    else if (a.status === "completed" || a.status === "pending_review"){
      s.done++;
      if ((a.createdAt || 0) >= dayStart) s.today++;
      if (a.grade12 != null){ s.sum += Number(a.grade12) || 0; s.graded++; }
    }
    s.last = Math.max(s.last, a.createdAt || 0);
  }
  return m;
}

// Прострочені посилання позначаємо закритими в базі одним записом (раз на сесію для кожного)
const _autoClosed = new Set();
function _syncExpiredLinks(){
  const now = Date.now(), upd = {};
  for (const l of links){
    if (l.status === "active" && l.closeAt && now > l.closeAt && !_autoClosed.has(l.id)){
      _autoClosed.add(l.id);
      upd[`${l.id}/status`] = "closed"; upd[`${l.id}/closedReason`] = "expired";
    }
  }
  if (Object.keys(upd).length) dbUpd("links", upd).catch(() => {});
}


// datetime-local ↔ timestamp (локальний час)
const _toLocalDT = ts => { const d = new Date(ts), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const _fromLocalDT = v => { if (!v) return null; const t = new Date(v).getTime(); return isNaN(t) ? null : t; };
// QR через qrcodejs (підключений на сторінках панелі); повертає true, якщо намалювали
function _drawQR(box, text, size){
  if (!box) return false;
  box.innerHTML = "";
  if (!window.QRCode){ box.innerHTML = `<div class="qr-na">QR недоступний офлайн</div>`; return false; }
  // Бібліотека малює canvas і показує його копію як <img>; canvas лишається для «Зберегти PNG»
  new QRCode(box, { text, width: size, height: size, colorDark: "#0B1437", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
  return !!box.querySelector("canvas");
}
async function _copyText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }
}

const LNK_SORTS = {
  new:   { label: "Спочатку нові",        fn: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) },
  soon:  { label: "Скоро закриються",     fn: (a, b) => (a.closeAt || Infinity) - (b.closeAt || Infinity) || (b.createdAt || 0) - (a.createdAt || 0) },
  busy:  { label: "Найбільше проходжень", fn: (a, b, st) => (st.get(b.id)?.done || 0) - (st.get(a.id)?.done || 0) },
  title: { label: "За назвою тесту",      fn: (a, b) => (tests.find(t => t.id === a.testId)?.title || "").localeCompare(tests.find(t => t.id === b.testId)?.title || "", "uk") },
};
window.LNK_SORTS = LNK_SORTS;

renderLinks = function(){
  const tb = $("lnk-tbl");
  if (!tb) return;
  _bindLinksPage();
  _syncExpiredLinks();
  const now = Date.now(), stats = _linkStats();
  const withState = links.map(l => ({ l, st: linkState(l, now) }));

  // ── KPI і лічильники вкладок ──
  const cnt = { open: 0, scheduled: 0, closed: 0 };
  let liveNow = 0, doneToday = 0, closingSoon = 0;
  for (const { l, st } of withState){
    if (_isOpenState(st)) cnt.open++; else cnt.closed++;
    if (st === "scheduled") cnt.scheduled++;
    const s = stats.get(l.id);
    if (s){ doneToday += s.today; if (_isOpenState(st)) liveNow += s.now; }
    if (st === "active" && l.closeAt && l.closeAt - now < 864e5) closingSoon++;
  }
  const setT = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setT("lnk-k-open", cnt.open); setT("lnk-k-live", liveNow); setT("lnk-k-today", doneToday); setT("lnk-k-soon", closingSoon);
  setT("lnk-tab-active", cnt.open); setT("lnk-tab-sched", cnt.scheduled); setT("lnk-tab-closed", cnt.closed); setT("lnk-tab-all", links.length);
  const liveKpi = $("lnk-k-live")?.closest(".lk-kpi"); if (liveKpi) liveKpi.classList.toggle("is-live", liveNow > 0);

  // ── Фільтри й сортування ──
  const q = ($("lnk-srch")?.value || "").trim().toLowerCase();
  const tab = window._lnkStatus ?? "active";
  let lst = withState.filter(({ st }) =>
    tab === "active" ? _isOpenState(st) : tab === "scheduled" ? st === "scheduled" : tab === "closed" ? !_isOpenState(st) : true);
  if (q){
    const words = q.split(/\s+/).filter(Boolean);
    lst = lst.filter(({ l }) => {
      const hay = `${l.group || ""} ${tests.find(t => t.id === l.testId)?.title || ""}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }
  const sort = LNK_SORTS[window._lnkSort] || LNK_SORTS.new;
  lst.sort((a, b) => sort.fn(a.l, b.l, stats));

  const foot = $("lnk-count");
  if (foot) foot.textContent = lst.length ? `${lst.length} ${_plural(lst.length, "посилання", "посилання", "посилань")}` : "";

  if (!lst.length){
    const filtered = !!q || (tab && links.length);
    tb.innerHTML = `<div class="l-empty">
      <div class="l-empty-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5"/><path d="M14 11a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5"/></svg></div>
      <div class="l-empty-title">${q ? "Нічого не знайдено" : !links.length ? "Ще немає посилань" : tab === "scheduled" ? "Немає запланованих посилань" : tab === "closed" ? "Немає закритих посилань" : "Немає активних посилань"}</div>
      <div class="l-empty-hint">${q ? "Спробуйте інший запит" : !links.length ? "Оберіть тест, вкажіть групу — і надішліть студентам посилання або QR-код" : filtered ? "Змініть вкладку або створіть нове посилання" : ""}</div>
      ${!q ? `<button class="l-btn primary" data-lact="new" style="margin:0 auto">${_lic("plus")}Нове посилання</button>` : ""}
    </div>`;
    return;
  }
  tb.innerHTML = lst.map(({ l, st }) => _linkCard(l, st, stats.get(l.id), now)).join("");
};

const _LIC = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  edit: '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/>',
  dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 011-1h11"/><path d="M14.5 11.5v6M11.5 14.5h6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
  file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  link: '<path d="M10 13a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1.5 1.5"/><path d="M14 11a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1.5-1.5"/>',
};
const _lic = (n, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_LIC[n]}</svg>`;

function _linkCard(l, st, s = {}, now){
  const t = tests.find(x => x.id === l.testId);
  const S = LINK_STATE[st];
  const used = l.usedAttempts || 0, max = _lnkMax(l);
  const pct = max ? Math.min(100, Math.round(used / max * 100)) : 0;
  const issue = linkTestIssue(t);
  const open = _isOpenState(st);
  const qn = (t?.questions || []).length;
  const avg = s.graded ? Math.round(s.sum / s.graded * 10) / 10 : null;
  const avgCls = avg == null ? "" : avg >= 10 ? "ok" : avg >= 7 ? "info" : avg >= 4 ? "warn" : "bad";

  // Розклад: що станеться далі
  let when;
  if (st === "scheduled") when = { ic: "cal", cls: "sched", text: `Відкриється ${_fmtDT(l.openAt)} · через ${_inWords(l.openAt - now)}` };
  else if (st === "expired") when = { ic: "clock", cls: "muted", text: `Закрилось ${_fmtDT(l.closeAt)}` };
  else if (!open) when = { ic: "lock", cls: "muted", text: l.closeAt ? `Було до ${_fmtDT(l.closeAt)}` : "Закрито вручну" };
  else if (l.closeAt){
    const left = l.closeAt - now;
    when = { ic: "clock", cls: left < 3600e3 ? "bad" : left < 864e5 ? "warn" : "", text: `Закриється через ${_inWords(left)} · ${_fmtDT(l.closeAt)}` };
  } else when = { ic: "clock", cls: "muted", text: "Без терміну" };

  const warnHtml = issue ? `<div class="lk-warn">${_lic("alert", 13)}<span>${issue.text}</span>${
      issue.kind === "draft" || issue.kind === "closed" ? `<button data-lact="publish" data-id="${l.id}">Опублікувати тест</button>`
      : issue.kind === "empty" ? `<a href="constructor?id=${encodeURIComponent(l.testId)}">Додати питання</a>` : ""}</div>`
    : st === "full" ? `<div class="lk-warn">${_lic("users", 13)}<span>Усі ${max} місць зайнято — нові студенти не зайдуть</span><button data-lact="edit" data-id="${l.id}">Збільшити ліміт</button></div>`
    : "";

  return `<article class="lnk-card is-${st}${issue ? " has-issue" : ""}" data-id="${l.id}">
    <div class="l-head">
      <div class="l-pills">
        <span class="l-pill ${S.cls}">${S.label}</span>
        ${l.group ? `<span class="l-pill grp" title="Група">${_lic("users", 11)}${esc(l.group)}</span>` : ""}
        ${s.now && open ? `<span class="l-pill live">${s.now} зараз проходить</span>` : ""}
      </div>
      <a class="l-title" href="${t ? `constructor?id=${encodeURIComponent(l.testId)}` : "#"}" title="Відкрити тест у конструкторі">${esc(t?.title || "Тест видалено")}</a>
      <div class="l-sub">${t ? `${qn} ${_plural(qn, "питання", "питання", "питань")}${t.timeLimit ? ` · ${Math.round(t.timeLimit / 60)} хв` : " · без ліміту часу"}` : "—"}${l.shuffleQuestions || l.shuffleAnswers ? ` · перемішування` : ""}</div>
    </div>
    ${warnHtml}
    <div class="l-url">
      <span class="l-url-text" title="${esc(linkUrl(l.id))}">${_lic("link", 12)}<span>${esc(location.host)}/test?link=<b>${esc(l.id.slice(-8))}</b></span></span>
      <button class="l-url-btn" data-lact="copy" data-id="${l.id}" title="Копіювати посилання">${_lic("copy", 12)}Копіювати</button>
      <a class="l-url-btn icon-only" href="${esc(linkUrl(l.id))}" target="_blank" rel="noopener" title="Відкрити як студент">${_lic("open", 12)}</a>
    </div>
    <div class="l-stats">
      <div><div class="l-stat-v">${s.done || 0}</div><div class="l-stat-l">Пройшли</div></div>
      <div><div class="l-stat-v ${avgCls}">${avg ?? "—"}</div><div class="l-stat-l">Сер. оцінка</div></div>
      <div><div class="l-stat-v ${max && pct >= 100 ? "warn" : ""}">${used}${max ? `<small>/${max}</small>` : ""}</div><div class="l-stat-l">${max ? "Місць зайнято" : "Відкрили · без ліміту"}</div></div>
    </div>
    ${max ? `<div class="l-bar" title="${pct}%"><i style="width:${pct}%" class="${pct >= 100 ? "full" : pct >= 80 ? "hi" : ""}"></i></div>` : ""}
    <div class="l-when ${when.cls}">${_lic(when.ic, 13)}<span>${when.text}</span></div>
    <div class="l-foot">
      <button class="l-res" data-lact="results" data-id="${l.id}">Результати${_lic("arrow", 13)}</button>
      <div class="l-foot-actions">
        <button class="l-icon-btn" data-lact="qr" data-id="${l.id}" title="QR-код">${_lic("qr")}</button>
        <button class="l-icon-btn" data-lact="dup" data-id="${l.id}" title="Копія для іншої групи">${_lic("dup")}</button>
        <button class="l-icon-btn" data-lact="edit" data-id="${l.id}" title="Редагувати">${_lic("edit")}</button>
        <button class="l-icon-btn" data-lact="toggle" data-id="${l.id}" title="${open ? "Закрити доступ" : "Відкрити знову"}">${_lic(open ? "lock" : "unlock")}</button>
        <button class="l-icon-btn danger" data-lact="del" data-id="${l.id}" title="Видалити">${_lic("trash")}</button>
      </div>
    </div>
  </article>`;
}

// Один делегований обробник для сторінки посилань + оновлення відліку щохвилини
let _linksBound = false;
function _bindLinksPage(){
  if (_linksBound) return;
  _linksBound = true;
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-lact]"); if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.lact){
      case "new":     return G.newLink();
      case "copy":    return G.copyLink(id, b);
      case "qr":      return G.showQR(id);
      case "dup":     return G.dupLink(id);
      case "edit":    return G.editLink(id);
      case "toggle":  return G.togLink(id);
      case "del":     return G.confirmDelLink(id);
      case "results": return G.linkResults(id);
      case "publish": return G.publishLinkTest(id, b);
    }
  });
  setInterval(() => { if (document.visibilityState === "visible" && $("lnk-tbl")) renderLinks(); }, 60000);
}


// G — global actions
// ─── GROQ для AI аналізу ──────────────────────────────────────────────────────
// ─── AI виклик: підтримує Groq і Google AI Studio ──────────────────────────

async function callGroq(messages, maxTokens=800, temp=0.5, feature="analysis"){
  const UA = "Ти — розумний асистент викладача. ОБОВ\'ЯЗКОВО відповідай ВИКЛЮЧНО українською мовою. Жодних інших мов. Якщо щось не знаєш українською — все одно пиши по-українськи.";
  try{
    const snap = await get(ref(db,"settings/ai"));
    const s = snap.exists() ? snap.val() : {};
    // Провайдер обирається для кожної функції в admin/ai-settings; без ключа — інший
    const geminiKey = s.geminiApiKey || (s.provider === "gemini" ? s.apiKey : "") || "";
    const groqKeyCfg = s.groqApiKey || (s.provider !== "gemini" ? s.apiKey : "") || "";
    const want = (s.featProviders && s.featProviders[feature]) || s.provider || "groq";
    const provider = want === "gemini" ? (geminiKey || !groqKeyCfg ? "gemini" : "groq") : (groqKeyCfg || !geminiKey ? "groq" : "gemini");

    if(provider === "gemini"){
      const key   = geminiKey;
      const model = s.geminiModel  || "gemini-2.5-flash";
      if(!key) throw new Error("Відсутній Gemini API ключ");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const contents = messages.map(m=>({
        role: m.role==="assistant" ? "model" : "user",
        parts:[{text: m.content}]
      }));
      const res = await fetch(url,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          systemInstruction:{parts:[{text:UA}]},
          contents,
          // Для flash-моделей Gemini 2.5 вимикаємо «думання», щоб воно не з'їдало ліміт токенів відповіді
          generationConfig:{maxOutputTokens:maxTokens, temperature:temp, ...(/flash/i.test(model) ? {thinkingConfig:{thinkingBudget:0}} : {})}
        })
      });
      const raw = await res.text();
      let d;
      try{ d = JSON.parse(raw); }
      catch(e){ throw new Error("Gemini: невалідна відповідь — " + raw.substring(0,200)); }
      if(d.error) throw new Error("Gemini: " + (d.error.message||JSON.stringify(d.error)));
      return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      const key   = groqKeyCfg;
      if(!key) throw new Error("AI не налаштовано: немає ключа Groq (адмінка → AI)");
      const model = s.groqModel  || (s.provider !== "gemini" && s.model) || "llama-3.3-70b-versatile";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
        body: JSON.stringify({
          model,
          messages:[{role:"system",content:UA},...messages],
          max_tokens:maxTokens,
          temperature:temp
        })
      });
      const d = await res.json();
      if(d.error) throw new Error(d.error.message);
      return d.choices?.[0]?.message?.content || "";
    }
  }catch(e){throw e;}
}



window.G = {
  // Folders
  setFF(v, opts = {}){
    v = v || "all";
    const changed = v !== _fFilter;
    _fFilter = v; window._fFilter = v;
    if (changed){ TS.q = ""; TS.status = ""; window._testsStatus = ""; const i = $("srch"); if (i) i.value = ""; }
    // Папка в адресі — працює кнопка «Назад» і посилання на папку
    if (!opts.fromHistory && document.getElementById("tc")){
      const url = new URL(location.href);
      if (v === "all") url.searchParams.delete("folder"); else url.searchParams.set("folder", v);
      if (url.href !== location.href) history[changed ? "pushState" : "replaceState"](null, "", url);
    }
    if (window.showSec && document.getElementById("sec-archive")?.classList.contains("on")) window.showSec("tests");
    renderTests();
    if (changed) window.scrollTo({ top: 0 });
  },
  // Старе API (могло лишитись у закешованій розмітці) — відкриває нове плаваюче меню
  _toggleTestMenu(id){
    const btn = document.querySelector(`[data-act="menu"][data-id="${CSS.escape(id)}"]`);
    if (btn) _testsAction("menu", id, btn);
  },

  toggleDrop(wrapId){
    const menu=document.getElementById(wrapId+"-menu");
    const btn=document.querySelector(`#${wrapId} .cd-btn`);
    const isOpen=menu?.classList.contains("open");
    // Закриваємо всі інші
    document.querySelectorAll(".cd-menu.open").forEach(m=>m.classList.remove("open"));
    document.querySelectorAll(".cd-btn.active").forEach(b=>b.classList.remove("active"));
    if(!isOpen){
      menu?.classList.add("open");
      btn?.classList.add("active");
    }
  },

  selectDrop(wrapId, value, label){
    // Оновлюємо label
    const labelEl=document.getElementById(wrapId+"-label");
    if(labelEl) labelEl.textContent=label;
    // Позначаємо active item
    const menu=document.getElementById(wrapId+"-menu");
    menu?.querySelectorAll(".cd-item").forEach(el=>{
      el.classList.toggle("cd-active", el.textContent.trim().startsWith(label.trim()));
    });
    // Синхронізуємо прихований select
    const idMap={
      "cd-ft":"ft","cd-fgrp":"fgrp","cd-fst":"fst","cd-fg":"fg"
    };
    const selId=idMap[wrapId];
    const sel=document.getElementById(selId);
    if(sel){
      // Знаходимо опцію з відповідним value
      const opt=[...sel.options].find(o=>o.value===value);
      if(opt) sel.value=value; else sel.value="";
    }
    // Підсвічуємо кнопку якщо є активний фільтр
    const btn=document.querySelector(`#${wrapId} .cd-btn`);
    btn?.classList.toggle("active", value!=="");
    if(value==="") btn?.querySelector("svg")?.style.removeProperty("transform");
    // Закриваємо меню
    document.getElementById(wrapId+"-menu")?.classList.remove("open");
    _attPage=1; renderAttempts();
  },

selectAnalyticsDrop(field, value, label){
    const ids = field==="test"
      ? {wrap:"cd-an-test", sel:"an-test", lbl:"cd-an-test-label"}
      : {wrap:"cd-an-group", sel:"an-group", lbl:"cd-an-group-label"};
    const labelEl=document.getElementById(ids.lbl);
    if(labelEl) labelEl.textContent=label;
    const menu=document.getElementById(ids.wrap+"-menu");
    menu?.querySelectorAll(".cd-item").forEach(el=>{
      el.classList.toggle("cd-active", el.dataset.val===value || (!value && el.dataset.val==="_none"));
    });
    const sel=document.getElementById(ids.sel);
    if(sel) sel.value=value;
    const btn=document.querySelector(`#${ids.wrap} .cd-btn`);
    btn?.classList.toggle("active", !!value);
    menu?.classList.remove("open");
 
    // ── НОВЕ: при виборі групи — перебудовуємо dropdown тестів ──
    if (field === "group"){
      // Тести, що мають посилання з обраною групою (або всі якщо група не обрана)
      const validTestIds = value
        ? new Set(links.filter(l => l.group === value).map(l => l.testId))
        : null;
      const filteredTests = tests.filter(t => {
        if (t.status === "archived") return false;
        if (!validTestIds) return true;       // група "Всі" → всі тести
        return validTestIds.has(t.id);
      });
 
      // Перебудовуємо menu тестів
      const anTestMenu = document.getElementById("cd-an-test-menu");
      const anTestSel  = document.getElementById("an-test");
      const curTestId  = anTestSel?.value || "";
      // Чи актуальний обраний тест ще доступний у новому списку?
      const stillValid = curTestId && filteredTests.some(t => t.id === curTestId);
 
      if (anTestMenu){
        const noneActive = !stillValid;
        anTestMenu.innerHTML = `<div class="cd-item${noneActive?" cd-active":""}" data-val="_none" onclick="G.selectAnalyticsDrop('test','','Оберіть тест...')">— Без фільтру</div>` +
          filteredTests.map(t =>
            `<div class="cd-item${(stillValid && curTestId===t.id)?" cd-active":""}" data-val="${t.id}" onclick="G.selectAnalyticsDrop('test','${t.id}',${jsq(t.title)})">${esc(t.title)}</div>`
          ).join("");
      }
 
      // Перебудовуємо <select> теж (щоб renderAnalytics брав актуальне значення)
      if (anTestSel){
        anTestSel.innerHTML = `<option value="">Оберіть тест...</option>` +
          filteredTests.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join("");
        anTestSel.value = stillValid ? curTestId : "";
      }
 
      // Якщо обраний тест більше не валідний — скидаємо лейбл і active state
      if (!stillValid){
        const testLbl = document.getElementById("cd-an-test-label");
        if (testLbl) testLbl.textContent = "Оберіть тест...";
        const testBtn = document.querySelector("#cd-an-test .cd-btn");
        testBtn?.classList.remove("active");
      }
    }
 
    G.renderAnalytics();
  },

  // ─── Крок 1: список папок ────────────────────────────────────────────
  renderNlPicker(){
    const box = document.getElementById("nl-picker-content");
    if (!box) return;
    if ((window._nlStep || "folder") === "test") G.renderNlTestStep(box);
    else G.renderNlFolderStep(box);
  },
  renderNlFolderStep(box){
    const activeTests = tests.filter(t => t.status !== "archived");
    const countIn = fid => activeTests.filter(t => (t.folderId || "_none") === fid).length;
    const usedFolders = folders.filter(f => countIn(f.id) > 0);
    const noneCount = countIn("_none");
    const q = (document.getElementById("nl-fsearch")?.value || "").trim().toLowerCase();

    let rows = [{ id: "", name: "Усі тести", color: "#7C3AED", count: activeTests.length, pin: true }];
    rows = rows.concat(usedFolders.map(f => ({ id: f.id, name: f.name, color: f.color || "#C7CFE0", count: countIn(f.id) })));
    if (noneCount) rows.push({ id: "_none", name: "Без папки", color: "#C7CFE0", count: noneCount });
    if (q) rows = rows.filter(r => r.pin || (r.name || "").toLowerCase().includes(q));

    box.innerHTML = `
      <div style="padding:7px 8px;border-bottom:1px solid var(--line, #E3E8F2)">
        <input id="nl-fsearch" type="text" placeholder="Пошук папки..." autocomplete="off" value="${esc(q)}" oninput="G.renderNlPicker()"
          style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--line, #E3E8F2);font-size:13px;outline:none;font-family:inherit;box-sizing:border-box"
          onfocus="this.style.borderColor='#3B82F6'" onblur="this.style.borderColor='var(--line, #E3E8F2)'">
      </div>
      <div style="max-height:360px;overflow-y:auto;padding:4px">
        ${rows.length ? rows.map(r => `
          <div onclick="G.pickNlFolder('${r.id}')" style="display:flex;align-items:center;gap:11px;padding:11px 12px;margin:2px 0;border-radius:10px;cursor:pointer;transition:background .12s" onmouseover="this.style.background='#EFF3FE'" onmouseout="this.style.background='transparent'">
            <span style="width:9px;height:9px;border-radius:50%;background:${r.color};flex:0 0 auto"></span>
            <span style="flex:1;font-size:13.5px;font-weight:700;color:#0B1437">${esc(r.name)}</span>
            <span style="font-size:12px;color:#8691AC">${r.count} ${r.count===1?"тест":"тестів"}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C7CFE0" stroke-width="2.2" style="flex:0 0 auto"><polyline points="9 6 15 12 9 18"/></svg>
          </div>`).join("") : `<div style="padding:28px 12px;text-align:center;color:#8691AC;font-size:12.5px">Нічого не знайдено</div>`}
      </div>`;
  },
  pickNlFolder(fid){
    window._nlFolderF = fid;
    window._nlStep = "test";
    G.renderNlPicker();
  },
  backToNlFolders(){
    window._nlStep = "folder";
    G.renderNlPicker();
  },

  // ─── Крок 2: список тестів усередині обраної папки ──────────────────
  renderNlTestStep(box){
    const fid = window._nlFolderF ?? "";
    const activeTests = tests.filter(t => t.status !== "archived");
    let list = fid === "" ? activeTests
      : fid === "_none" ? activeTests.filter(t => !t.folderId)
      : activeTests.filter(t => t.folderId === fid);
    const q = (document.getElementById("nl-tsearch")?.value || "").trim().toLowerCase();
    if (q) list = list.filter(t => (t.title || "").toLowerCase().includes(q));
    const label = fid === "" ? "Усі тести" : fid === "_none" ? "Без папки" : (folders.find(f => f.id === fid)?.name || "Папка");

    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:9px 10px;border-bottom:1px solid var(--line, #E3E8F2);background:#fff">
        <button onclick="G.backToNlFolders()" title="Назад до папок" style="border:0;background:#EFF3FE;color:#2D5BE3;width:28px;height:28px;border-radius:8px;cursor:pointer;display:grid;place-items:center;flex:0 0 auto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style="font-size:13px;font-weight:800;color:#0B1437;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</div>
      </div>
      <div style="padding:7px 8px;border-bottom:1px solid var(--line, #E3E8F2)">
        <input id="nl-tsearch" type="text" placeholder="Пошук тесту..." autocomplete="off" value="${esc(q)}" oninput="G.renderNlPicker()"
          style="width:100%;padding:7px 10px;border-radius:8px;border:1px solid var(--line, #E3E8F2);font-size:13px;outline:none;font-family:inherit;box-sizing:border-box"
          onfocus="this.style.borderColor='#3B82F6'" onblur="this.style.borderColor='var(--line, #E3E8F2)'">
      </div>
      <div style="max-height:300px;overflow-y:auto;padding:4px">
        ${list.length ? list.map(t => {
          const tag = t.status === "draft" ? `<span style="font-size:10.5px;font-weight:700;color:#92400E;background:#FEF3C7;padding:2px 7px;border-radius:999px;flex:0 0 auto">Чернетка</span>`
            : t.status === "closed" ? `<span style="font-size:10.5px;font-weight:700;color:#B91C1C;background:#FEE2E2;padding:2px 7px;border-radius:999px;flex:0 0 auto">Закритий</span>` : "";
          const nL = links.filter(l => l.testId === t.id && _isOpenState(linkState(l))).length;
          return `<div onclick="G.selectLinkTest('${t.id}')"
            style="display:flex;align-items:center;gap:9px;padding:8px 10px;margin:2px 0;border-radius:9px;cursor:pointer;transition:background .12s" onmouseover="this.style.background='#EFF3FE'" onmouseout="this.style.background='transparent'">
            <div style="width:28px;height:28px;border-radius:8px;background:#EFF3FE;display:grid;place-items:center;flex:0 0 auto;color:#2D5BE3">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13.5px;font-weight:700;color:#0B1437;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.title)}</div>
              <div style="font-size:10.5px;color:#8691AC">${(t.questions||[]).length} ${_plural((t.questions||[]).length, "питання", "питання", "питань")}${nL ? ` · ${nL} ${_plural(nL, "активне посилання", "активні посилання", "активних посилань")}` : ""}</div>
            </div>
            ${tag}
          </div>`;
        }).join("") : `<div style="padding:28px 12px;text-align:center;color:#8691AC;font-size:12.5px">Нічого не знайдено</div>`}
      </div>`;
  },

  // ─── Вибір тесту: ховаємо пікер, показуємо підсумок і решту полів ───
  selectLinkTest(testId){
    const t = tests.find(x => x.id === testId);
    $("nl-t").value = testId;
    const summary = $("nl-test-summary"), box = $("nl-picker-box"), details = $("nl-details-wrap");
    const qn = (t?.questions || []).length;
    if (summary){
      summary.style.display = "flex";
      summary.innerHTML = `
        <div class="lk-tic">${_lic("file", 15)}</div>
        <div class="lk-tsum"><b>${esc(t?.title || "Тест")}</b><span>${qn} ${_plural(qn, "питання", "питання", "питань")}${t?.timeLimit ? ` · ${Math.round(t.timeLimit / 60)} хв` : " · без ліміту часу"}</span></div>
        <button type="button" onclick="G.changeNlTest()">Змінити</button>`;
    }
    if (box) box.style.display = "none";
    if (details) details.style.display = "flex";
    G._nlTestWarn(testId);
    setTimeout(() => $("nl-g")?.focus(), 30);
  },
  changeNlTest(){
    $("nl-test-summary").style.display = "none";
    $("nl-picker-box").style.display = "";
    $("nl-details-wrap").style.display = "none";
    $("nl-test-warn").innerHTML = "";
    $("nl-t").value = "";
    window._nlStep = "folder";
    G.renderNlPicker();
  },
  toggleArchive(){
    const list=document.getElementById("archive-list");
    const chev=document.getElementById("archive-chevron");
    if(!list)return;
    const isHidden=list.style.display==="none";
    list.style.display=isHidden?"block":"none";
    if(chev) chev.style.transform=isHidden?"rotate(180deg)":"";
    if(isHidden) G._renderArchiveLegacy();
  },
  _renderArchiveLegacy(){
    const archived=tests.filter(t=>t.status==="archived");
    const cnt=document.getElementById("archive-count");
    if(cnt) cnt.textContent=archived.length;
    const list=document.getElementById("archive-list");
    if(!list)return;
    if(!archived.length){
      list.innerHTML=`<div style="padding:16px;font-size:14px;color:var(--muted);text-align:center">Архів порожній</div>`;
      return;
    }
    list.innerHTML=archived.map(t=>{
      const attCount=attempts.filter(a=>a.testId===t.id).length;
      return`<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(107,114,128,.05);border:1.5px solid var(--border);border-radius:12px;margin-bottom:8px">
        <span style="font-size:18px">📦</span>
        <div style="flex:1">
          <div style="font-weight:500;font-size:14px;color:var(--muted)">${esc(t.title)}</div>
          <div style="font-size:12px;color:var(--light);margin-top:2px">${attCount} спроб · Архівовано ${timeAgo(t.archivedAt||t.createdAt)}</div>
        </div>
        <button class="btn bs btn-sm" onclick="G.restoreTest('${t.id}')" style="font-size:12px">↩ Відновити</button>
        <button class="btn bd btn-sm" onclick="G.permDeleteTest('${t.id}',${jsq(t.title)})" style="font-size:12px">🗑</button>
      </div>`;
    }).join("");
  },
  async restoreTest(id){
    try{
      await dbUpd(`tests/${id}`,{status:"draft",archivedAt:null});
      tests=tests.map(t=>t.id===id?{...t,status:"draft",archivedAt:null}:t); window.tests=tests;
      renderAll(); G.renderArchive(); toast("Тест відновлено як чернетку");
    }catch(e){toast("Помилка: "+e.message,"err");}
  },
  async permDeleteTest(id,name){
    if(!confirm(`Остаточно видалити "${name}"? Всі спроби теж видаляться.`))return;
    ldr(true);
    try{
      const rl=links.filter(l=>l.testId===id),ra=attempts.filter(a=>a.testId===id);
      await Promise.all([dbDel(`tests/${id}`),...rl.map(l=>dbDel(`links/${l.id}`)),...ra.map(a=>dbDel(`attempts/${a.id}`))]);
      tests=tests.filter(t=>t.id!==id);links=links.filter(l=>l.testId!==id);attempts=attempts.filter(a=>a.testId!==id);
      renderAll(); G.renderArchive(); toast("Видалено назавжди");
    }catch(e){toast("Помилка: "+e.message,"err");}
    ldr(false);
  },
  togFld(id){
    document.getElementById(`fb-${id}`)?.classList.toggle("hid");
    document.querySelector(`.fh[onclick*="'${id}'"]`)?.classList.toggle("col");
  },
  // Модалка папки: без id — нова папка, з id — перейменування/колір
  openFolderModal(editId){
    const f = editId ? folders.find(x => x.id === editId) : null;
    window._editFolderId = f ? f.id : null;
    $("m-folder-title").textContent = f ? "Редагувати папку" : "Нова папка";
    $("m-folder-sub").textContent = f ? "Змініть назву або колір" : "Згрупуйте тести в курс чи тему";
    $("nf-submit").textContent = f ? "Зберегти" : "Створити папку";
    $("nf-n").value = f ? f.name : "";
    $("nf-n").classList.remove("er");
    $("nf-err").textContent = "";
    G.selectFolderColor(f ? _folderColor(f) : "#2d5be3");
    openM("m-folder");
    setTimeout(() => { $("nf-n").focus(); $("nf-n").select(); }, 80);
  },
  async submitFolder(){
    const inp = $("nf-n"), err = $("nf-err"), btn = $("nf-submit");
    const n = inp.value.replace(/\s+/g, " ").trim();
    const editId = window._editFolderId || null;
    const fail = m => { inp.classList.add("er"); if (err) err.textContent = m; inp.focus(); };
    if (!n) return fail("Введіть назву папки");
    if (n.length > 60) return fail("Назва задовга — до 60 символів");
    if (folders.some(f => f.id !== editId && f.name.trim().toLowerCase() === n.toLowerCase())) return fail(`Папка «${n}» вже існує`);
    if (btn.disabled) return;
    btn.disabled = true;
    const color = $("nf-color")?.value || "#2d5be3";
    try{
      if (editId){
        await dbUpd(`folders/${editId}`, { name: n, color, updatedAt: ts() });
        folders = folders.map(f => f.id === editId ? { ...f, name: n, color } : f);
        window.folders = folders;
        toast("Папку оновлено");
      } else {
        const id = await dbPush("folders", { name: n, color, createdAt: ts() });
        folders.push({ id, name: n, color, createdAt: ts() });
        window.folders = folders;
        toast(`Папку «${n}» створено`);
      }
      closeM("m-folder");
      renderTests(); updateBadges();
    }catch(e){ fail("Помилка: " + e.message); }
    finally{ btn.disabled = false; }
  },
  selectFolderColor(color){
    const inp = $("nf-color"); if (inp) inp.value = color;
    document.querySelectorAll("#m-folder [data-color]").forEach(el => {
      const on = el.dataset.color.toLowerCase() === String(color).toLowerCase();
      el.classList.toggle("on", on); el.setAttribute("aria-checked", on);
    });
    const prev = $("nf-preview"); if (prev) prev.style.background = `linear-gradient(135deg,${_lightenHex(color, .35)},${color})`;
  },

  confDelFolder(id){
    const f = folders.find(x => x.id === id); if (!f) return;
    _pid = id;
    const n = tests.filter(t => t.folderId === id && t.status !== "archived").length;
    $("del-fn").textContent = f.name;
    const info = $("del-fn-info");
    if (info) info.innerHTML = n ? `${_nTests(n)} ${_plural(n, "перейде", "перейдуть", "перейдуть")} у «Без папки». Самі тести й спроби <strong>не видаляються</strong>.` : "Папка порожня.";
    openM("m-del-folder");
  },
  async doDelFolder(){
    const id = _pid; if (!id) return;
    const btn = $("del-folder-btn"); if (btn) btn.disabled = true;
    try{
      const ops = [dbDel(`folders/${id}`)];
      tests.filter(t => t.folderId === id).forEach(t => ops.push(dbUpd(`tests/${t.id}`, { folderId: null })));
      await Promise.all(ops);
      folders = folders.filter(f => f.id !== id); window.folders = folders;
      tests = tests.map(t => t.folderId === id ? { ...t, folderId: null } : t); window.tests = tests;
      _pid = null;
      closeM("m-del-folder");
      if (_fFilter === id) G.setFF("all"); else renderTests();
      toast("Папку видалено. Тести — у «Без папки»");
    }catch(e){ toast("Помилка: " + e.message, "err"); }
    finally{ if (btn) btn.disabled = false; }
  },

  // Перемістити тест у папку
  openMoveModal(testId){
    const t = tests.find(x => x.id === testId); if (!t) return;
    window._moveTestId = testId;
    $("move-test-name").textContent = t.title;
    const opts = [{ id: "", name: "Без папки", color: "#8691AC" }, ...folders.map(f => ({ id: f.id, name: f.name, color: _folderColor(f) }))];
    $("move-list").innerHTML = opts.map(o => {
      const cur = (t.folderId || "") === o.id;
      const n = tests.filter(x => (x.folderId || "") === o.id && x.status !== "archived").length;
      return `<button type="button" class="mv-item${cur ? " cur" : ""}" data-folder="${esc(o.id)}" ${cur ? "disabled" : ""}>
        <span class="mv-ico" style="background:linear-gradient(135deg,${_lightenHex(o.color, .35)},${o.color})"></span>
        <span class="mv-name">${esc(o.name)}</span>
        <span class="mv-n">${cur ? "поточна" : _nTests(n)}</span>
      </button>`;
    }).join("") + `<button type="button" class="mv-item mv-new" data-folder="__new">＋ Нова папка…</button>`;
    openM("m-move");
  },
  async doMoveTest(folderId){
    const id = window._moveTestId, t = tests.find(x => x.id === id); if (!t) return;
    if (folderId === "__new"){ closeM("m-move"); G.openFolderModal(); return; }
    try{
      await dbUpd(`tests/${id}`, { folderId: folderId || null, updatedAt: ts() });
      tests = tests.map(x => x.id === id ? { ...x, folderId: folderId || null } : x); window.tests = tests;
      closeM("m-move");
      renderTests();
      const f = folders.find(x => x.id === folderId);
      toast(`Переміщено в «${f ? f.name : "Без папки"}»`);
    }catch(e){ toast("Помилка: " + e.message, "err"); }
  },

  // Копія тесту (чернетка в тій самій папці)
  async duplicateTest(testId){
    const t = tests.find(x => x.id === testId); if (!t) return;
    try{
      const { id: _i, ...rest } = t;
      const copy = { ...rest, title: `${t.title} (копія)`, status: "draft", createdAt: ts(), updatedAt: ts(), archivedAt: null, sharedFrom: null, sharedAt: null };
      Object.keys(copy).forEach(k => copy[k] === undefined && delete copy[k]);
      const id = await dbPush("tests", copy);
      tests.unshift({ id, ...copy }); window.tests = tests;
      renderAll();
      toast("Створено копію-чернетку");
    }catch(e){ toast("Помилка: " + e.message, "err"); }
  },

  async setTestStatus(id, status){
    const t = tests.find(x => x.id === id);
    if (!t || !STATUS[status] || t.status === status) return;
    try{
      await dbUpd(`tests/${id}`, { status, updatedAt: ts() });
      tests = tests.map(x => x.id === id ? { ...x, status } : x); window.tests = tests;
      renderTests(); updateBadges();
      toast(`Статус: ${STATUS[status].label}`);
    }catch(e){ toast("Помилка: " + e.message, "err"); }
  },
  // Tests
  openTestInFolder(fid){
    _fid = fid && folders.some(f => f.id === fid) ? fid : null;
    ["nt-n", "nt-d", "nt-tg"].forEach(k => { const el = $(k); if (el){ el.value = ""; el.classList.remove("er"); } });
    const tm = $("nt-tm"); if (tm){ tm.value = "10"; tm.classList.remove("er"); }
    const err = $("nt-err"); if (err) err.textContent = "";
    const btn = $("nt-submit"); if (btn){ btn.disabled = false; btn.textContent = "Створити тест →"; }
    openM("m-test");
    buildChips();
  },
  async submitTest(){
    const nEl = $("nt-n"), err = $("nt-err"), btn = $("nt-submit");
    const fail = (el, m) => { el?.classList.add("er"); if (err) err.textContent = m; el?.focus(); };
    const n = nEl.value.replace(/\s+/g, " ").trim();
    if (!n) return fail(nEl, "Введіть назву тесту");
    if (n.length > 120) return fail(nEl, "Назва задовга — до 120 символів");
    const mins = parseInt($("nt-tm").value, 10);
    if (!Number.isFinite(mins) || mins < 1 || mins > 600) return fail($("nt-tm"), "Ліміт часу — від 1 до 600 хвилин");
    if (btn?.disabled) return;
    if (btn){ btn.disabled = true; btn.textContent = "Створюємо…"; }
    const desc = $("nt-d").value.trim();
    const tags = [...new Set($("nt-tg").value.split(",").map(s => s.trim()).filter(Boolean))];
    try{
      const id = await dbPush("tests", { title: n, description: desc, folderId: _fid || null, tags, timeLimit: mins * 60, status: "draft", questions: [], createdAt: ts() });
      location.href = `constructor?id=${id}`;
    }catch(e){
      fail(null, "Не вдалося створити: " + e.message);
      if (btn){ btn.disabled = false; btn.textContent = "Створити тест →"; }
    }
  },
  // Видалення/архів. Для вже архівованого тесту — лише «Видалити назавжди».
  confDelTest(id){
    const t = tests.find(x => x.id === id); if (!t) return;
    _pid = id;
    const att = attempts.filter(a => a.testId === id).length;
    const lnk = links.filter(l => l.testId === id).length;
    const archived = t.status === "archived";
    $("del-tn").textContent = t.title;
    $("del-test-title").textContent = archived ? "Видалити тест назавжди?" : "Що зробити з тестом?";
    $("del-archive-opt").hidden = archived;
    $("del-archive-info").textContent = `Тест зникне зі списку, ${lnk ? `${lnk} ${_plural(lnk, "посилання закриється", "посилання закриються", "посилань закриються")}, ` : ""}усі ${att} ${_plural(att, "спроба збережеться", "спроби збережуться", "спроб збережуться")}. Можна відновити з архіву.`;
    $("del-forever-info").textContent = att
      ? `Буде видалено тест і ${att} ${_plural(att, "спробу", "спроби", "спроб")} студентів. Скасувати неможливо.`
      : "Тест буде видалено. Скасувати неможливо.";
    const conf = $("del-forever-confirm"); if (conf) conf.hidden = true;
    openM("m-del-test");
  },
  // Друге натискання підтверджує остаточне видалення (захист від випадкового кліку)
  askDelForever(){
    const conf = $("del-forever-confirm");
    if (conf && conf.hidden){ conf.hidden = false; conf.querySelector("button")?.focus(); return; }
    G.doDelTest("delete");
  },
  startLiveGame(testId){
    document.querySelectorAll("[id^='tmenu-']").forEach(m=>m.style.display="none");
    window.open(`live/setup?testId=${testId}`,"_blank","noopener");
  },
  async doDelTest(mode="archive"){
    const id=_pid; if(!id) return; _pid=null;closeM("m-del-test");ldr(true);
    try{
      if(mode==="archive"){
        // Архівуємо тест — зберігаємо спроби, закриваємо посилання
        await dbUpd(`tests/${id}`,{status:"archived",archivedAt:ts()});
        const rl=links.filter(l=>l.testId===id);
        await Promise.all(rl.map(l=>dbUpd(`links/${l.id}`,{status:"closed"})));
        tests=tests.map(t=>t.id===id?{...t,status:"archived",archivedAt:ts()}:t);
        links=links.map(l=>l.testId===id?{...l,status:"closed"}:l);
        window.tests=tests; window.links=links;
        renderAll();toast("Тест переміщено в архів");
      } else {
        // Повне видалення
        const rl=links.filter(l=>l.testId===id),ra=attempts.filter(a=>a.testId===id);
        await Promise.all([dbDel(`tests/${id}`),...rl.map(l=>dbDel(`links/${l.id}`)),...ra.map(a=>dbDel(`attempts/${a.id}`))]);
        tests=tests.filter(t=>t.id!==id);links=links.filter(l=>l.testId!==id);attempts=attempts.filter(a=>a.testId!==id);
        window.tests=tests; window.links=links; window.attempts=attempts;
        renderAll();toast("Тест та всі спроби видалено");
        if (document.getElementById("sec-archive")?.classList.contains("on")) G.renderArchive();
      }
    }catch(e){toast("Помилка: "+e.message,"err");}
    ldr(false);
  },
  // Links
  toggleTestStatus(id, currentStatus){
    // Прибираємо старі дропдауни
    document.querySelectorAll(".status-dropdown").forEach(el=>el.remove());

    const statuses = [
      {val:"active",  label:"✅ Активний",  color:"#0d9e85"},
      {val:"draft",   label:"📝 Чернетка",  color:"var(--muted)"},
      {val:"closed",  label:"🔒 Закрито",   color:"#be123c"},
    ].filter(s=>s.val!==currentStatus);

    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();

    const menu = document.createElement("div");
    menu.className = "status-dropdown";
    menu.style.cssText = `position:fixed;z-index:9999;top:${rect.bottom+6}px;left:${rect.left}px;background:white;border:1.5px solid var(--border);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.12);padding:6px;min-width:160px`;

    statuses.forEach(s=>{
      const item = document.createElement("div");
      item.style.cssText = "padding:9px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:"+s.color+";transition:background .1s";
      item.textContent = s.label;
      item.onmouseover = ()=>item.style.background="rgba(0,0,0,.04)";
      item.onmouseout  = ()=>item.style.background="";
      item.onclick = async ()=>{
        menu.remove();
        try{
          await dbUpd(`tests/${id}`,{status:s.val,updatedAt:ts()});
          tests=tests.map(t=>t.id===id?{...t,status:s.val}:t);
          renderTests(document.getElementById("srch")?.value||"");
          updateBadges();
          toast(`Статус змінено → ${s.label.replace(/^.\s/,"")}`);
        }catch(e){toast("Помилка: "+e.message,"err");}
      };
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    // Закриваємо при кліку поза
    setTimeout(()=>{
      const close = e=>{ if(!menu.contains(e.target)&&e.target!==btn){menu.remove();document.removeEventListener("click",close);} };
      document.addEventListener("click",close);
    },0);
  },

  // ─── Посилання: модалка створення / редагування ─────────────────────
  _lnkForm(mode, l = null, testId = null){
    const edit = mode === "edit";
    window._editLinkId = edit ? l.id : null;
    $("m-link-title").textContent = edit ? "Налаштування посилання" : mode === "dup" ? "Копія для іншої групи" : "Нове посилання";
    $("m-link-sub").textContent = edit ? "Зміни діють одразу" : "Студенти проходять тест за цим посиланням або QR-кодом";
    $("lk-form").hidden = false; $("lk-done").hidden = true;
    $("m-link-test-wrap").style.display = edit ? "none" : "";
    $("nl-submit-btn").textContent = edit ? "Зберегти" : "Створити посилання";
    const max = l ? _lnkMax(l) : 30;
    $("nl-g").value = mode === "dup" ? "" : (l?.group || "");
    $("nl-unl").checked = !!l && !max;
    $("nl-m").value = max || 30;
    $("nl-m").disabled = $("nl-unl").checked;
    const now = Date.now();
    $("nl-open").value = l?.openAt && (edit || l.openAt > now) ? _toLocalDT(l.openAt) : "";
    $("nl-close").value = l?.closeAt && (edit || l.closeAt > now) ? _toLocalDT(l.closeAt) : "";
    $("nl-sq").checked = !!l?.shuffleQuestions;
    $("nl-sa").checked = !!l?.shuffleAnswers;
    G._nlGroupChips();
    $("nl-err").textContent = "";
    $("nl-hint").textContent = edit && linkState(l) === "expired" ? "Термін дії минув. Вкажіть новий час закриття або очистіть поле — посилання знову відкриється." : "";
    if (edit){
      $("nl-details-wrap").style.display = "flex";
      G._nlTestWarn(l.testId);
    } else if (testId){
      G.selectLinkTest(testId);
    } else {
      $("nl-t").value = "";
      window._nlStep = "folder"; window._nlFolderF = "";
      $("nl-test-summary").style.display = "none";
      $("nl-picker-box").style.display = "";
      $("nl-details-wrap").style.display = "none";
      $("nl-test-warn").innerHTML = "";
      G.renderNlPicker();
    }
    G._nlPresetsSync();
    openM("m-link");
  },
  newLink(){ G._lnkForm("new"); },
  qLink(tid){ G._lnkForm("new", null, tid); },
  editLink(id){ const l = links.find(x => x.id === id); if (l) G._lnkForm("edit", l); },
  dupLink(id){ const l = links.find(x => x.id === id); if (l) G._lnkForm("dup", l, l.testId); },

  // Підказки груп (чипи замість стандартного datalist): останні використані, що підходять під введене
  _nlGroupChips(){
    const box = $("nl-groups"); if (!box) return;
    const cur = ($("nl-g")?.value || "").trim().toLowerCase();
    const seen = new Set(), recent = [];
    for (const l of links) if (l.group && !seen.has(l.group)){ seen.add(l.group); recent.push(l.group); }   // links уже від новіших
    const list = recent.filter(g => g.toLowerCase() !== cur && (!cur || g.toLowerCase().includes(cur))).slice(0, 6);
    box.innerHTML = list.map(g => `<button type="button" data-g="${esc(g)}">${esc(g)}</button>`).join("");
    box.onclick = e => { const b = e.target.closest("[data-g]"); if (!b) return; $("nl-g").value = b.dataset.g; G._nlGroupChips(); $("nl-m")?.focus(); };
  },
  // Попередження про тест (чернетка, закритий, порожній…) у модалці
  _nlTestWarn(testId){
    const box = $("nl-test-warn"); if (!box) return;
    const issue = linkTestIssue(tests.find(t => t.id === testId));
    if (!issue){ box.innerHTML = ""; return; }
    const canPub = issue.kind === "draft" || issue.kind === "closed";
    box.innerHTML = `<div class="lk-warn">${_lic("alert", 14)}<span>${issue.text}</span></div>${canPub
      ? `<label class="lk-check"><input type="checkbox" id="nl-pub" checked><span>Опублікувати тест разом зі створенням посилання</span></label>` : ""}`;
  },
  // Швидкий вибір часу закриття
  nlPreset(kind){
    const d = new Date();
    if (kind === "none"){ $("nl-close").value = ""; }
    else {
      if (kind === "1h") d.setHours(d.getHours() + 1);
      else if (kind === "2h") d.setHours(d.getHours() + 2);
      else if (kind === "today") d.setHours(23, 59, 0, 0);
      else if (kind === "1d") d.setDate(d.getDate() + 1);
      else if (kind === "7d") d.setDate(d.getDate() + 7);
      const base = _fromLocalDT($("nl-open").value);
      if (base && kind !== "today" && base > Date.now()) d.setTime(base + (d.getTime() - Date.now()));
      $("nl-close").value = _toLocalDT(d.getTime());
    }
    $("nl-err").textContent = "";
    G._nlPresetsSync();
  },
  _nlPresetsSync(){
    const has = !!$("nl-close")?.value;
    document.querySelectorAll("#nl-presets [data-p]").forEach(b => b.classList.toggle("on", b.dataset.p === "none" && !has));
    const unl = $("nl-unl")?.checked; if ($("nl-m")) $("nl-m").disabled = !!unl;
  },

  async submitLink(){
    if (G._lnkBusy) return;
    const editId = window._editLinkId;
    const old = editId ? links.find(l => l.id === editId) : null;
    const tid = old ? old.testId : $("nl-t").value;
    const err = m => { $("nl-err").textContent = m; return false; };
    if (!tid) return err("Оберіть тест");
    const unl = $("nl-unl").checked;
    const max = unl ? 0 : parseInt($("nl-m").value, 10);
    if (!unl && !(max >= 1)) return err("Вкажіть ліміт студентів (від 1) або позначте «Без ліміту»");
    if (max > 5000) return err("Ліміт — не більше 5000 студентів");
    if (old && max && max < (old.usedAttempts || 0)) return err(`Посилання вже відкрили ${old.usedAttempts} разів — ліміт не може бути меншим`);
    const now = Date.now();
    const openAt = _fromLocalDT($("nl-open").value), closeAt = _fromLocalDT($("nl-close").value);
    if (closeAt && closeAt <= now) return err("Час закриття вже минув — оберіть пізніший");
    if (openAt && closeAt && closeAt <= openAt) return err("Закриття має бути пізніше за відкриття");
    const data = {
      group: $("nl-g").value.trim().slice(0, 60),
      maxAttempts: max,
      openAt: openAt || null, closeAt: closeAt || null,
      shuffleQuestions: $("nl-sq").checked, shuffleAnswers: $("nl-sa").checked,
    };
    const publish = !!$("nl-pub")?.checked;
    const btn = $("nl-submit-btn"), label = btn.textContent;
    G._lnkBusy = true; btn.disabled = true; btn.textContent = editId ? "Збереження…" : "Створення…";
    try {
      if (publish){
        await dbUpd(`tests/${tid}`, { status: "active", updatedAt: ts() });
        tests = tests.map(t => t.id === tid ? { ...t, status: "active" } : t); window.tests = tests;
      }
      if (old){
        const reopen = old.status !== "active" && old.closedReason === "expired";
        const upd = { ...data, ...(reopen ? { status: "active", closedReason: null } : {}) };
        await dbUpd(`links/${editId}`, upd);
        links = links.map(l => l.id === editId ? { ...l, ...upd } : l); window.links = links;
        closeM("m-link");
        renderLinks(); renderDashLinks(); updateBadges();
        toast(reopen ? "Збережено — посилання знову відкрите" : "Збережено");
      } else {
        const rec = { testId: tid, ...data, usedAttempts: 0, status: "active", createdAt: ts() };
        const id = await dbPush("links", rec);
        if (!links.some(l => l.id === id)){ links.unshift({ id, ...rec }); window.links = links; }
        renderLinks(); renderDashLinks(); updateBadges();
        G._lnkDone(id);
      }
    } catch (e){ err("Помилка: " + e.message); }
    finally { G._lnkBusy = false; btn.disabled = false; btn.textContent = label; }
  },

  // Екран «Посилання готове» — одразу копіюємо й показуємо QR
  async _lnkDone(id){
    const l = links.find(x => x.id === id), t = tests.find(x => x.id === l?.testId);
    const url = linkUrl(id);
    window._qrLinkId = id;
    $("lk-form").hidden = true; $("lk-done").hidden = false;
    $("lk-done-title").textContent = t?.title || "Тест";
    $("lk-done-meta").textContent = [l?.group ? `Група ${l.group}` : "", l?.closeAt ? `до ${_fmtDT(l.closeAt)}` : "без терміну", _lnkMax(l) ? `${_lnkMax(l)} місць` : "без ліміту"].filter(Boolean).join(" · ");
    $("lk-done-url").textContent = url;
    _drawQR($("lk-done-qr"), url, 132);
    const copied = await _copyText(url);
    $("lk-done-copied").textContent = copied ? "Посилання вже скопійовано — вставте його в чат групи" : "Скопіюйте посилання й надішліть студентам";
  },
  async copyLink(id, btn){
    const ok = await _copyText(linkUrl(id));
    if (btn && ok){
      const html = btn.innerHTML;
      btn.classList.add("done"); btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Скопійовано`;
      setTimeout(() => { btn.classList.remove("done"); btn.innerHTML = html; }, 1600);
    } else toast(ok ? "Посилання скопійовано" : "Не вдалося скопіювати", ok ? "" : "err");
  },

  async togLink(id){
    const l = links.find(x => x.id === id); if (!l) return;
    const st = linkState(l);
    if (!_isOpenState(st) && l.closeAt && l.closeAt <= Date.now()) return G.editLink(id);  // спершу новий термін
    const open = _isOpenState(st);
    const upd = open ? { status: "closed", closedReason: "manual" } : { status: "active", closedReason: null };
    try {
      await dbUpd(`links/${id}`, upd);
      links = links.map(x => x.id === id ? { ...x, ...upd } : x); window.links = links;
      renderLinks(); renderDashLinks(); updateBadges();
      toast(open ? "Доступ закрито — нові студенти не зайдуть" : "Посилання знову відкрите");
    } catch (e){ toast("Помилка: " + e.message, "err"); }
  },
  confirmDelLink(id){
    const l = links.find(x => x.id === id); if (!l) return;
    const t = tests.find(x => x.id === l.testId);
    const n = attempts.filter(a => a.linkId === id).length;
    window._delLinkId = id;
    $("del-lnk-name").textContent = `${t?.title || "Тест"}${l.group ? ` · ${l.group}` : ""}`;
    $("del-lnk-info").textContent = n ? `${n} ${_plural(n, "спроба", "спроби", "спроб")} студентів залишаться на сторінці «Спроби».` : "За цим посиланням ще ніхто не проходив тест.";
    openM("m-del-link");
  },
  async doDelLink(){
    const id = window._delLinkId; if (!id) return;
    window._delLinkId = null;
    closeM("m-del-link");
    try {
      await dbDel(`links/${id}`);
      links = links.filter(l => l.id !== id); window.links = links;
      renderLinks(); renderDashLinks(); updateBadges(); renderStats();
      toast("Посилання видалено");
    } catch (e){ toast("Помилка: " + e.message, "err"); }
  },
  // Результати за посиланням — сторінка «Спроби» з фільтром тесту й групи
  linkResults(id){
    const l = links.find(x => x.id === id); if (!l) return;
    const p = new URLSearchParams({ test: l.testId });
    if (l.group) p.set("group", l.group);
    location.href = `attempts?${p}`;
  },
  showStudents(id){ G.linkResults(id); },
  async publishLinkTest(id, btn){
    const l = links.find(x => x.id === id); if (!l) return;
    if (btn){ btn.disabled = true; btn.textContent = "Публікую…"; }
    try {
      await dbUpd(`tests/${l.testId}`, { status: "active", updatedAt: ts() });
      tests = tests.map(t => t.id === l.testId ? { ...t, status: "active" } : t); window.tests = tests;
      renderLinks(); toast("Тест опубліковано — студенти можуть проходити");
    } catch (e){ toast("Помилка: " + e.message, "err"); if (btn){ btn.disabled = false; btn.textContent = "Опублікувати тест"; } }
  },

  // ─── QR-код ─────────────────────────────────────────────────────────
  showQR(id){
    const l = links.find(x => x.id === id); if (!l) return;
    const t = tests.find(x => x.id === l.testId), url = linkUrl(id);
    window._qrLinkId = id;
    $("qr-title").textContent = t?.title || "Тест";
    $("qr-group").textContent = [l.group ? `Група ${l.group}` : "", l.closeAt ? `до ${_fmtDT(l.closeAt)}` : ""].filter(Boolean).join(" · ");
    $("qr-url-text").textContent = url;
    _drawQR($("qr-canvas"), url, 220);
    openM("m-qr");
  },
  copyQrUrl(){ if (window._qrLinkId) G.copyLink(window._qrLinkId); },
  // PNG для друку чи слайда: назва тесту, група, великий QR і адреса
  downloadQR(){
    const id = window._qrLinkId, l = links.find(x => x.id === id); if (!l) return;
    const t = tests.find(x => x.id === l.testId), url = linkUrl(id);
    const tmp = document.createElement("div");
    if (!_drawQR(tmp, url, 900)){ toast("QR-бібліотека не завантажилась", "err"); return; }
    const src = tmp.querySelector("canvas");
    const W = 1100, H = 1380, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#0B1437"; g.textAlign = "center";
    g.font = "800 54px Manrope, system-ui, sans-serif";
    const title = t?.title || "Тест";
    g.fillText(title.length > 34 ? title.slice(0, 33) + "…" : title, W / 2, 110);
    if (l.group){ g.fillStyle = "#5B6A8F"; g.font = "600 38px Manrope, system-ui, sans-serif"; g.fillText(`Група ${l.group}`, W / 2, 170); }
    g.drawImage(src, 100, 220, 900, 900);
    g.fillStyle = "#5B6A8F"; g.font = "500 30px 'Geist Mono', monospace";
    g.fillText(url.replace(/^https?:\/\//, "").replace(/&t=.*/, "…"), W / 2, 1200);
    g.fillStyle = "#8691AC"; g.font = "600 28px Manrope, system-ui, sans-serif";
    g.fillText("Відскануйте камерою телефона", W / 2, 1270);
    const a = document.createElement("a");
    a.download = `QR — ${title}${l.group ? " — " + l.group : ""}.png`.replace(/[\\/:*?"<>|]/g, "_");
    c.toBlob(blob => {
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  },
  // QR на весь екран — показати групі через проєктор
  qrFullscreen(){
    const id = window._qrLinkId, l = links.find(x => x.id === id); if (!l) return;
    const t = tests.find(x => x.id === l.testId), url = linkUrl(id);
    if ($("m-qr")?.classList.contains("on")) closeM("m-qr");
    if ($("m-link")?.classList.contains("on")) closeM("m-link");
    const ov = document.createElement("div");
    ov.className = "qr-full";
    const size = Math.min(innerHeight * .62, innerWidth * .8, 720);
    ov.innerHTML = `<div class="qr-full-in"><div class="qr-full-t">${esc(t?.title || "Тест")}</div>${l.group ? `<div class="qr-full-g">Група ${esc(l.group)}</div>` : ""}<div class="qr-full-code"></div><div class="qr-full-u">${esc(location.host)}/test?link=${esc(id)}</div><div class="qr-full-h">Esc або клік — закрити</div></div>`;
    document.body.appendChild(ov);
    _drawQR(ov.querySelector(".qr-full-code"), url, Math.round(size));
    const close = () => { ov.remove(); removeEventListener("keydown", onKey, true); };
    const onKey = e => { if (e.key === "Escape"){ e.stopImmediatePropagation(); e.preventDefault(); close(); } };
    ov.addEventListener("click", close);
    addEventListener("keydown", onKey, true);
    try { ov.requestFullscreen?.().catch(() => {}); } catch {}
  },
  sortAttempts(field){
  if (_attSort.field === field){
    _attSort.dir = _attSort.dir === "asc" ? "desc" : "asc";
  } else {
    _attSort.field = field;
    _attSort.dir = field === "date" ? "desc" : "asc";
  }
  // Текстові стрілки у новому дизайні: ↑ / ↓ / ↕
  ["name","grade","time","date"].forEach(f => {
    const el = $(`sort-${f}`);
    if (!el) return;
    el.textContent = (f === _attSort.field)
      ? (_attSort.dir === "asc" ? "↑" : "↓")
      : "↕";
    el.style.opacity = (f === _attSort.field) ? "0.9" : "0.5";
  });
  renderAttempts();
},

  copyUrl:async url=>{try{await navigator.clipboard.writeText(url);toast("Скопійовано!");}catch{toast("Не вдалось скопіювати","err");}},
  // Attempts
  rAttempts:renderAttempts,

  renderNotifications(){
    const list=$("notif-list");
    if(!list) return;
    // ВАЖЛИВО: на новій сторінці виклик markAllNotifsRead викликався тут — це робило
    // всі сповіщення прочитаними при ВІДКРИТТІ сторінки. Це бажана поведінка тільки
    // на старій сторінці. Тут лишаємо так само щоб не зламати логіку badge.
    markAllNotifsRead();
 
    const fVal = $("notif-filter")?.value || "";
    let filtered = _notifications;
    if(fVal === "warn")      filtered = filtered.filter(n => n.isWarning);
    if(fVal === "completed") filtered = filtered.filter(n => n.type === "completed");
    if(fVal === "started")   filtered = filtered.filter(n => n.type === "started");
    if(fVal === "unread")    filtered = filtered.filter(n => !n.read);
 
    // Лічильники по табах (нова сторінка)
    const elAll       = document.getElementById("cnt-all");
    const elUnread    = document.getElementById("cnt-unread");
    const elWarn      = document.getElementById("cnt-warn");
    const elCompleted = document.getElementById("cnt-completed");
    const elStarted   = document.getElementById("cnt-started");
    if (elAll)       elAll.textContent       = _notifications.length;
    if (elUnread)    elUnread.textContent    = _notifications.filter(n => !n.read).length;
    if (elWarn)      elWarn.textContent      = _notifications.filter(n => n.isWarning).length;
    if (elCompleted) elCompleted.textContent = _notifications.filter(n => n.type === "completed").length;
    if (elStarted)   elStarted.textContent   = _notifications.filter(n => n.type === "started").length;
 
    // Лічильник у page-head (нова сторінка)
    const elHeadUnread = document.getElementById("nf-unread-count");
    if (elHeadUnread) elHeadUnread.textContent = _notifications.filter(n => !n.read).length;
 
    // Лічильник справа в нав-bar
    const elMetaR = document.getElementById("nf-meta-r");
    if (elMetaR) elMetaR.textContent = `${filtered.length} ${filtered.length === 1 ? "сповіщення" : "сповіщень"}`;
 
    if(!filtered.length){
      list.innerHTML = `<div class="nf-empty">
        <div class="ei"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></svg></div>
        <div class="et">${fVal ? "Немає сповіщень за фільтром" : "Немає сповіщень"}</div>
        <div class="es">${fVal ? "Спробуйте змінити фільтр" : "Тут з'являтимуться повідомлення про активність студентів"}</div>
      </div>`;
      return;
    }
 
    const today = new Date().toDateString();
    const yest  = new Date(Date.now() - 86400000).toDateString();
    let lastGroup = null;
 
    list.innerHTML = filtered.map(n => {
      const d = new Date(n.ts);
      const dStr = d.toDateString();
      const groupLabel = dStr === today ? "Сьогодні"
                       : dStr === yest  ? "Вчора"
                       : d.toLocaleDateString("uk-UA", { day:"numeric", month:"long" });
 
      let groupHtml = "";
      if (groupLabel !== lastGroup){
        lastGroup = groupLabel;
        groupHtml = `<div class="nf-day-sep"><div class="ln"></div><span class="lbl">${groupLabel}</span><div class="ln"></div></div>`;
      }
 
      const time = d.toLocaleTimeString("uk-UA", { hour:"2-digit", minute:"2-digit" });
      const isWarn = n.isWarning;
      const nid = n.id || "";
      const aid = n.attemptId || "";
      const isUnread = !n.read;
 
      // Визначаємо рівень (для кольору іконки) на основі n.type / isWarning
      let lv = "info";
      if (isWarn) lv = "bad";
      else if (n.type === "completed") lv = "ok";
      else if (n.type === "started") lv = "info";
      else if (n.type === "warn" || n.type === "warning") lv = "warn";
 
      // Тег для меню
      const tag = isWarn ? "Анти-чіт"
                : n.type === "completed" ? "Завершено"
                : n.type === "started"   ? "Розпочато"
                : "Активність";
 
      // Іконка — оригінальна з n.icon (емодзі)
      const ico = n.icon || (lv === "bad" ? "⚠️" : lv === "ok" ? "✅" : lv === "warn" ? "⚡" : "🔔");
 
      const sharedLink = n.sharedTestId
        ? `<div class="nf-shared-link" onclick="event.stopPropagation();G.openSharedTest('${n.sharedTestId}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Відкрити тест
          </div>`
        : "";
 
      const detailsBtn = aid
        ? `<button class="ib" title="Деталі" onclick="event.stopPropagation();G.viewAtt('${aid}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>`
        : "";
 
      return groupHtml + `
        <div class="notif${isUnread ? " unread" : ""}" data-nid="${nid}" onclick="G.openNotif('${nid}')">
          <div class="notif-ico ${lv}">${ico}</div>
          <div class="notif-body">
            ${n.title ? `<div class="notif-title">${n.title}</div>` : ""}
            <div class="notif-text">${n.msg || n.desc || ""}</div>
            ${sharedLink}
            <div class="notif-meta">
              <span class="item">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                ${time}
              </span>
              <span class="tag">${tag}</span>
            </div>
          </div>
          <div class="notif-actions">
            ${detailsBtn}
            <button class="ib d" title="Видалити" onclick="event.stopPropagation();G.delNotif('${nid}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            </button>
          </div>
        </div>`;
    }).join("");
  },
  // ─── ДОДАТИ новий метод markAllNotifsAsRead (повна заміна _notifications): ──
 
  async markAllNotifsAsRead(){
    if (typeof markAllNotifsRead === "function") {
      await markAllNotifsRead();
    } else {
      _notifications = _notifications.map(n => ({ ...n, read: true }));
      if (typeof updateNotifBadge === "function") updateNotifBadge();
    }
    G.renderNotifications();
    if (window.toast) toast("Всі сповіщення позначено прочитаними");
  },
 
 
// ─── ДОДАТИ новий метод openNotif — відкриває сповіщення (deep-link) ────────
//   Якщо є attemptId → відкриває деталі; якщо sharedTestId → переходить на тест;
//   інакше — нічого не робить (просто прочитане).
 
  openNotif(id){
    const n = _notifications.find(x => x.id === id);
    if (!n) return;
    // Позначаємо прочитаним (markAllNotifsRead уже у renderNotifications, але про всяк)
    if (n.attemptId && window.G?.viewAtt) {
      G.viewAtt(n.attemptId);
    } else if (n.sharedTestId && window.G?.openSharedTest) {
      G.openSharedTest(n.sharedTestId);
    }
  },
 
  selectNotifFilter(value, label){
    document.getElementById("notif-filter").value = value;
    document.getElementById("cd-notif-filter-label").textContent = label;
    const menu = document.getElementById("cd-notif-filter-menu");
    menu?.querySelectorAll(".cd-item").forEach(el=>{
      el.classList.toggle("cd-active", el.dataset.val===value);
    });
    menu?.classList.remove("open");
    const btn = document.querySelector("#cd-notif-filter .cd-btn");
    btn?.classList.toggle("active", !!value);
    btn?.classList.remove("open");
    G.renderNotifications();
  },

  openSharedTest(testId){
    // Переходимо на вкладку тестів і знаходимо тест
    showSec("tests");
    setTimeout(()=>{
      const t=tests.find(x=>x.id===testId);
      if(t){
        // Якщо тест в папці — відкриваємо папку
        if(t.folderId){ window.setFolderFilter&&setFolderFilter(t.folderId); }
        // Підсвічуємо тест
        const row=document.querySelector(`[data-test-id="${testId}"]`);
        if(row){ row.scrollIntoView({behavior:"smooth",block:"center"}); row.style.background="rgba(45,91,227,.06)"; setTimeout(()=>row.style.background="",2000); }
      } else {
        toast("Тест не знайдено — можливо ще не завантажився");
      }
    },300);
  },

  async delNotif(id){
    _notifications=_notifications.filter(n=>n.id!==id);
    updateNotifBadge();
    G.renderNotifications();
    try{ await dbDel(`notifications/${id}`); }catch(e){console.warn(e);}
  },

// ─── ОНОВЛЕННЯ toggleNotifSound (опційно — для класу .snd-off в новому дизайні) ──
// Якщо хочеш можеш ЗАМІНИТИ існуючий toggleNotifSound:
 
  toggleNotifSound(){
    _soundEnabled = !_soundEnabled;
    localStorage.setItem("qf_sound", _soundEnabled ? "1" : "0");
    const btn = document.getElementById("notif-sound-btn");
    if(btn){
      btn.textContent = _soundEnabled ? "🔔" : "🔕";
      btn.title = _soundEnabled ? "Звук увімкнено" : "Звук вимкнено";
      btn.classList.toggle("snd-off", !_soundEnabled);
      btn.style.opacity = "";  // скидаємо inline якщо був
    }
    if (window.toast) toast(_soundEnabled ? "Звук сповіщень увімкнено" : "Звук сповіщень вимкнено");
  },

  async clearAllNotifs(){
    const ids=[..._notifications.map(n=>n.id)];
    _notifications=[];
    updateNotifBadge();
    G.renderNotifications();
    toast("Сповіщення очищено");
    await Promise.all(ids.map(id=>dbDel(`notifications/${id}`).catch(()=>{})));
  },


  // ─── ЗАМІНИТИ метод initStudents: ───────────────────────────────────────────
 
   async initStudents(){
    // Завантажуємо студентів з Firebase
    try {
      const snap = await dbGet("students");
      _students = snap.exists()
        ? Object.entries(snap.val()).map(([id,v]) => ({ id, ...v }))
            .sort((a,b) => (a.surname || "").localeCompare(b.surname || "", "uk"))
        : [];
    } catch(e) { _students = []; }
 
    // Бейдж sidebar
    const badge = $("nb-students");
    if (badge) { badge.textContent = _students.filter(s=>!s.archived).length; badge.style.display = _students.length ? "" : "none"; }

    // Вкладки Активні / Архів
    if (window._stTab == null) window._stTab = "active";
    const ctActive = document.getElementById("st-ct-active");
    const ctArchived = document.getElementById("st-ct-archived");
    if (ctActive) ctActive.textContent = _students.filter(s=>!s.archived).length;
    if (ctArchived) ctArchived.textContent = _students.filter(s=>s.archived).length;
    const tabSeg = document.getElementById("st-tab-seg");
    if (tabSeg && !tabSeg.dataset.wired){
      tabSeg.dataset.wired = "1";
      tabSeg.addEventListener("click", e => {
        const btn = e.target.closest("button[data-tab]");
        if (!btn) return;
        window._stTab = btn.dataset.tab;
        tabSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b===btn));
        window._stFiltersChanged = true;
        window._selectedStId = null;
        G.renderStudents();
      });
    }
 
    // Групи — рахуємо ЗАНОВО щоразу (не кешуємо), і лише з активної вкладки
    // (Активні/Архів), щоб видалена чи повністю заархівована група одразу
    // зникала з фільтрів і на цій сторінці.
    G.refreshStGroupFilters();
 
    // Підсумок у заголовку
    const summary = document.getElementById("st-summary");
    if (summary){
      const allGroupsCount = new Set(_students.flatMap(s => s.groups || []).filter(Boolean)).size;
      summary.innerHTML = `<b>${_students.length}</b> ${_students.length === 1 ? "студент" : (_students.length>=2 && _students.length<=4) ? "студенти" : "студентів"} у <b>${allGroupsCount}</b> ${allGroupsCount === 1 ? "групі" : "групах"}`;
    }
    const chip = document.getElementById("st-page-chip");
    if (chip){
      // Загальний середній бал
      const allGrades = _students.map(s => s.avgGrade || 0).filter(g => g > 0);
      const avgAll = allGrades.length ? (allGrades.reduce((s,g) => s+g, 0) / allGrades.length).toFixed(1) : "—";
      chip.textContent = `Сер. ${avgAll}/12`;
    }
 
    G.renderStudents();
  },
 

// ─── ЗАМІНИТИ метод selectStFilter: ──────────────────────────────────────────
 
  selectStFilter(value, label){
    // Старі контракти (для сумісності з G.toggleDrop)
    const lblEl = document.getElementById("cd-st-group-label");
    if (lblEl) lblEl.textContent = label;
    const sel = document.getElementById("st-group");
    if (sel) sel.value = value;
    const menu = document.getElementById("cd-st-group-menu");
    menu?.querySelectorAll(".cd-item").forEach(el => el.classList.toggle("cd-active", el.dataset.val === value));
    menu?.classList.remove("open");
    document.querySelector("#cd-st-group .cd-btn")?.classList.toggle("active", !!value);
 
    // Новий chip-фільтр
    const chipsEl = document.getElementById("st-chips");
    if (chipsEl){
      chipsEl.querySelectorAll(".st-chip").forEach(c => c.classList.toggle("on", (c.dataset.val||"") === value));
    }
 
    // При зміні фільтра — скидаємо на першу сторінку
    window._stFiltersChanged = true;
 
    G.renderStudents();
  },
  
 // ─── ЗАМІНИТИ метод renderStudents: ──────────────────────────────────────────
 
  refreshStGroupFilters(){
    const tab = window._stTab || "active";
    const pool = _students.filter(s => tab === "archived" ? !!s.archived : !s.archived);
    const groups = [...new Set(pool.flatMap(s => s.groups || []).filter(Boolean))].sort();
    const curSel = document.getElementById("st-group")?.value || "";

    // Лічильники на вкладках — рахуємо заново щоразу, щоб не залежати від
    // initStudents() (яка виконується лише один раз при завантаженні сторінки)
    const ctActive = document.getElementById("st-ct-active");
    const ctArchived = document.getElementById("st-ct-archived");
    if (ctActive) ctActive.textContent = _students.filter(s=>!s.archived).length;
    if (ctArchived) ctArchived.textContent = _students.filter(s=>s.archived).length;

    const chipsEl = document.getElementById("st-chips");
    if (chipsEl){
      chipsEl.innerHTML =
        `<span class="st-chip${curSel?"":" on"}" data-val="">Всі групи</span>` +
        groups.map(g => `<span class="st-chip${curSel===g?" on":""}" data-val="${esc(g)}">${esc(g)}</span>`).join("");
      chipsEl.querySelectorAll(".st-chip").forEach(el => {
        el.addEventListener("click", () => {
          G.selectStFilter(el.dataset.val || "", el.textContent);
        });
      });
    }

    const sel = document.getElementById("st-group");
    if (sel){
      sel.innerHTML = `<option value="">Всі групи</option>` +
        groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
      // Якщо група, що була обрана, більше не існує в цій вкладці — скидаємо фільтр
      if (groups.includes(curSel)) sel.value = curSel;
      else { sel.value = ""; window._stFiltersChanged = true; }
    }

    const menu = document.getElementById("cd-st-group-menu");
    if (menu){
      menu.innerHTML = `<div class="cd-item cd-active" data-val="" onclick="G.selectStFilter('','Всі групи')">Всі групи</div>` +
        groups.map(g => `<div class="cd-item" data-val="${esc(g)}" onclick="G.selectStFilter(${jsq(g)},${jsq(g)})">${esc(g)}</div>`).join("");
    }
    const lblEl = document.getElementById("cd-st-group-label");
    if (lblEl && !groups.includes(curSel)) lblEl.textContent = "Всі групи";

    // Кнопка "Архівувати/Відновити групу" — залежить від активної вкладки
    const archBtn = document.getElementById("st-gbar-archive-btn");
    if (archBtn){
      if (tab === "archived"){
        archBtn.textContent = "Відновити групу";
        archBtn.onclick = () => G.restoreGroupBulk();
      } else {
        archBtn.textContent = "Архівувати групу";
        archBtn.onclick = () => G.archiveGroupBulk();
      }
    }
  },
  renderStudents(){
    G.refreshStGroupFilters();
    const body = document.getElementById("students-body");
    if (!body) return;
    const q = (document.getElementById("student-srch")?.value || "").toLowerCase().trim();
    const grp = document.getElementById("st-group")?.value || "";
    const tab = window._stTab || "active";

    let list = _students.filter(s => tab === "archived" ? !!s.archived : !s.archived);
    if (q) list = list.filter(s => (s.name + " " + s.surname).toLowerCase().includes(q) || (s.surname + " " + s.name).toLowerCase().includes(q));
    if (grp) list = list.filter(s => (s.groups || []).includes(grp));

    // Панель масових дій по групі — видно тільки коли обрано конкретну групу
    const gbar = document.getElementById("st-group-bar");
    if (gbar){
      if (grp){
        gbar.style.display = "flex";
        document.getElementById("st-gbar-name").textContent = grp;
        document.getElementById("st-gbar-count").textContent = list.length;
      } else {
        gbar.style.display = "none";
      }
    }
 
    // ── Пагінація ──
    const PAGE_SIZE = 15;
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (window._stPage == null) window._stPage = 1;
    // Якщо змінилися фільтри — на 1 сторінку (через прапорець)
    if (window._stFiltersChanged){
      window._stPage = 1;
      window._stFiltersChanged = false;
    }
    if (window._stPage > totalPages) window._stPage = totalPages;
    if (window._stPage < 1) window._stPage = 1;
    const page = window._stPage;
    const startIdx = (page - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, list.length);
    const pageList = list.slice(startIdx, endIdx);
 
    // Лічильник
    const cntEl = document.getElementById("st-list-count");
    if (cntEl){
      if (list.length === 0) cntEl.textContent = `0 / ${_students.length}`;
      else cntEl.textContent = `${startIdx + 1}–${endIdx} / ${list.length}`;
    }
 
    if (!list.length){
      body.innerHTML = `<div class="st-empty">
        <div class="st-empty-ico">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="4"/><path d="M3 21c0-4 4-7 9-7s9 3 9 7"/></svg>
        </div>
        <div class="st-empty-title">${q || grp ? "Нічого не знайдено" : "Ще немає студентів"}</div>
        <div class="st-empty-hint">${q || grp ? "Спробуйте змінити запит або фільтр" : "Студенти з'являться після першого проходження тесту"}</div>
      </div>`;
      return;
    }
 
    // Палітра кольорів аватарок (детермінована)
    const avaColors = ["#3B82F6","#DB2777","#16A34A","#F59E0B","#6366F1","#0EA5E9","#8B5CF6","#EF4444","#14B8A6"];
 
    // Допоміжні
    const gradePctClass = (g12) => {
      if (g12 == null) return "";
      if (g12 >= 10) return "ok";
      if (g12 >= 7)  return "info";
      if (g12 >= 4)  return "warn";
      return "bad";
    };
 
    const rows = pageList.map(s => {
      const att = Array.isArray(s.attempts) ? s.attempts : [];
      const groups = (s.groups || []).filter(Boolean);
      const initials = ((s.surname?.[0] || "") + (s.name?.[0] || "")).toUpperCase() || "?";
 
      // Колір аватарки за hash імені
      const seed = String(s.surname || "") + String(s.name || "");
      let h = 0; for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i)) | 0;
      const color = avaColors[Math.abs(h) % avaColors.length];
 
      const avg = s.avgGrade != null ? s.avgGrade : null;
      const best = att.length ? Math.max(...att.map(a => a.grade || 0)) : null;
      const passRate = att.length ? Math.round(att.filter(a => (a.grade||0) >= 4).length / att.length * 100) : null;
      const flagsCount = att.filter(a => (a.tabSwitches||0)*2 + (a.copyAttempts||0)*3 + (a.screenshots||0)*5 > 0).length;
 
      const isSelected = window._selectedStId === s.id;
 
      return `<tr class="${isSelected ? "is-selected" : ""}" data-st-id="${s.id}">
        <td>
          <div class="st-stud">
            <div class="st-ava" style="background:linear-gradient(135deg, ${color}DD, ${color})">${esc(initials)}</div>
            <div class="st-stud-info">
              <div class="st-stud-name">
                ${esc((s.surname||"") + " " + (s.name||""))}
                ${flagsCount ? `<span class="st-stud-flag">⚑${flagsCount}</span>` : ""}
              </div>
              <div class="st-stud-sub">${att.length} ${att.length === 1 ? "спроба" : (att.length>=2 && att.length<=4) ? "спроби" : "спроб"}</div>
            </div>
          </div>
        </td>
        <td>${groups.length ? groups.map(g => `<span class="st-pill">${esc(g)}</span>`).join(" ") : `<span style="color:var(--ink-400);font-size:11.5px;font-style:italic">—</span>`}</td>
        <td class="mono">${att.length}</td>
        <td class="mono ${gradePctClass(avg)}">${avg != null ? avg.toFixed(1) : "—"}</td>
        <td class="mono ${gradePctClass(best)}">${best != null ? best : "—"}</td>
        <td class="mono">${passRate != null ? passRate + "%" : "—"}</td>
      </tr>`;
    }).join("");
 
    // ── Pagination ──
    let pagHtml = "";
    if (totalPages > 1){
      const winSize = 5; // максимум кнопок-чисел
      let from = Math.max(1, page - Math.floor(winSize / 2));
      let to = Math.min(totalPages, from + winSize - 1);
      if (to - from + 1 < winSize) from = Math.max(1, to - winSize + 1);
 
      const btn = (p, label, disabled, extra="") =>
        `<button class="st-pg-btn ${extra}" ${disabled ? "disabled" : `onclick="G.setStudentsPage(${p})"`}>${label}</button>`;
 
      const numbers = [];
      if (from > 1){
        numbers.push(btn(1, "1"));
        if (from > 2) numbers.push(`<span class="st-pg-ellipsis">…</span>`);
      }
      for (let p = from; p <= to; p++){
        numbers.push(btn(p, String(p), false, p === page ? "is-active" : ""));
      }
      if (to < totalPages){
        if (to < totalPages - 1) numbers.push(`<span class="st-pg-ellipsis">…</span>`);
        numbers.push(btn(totalPages, String(totalPages)));
      }
 
      pagHtml = `<div class="st-pagination">
        ${btn(page - 1, `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>`, page <= 1, "prev")}
        ${numbers.join("")}
        ${btn(page + 1, `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`, page >= totalPages, "next")}
      </div>`;
    }
 
    body.innerHTML = `<table class="st-tbl">
      <thead><tr>
        <th>Студент</th>
        <th>Група</th>
        <th>Спроб</th>
        <th>Сер. бал</th>
        <th>Кращий</th>
        <th>Здав</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>${pagHtml}`;
 
    // Click handlers — обираємо студента
    body.querySelectorAll("tr[data-st-id]").forEach(tr => {
      tr.addEventListener("click", () => {
        G.selectStudent(tr.dataset.stId);
      });
    });
 
    // Якщо є вибраний — перемалювати правий блок
    if (window._selectedStId && list.some(s => s.id === window._selectedStId)) {
      G.selectStudent(window._selectedStId, /*skipTableUpdate*/ true);
    } else if (!window._selectedStId && pageList.length){
      // Автоматично обираємо першого з поточної сторінки
      G.selectStudent(pageList[0].id);
    } else if (window._selectedStId && !list.some(s => s.id === window._selectedStId)){
      // Поточний вибраний пропав з фільтра — скидаємо
      window._selectedStId = null;
      G.selectStudent(null);
    }
  },
 // ─── ДОДАТИ новий метод setStudentsPage: ─────────────────────────────────────
 
  setStudentsPage(page){
    window._stPage = page;
    G.renderStudents();
    // Скрол до верху таблиці
    const body = document.getElementById("students-body");
    if (body) body.scrollIntoView({ behavior: "smooth", block: "start" });
  },
 
 
// ─── ДОДАТИ новий метод searchStudents (викликається з input.oninput): ───────
 
  searchStudents(){
    window._stFiltersChanged = true;
    G.renderStudents();
  },
 
 
// ─── ДОДАТИ новий метод selectStudent: ───────────────────────────────────────
 
  selectStudent(id, skipTableUpdate){
    window._selectedStId = id;
 
    // Підсвітка обраного у таблиці
    if (!skipTableUpdate) {
      document.querySelectorAll("#students-body tr[data-st-id]").forEach(tr => {
        tr.classList.toggle("is-selected", tr.dataset.stId === id);
      });
    }
 
    const noneEl = document.getElementById("pf-none");
    const contEl = document.getElementById("pf-content");
    if (!contEl || !noneEl) return;
 
    if (!id){
      noneEl.style.display = "block";
      contEl.style.display = "none";
      contEl.innerHTML = "";
      return;
    }
 
    const s = _students.find(x => x.id === id);
    if (!s){
      noneEl.style.display = "block";
      contEl.style.display = "none";
      return;
    }
 
    noneEl.style.display = "none";
    contEl.style.display = "block";
 
    const att = Array.isArray(s.attempts) ? s.attempts : [];
    const groups = (s.groups || []).filter(Boolean);
    const initials = ((s.surname?.[0] || "") + (s.name?.[0] || "")).toUpperCase() || "?";
    const fullName = ((s.surname||"") + " " + (s.name||"")).trim() || "Студент";
 
    const avg = s.avgGrade != null ? s.avgGrade.toFixed(1) : "—";
    const best = att.length ? Math.max(...att.map(a => a.grade || 0)) : "—";
 
    // Last activity
    const lastTs = att.length ? Math.max(...att.map(a => a.date || 0)) : 0;
    const lastStr = lastTs ? timeAgo(lastTs) : "—";
 
    // History bars (останні 8)
    const recent = att.slice(-8);
    const barsHtml = recent.length
      ? `<div class="pf-bars">${recent.map(a => {
          const g = a.grade || 0;
          const pct = Math.max(8, Math.round(g/12*100));
          const c = g >= 10 ? "#16A34A" : g >= 7 ? "#1E40AF" : g >= 4 ? "#F59E0B" : "#DC2626";
          return `<div class="pf-bar" title="${g}/12"><i style="height:${pct}%;background:${c}"></i></div>`;
        }).join("")}</div>`
      : `<div class="pf-bars-empty">Поки що немає історії</div>`;
 
    // Recent attempts (останні 5)
    const sortedAtt = [...att].sort((a,b) => (b.date||0) - (a.date||0)).slice(0, 5);
    const listHtml = sortedAtt.length ? `<div class="pf-list">
      ${sortedAtt.map(a => {
        const t = tests.find(x => x.id === a.testId);
        const title = t?.title || a.testTitle || "Тест";
        const dateStr = a.date ? new Date(a.date).toLocaleDateString("uk-UA",{day:"numeric",month:"short"}) + " · " + new Date(a.date).toLocaleTimeString("uk-UA",{hour:"2-digit",minute:"2-digit"}) : "—";
        const g = a.grade || 0;
        const c = g >= 10 ? "#15803D" : g >= 7 ? "#1E40AF" : g >= 4 ? "#B45309" : "#B91C1C";
        return `<div class="pf-list-item" onclick="G.viewAtt && G.viewAtt('${a.attemptId || a.id || ''}')" style="${a.attemptId || a.id ? 'cursor:pointer' : ''}">
          <div class="pf-li-l">
            <div class="pf-li-name">${esc(title)}</div>
            <div class="pf-li-date">${dateStr}</div>
          </div>
          <span class="pf-li-grade" style="color:${c}">${g}/12</span>
        </div>`;
      }).join("")}
    </div>` : `<div style="font-size:12.5px;color:var(--ink-400);padding:6px 0">Жодної спроби ще немає</div>`;
 
    contEl.innerHTML = `
      <div class="pf-head">
        <div class="pf-ava">${esc(initials)}</div>
        <div class="pf-info">
          <div class="pf-name">${esc(fullName)}</div>
          <div class="pf-sub">${groups.length ? groups.map(esc).join(" · ") : "без групи"}</div>
          <div class="pf-status">${att.length ? `Остання активність: ${lastStr}` : "ще не проходив тести"}</div>
        </div>
      </div>
      <div class="pf-stat">
        <div><div class="l">Спроб</div><div class="v">${att.length}</div></div>
        <div><div class="l">Сер. бал</div><div class="v" style="color:${avg !== '—' && parseFloat(avg)>=10?'#16A34A':parseFloat(avg)>=7?'#1E40AF':parseFloat(avg)>=4?'#F59E0B':'#DC2626'}">${avg}</div></div>
        <div><div class="l">Кращий</div><div class="v" style="color:${best !== '—' && best>=10?'#16A34A':best>=7?'#1E40AF':best>=4?'#F59E0B':'#DC2626'}">${best}</div></div>
      </div>
      <div class="pf-block">
        <div class="pf-block-h">Динаміка балів</div>
        ${barsHtml}
      </div>
      <div class="pf-block">
        <div class="pf-block-h">Останні спроби</div>
        ${listHtml}
      </div>
      <div class="pf-foot">
        <button class="pf-btn" onclick="G.openStudentCard && G.openStudentCard('${s.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          Картка
        </button>
        <button class="pf-btn primary" onclick="G.viewStudentAttempts && G.viewStudentAttempts('${s.id}')">
          Усі спроби
        </button>
        <button class="pf-btn" title="${s.archived ? 'Повернути у список активних' : 'Приховати зі списку активних, дані збережуться'}" onclick="G.archiveStudent('${s.id}', ${s.archived ? 'false' : 'true'})">
          ${s.archived ? '↩ Відновити' : '🗄 Архівувати'}
        </button>
        <button class="pf-btn danger" onclick="G.deleteStudent('${s.id}')">
          🗑 Видалити
        </button>
      </div>`;
  },
  async archiveStudent(id, archived){
    const idx = _students.findIndex(s => s.id === id);
    if (idx < 0) return;
    await dbUpd(`students/${id}`, { archived, archivedAt: archived ? Date.now() : null });
    _students[idx] = { ..._students[idx], archived, archivedAt: archived ? Date.now() : null };
    toast(archived ? "Студента архівовано" : "Студента відновлено");
    window._selectedStId = null;
    G.renderStudents();
  },
  async archiveGroupBulk(){
    const grp = document.getElementById("st-group")?.value || "";
    if (!grp) return;
    const targets = _students.filter(s => (s.groups||[]).includes(grp) && !s.archived);
    if (!targets.length){ toast("Немає активних студентів у цій групі","err"); return; }
    const ok = window.stConfirm
      ? await window.stConfirm({
          variant: "warn",
          title: "Архівувати групу?",
          text: `Буде архівовано <b>${targets.length}</b> студентів групи «<b>${esc(grp)}</b>».<br>Група зникне з фільтрів усюди (спроби, аналітика). Відновити можна з вкладки «Архів».`,
          okLabel: "Архівувати",
        })
      : confirm(`Архівувати ${targets.length} студентів групи «${grp}»?\n\nГрупа зникне з фільтрів усюди (спроби, аналітика). Відновити можна з вкладки «Архів».`);
    if (!ok) return;
    const grpLinks = links.filter(l => l.group === grp && !l.groupHidden);
    await Promise.all([
      ...targets.map(s => dbUpd(`students/${s.id}`, { archived: true, archivedAt: Date.now() })),
      ...grpLinks.map(l => dbUpd(`links/${l.id}`, { groupHidden: true })),
    ]);
    const ids = new Set(targets.map(s => s.id));
    const linkIds = new Set(grpLinks.map(l => l.id));
    _students = _students.map(s => ids.has(s.id) ? { ...s, archived: true, archivedAt: Date.now() } : s);
    links = links.map(l => linkIds.has(l.id) ? { ...l, groupHidden: true } : l);
    window.links = links;
    toast(`Архівовано ${targets.length} студентів`);
    window._selectedStId = null;
    G.renderStudents();
  },
  async restoreGroupBulk(){
    const grp = document.getElementById("st-group")?.value || "";
    if (!grp) return;
    const targets = _students.filter(s => (s.groups||[]).includes(grp) && s.archived);
    if (!targets.length){ toast("Немає архівних студентів у цій групі","err"); return; }
    const ok = window.stConfirm
      ? await window.stConfirm({
          variant: "info",
          title: "Відновити групу?",
          text: `Буде відновлено <b>${targets.length}</b> студентів групи «<b>${esc(grp)}</b>».<br>Група знову з'явиться у фільтрах усюди.`,
          okLabel: "Відновити",
        })
      : confirm(`Відновити ${targets.length} студентів групи «${grp}»?\n\nГрупа знову з'явиться у фільтрах усюди.`);
    if (!ok) return;
    const grpLinks = links.filter(l => l.group === grp && l.groupHidden);
    await Promise.all([
      ...targets.map(s => dbUpd(`students/${s.id}`, { archived: false, archivedAt: null })),
      ...grpLinks.map(l => dbUpd(`links/${l.id}`, { groupHidden: false })),
    ]);
    const ids = new Set(targets.map(s => s.id));
    const linkIds = new Set(grpLinks.map(l => l.id));
    _students = _students.map(s => ids.has(s.id) ? { ...s, archived: false, archivedAt: null } : s);
    links = links.map(l => linkIds.has(l.id) ? { ...l, groupHidden: false } : l);
    window.links = links;
    toast(`Відновлено ${targets.length} студентів`);
    window._selectedStId = null;
    G.renderStudents();
  },
  async deleteGroupBulk(){
    const grp = document.getElementById("st-group")?.value || "";
    if (!grp) return;
    const tab = window._stTab || "active";
    const targets = _students.filter(s => (s.groups||[]).includes(grp) && (tab === "archived" ? !!s.archived : !s.archived));
    if (!targets.length){ toast("Немає студентів для видалення в цій групі","err"); return; }
    const grpLinks = links.filter(l => l.group === grp);
    const linkAttemptIds = attempts.filter(a => grpLinks.some(l => l.id === a.linkId)).map(a => a.id);
    const studentAttemptIds = targets.flatMap(s => (s.attempts||[]).map(a => a.attemptId || a.id).filter(Boolean));
    const attemptIds = [...new Set([...studentAttemptIds, ...linkAttemptIds])];
    const ok = window.stConfirm
      ? await window.stConfirm({
          variant: "danger",
          title: "Видалити групу назавжди?",
          text: `Буде видалено <b>${targets.length}</b> студентів, <b>${grpLinks.length}</b> посилань-запрошень і <b>${attemptIds.length}</b> записів про спроби групи «<b>${esc(grp)}</b>».<br>Група зникне звідусіль. Це незворотно.`,
          okLabel: "Видалити назавжди",
        })
      : confirm(`Видалити НАЗАВЖДИ ${targets.length} студентів і всю групу «${grp}»?\n\nРазом з ними буде видалено ${grpLinks.length} посилань-запрошень і ${attemptIds.length} записів про спроби. Група зникне звідусіль. Це незворотно.`);
    if (!ok) return;
    await Promise.all([
      ...targets.map(s => dbDel(`students/${s.id}`)),
      ...grpLinks.map(l => dbDel(`links/${l.id}`)),
      ...attemptIds.map(aid => dbDel(`attempts/${aid}`)),
    ]);
    const ids = new Set(targets.map(s => s.id));
    const linkIds = new Set(grpLinks.map(l => l.id));
    _students = _students.filter(s => !ids.has(s.id));
    links = links.filter(l => !linkIds.has(l.id));
    attempts = attempts.filter(a => !attemptIds.includes(a.id));
    window.links = links;
    window.attempts = attempts;
    toast(`Видалено групу «${grp}»: ${targets.length} студентів, ${grpLinks.length} посилань, ${attemptIds.length} спроб`);
    window._selectedStId = null;
    G.selectStFilter && G.selectStFilter("", "Всі групи");
    G.renderStudents();
  },
  viewAtt(id){
    const a = attempts.find(x => x.id === id);
    if (!a){ toast("Спробу не знайдено","err"); return; }
    const t = tests.find(x => x.id === a.testId);
    const l = links.find(x => x.id === a.linkId);
    if (a.qVer && !Array.isArray(a.questionsSnapshot)) {
      const e = loadQVer(a.qVer);
      if (!e.done) { e.p.then(() => G.viewAtt(id)); return; }   // версію питань ще вантажимо — відкриємо, щойно буде
    }
    const qs = attemptQs(a, t) || [];
    const ans = Array.isArray(a.answers) ? a.answers : [];
 
    try {
      // ── Форматовані рядки шапки ──
      const dateStr = a.createdAt
        ? new Date(a.createdAt).toLocaleString("uk-UA", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })
        : "—";
      let durStr = "";
      if (a.finishedAt && a.startedAt && a.finishedAt > a.startedAt){
        const secs = Math.floor((a.finishedAt - a.startedAt) / 1000);
        durStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2,"0")}`;
      }
      const codeStr = "A-" + String(a.id || "").slice(-4).toUpperCase();
      const pctRaw = (a.score?.percent != null) ? a.score.percent : null;
      const correctCnt = a.score?.correct ?? 0;
      const totalCnt = qs.length || (a.score?.total ?? 0);
      const group = l?.group || "";
 
      // Колір кільця
      let ringColor = "#94A3B8";
      if (pctRaw != null){
        if (pctRaw >= 80) ringColor = "#16A34A";
        else if (pctRaw >= 60) ringColor = "#1E3A8A";
        else if (pctRaw >= 40) ringColor = "#F59E0B";
        else ringColor = "#DC2626";
      }
 
      // Donut SVG
      const ringR = 34, ringCirc = 2 * Math.PI * ringR;
      const pctSafe = pctRaw != null ? Math.max(0, Math.min(100, pctRaw)) : 0;
      const dash = (pctSafe / 100) * ringCirc;
      let donutHtml = "";
      if (pctRaw != null){
        donutHtml = '<svg width="80" height="80" viewBox="0 0 80 80" style="flex:0 0 auto">'
          + `<circle cx="40" cy="40" r="${ringR}" fill="none" stroke="#E5EAF5" stroke-width="8"/>`
          + `<circle cx="40" cy="40" r="${ringR}" fill="none" stroke="${ringColor}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${dash} ${ringCirc}" transform="rotate(-90 40 40)"/>`
          + `<text x="40" y="46" text-anchor="middle" font-family="Geist Mono, monospace" font-weight="800" font-size="16" fill="${ringColor}">${pctRaw}%</text>`
          + '</svg>';
      } else {
        donutHtml = '<div style="width:80px;height:80px;border-radius:50%;background:#E5EAF5;display:flex;align-items:center;justify-content:center;color:#8691AC;font-family:\'Geist Mono\',monospace;font-weight:700;flex:0 0 auto">—</div>';
      }
 
      // ── Секція ПИТАННЯ ──
      const qHtml = qs.map((q, i) => {
        const rawAns = ans[i];
        const userAns = (rawAns !== null && rawAns !== undefined && typeof rawAns === "object" && !Array.isArray(rawAns) && "value" in rawAns)
          ? rawAns.value : rawAns;
        const det = a.score?.details?.[i];
        const pts = det?.points;
 
        // Статус картки (колір лівої рамки, бейдж)
        let qCls = "none";
        let ptsCls = "";
        if (q.type === "long"){
          const lr = det?.longResult;
          if (lr === "correct"){ qCls = "ok"; ptsCls = "ok"; }
          else if (lr === "partial"){ qCls = "partial"; ptsCls = "partial"; }
          else if (lr === "wrong"){ qCls = "bad"; ptsCls = "bad"; }
          else { qCls = "pending"; ptsCls = ""; }
        } else {
          const hasAnswer = userAns !== null && userAns !== undefined && userAns !== ""
            && !(Array.isArray(userAns) && userAns.length === 0);
          if (!hasAnswer){ qCls = "none"; ptsCls = ""; }
          else if (pts > 0){
            const maxPts = q.points || 1;
            if (pts >= maxPts){ qCls = "ok"; ptsCls = "ok"; }
            else { qCls = "partial"; ptsCls = "partial"; }
          } else if (pts === 0){ qCls = "bad"; ptsCls = "bad"; }
        }
 
        let ptsStr = "";
        if (pts != null) ptsStr = pts > 0 ? ("+" + pts) : String(pts);
 
        // Тіло відповіді
        let body = "";
        if (q.type === "single" || q.type === "multi"){
          const opts = q.options || [];
          const userIdxs = Array.isArray(userAns) ? userAns : (userAns != null ? [userAns] : []);
          const correctIdxs = Array.isArray(q.correct) ? q.correct : (q.correct != null ? [q.correct] : []);
          const userTexts = userIdxs.map(j => opts[j]).filter(x => x != null);
          const correctTexts = correctIdxs.map(j => opts[j]).filter(x => x != null);
          const isOk = qCls === "ok";
 
          if (userTexts.length){
            body += '<div class="ad-q-line"><b>Ваш:</b> <span class="ad-q-code ' + (isOk ? "ok" : "bad") + '">' + userTexts.map(esc).join(", ") + '</span></div>';
          } else {
            body += '<div class="ad-q-line"><b>Ваш:</b> <span class="ad-q-code none">—</span></div>';
          }
          if (!isOk && correctTexts.length){
            body += '<div class="ad-q-line"><b>Правильно:</b> <span class="ad-q-code correct">' + correctTexts.map(esc).join(", ") + '</span></div>';
          }
        } else if (q.type === "text" || q.type === "number"){
          const raw = userAns;
          const ua = (raw != null && raw !== "" && typeof raw !== "object") ? String(raw) : null;
          const correctVal = q.correct != null ? String(q.correct) : (q.answer != null ? String(q.answer) : null);
          const isOk = qCls === "ok";
 
          if (ua){
            body += '<div class="ad-q-line"><b>Ваш:</b> <span class="ad-q-code ' + (isOk ? "ok" : "bad") + '">' + esc(ua) + '</span></div>';
          } else {
            body += '<div class="ad-q-line"><b>Ваш:</b> <span class="ad-q-code none">—</span></div>';
          }
          if (!isOk && correctVal){
            body += '<div class="ad-q-line"><b>Правильно:</b> <span class="ad-q-code correct">' + esc(correctVal) + '</span></div>';
          }
        } else if (q.type === "order"){
          const ua = Array.isArray(userAns) ? userAns : [];
          if (ua.length){
            body += '<div class="ad-q-line"><b>Ваш:</b> <span class="ad-q-code">' + ua.map(x => esc(String(x))).join(" → ") + '</span></div>';
          } else {
            body += '<div class="ad-q-line"><b>Ваш:</b> <span class="ad-q-code none">—</span></div>';
          }
        } else if (q.type === "long"){
          const raw = userAns;
          const ua = (raw != null && raw !== "" && typeof raw !== "object") ? String(raw).trim() : null;
          body += '<div class="ad-long-text ' + (ua ? "" : "empty") + '">' + (ua ? esc(ua) : "Немає відповіді") + '</div>';
          if (a.grade12 == null){
            const lr = det?.longResult || "";
            body += '<div class="ad-long-grade">'
              + '<button class="g-ok' + (lr === "correct" ? " active" : "") + '" onclick="G.setLongAnswer(\'' + a.id + '\', ' + i + ', \'correct\')">✓ Правильно</button>'
              + '<button class="g-partial' + (lr === "partial" ? " active" : "") + '" onclick="G.setLongAnswer(\'' + a.id + '\', ' + i + ', \'partial\')">~ Частково</button>'
              + '<button class="g-bad' + (lr === "wrong" ? " active" : "") + '" onclick="G.setLongAnswer(\'' + a.id + '\', ' + i + ', \'wrong\')">✗ Неправильно</button>'
              + '</div>';
          }
        }
 
        const qText = q.text || q.question || "";
        let cardHtml = '<div class="ad-q ' + qCls + '">'
          + '<div class="ad-q-head">'
          + '<div class="ad-q-text"><span class="qf-rich">' + (i + 1) + '. ' + qText + '</span></div>';
        if (ptsStr){
          cardHtml += '<span class="ad-q-pts ' + ptsCls + '">' + ptsStr + '</span>';
        }
        cardHtml += '</div>' + body + '</div>';
        return cardHtml;
      }).join("");
 
      // ── Pending review: грейд-пікер + AI ──
      const longIdxs = qs.map((_q, qi) => qi).filter(qi => qs[qi].type === "long");
      const allLongGraded = longIdxs.length === 0 || longIdxs.every(qi => a.score?.details?.[qi]?.longResult);
      const hasGrade = a.grade12 != null;
      const canAnalyse = allLongGraded && hasGrade;
 
      let gradePicker = "";
      if (a.status === "pending_review"){
        if (allLongGraded){
          let btns = "";
          for (let g = 1; g <= 12; g++){
            const col = g >= 10 ? "#16A34A" : g >= 7 ? "#1E3A8A" : g >= 4 ? "#F59E0B" : "#DC2626";
            const sel = a.grade12 === g ? ("outline:2px solid " + col + ";outline-offset:2px;") : "";
            btns += '<button data-g="' + g + '" onclick="G.setManualGrade(\'' + a.id + '\', ' + g + ')" style="border-color:' + col + '55;color:' + col + ';' + sel + '">' + g + '</button>';
          }
          gradePicker = '<div class="ad-grade-pick"><div class="ad-gp-label">Виставити оцінку (1–12)</div><div class="ad-gp-grid">' + btns + '</div></div>';
        } else {
          gradePicker = '<div class="ad-pending"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Оцініть усі відкриті відповіді нижче, щоб виставити загальну оцінку</div>';
        }
      }
 
      let aiBlock = "";
      if (a.aiComment || a.personalAnalysis || canAnalyse){
        aiBlock = '<div class="ad-ai"><div class="ad-ai-h">'
          + '<div class="ad-ai-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>ШІ аналіз</div>';
        if (canAnalyse){
          aiBlock += '<button class="ad-ai-btn" onclick="G.personalAnalysis(\'' + a.id + '\')">✦ Розбір</button>';
        } else {
          aiBlock += '<span style="font-size:11px;color:#8691AC;font-style:italic">' + (hasGrade ? "оцініть відповіді" : "виставте оцінку") + '</span>';
        }
        aiBlock += '</div>';
        if (a.aiComment) aiBlock += '<div class="ad-ai-body">' + esc(a.aiComment) + '</div>';
        else if (a.personalAnalysis) aiBlock += '<div class="ad-ai-body">' + esc(a.personalAnalysis) + '</div>';
        aiBlock += '</div>';
      }
 
      // ── Summary текст ──
      let scoreText = "—";
      if (totalCnt > 0) scoreText = correctCnt + "/" + totalCnt + " правильно";
      else if (a.grade12 != null) scoreText = a.grade12 + "/12";
      const subLineParts = [];
      if (t?.title) subLineParts.push(t.title);
      if (group) subLineParts.push(group);
      const subLine = subLineParts.join(" · ");
 
      // ── Збирання HTML через конкатенацію (без глибокої вкладеності) ──
      let html = "";
 
      // Header
      html += '<div class="ad-head">';
      html += '<div class="ad-code">' + esc(codeStr) + '</div>';
      html += '<h2>' + esc(a.surname || "") + ' ' + esc(a.name || "") + '</h2>';
      if (subLine) html += '<div class="ad-sub">' + esc(subLine) + '</div>';
      html += '</div>';
 
      // Body
      html += '<div class="ad-body">';
 
      // Summary
      html += '<div class="ad-sum">' + donutHtml + '<div class="ad-sum-text">';
      html += '<div class="ad-sum-label">' + esc(t?.title || "Тест") + '</div>';
      html += '<div class="ad-sum-main">' + esc(scoreText) + '</div>';
      html += '<div class="ad-sum-meta">';
      if (durStr){
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        html += durStr + ' · ';
      }
      html += '<span>' + esc(dateStr) + '</span>';
      html += '</div></div></div>';
 
      // Pending + AI
      html += gradePicker + aiBlock;
 
      // Questions
      html += '<div><div class="ad-qlabel">Питання <span class="ad-qlabel-sep">·</span> ' + qs.length + '</div>';
      html += qHtml || '<div class="ad-empty">Немає даних про відповіді</div>';
      html += '</div>';
 
      html += '</div>'; // /ad-body
 
      // Footer
      html += '<div class="ad-foot">';
      html += '<button class="ad-btn-sec" onclick="G.notifyAtt && G.notifyAtt(\'' + a.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>Повідомити</button>';
      html += '<button class="ad-btn-pri" onclick="G.allowRetake && G.allowRetake(\'' + a.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>Дозволити перездачу</button>';
      html += '</div>';
 
      const target = document.getElementById("att-det");
      if (!target){
        console.error("[viewAtt] #att-det не знайдено в DOM");
        toast("Помилка: модалка не готова","err");
        return;
      }
      target.innerHTML = html;
      console.log("[viewAtt] rendered OK, length:", html.length);
    } catch (err){
      console.error("[viewAtt] render error:", err);
      const target = document.getElementById("att-det");
      if (target){
        target.innerHTML = '<div style="padding:24px;color:#B91C1C;font-family:Manrope,sans-serif">'
          + '<div style="font-weight:700;font-size:15px;margin-bottom:8px">Помилка відображення деталей спроби</div>'
          + '<div style="font-size:13px;color:#5B6A8F;line-height:1.5">' + esc(err.message || String(err)) + '</div>'
          + '<div style="font-size:12px;color:#8691AC;margin-top:10px">Відкрий DevTools → Console для деталей</div>'
          + '</div>';
      }
    }
 
    openM("m-attempt");
  },
 
// ═══════════════════════════════════════════════════════════════════════════
// ЗАГЛУШКИ для кнопок footer-а drawer-а
// Додай у G namespace (десь поруч з іншими методами).
// Якщо у тебе вже є власна логіка — можеш пропустити або замінити.
// ═══════════════════════════════════════════════════════════════════════════
 
  notifyAtt(aid){
    // TODO: відкрити модалку/діалог для повідомлення студенту
    toast("Функція 'Повідомити' поки у розробці", "info");
  },
 
  allowRetake(aid){
    // TODO: дозволити студенту перездати цю спробу.
    // Можливий варіант: пересунути status у "retake_allowed" + notification у /students/{uid}
    toast("Функція 'Дозволити перездачу' поки у розробці", "info");
  },
 

    async personalAnalysis(attId){
    if(window._AI_ANALYSIS===false){ toast("Персональний аналіз вимкнено адміністратором","err"); return; }
    const a=attempts.find(x=>x.id===attId);
    if(!a){ toast("Спробу не знайдено","err"); return; }

    // Якщо вже є збережений аналіз — показуємо
    if(a.personalAnalysis){
      G._showAiPanel(a.personalAnalysis); return;
    }

    // Відкриваємо панель з лоадером
    document.getElementById("ai-side-content").innerHTML=`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:var(--muted)">
        <div style="font-size:32px;margin-bottom:10px">⏳</div>
        <div style="font-size:14px">Аналізую помилки...</div>
      </div>`;
    document.getElementById("ai-side-panel").style.right="0";
    document.getElementById("ai-side-overlay").style.display="block";

    try{
      const t=tests.find(x=>x.id===a.testId);
      const qs=await attemptQsAsync(a,t);
      const ans=Array.isArray(a.answers)?a.answers:[];

      const wrongList=qs.map((q,i)=>{
        const rawAns=ans[i];
        const ua=(rawAns!==null&&rawAns!==undefined&&typeof rawAns==="object"&&!Array.isArray(rawAns)&&"value" in rawAns)
          ? rawAns.value : rawAns;
        // Пропускаємо питання без відповіді
        if(ua===null||ua===undefined||ua==="") return null;
        let wrong=false;
        if(q.type==="single") wrong=ua!==q.correct&&String(ua)!==String(q.correct);
        else if(q.type==="multi"){
          const uaArr=Array.isArray(ua)?ua:[];
          const cArr=Array.isArray(q.correct)?q.correct:[];
          wrong=JSON.stringify([...uaArr].sort())!==JSON.stringify([...cArr].sort());
        }
        else if(q.type==="number") wrong=parseFloat(ua)!==parseFloat(q.correct);
        else if(q.type==="text") wrong=true; // текст завжди включаємо для AI аналізу
        else return null; // long/order — пропускаємо
        const uaStr=Array.isArray(ua)?ua.join(", "):String(ua);
        const corrStr=Array.isArray(q.correct)?q.correct.join(", "):String(q.correct||"");
        return wrong?`Питання: "${(q.text||q.question||"").replace(/<[^>]+>/g,"")}"
Відповідь студента: "${uaStr}"
Правильна відповідь: "${corrStr}"`:null;
      }).filter(Boolean);

      if(!wrongList.length){
        const text="✅ Студент відповів правильно на всі питання! Відмінна робота.";
        await dbUpd(`attempts/${attId}`,{personalAnalysis:text});
        a.personalAnalysis=text;
        G._showAiPanel(text); return;
      }

      const prompt = `Ти репетитор. Студент ${esc(a.name)} ${esc(a.surname)} отримав оцінку ${a.grade12}/12 за тест "${t?.title || ""}". Помилкові відповіді: ${wrongList.slice(0, 8).join("")}. Напиши короткий персональний розбір (5–8 речень): що студент не зрозумів, на що звернути увагу, як виправити знання. Звертайся до студента напряму.`;
      const res=await callGroq([{role:"user",content:prompt}],600,0.5,"analysis");
      await dbUpd(`attempts/${attId}`,{personalAnalysis:res});
      a.personalAnalysis=res;
      G._showAiPanel(res);
    }catch(e){
      document.getElementById("ai-side-content").innerHTML=`<div style="color:#be123c;padding:16px;font-size:14px">Помилка: ${esc(e.message)}</div>`;
    }
  },

  _showAiPanel(text){
    document.getElementById("ai-side-content").innerHTML=`
      <div style="font-size:14px;line-height:1.8;color:var(--text);white-space:pre-wrap">${esc(text)}</div>`;
    document.getElementById("ai-side-panel").style.right="0";
    document.getElementById("ai-side-overlay").style.display="block";
  },

  closeAiPanel(){
    document.getElementById("ai-side-panel").style.right="-480px";
    document.getElementById("ai-side-overlay").style.display="none";
  },

    openStudentCard(id){
    const s=_students.find(x=>x.id===id);
    if(!s) return;
    const att=Array.isArray(s.attempts)?s.attempts:[];
    const groups=(s.groups||[]).filter(Boolean);
    const gc=s.avgGrade>=10?"#0d9e85":s.avgGrade>=7?"#2d5be3":s.avgGrade>=4?"#f59e0b":"#f43f5e";
    const gradeEmoji=s.avgGrade>=10?"🏆":s.avgGrade>=7?"✅":s.avgGrade>=4?"📈":"📉";
    const passCount=att.filter(a=>(a.grade||0)>=4).length;
    const passRate=att.length?Math.round(passCount/att.length*100):0;
    const bestGrade=att.length?Math.max(...att.map(a=>a.grade||0)):0;
    const totalTests=[...new Set(att.map(a=>a.testId))].length;
    const initials=(s.name||"?").slice(0,1)+(s.surname||"").slice(0,1);

    // Динаміка — останні 8 спроб
    const bars=att.slice(-8).map((a,i)=>{
      const pct=Math.max(6,Math.round((a.grade||0)/12*100));
      const c=a.grade>=10?"#0d9e85":a.grade>=7?"#2d5be3":a.grade>=4?"#f59e0b":"#f43f5e";
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="font-size:9px;color:rgba(255,255,255,.6);font-weight:600">${a.grade||0}</div>
        <div style="width:100%;border-radius:4px 4px 0 0;background:rgba(255,255,255,.12);height:40px;position:relative;overflow:hidden">
          <div style="position:absolute;bottom:0;left:0;right:0;background:${c};height:${pct}%;border-radius:4px 4px 0 0"></div>
        </div>
      </div>`;
    }).join("");

    // Рядки спроб
    const attRows=att.slice().reverse().map(a=>{
      const gc2=a.grade>=10?"bg-g":a.grade>=7?"bg-b":a.grade>=4?"bg-a":"bg-r";
      const dateStr=new Date(a.date).toLocaleDateString("uk-UA",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
      return `<tr style="border-bottom:1px solid rgba(229,232,240,.5)">
        <td style="padding:11px 16px;font-size:13px;font-weight:500">${esc(a.testTitle||"—")}</td>
        <td style="padding:11px 12px;text-align:center">${a.grade!=null?`<span class="bdg ${gc2}">${a.grade}/12</span>`:"—"}</td>
        <td style="padding:11px 10px;font-size:13px;font-weight:600;text-align:center;color:var(--muted)">${a.percent||0}%</td>
        <td style="padding:11px 10px;font-size:12px;color:var(--muted)">${esc(a.group||"—")}</td>
        <td style="padding:11px 12px;font-size:12px;color:var(--muted);white-space:nowrap">${dateStr}</td>
        <td style="padding:11px 10px">${a.attemptId?`<span style="font-size:12px;color:var(--primary);cursor:pointer;font-weight:500" onclick="closeM('m-student');G.viewAtt('${a.attemptId}')">деталі →</span>`:""}</td>
      </tr>`;
    }).join("");

    $("m-student-body").innerHTML=`
      <!-- Шапка -->
      <div style="background:linear-gradient(135deg,#1e2d6b 0%,#0d1340 100%);padding:28px;position:relative;overflow:hidden;color:#fff">
        <div style="position:absolute;width:280px;height:280px;border-radius:50%;background:rgba(255,255,255,.04);top:-100px;right:-80px"></div>
        <div style="position:absolute;width:160px;height:160px;border-radius:50%;background:rgba(45,91,227,.15);bottom:-60px;left:20px"></div>
        <div style="position:relative;z-index:1;display:flex;align-items:flex-start;gap:18px;margin-bottom:${att.length>=2?"20":"0"}px">
          <!-- Аватар -->
          <div style="width:60px;height:60px;border-radius:16px;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-weight:800;font-size:20px;color:#fff;flex-shrink:0">${initials}</div>
          <!-- Ім'я -->
          <div style="flex:1;min-width:0;padding-top:4px">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;opacity:.5;margin-bottom:6px">Студент</div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:21px;line-height:1.2" id="sc-fullname">${esc(s.surname)} ${esc(s.name)}</div>
              <button onclick="G.editStudentName('${s.id}')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:rgba(255,255,255,.8);font-size:11px;font-weight:600;cursor:pointer;transition:all .15s"
                onmouseover="this.style.background='rgba(255,255,255,.2)'"
                onmouseout="this.style.background='rgba(255,255,255,.1)'">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Редагувати
              </button>
            </div>
            <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap">
              ${groups.length
                ?groups.map(g=>`<span style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:500">${esc(g)}</span>`).join("")
                :`<span style="opacity:.4;font-size:12px;font-style:italic">Без групи</span>`}
            </div>
          </div>
          <!-- Середня оцінка -->
          <div style="text-align:right;flex-shrink:0;padding-top:4px">
            <div style="font-size:10px;opacity:.5;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Середня</div>
            <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:48px;line-height:1;color:${gc==="var(--primary)"?"#fff":gc};text-shadow:0 2px 12px rgba(0,0,0,.3)">${s.avgGrade||"—"}</div>
            <div style="font-size:12px;opacity:.5;margin-top:2px">/ 12 ${gradeEmoji}</div>
          </div>
        </div>
        <!-- Графік динаміки -->
        ${att.length>=2?`<div style="position:relative;z-index:1">
          <div style="font-size:9px;opacity:.45;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px">Динаміка оцінок</div>
          <div style="display:flex;gap:4px;height:52px;align-items:flex-end">${bars}</div>
        </div>`:""}
      </div>

      <!-- Метрики -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border)">
        ${[
          {val:att.length,  label:"Спроб",      col:"var(--primary)",  bg:"rgba(45,91,227,.04)"},
          {val:passCount,   label:"Склав",       col:"#0d9e85",         bg:"rgba(13,158,133,.04)"},
          {val:passRate+"%",label:"Успішність",  col:"#d97706",         bg:"rgba(245,158,11,.04)"},
          {val:bestGrade,   label:"Найкраща",    col:"#9333ea",         bg:"rgba(147,51,234,.04)"},
        ].map(m=>`<div style="background:${m.bg};padding:16px;text-align:center">
          <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:24px;color:${m.col};line-height:1">${m.val}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:.4px">${m.label}</div>
        </div>`).join("")}
      </div>

      <!-- Таблиця спроб -->
      <div style="padding:20px 24px 8px">
        <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">Всі спроби</div>
        ${att.length
          ?`<div style="border:1.5px solid var(--border);border-radius:14px;overflow:hidden">
              <table class="tbl" style="margin:0">
                <thead><tr>
                  <th style="padding:10px 16px">Тест</th>
                  <th style="padding:10px 12px;text-align:center">Оцінка</th>
                  <th style="padding:10px 10px;text-align:center">%</th>
                  <th style="padding:10px 10px">Група</th>
                  <th style="padding:10px 12px">Дата</th>
                  <th></th>
                </tr></thead>
                <tbody>${attRows}</tbody>
              </table>
            </div>`
          :`<div style="text-align:center;padding:32px;background:#f8faff;border-radius:14px;border:1.5px solid var(--border)">
              <div style="font-size:32px;margin-bottom:8px">📭</div>
              <div style="color:var(--muted);font-size:14px">Немає спроб</div>
            </div>`}
      </div>

      <!-- Дії -->
      <div style="padding:16px 24px 24px;display:flex;justify-content:space-between;align-items:center">
        <button onclick="G.openMergeModal('${s.id}')" style="display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:11px;border:1.5px solid var(--border);background:#fff;font-size:13px;font-weight:600;cursor:pointer;color:var(--text);transition:all .15s"
          onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text)'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          Об'єднати картки
        </button>
        <button onclick="G.deleteStudent('${s.id}')" style="display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:11px;border:1.5px solid rgba(244,63,94,.25);background:rgba(244,63,94,.05);font-size:13px;font-weight:600;cursor:pointer;color:#be123c;transition:all .15s"
          onmouseover="this.style.background='rgba(244,63,94,.12)'"
          onmouseout="this.style.background='rgba(244,63,94,.05)'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          Видалити картку
        </button>
      </div>`;
    openM("m-student");
  },


  openMergeModal(sourceId){
    closeM("m-merge");  // на випадок якщо вже відкрито
    closeM("m-student");
    const source = _students.find(s=>s.id===sourceId);
    if(!source) return;
    window._mergeSourceId = sourceId;
    window._mergeTargetId = null;

    document.getElementById("m-merge-sub").textContent =
      `Об'єднати картку "${source.surname} ${source.name}" з:`;

    // Показуємо всіх студентів крім поточного
    const list = document.getElementById("m-merge-list");
    const others = _students.filter(s=>s.id!==sourceId);

    if(!others.length){
      list.innerHTML=`<div style="color:var(--muted);font-size:14px;text-align:center;padding:16px">Немає інших карток для об'єднання</div>`;
      document.getElementById("merge-confirm-btn").disabled=true;
    } else {
      list.innerHTML = others.map(s=>{
        const att = Array.isArray(s.attempts)?s.attempts:[];
        return `<div class="merge-item" id="mi-${s.id}" data-name="${esc((s.surname||'')+ ' '+(s.name||''))}" onclick="G.selectMergeTarget('${s.id}')"
          style="padding:12px 14px;border:1.5px solid var(--border);border-radius:13px;cursor:pointer;transition:all .15s;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:600;font-size:14px">${esc(s.surname)} ${esc(s.name)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">${att.length} спроб · Середня: ${s.avgGrade||"—"}</div>
          </div>
          <div style="width:20px;height:20px;border-radius:50%;border:2px solid var(--border);flex-shrink:0" id="mi-dot-${s.id}"></div>
        </div>`;
      }).join("");
      document.getElementById("merge-confirm-btn").disabled=true;
    }
    document.getElementById("merge-search").value = "";
    openM("m-merge");
  },

  filterMergeList(q){
    const lq = q.toLowerCase();
    document.querySelectorAll(".merge-item").forEach(el=>{
      const name = (el.dataset.name||"").toLowerCase();
      el.style.display = name.includes(lq) ? "" : "none";
    });
  },

  selectMergeTarget(targetId){
    // Скидаємо попередній вибір
    document.querySelectorAll(".merge-item").forEach(el=>{
      el.style.borderColor="var(--border)";
      el.style.background="";
    });
    document.querySelectorAll("[id^='mi-dot-']").forEach(el=>{
      el.style.background=""; el.style.borderColor="var(--border)";
    });

    window._mergeTargetId = targetId;
    const item = document.getElementById(`mi-${targetId}`);
    const dot  = document.getElementById(`mi-dot-${targetId}`);
    if(item){ item.style.borderColor="var(--primary)"; item.style.background="rgba(45,91,227,.04)"; }
    if(dot){  dot.style.background="var(--primary)"; dot.style.borderColor="var(--primary)"; }
    document.getElementById("merge-confirm-btn").disabled=false;
  },

  async confirmMerge(){
    const sourceId = window._mergeSourceId;
    const targetId = window._mergeTargetId;
    if(!sourceId || !targetId) return;

    const source = _students.find(s=>s.id===sourceId);
    const target = _students.find(s=>s.id===targetId);
    if(!source || !target) return;

    const btn = document.getElementById("merge-confirm-btn");
    btn.disabled=true; btn.textContent="Об'єднання...";

    // Об'єднуємо спроби
    const srcAttempts = Array.isArray(source.attempts)?source.attempts:[];
    const tgtAttempts = Array.isArray(target.attempts)?target.attempts:[];
    const merged = [...tgtAttempts, ...srcAttempts].sort((a,b)=>(a.date||0)-(b.date||0));

    // Об'єднуємо групи
    const groups = [...new Set([...(target.groups||[]),...(source.groups||[])].filter(Boolean))];

    // Перераховуємо середню
    const grades = merged.map(a=>a.grade).filter(g=>g>0);
    const avgGrade = grades.length ? Math.round((grades.reduce((a,b)=>a+b,0)/grades.length)*10)/10 : 0;

    // Зберігаємо в target і видаляємо source
    await dbUpd(`students/${targetId}`, { attempts: merged, groups, avgGrade, lastSeen: Date.now() });
    await dbDel(`students/${sourceId}`);

    _students = _students.filter(s=>s.id!==sourceId);
    const tIdx = _students.findIndex(s=>s.id===targetId);
    if(tIdx>=0) _students[tIdx] = { ..._students[tIdx], attempts: merged, groups, avgGrade };

    closeM("m-merge");
    G.renderStudents();
    toast(`Картки об'єднано: ${merged.length} спроб`);
    btn.disabled=false; btn.textContent="Об'єднати →";
  },

  editStudentName(sid){
    const s = _students.find(x=>x.id===sid);
    if(!s) return;
    closeM("m-student");
    openM("m-edit-student");
    document.getElementById("es-surname").value = s.surname || "";
    document.getElementById("es-name").value    = s.name    || "";
    document.getElementById("es-err").textContent = "";
    window._editStudentId = sid;
    setTimeout(()=>document.getElementById("es-surname").focus(), 120);
  },

  async saveStudentName(){
    const sid     = window._editStudentId;
    const surname = document.getElementById("es-surname").value.trim();
    const name    = document.getElementById("es-name").value.trim();
    const errEl   = document.getElementById("es-err");
    if(!surname || !name){ errEl.textContent = "Заповни обидва поля"; return; }

    const btn = document.getElementById("es-save-btn");
    btn.disabled = true; btn.textContent = "Збереження...";
    errEl.textContent = "";

    try {
      await dbUpd(`students/${sid}`, { surname, name });
      const idx = _students.findIndex(x=>x.id===sid);
      if(idx>=0) _students[idx] = { ..._students[idx], surname, name };

      closeM("m-edit-student");
      G.renderStudents();
      toast("Ім'я збережено ✓");
      // Повертаємо картку студента з оновленими даними
      G.openStudentCard(sid);
    } catch(e){
      errEl.textContent = "Помилка: " + e.message;
    }
    btn.disabled = false; btn.textContent = "Зберегти";
  },

  deleteStudent(id){
    const s=_students.find(x=>x.id===id);
    if(!s) return;
    const nameEl=document.getElementById("del-student-name");
    if(nameEl) nameEl.textContent=`${s.surname} ${s.name}`;
    document.getElementById("del-student-confirm-btn").onclick = async () => {
      closeM("m-del-student");
      const attemptIds = (s.attempts||[]).map(a => a.attemptId || a.id).filter(Boolean);
      await Promise.all([
        dbDel(`students/${id}`),
        ...attemptIds.map(aid => dbDel(`attempts/${aid}`)),
      ]);
      _students=_students.filter(x=>x.id!==id);
      attempts=attempts.filter(a=>!attemptIds.includes(a.id));
      window.attempts=attempts;
      window._selectedStId = null;
      closeM("m-student");
      G.renderStudents();
      toast(attemptIds.length ? `Картку і ${attemptIds.length} спроб видалено` : "Картку видалено");
    };
    closeM("m-student");
    openM("m-del-student");
  },



  renderArchive(){
    const body = document.getElementById("archive-body");
    if(!body) return;
    const archived = tests.filter(t => t.status === "archived").sort((a, b) => (b.archivedAt || b.updatedAt || 0) - (a.archivedAt || a.updatedAt || 0));
    const nb = document.getElementById("nb-archive");
    if (nb) nb.textContent = archived.length;
    if (!archived.length){
      body.innerHTML = `<div class="t-card"><div class="t-empty">
        <div class="t-empty-ico">${I.archive}</div>
        <div class="t-empty-title">Архів порожній</div>
        <div class="t-empty-hint">Сюди потрапляють архівовані тести разом зі спробами студентів</div>
      </div></div>`;
      return;
    }
    const stats = _testStats();
    body.innerHTML = `<div class="t-card"><div style="overflow-x:auto"><table class="t-dtable">
      <thead><tr><th>Назва</th><th>Папка</th><th>Питань</th><th>Спроб</th><th>Архівовано</th><th style="width:220px"></th></tr></thead>
      <tbody>${archived.map((t, i) => {
        const f = _folderOf(t);
        return `<tr data-id="${esc(t.id)}">
          <td><div style="display:flex;align-items:center;gap:12px;min-width:0">
            <div class="t-tile" style="background:${_quizCoverGradient(t, i)};filter:grayscale(.5)">${esc(_testAbbr(t.title))}</div>
            <div style="min-width:0"><div class="t-row-title" style="cursor:default">${esc(t.title)}</div>
            ${(t.tags || []).length ? `<div class="t-row-sub">${t.tags.map(g => "#" + esc(g)).join(" ")}</div>` : ""}</div>
          </div></td>
          <td class="t-muted">${esc(f?.name || "—")}</td>
          <td class="t-mono">${(t.questions || []).length}</td>
          <td class="t-mono">${stats.get(t.id)?.cnt || 0}</td>
          <td class="t-mono t-muted" style="white-space:nowrap">${_fmtDate(t.archivedAt || t.updatedAt) || "—"}</td>
          <td><div style="display:flex;gap:6px;justify-content:flex-end">
            <button class="t-btn" data-act="restore" data-id="${esc(t.id)}">${I.restore}Відновити</button>
            <button class="t-btn ghost danger" data-act="purge" data-id="${esc(t.id)}" title="Видалити назавжди">${I.del}Видалити</button>
          </div></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div></div>`;
  },

// ─── ЗАМІНИТИ toggleSuspDrop (тепер підтримує "group"): ─────────────────────
 
  toggleSuspDrop(which){
    const test = document.getElementById("susp-test-menu");
    const date = document.getElementById("susp-date-menu");
    const group = document.getElementById("susp-group-menu");
    [test, date, group].forEach(m => {
      if (!m) return;
      const target = (which === "test"  && m === test) ||
                     (which === "date"  && m === date) ||
                     (which === "group" && m === group);
      if (target) m.classList.toggle("on");
      else m.classList.remove("on");
    });
  },
 
// ─── ЗАМІНИТИ setSuspTest: ──────────────────────────────────────────────────
 
  setSuspTest(id, label){
    const inp = document.getElementById("susp-filter-test");
    if (inp) inp.value = id || "";
    const lbl = document.getElementById("susp-test-label");
    if (lbl) lbl.textContent = label || "Всі тести";
    const btn = document.getElementById("susp-test-btn");
    if (btn) btn.classList.toggle("active", !!id);
    document.getElementById("susp-test-menu")?.classList.remove("on");
    document.querySelectorAll("#susp-test-menu .it").forEach(it => {
      it.classList.toggle("on", (it.dataset.val || "") === (id || ""));
    });
    G.renderSuspicious();
  },
 
// ─── ЗАМІНИТИ setSuspDate: ──────────────────────────────────────────────────
 
  setSuspDate(val){
    const lbl = document.getElementById("susp-date-label");
    if (lbl) lbl.textContent = val
      ? new Date(val + "T00:00:00").toLocaleDateString("uk-UA", { day:"numeric", month:"short", year:"numeric" })
      : "Будь-яка дата";
    const btn = document.getElementById("susp-date-btn");
    if (btn) btn.classList.toggle("active", !!val);
    document.getElementById("susp-date-menu")?.classList.remove("on");
    G.renderSuspicious();
  },
  
// ─── ДОДАТИ новий setSuspGroup: ─────────────────────────────────────────────
 
  setSuspGroup(group, label){
    const inp = document.getElementById("susp-filter-group");
    if (inp) inp.value = group || "";
    const lbl = document.getElementById("susp-group-label");
    if (lbl) lbl.textContent = label || "Усі групи";
    const btn = document.getElementById("susp-group-btn");
    if (btn) btn.classList.toggle("active", !!group);
    document.getElementById("susp-group-menu")?.classList.remove("on");
    document.querySelectorAll("#susp-group-menu .it").forEach(it => {
      it.classList.toggle("on", (it.dataset.val || "") === (group || ""));
    });
    G.renderSuspicious();
  },
 
// ─── ЗАМІНИТИ resetSuspFilters (тепер скидає й групу): ──────────────────────
 
  resetSuspFilters(){
    const inp = document.getElementById("susp-filter-test");
    if (inp) inp.value = "";
    const dateInp = document.getElementById("susp-filter-date");
    if (dateInp) dateInp.value = "";
    const grpInp = document.getElementById("susp-filter-group");
    if (grpInp) grpInp.value = "";
 
    ["susp-test-btn", "susp-date-btn", "susp-group-btn"].forEach(id => {
      document.getElementById(id)?.classList.remove("active");
    });
 
    const tLbl = document.getElementById("susp-test-label");
    if (tLbl) tLbl.textContent = "Всі тести";
    const dLbl = document.getElementById("susp-date-label");
    if (dLbl) dLbl.textContent = "Будь-яка дата";
    const gLbl = document.getElementById("susp-group-label");
    if (gLbl) gLbl.textContent = "Усі групи";
 
    document.querySelectorAll("#susp-test-menu .it").forEach(it => it.classList.toggle("on", !it.dataset.val));
    document.querySelectorAll("#susp-group-menu .it").forEach(it => it.classList.toggle("on", !it.dataset.val));
 
    G.renderSuspicious();
  },
 
 
  
// ─── ДОДАТИ toggleSuspCase: ─────────────────────────────────────────────────
 
  toggleSuspCase(id){
    const el = document.querySelector(`[data-case-id="${id}"]`);
    if (!el) return;
    el.classList.toggle("expanded");
  },
 
 
// ─── ЗАМІНИТИ повністю renderSuspicious (тепер з group filter): ─────────────
 
  renderSuspicious(filterTest, filterDate){
    const body = document.getElementById("suspicious-body");
    if (!body) return;
 
    const allScored = attempts
      .filter(a => a.status === "completed" || a.status === "pending_review")
      .map(a => {
        const score = (a.tabSwitches||0)*2 + (a.copyAttempts||0)*3 + (a.screenshots||0)*5;
        return { ...a, suspScore: score };
      })
      .filter(a => a.suspScore > 0);
 
    dbUpd("meta", { suspReadCount: allScored.length }).catch(()=>{});
    const badge = $("nb-suspicious");
    if (badge){ badge.textContent = "0"; badge.style.display = "none"; }
 
    // ─── Filters ───
    const fTest  = filterTest || document.getElementById("susp-filter-test")?.value || "";
    const fDate  = filterDate || document.getElementById("susp-filter-date")?.value || "";
    const fGroup = document.getElementById("susp-filter-group")?.value || "";
 
    let scored = [...allScored];
    if (fTest)  scored = scored.filter(a => a.testId === fTest);
    if (fGroup) scored = scored.filter(a => {
      const l = links.find(x => x.id === a.linkId);
      return (l?.group || "") === fGroup;
    });
    if (fDate){
      const d = new Date(fDate); d.setHours(0,0,0,0);
      const d2 = new Date(fDate); d2.setHours(23,59,59,999);
      scored = scored.filter(a => a.createdAt >= d.getTime() && a.createdAt <= d2.getTime());
    }
    scored.sort((a, b) => b.suspScore - a.suspScore);
 
    // ─── Page head: lichilnyk i chip ───
    const headCount = document.getElementById("sp-cases-count");
    if (headCount) headCount.textContent = allScored.length;
 
    const statusChip = document.getElementById("sp-status-chip");
    if (statusChip){
      const high = allScored.filter(a => a.suspScore >= 10).length;
      if (high > 0){
        statusChip.className = "sp-chip bad";
        statusChip.textContent = `${high} high-risk`;
      } else if (allScored.length > 0){
        statusChip.className = "sp-chip ok";
        statusChip.textContent = "під спостереженням";
      } else {
        statusChip.className = "sp-chip ok";
        statusChip.textContent = "все спокійно";
      }
    }
 
    // ─── KPI strip ───
    const kpiGrid = document.getElementById("sp-kpi-grid");
    if (kpiGrid){
      const high = allScored.filter(a => a.suspScore >= 10).length;
      const mid  = allScored.filter(a => a.suspScore >= 5 && a.suspScore < 10).length;
 
      const today = new Date(); today.setHours(0,0,0,0);
      const yest = new Date(today); yest.setDate(yest.getDate() - 1);
      const todayCount = allScored.filter(a => (a.createdAt||0) >= today.getTime()).length;
      const yestCount = allScored.filter(a => {
        const ts = a.createdAt || 0;
        return ts >= yest.getTime() && ts < today.getTime();
      }).length;
      const totalFlags = allScored.reduce((s, a) => s + (a.tabSwitches||0) + (a.copyAttempts||0) + (a.screenshots||0), 0);
      const cleanCount = attempts.filter(a => (a.status === "completed" || a.status === "pending_review")).length - allScored.length;
 
      kpiGrid.innerHTML = `
        <div class="risk-card bad">
          <div class="risk-l">High risk</div>
          <div class="risk-score bad">${high}</div>
          <div class="sub">${high === 0 ? "немає кейсів" : (high === 1 ? "потребує перевірки" : "потребують перевірки")}</div>
        </div>
        <div class="risk-card warn">
          <div class="risk-l">Medium risk</div>
          <div class="risk-score warn">${mid}</div>
          <div class="sub">${mid === 0 ? "немає кейсів" : "на спостереженні"}</div>
        </div>
        <div class="risk-card info">
          <div class="risk-l">Всього флагів</div>
          <div class="risk-score info">${totalFlags}</div>
          <div class="sub">${todayCount} за сьогодні${yestCount ? ` · ${todayCount > yestCount ? "+" : ""}${todayCount - yestCount} vs вчора` : ""}</div>
        </div>
        <div class="risk-card good">
          <div class="risk-l">Чистих спроб</div>
          <div class="risk-score good">${cleanCount}</div>
          <div class="sub">без порушень</div>
        </div>
      `;
    }
 
    // ─── Filter bar ───
    const filtersDiv = document.getElementById("susp-filters");
    if (filtersDiv && !filtersDiv.dataset.built){
      filtersDiv.dataset.built = "1";
      filtersDiv.className = "sp-fb";
 
      const testOpts = `<div class="it on" data-val="" onclick="G.setSuspTest('','Всі тести')">Всі тести</div>` +
        tests.filter(t => t.status !== "archived").map(t =>
          `<div class="it" data-val="${t.id}" onclick="G.setSuspTest('${t.id}',${jsq(t.title)})">${esc(t.title)}</div>`
        ).join("");
 
      const groupsList = [...new Set(links.filter(l=>!l.groupHidden).map(l => l.group).filter(Boolean))].sort();
      const groupOpts = `<div class="it on" data-val="" onclick="G.setSuspGroup('','Усі групи')">Усі групи</div>` +
        groupsList.map(g =>
          `<div class="it" data-val="${esc(g)}" onclick="G.setSuspGroup(${jsq(g)},${jsq(g)})">${esc(g)}</div>`
        ).join("");
 
      filtersDiv.innerHTML = `
        <span class="sp-fb-l">Фільтри:</span>

        <div class="sp-drop" id="susp-group-wrap">
          <button onclick="event.stopPropagation();G.toggleSuspDrop('group')" id="susp-group-btn">
            <span id="susp-group-label">Усі групи</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="sp-drop-menu" id="susp-group-menu">${groupOpts}</div>
        </div>
 
 
        <div class="sp-drop" id="susp-test-wrap">
          <button onclick="event.stopPropagation();G.toggleSuspDrop('test')" id="susp-test-btn">
            <span id="susp-test-label">Всі тести</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="sp-drop-menu" id="susp-test-menu">${testOpts}</div>
        </div>
 
        <div class="sp-drop" id="susp-date-wrap">
          <button onclick="event.stopPropagation();G.toggleSuspDrop('date')" id="susp-date-btn">
            <span id="susp-date-label">Будь-яка дата</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="sp-drop-menu" id="susp-date-menu" style="padding:10px;width:240px">
            <input type="date" id="susp-filter-date" onchange="G.setSuspDate(this.value)">
          </div>
        </div>
 
        <span class="sp-fb-meta">${scored.length} / ${allScored.length}</span>
 
        <input type="hidden" id="susp-filter-test" value="">
        <input type="hidden" id="susp-filter-group" value="">
      `;
    } else if (filtersDiv){
      // Оновлюємо лічильник
      const meta = filtersDiv.querySelector(".sp-fb-meta");
      if (meta) meta.textContent = `${scored.length} / ${allScored.length}`;
 
      // Reset кнопка — додаємо/прибираємо в залежності від наявності фільтрів
      const existingReset = document.getElementById("susp-reset-btn");
      const hasFilters = !!(fTest || fDate || fGroup);
      if (hasFilters && !existingReset){
        const resetBtn = document.createElement("button");
        resetBtn.className = "sp-reset";
        resetBtn.id = "susp-reset-btn";
        resetBtn.onclick = () => G.resetSuspFilters();
        resetBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Скинути`;
        if (meta) filtersDiv.insertBefore(resetBtn, meta);
      } else if (!hasFilters && existingReset){
        existingReset.remove();
      }
 
      // Update test menu (на випадок якщо тести змінились)
      const tMenu = document.getElementById("susp-test-menu");
      if (tMenu){
        const cur = document.getElementById("susp-filter-test")?.value || "";
        tMenu.innerHTML = `<div class="it${!cur?" on":""}" data-val="" onclick="G.setSuspTest('','Всі тести')">Всі тести</div>` +
          tests.filter(t => t.status !== "archived").map(t =>
            `<div class="it${cur===t.id?" on":""}" data-val="${t.id}" onclick="G.setSuspTest('${t.id}',${jsq(t.title)})">${esc(t.title)}</div>`
          ).join("");
      }
 
      // Update group menu (на випадок якщо посилання/групи змінились)
      const gMenu = document.getElementById("susp-group-menu");
      if (gMenu){
        const cur = document.getElementById("susp-filter-group")?.value || "";
        const groupsList = [...new Set(links.filter(l=>!l.groupHidden).map(l => l.group).filter(Boolean))].sort();
        gMenu.innerHTML = `<div class="it${!cur?" on":""}" data-val="" onclick="G.setSuspGroup('','Усі групи')">Усі групи</div>` +
          groupsList.map(g =>
            `<div class="it${cur===g?" on":""}" data-val="${esc(g)}" onclick="G.setSuspGroup(${jsq(g)},${jsq(g)})">${esc(g)}</div>`
          ).join("");
      }
    }
 
    // ─── Cases body ───
    if (!scored.length){
      body.innerHTML = `<div class="sp-empty">
        <div class="ei"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div class="et">${(fTest || fDate || fGroup) ? "За цим фільтром нічого немає" : "Підозрілих спроб немає"}</div>
        <div class="es">${(fTest || fDate || fGroup) ? "Спробуйте інший фільтр" : "Студенти проходили тести без порушень"}</div>
      </div>`;
      return;
    }
 
    const AVA_PALETTE = ["", "b", "g", "o", "r"];
 
    body.innerHTML = `<div class="case-list">${scored.map(a => {
      const t = tests.find(x => x.id === a.testId);
      const l = links.find(x => x.id === a.linkId);
      const score = a.suspScore;
      const lvl = score >= 10 ? "bad" : score >= 5 ? "warn" : "info";
      const lvlIcon = lvl === "bad" ? "⚑ high" : lvl === "warn" ? "medium" : "low";
 
      const dateStr = a.createdAt ? new Date(a.createdAt).toLocaleDateString("uk-UA", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "—";
      const initials = ((a.surname?.[0] || "") + (a.name?.[0] || "")).toUpperCase() || "?";
      const seed = String(a.surname || "") + String(a.name || "");
      let h = 0; for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i)) | 0;
      const avaCls = AVA_PALETTE[Math.abs(h) % AVA_PALETTE.length];
 
      const barColor = lvl === "bad" ? "#DC2626" : lvl === "warn" ? "#F59E0B" : "#3B82F6";
      const barPct = Math.min(100, score * 6);
      const caseId = "S-" + (a.id ? a.id.slice(-5).toUpperCase() : "?????");
 
      const compactTags = [];
      if (a.tabSwitches > 0) compactTags.push(`<span class="case-tag tabs">🔄 ${a.tabSwitches}</span>`);
      if (a.copyAttempts > 0) compactTags.push(`<span class="case-tag copies">📋 ${a.copyAttempts}</span>`);
      if (a.screenshots > 0) compactTags.push(`<span class="case-tag shots">📸 ${a.screenshots}</span>`);
 
      const conclParts = [];
      if (a.tabSwitches >= 3) conclParts.push("часті переключення між вкладками");
      if (a.copyAttempts >= 1) conclParts.push("спроби скопіювати текст питань");
      if (a.screenshots >= 1) conclParts.push("спроби зробити скріншот");
      const conclusion = conclParts.length
        ? conclParts.join(", ").charAt(0).toUpperCase() + conclParts.join(", ").slice(1) + "."
        : "Підозріла активність зафіксована, але показники в межах допустимого.";
 
      return `<div class="case" data-case-id="${a.id}">
        <div class="case-h" onclick="G.toggleSuspCase('${a.id}')">
          <div class="case-ava ${avaCls}">${esc(initials)}</div>
          <div class="case-info">
            <div class="case-id">${caseId}</div>
            <div class="case-name">
              ${esc(a.surname || "")} ${esc(a.name || "")}
              <span class="ms">· ${esc(t?.title || "—")}${l?.group ? " · " + esc(l.group) : ""}</span>
            </div>
          </div>
          <div class="case-right">
            <div class="case-tags">${compactTags.join("")}</div>
            <div class="case-score">
              <span class="l">Risk score</span>
              <span class="v ${lvl}">${score}</span>
            </div>
            <div class="case-bar"><i style="width:${barPct}%; background:${barColor}"></i></div>
            <span class="case-pill ${lvl}">${lvlIcon}</span>
            <span class="case-chev">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </span>
          </div>
        </div>
 
        <div class="case-body">
          <div class="case-section-l">Метрики анти-чіту</div>
          <div class="meters">
            <div class="meter ${a.tabSwitches > 0 ? "tabs" : "zero"}">
              <div class="meter-l"><span class="ico">🔄</span> Перемикання вкладок</div>
              <div class="meter-v">${a.tabSwitches || 0}</div>
              <div class="meter-sub">×2 балів за подію</div>
            </div>
            <div class="meter ${a.copyAttempts > 0 ? "copies" : "zero"}">
              <div class="meter-l"><span class="ico">📋</span> Копії в буфер</div>
              <div class="meter-v">${a.copyAttempts || 0}</div>
              <div class="meter-sub">×3 балів за спробу</div>
            </div>
            <div class="meter ${a.screenshots > 0 ? "shots" : "zero"}">
              <div class="meter-l"><span class="ico">📸</span> Скріншоти</div>
              <div class="meter-v">${a.screenshots || 0}</div>
              <div class="meter-sub">×5 балів за спробу</div>
            </div>
          </div>
 
          <div class="case-concl">
            <span class="ico">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </span>
            <div>
              <div class="t">Висновок аналізатора</div>
              <div class="d">${conclusion} Дата спроби: <span class="mono">${dateStr}</span></div>
            </div>
          </div>
 
          <div class="case-foot">
            <button class="sp-btn" onclick="event.stopPropagation();G.viewAtt('${a.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Переглянути спробу
            </button>
          </div>
        </div>
      </div>`;
    }).join("")}</div>`;
  },
  initGradebook(){
    window._gbTestF = window._gbTestF!==undefined ? window._gbTestF : "";
    window._gbGrpF  = window._gbGrpF!==undefined  ? window._gbGrpF  : "";
    // Заповнюємо тести
    const curTestF=window._gbTestF||"";
    const curGrpF=window._gbGrpF||"";
    const gbTestMenu=document.getElementById("cd-gb-test-menu");
    if(gbTestMenu){
      gbTestMenu.innerHTML=`<div class="cd-item${!curTestF?" cd-active":""}" data-val="" onclick="G.selectGbFilter('test','','Всі тести')">Всі тести</div>`+
        tests.filter(t=>t.status!=="archived").map(t=>
          `<div class="cd-item${curTestF===t.id?" cd-active":""}" data-val="${t.id}" onclick="G.selectGbFilter('test','${t.id}',${jsq(t.title)})">${esc(t.title)}</div>`
        ).join("");
      const lbl=document.getElementById("cd-gb-test-label");
      if(lbl&&curTestF){const t=tests.find(x=>x.id===curTestF);if(t)lbl.textContent=t.title;}
    }
    // Заповнюємо групи (без прихованих через архівацію студентської групи)
    const groups=[...new Set(links.filter(l=>!l.groupHidden).map(l=>l.group).filter(Boolean))].sort();
    const gbGrpMenu=document.getElementById("cd-gb-group-menu");
    if(gbGrpMenu){
      gbGrpMenu.innerHTML=`<div class="cd-item${!curGrpF?" cd-active":""}" data-val="" onclick="G.selectGbFilter('group','','Всі групи')">Всі групи</div>`+
        groups.map(g=>`<div class="cd-item${curGrpF===g?" cd-active":""}" data-val="${esc(g)}" onclick="G.selectGbFilter('group',${jsq(g)},${jsq(g)})">${esc(g)}</div>`
        ).join("");
      const lbl2=document.getElementById("cd-gb-group-label");
      if(lbl2&&curGrpF)lbl2.textContent=curGrpF;
    }
    G.renderGradebook();
  },

 selectGbFilter(field, value, label){
    const wrap  = field === "test" ? "cd-gb-test" : "cd-gb-group";
    const selId = field === "test" ? "gb-test"    : "gb-group";
 
    // Оновлюємо лейбл, активний пункт, select
    const lbl = document.getElementById(wrap + "-label");
    if (lbl) lbl.textContent = label;
    const menu = document.getElementById(wrap + "-menu");
    menu?.querySelectorAll(".cd-item").forEach(el => {
      el.classList.toggle("cd-active", el.dataset.val === value || (!value && el.dataset.val === ""));
    });
    menu?.classList.remove("open");
    const btn = document.querySelector(`#${wrap} .cd-btn`);
    btn?.classList.toggle("active", !!value);
    const sel = document.getElementById(selId);
    if (sel) sel.value = value;
 
    // Зберігаємо в window-змінні (використовує initGradebook при перезавантаженні)
    if (field === "test") window._gbTestF = value;
    else                  window._gbGrpF  = value;
 
    // ── НОВЕ: при виборі групи — перебудовуємо dropdown тестів ──
    if (field === "group"){
      // Тести, що мають посилання з обраною групою (або всі якщо група не обрана)
      const validTestIds = value
        ? new Set(links.filter(l => l.group === value).map(l => l.testId))
        : null;
      const filteredTests = tests.filter(t => {
        if (t.status === "archived") return false;
        if (!validTestIds) return true;
        return validTestIds.has(t.id);
      });
 
      // Перебудовуємо menu тестів
      const gbTestMenu = document.getElementById("cd-gb-test-menu");
      const gbTestSel  = document.getElementById("gb-test");
      const curTestId  = window._gbTestF || gbTestSel?.value || "";
      // Чи актуальний обраний тест ще доступний у новому списку?
      const stillValid = curTestId && filteredTests.some(t => t.id === curTestId);
 
      if (gbTestMenu){
        gbTestMenu.innerHTML =
          `<div class="cd-item${!stillValid ? " cd-active" : ""}" data-val="" onclick="G.selectGbFilter('test','','Всі тести')">Всі тести</div>` +
          filteredTests.map(t =>
            `<div class="cd-item${(stillValid && curTestId === t.id) ? " cd-active" : ""}" data-val="${t.id}" onclick="G.selectGbFilter('test','${t.id}',${jsq(t.title)})">${esc(t.title)}</div>`
          ).join("");
      }
 
      // Перебудовуємо <select> теж
      if (gbTestSel){
        gbTestSel.innerHTML = `<option value="">Всі тести</option>` +
          filteredTests.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join("");
        gbTestSel.value = stillValid ? curTestId : "";
      }
 
      // Якщо обраний тест більше не валідний — скидаємо лейбл і active state
      if (!stillValid){
        const testLbl = document.getElementById("cd-gb-test-label");
        if (testLbl) testLbl.textContent = "Всі тести";
        const testBtn = document.querySelector("#cd-gb-test .cd-btn");
        testBtn?.classList.remove("active");
        window._gbTestF = "";
      }
    }
 
    G.renderGradebook && G.renderGradebook();
  },
 

  renderGradebook(){
    const body=document.getElementById("gradebook-body");
    if(!body) return;
    // Читаємо активний елемент з меню (найнадійніший спосіб)
    const activeTestEl=document.querySelector("#cd-gb-test-menu .cd-item.cd-active");
    const activeGrpEl=document.querySelector("#cd-gb-group-menu .cd-item.cd-active");
    const testF=activeTestEl?.dataset?.val||"";
    const groupF=activeGrpEl?.dataset?.val||"";

    // Кнопки експорту працюють лише коли обрано групу
    const csvBtn=document.getElementById("gb-export-csv");
    const htmlBtn=document.getElementById("gb-export-html");
    if(csvBtn)  csvBtn.disabled=!groupF;
    if(htmlBtn) htmlBtn.disabled=!groupF;

    // Поки не обрано групу — не рахуємо і не рендеримо журнал по УСІХ спробах
    // одразу (це і є те, що гальмувало сторінку при завантаженні).
    if(!groupF){
      body.innerHTML=`<div class="empty" style="padding:80px 20px">
        <div class="ei">👥</div>
        <div class="et">Оберіть групу</div>
        <div class="es">Щоб побачити журнал, виберіть групу</div>
      </div>`;
      return;
    }

    let att=attempts.filter(a=>a.status==="completed"||a.status==="pending_review");
    att=att.filter(a=>{const l=links.find(x=>x.id===a.linkId);return (l?.group||"")===groupF;});
    if(testF)  att=att.filter(a=>a.testId===testF);

    if(!att.length){
      body.innerHTML=`<div class="empty" style="padding:80px 20px"><div class="ei">📋</div><div class="et">Немає завершених спроб</div><div class="es">У цій групі поки немає результатів для журналу</div></div>`;
      return;
    }

    // Студенти — беремо найкращу оцінку по кожному тесту
    const studentMap={};
    att.forEach(a=>{
      const key=`${a.surname}|||${a.name}`;
      if(!studentMap[key]) studentMap[key]={name:a.name,surname:a.surname,attempts:{}};
      const prev=studentMap[key].attempts[a.testId];
      if(!prev || (a.grade12!=null && (prev.grade==null || a.grade12>prev.grade)))
        studentMap[key].attempts[a.testId]={grade:a.grade12,status:a.status,id:a.id};
    });

    const usedTestIds=testF?[testF]:[...new Set(att.map(a=>a.testId))];
    const usedTests=usedTestIds.map(id=>tests.find(t=>t.id===id)).filter(Boolean);
    const students=Object.values(studentMap).sort((a,b)=>a.surname.localeCompare(b.surname,"uk"));

    // Статистика по тестах (для підсумкового рядка)
    const testStats=usedTests.map(t=>{
      const grades=students.map(s=>s.attempts[t.id]?.grade).filter(g=>g!=null);
      const avg=grades.length?Math.round(grades.reduce((s,g)=>s+g,0)/grades.length*10)/10:null;
      const pass=grades.filter(g=>g>=4).length;
      return {avg,pass,total:grades.length};
    });

    const gradeColor=g=>g>=10?"#0d9e85":g>=7?"#2d5be3":g>=4?"#f59e0b":"#f43f5e";
    const gradeBg=g=>g>=10?"rgba(13,158,133,.1)":g>=7?"rgba(45,91,227,.1)":g>=4?"rgba(245,158,11,.1)":"rgba(244,63,94,.1)";

    const thCells=usedTests.map((t,i)=>{
      const st=testStats[i];
      return `<th style="padding:10px 12px;font-size:12px;font-weight:600;text-align:center;min-width:110px;max-width:150px;color:var(--text)">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px" title="${esc(t.title)}">${esc(t.title.length>18?t.title.substring(0,18)+"…":t.title)}</div>
        ${st.avg!=null?`<div style="font-size:10px;color:var(--muted);font-weight:400">${st.pass}/${st.total} здали · ø${st.avg}</div>`:""}
      </th>`;
    }).join("");

    const rows=students.map((s,si)=>{
      const cells=usedTests.map(t=>{
        const a_=s.attempts[t.id];
        if(!a_) return `<td style="padding:10px 12px;text-align:center"><span style="color:var(--border);font-size:18px">·</span></td>`;
        if(a_.status==="pending_review") return `<td style="padding:10px 12px;text-align:center"><span style="font-size:13px" title="Очікує перевірки">⏳</span></td>`;
        const g=a_.grade!=null?a_.grade:0;
        return `<td style="padding:8px 12px;text-align:center;cursor:pointer" onclick="G.viewAtt('${a_.id}')">
          <div style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:28px;border-radius:8px;background:${gradeBg(g)};color:${gradeColor(g)};font-weight:700;font-size:13px;transition:all .15s"
            onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform=''">${g}</div>
        </td>`;
      }).join("");

      // Середня оцінка студента
      const grds=usedTests.map(t=>s.attempts[t.id]?.grade).filter(g=>g!=null);
      const avg=grds.length?Math.round(grds.reduce((s,g)=>s+g,0)/grds.length*10)/10:null;
      const avgCol=avg!=null?gradeColor(avg):"var(--muted)";

      return `<tr style="border-top:1px solid rgba(229,232,240,.6);transition:background .1s" onmouseover="this.style.background='rgba(45,91,227,.02)'" onmouseout="this.style.background=''">
        <td style="padding:12px 16px;white-space:nowrap">
          <div style="font-weight:600;font-size:14px">${esc(s.surname)} ${esc(s.name)}</div>
        </td>
        ${cells}
        <td style="padding:12px 16px;text-align:center">
          ${avg!=null?`<div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:16px;color:${avgCol}">${avg}</div><div style="font-size:10px;color:var(--muted)">середня</div>`:`<span style="color:var(--border)">—</span>`}
        </td>
      </tr>`;
    }).join("");

    body.innerHTML=`
      <!-- Метрики -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
        <div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:16px 20px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;margin-bottom:8px">Студентів</div>
          <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:32px;color:var(--primary);line-height:1">${students.length}</div>
        </div>
        <div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:16px 20px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;margin-bottom:8px">Тестів</div>
          <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:32px;color:#9333ea;line-height:1">${usedTests.length}</div>
        </div>
        <div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:16px 20px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;margin-bottom:8px">Спроб всього</div>
          <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:32px;color:#f59e0b;line-height:1">${att.length}</div>
        </div>
        <div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:16px 20px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;margin-bottom:8px">Здали (≥4)</div>
          <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:32px;color:#0d9e85;line-height:1">${att.filter(a=>a.grade12>=4).length}</div>
        </div>
      </div>

      <!-- Таблиця -->
      <div style="background:#fff;border:1.5px solid var(--border);border-radius:18px;overflow:hidden">
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:500px">
            <thead>
              <tr style="background:rgba(45,91,227,.03)">
                <th style="padding:12px 16px;font-size:12px;font-weight:700;text-align:left;color:var(--text);min-width:180px;border-bottom:1.5px solid var(--border)">Студент</th>
                ${thCells.replace(/border-bottom:[^;]+;/g,'')} <!-- fix double border -->
                <th style="padding:12px 16px;font-size:12px;font-weight:700;text-align:center;color:var(--text);border-bottom:1.5px solid var(--border);min-width:80px">Середня</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:10px;display:flex;align-items:center;gap:12px">
        <span>⏳ — очікує перевірки</span>
        <span>· — не проходив</span>
        <span>Натисніть на оцінку щоб переглянути деталі</span>
      </div>`;
  },

  async exportGradebook(format='csv'){
    // Читаємо активний елемент з меню (найнадійніший спосіб)
    const activeTestEl=document.querySelector("#cd-gb-test-menu .cd-item.cd-active");
    const activeGrpEl=document.querySelector("#cd-gb-group-menu .cd-item.cd-active");
    const testF=activeTestEl?.dataset?.val||"";
    const groupF=activeGrpEl?.dataset?.val||"";
    if(!groupF){ toast("Спочатку виберіть групу","err"); return; }
    let att=attempts.filter(a=>a.status==="completed"||a.status==="pending_review");
    att=att.filter(a=>{const l=links.find(x=>x.id===a.linkId);return (l?.group||"")===groupF;});
    if(testF)  att=att.filter(a=>a.testId===testF);
    if(!att.length){toast("Немає даних для експорту","err");return;}

    const studentMap={};
    att.forEach(a=>{
      const key=`${a.surname}|||${a.name}`;
      if(!studentMap[key]) studentMap[key]={name:a.name,surname:a.surname,attempts:{}};
      const prev=studentMap[key].attempts[a.testId];
      if(!prev||(a.grade12!=null&&(prev===null||a.grade12>prev)))
        studentMap[key].attempts[a.testId]=a.grade12;
    });
    const usedTestIds=testF?[testF]:[...new Set(att.map(a=>a.testId))];
    const usedTests=usedTestIds.map(id=>tests.find(t=>t.id===id)).filter(Boolean);
    const students=Object.values(studentMap).sort((a,b)=>a.surname.localeCompare(b.surname,"uk"));
    const dateStr=new Date().toLocaleDateString("uk-UA");
    const fname="Журнал_"+(groupF||"всі")+"_"+dateStr;

    if(format==="csv"){
      const header=["Прізвище","Ім'я",...usedTests.map(t=>t.title),"Середня"].join(",");
      const csvRows=students.map(s=>{
        const grades=usedTests.map(t=>s.attempts[t.id]!=null?s.attempts[t.id]:"");
        const nums=grades.filter(g=>g!=="");
        const avg=nums.length?(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(1):"";
        return [s.surname,s.name,...grades,avg].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",");
      });
      const csv="\uFEFF"+header+"\n"+csvRows.join("\n");
      const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=fname+".csv";document.body.appendChild(a);a.click();document.body.removeChild(a);
      toast("CSV завантажено ✅");
    } else {
      const thHTML=usedTests.map(t=>`<th>${esc(t.title)}</th>`).join("");
      const rowsHTML=students.map(s=>{
        const cells=usedTests.map(t=>{
          const g=s.attempts[t.id];
          if(g==null) return `<td style="text-align:center;color:#9ca3af">—</td>`;
          const col=g>=10?"#0d9e85":g>=7?"#2d5be3":g>=4?"#f59e0b":"#f43f5e";
          return `<td style="text-align:center;font-weight:700;color:${col}">${g}/12</td>`;
        }).join("");
        const nums=usedTests.map(t=>s.attempts[t.id]).filter(g=>g!=null);
        const avg=nums.length?(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(1):"—";
        return `<tr><td>${esc(s.surname)} ${esc(s.name)}</td>${cells}<td style="text-align:center;font-weight:700">${avg}</td></tr>`;
      }).join("");

      const html=`<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<title>Журнал оцінок — ${esc(groupF||"Всі групи")} — ${dateStr}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Arial',sans-serif;padding:40px;background:#f5f7fa;color:#0d1340}
  h1{font-size:24px;font-weight:700;margin-bottom:4px}
  .meta{font-size:13px;color:#6b7280;margin-bottom:28px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px}
  .stat-card{background:white;border-radius:12px;padding:16px 20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .stat-n{font-size:28px;font-weight:900;line-height:1}
  .stat-l{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-top:4px}
  table{width:100%;border-collapse:collapse;background:white;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)}
  th{background:#1e2d6b;color:white;padding:13px 16px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;text-align:left}
  th:not(:first-child){text-align:center}
  td{padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px}
  td:not(:first-child){text-align:center}
  tr:last-child td{border-bottom:none}
  tr:nth-child(even) td{background:#f9faff}
  .footer{margin-top:20px;font-size:12px;color:#9ca3af;text-align:center}
</style></head><body>
<h1>Журнал оцінок${groupF?" — "+esc(groupF):""}</h1>
<div class="meta">Сформовано ${dateStr} · ${students.length} студентів · ${usedTests.length} тестів · QuizFlow</div>
<div class="stats">
  <div class="stat-card"><div class="stat-n" style="color:#2d5be3">${students.length}</div><div class="stat-l">Студентів</div></div>
  <div class="stat-card"><div class="stat-n" style="color:#0d9e85">${att.filter(a=>a.grade12>=4).length}</div><div class="stat-l">Склали (≥4)</div></div>
  <div class="stat-card"><div class="stat-n" style="color:#f59e0b">${att.length}</div><div class="stat-l">Всього спроб</div></div>
</div>
<table><thead><tr><th>Студент</th>${thHTML}<th>Середня</th></tr></thead>
<tbody>${rowsHTML}</tbody></table>
<div class="footer">QuizFlow — система тестування · ${dateStr}</div>
</body></html>`;

      const blob=new Blob([html],{type:"text/html;charset=utf-8"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=fname+".html";document.body.appendChild(a);a.click();document.body.removeChild(a);
      toast("HTML завантажено ✅");
    }
  }

,
  // ─── SHARE TEST ──────────────────────────────────────────────────────────────
  _shareTestId: null,
  _shareSelectedUid: null,

  _shareUsers: [],

  _renderShareList(query=""){
    const list=document.getElementById("share-teachers-list");
    if(!list) return;
    const q=query.toLowerCase().trim();
    const filtered=q
      ? G._shareUsers.filter(u=>(u.name||u.login).toLowerCase().includes(q)||u.login.toLowerCase().includes(q))
      : G._shareUsers;

    if(!filtered.length){
      list.innerHTML="<div style='color:var(--muted);font-size:13px;text-align:center;padding:16px'>Нікого не знайдено</div>";
      return;
    }

    list.innerHTML=filtered.map(u=>{
      const initials=(u.name||u.login).slice(0,2).toUpperCase();
      const isSelected=G._shareSelectedUid===u.id;
      return `<div data-uid="${u.id}" onclick="G._selectShareTeacher('${u.id}')"
        style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1.5px solid ${isSelected?"var(--primary)":"var(--border)"};background:${isSelected?"rgba(45,91,227,.05)":""};cursor:pointer;transition:all .15s"
        onmouseover="if('${u.id}'!==G._shareSelectedUid)this.style.borderColor='rgba(45,91,227,.3)'"
        onmouseout="if('${u.id}'!==G._shareSelectedUid)this.style.borderColor='var(--border)'">
        <div style="width:36px;height:36px;border-radius:10px;background:var(--grad);display:flex;align-items:center;justify-content:center;font-family:Syne,sans-serif;font-weight:700;font-size:13px;color:#fff;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">${esc(u.name||u.login)}</div>
          <div style="font-size:12px;color:var(--muted);font-family:monospace">@${esc(u.login)}</div>
        </div>
        ${isSelected?`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`:""}
      </div>`;
    }).join("");
  },

  _selectShareTeacher(uid){
    G._shareSelectedUid=uid;
    G._renderShareList(document.getElementById("share-srch")?.value||"");
  },

  _filterShareTeachers(q){
    G._renderShareList(q);
  },

  async openShareModal(testId, testTitle){
    G._shareTestId = testId;
    G._shareSelectedUid = null;
    G._shareUsers = [];
    document.getElementById("share-test-name").textContent = testTitle;
    document.getElementById("share-err").textContent = "";
    const srch=document.getElementById("share-srch");
    if(srch) srch.value="";
    const btn=document.getElementById("share-btn");
    btn.disabled=false; btn.textContent="Поділитись →";
    const list=document.getElementById("share-teachers-list");
    list.innerHTML="<div style='color:var(--muted);font-size:14px;text-align:center;padding:20px'>Завантаження...</div>";
    openM("m-share");
    try{
      const {get:_g,ref:_r}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const snap=await _g(_r(db,"users"));
      if(!snap.exists()){ list.innerHTML="<div style='color:var(--muted);font-size:14px'>Немає викладачів</div>"; return; }
      G._shareUsers=Object.entries(snap.val()).map(([id,u])=>({id,...u})).filter(u=>u.id!==_uid&&!u.blocked);
      if(!G._shareUsers.length){ list.innerHTML="<div style='color:var(--muted);font-size:14px;padding:12px 0'>Немає інших викладачів</div>"; return; }
      G._renderShareList();
    }catch(e){ list.innerHTML="<div style='color:#be123c;font-size:13px'>"+esc(e.message)+"</div>"; }
  },

  async doShareTest(){
    const errEl=document.getElementById("share-err");
    if(!G._shareSelectedUid){ errEl.textContent="Оберіть викладача"; return; }
    const test=tests.find(t=>t.id===G._shareTestId);
    if(!test) return;
    const btn=document.getElementById("share-btn");
    btn.disabled=true; btn.textContent="⏳ Надсилаю...";
    try{
      const {push:_p,ref:_r,set:_s}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const newRef=_p(_r(db,"teachers/"+G._shareSelectedUid+"/tests"));
      await _s(newRef,{
        title:test.title, description:test.description||"",
        questions:test.questions||[], timeLimit:test.timeLimit||600,
        status:"draft", folderId:null, tags:test.tags||[],
        sharedFrom:_user.name||_user.login, sharedAt:ts(), createdAt:ts()
      });
      const nRef=_p(_r(db,"teachers/"+G._shareSelectedUid+"/notifications"));
      const senderName=esc(_user.name||_user.login);
      const testName=esc(test.title);
      await _s(nRef,{
        icon:"🔗",
        title:"Новий тест від "+senderName,
        msg:"<strong>"+senderName+"</strong> поділився тестом «<strong>"+testName+"</strong>»",
        color:"#2d5be3", read:false, ts:ts(),
        sharedTestId: newRef.key,
        actionLabel: "Відкрити тест →"
      });
      closeM("m-share");
      toast("Тест надіслано ✅");
    }catch(e){ errEl.textContent="Помилка: "+e.message; btn.disabled=false; btn.textContent="Поділитись →"; }
  }
,

 renderAnalytics(){
    const testId = document.getElementById("an-test")?.value || "";
    const groupF = document.getElementById("an-group")?.value || "";
    const body   = document.getElementById("analytics-body");
    if(!body) return;

    // Оновлюємо chip-meta
    const chip = document.getElementById("a-chip");

    // Поки не обрано групу — не рахуємо аналітику по УСІХ спробах одразу
    // (саме це гальмувало відкриття сторінки).
    if(!groupF){
      if (chip) chip.textContent = "Оберіть групу";
      body.innerHTML = `<div class="a-empty">
        <div class="a-empty-ico">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="a-empty-title">Оберіть групу</div>
        <div class="a-empty-hint">Щоб побачити аналітику, виберіть групу</div>
      </div>`;
      return;
    }
    if (chip){
      const t = tests.find(x => x.id === testId);
      const parts = [];
      if (t) parts.push(t.title);
      if (groupF) parts.push(groupF);
      chip.textContent = parts.length ? parts.join(" · ") : "Дані за весь період";
    }

    // Фільтруємо спроби
    let att = attempts.filter(a => a.status === "completed" || a.status === "pending_review");
    if(testId)  att = att.filter(a => a.testId === testId);
    att = att.filter(a => { const l=links.find(x=>x.id===a.linkId); return (l?.group||"") === groupF; });
 
    if(!att.length){
      body.innerHTML = `<div class="a-empty">
        <div class="a-empty-ico">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/></svg>
        </div>
        <div class="a-empty-title">Немає даних для відображення</div>
        <div class="a-empty-hint">Оберіть інший тест або змініть фільтри</div>
      </div>`;
      return;
    }
 
    const completed = att.filter(a=>a.status==="completed");
    const grades    = completed.map(a=>a.grade12).filter(g=>g!=null);
    const avgGrade  = grades.length ? (grades.reduce((s,g)=>s+g,0)/grades.length).toFixed(1) : "—";
    const maxGrade  = grades.length ? Math.max(...grades) : "—";
    const minGrade  = grades.length ? Math.min(...grades) : "—";
    const passCount = grades.filter(g=>g>=4).length;
    const failCount = grades.filter(g=>g<4).length;
    const passRate  = grades.length ? Math.round(passCount/grades.length*100) : 0;
 
    // Розподіл оцінок 1-12
    const dist = Array.from({length:12},(_,i)=>({grade:i+1,count:grades.filter(g=>g===i+1).length}));
    const maxCount = Math.max(...dist.map(d=>d.count),1);
 
    // Кольори для оцінок
    const gradeColor = g => g>=10?"#16A34A":g>=7?"#1E40AF":g>=4?"#F59E0B":"#DC2626";
    const gradePillCls = g => g>=10?"g-best":g>=7?"g-good":g>=4?"g-mid":"g-bad";
 
    // Sparklines (декоративні, статичні — щоб KPI не виглядали голими)
    const spark = (color, points) => `<svg class="a-kpi-spark" width="130" height="42" viewBox="0 0 130 42">${points}</svg>`;
 
    body.innerHTML = `
      <!-- KPI -->
      <div class="a-kpi-grid">
 
        <div class="a-kpi">
          <div class="a-kpi-l">Всього спроб</div>
          <div class="a-kpi-v info">${att.length}</div>
          <div class="a-kpi-d"><span>${completed.length} завершено</span><span>·</span><span>${att.length-completed.length} на перевірці</span></div>
          ${spark("#3B82F6", `<polyline points="0,32 18,28 36,30 54,22 72,24 90,16 108,18 130,12" fill="none" stroke="#3B82F6" stroke-width="2.2"/>`)}
        </div>
 
        <div class="a-kpi">
          <div class="a-kpi-l">Середня оцінка</div>
          <div class="a-kpi-v ${avgGrade!=="—"?gradePillCls(parseFloat(avgGrade)):""}">${avgGrade}${avgGrade!=="—"?'<span style="font-size:14px;font-weight:600;color:var(--ink-400);margin-left:2px">/12</span>':""}</div>
          <div class="a-kpi-d"><span>мін: <b style="color:var(--ink-700);font-family:'Geist Mono',monospace;font-weight:700">${minGrade}</b></span><span>·</span><span>макс: <b style="color:var(--ink-700);font-family:'Geist Mono',monospace;font-weight:700">${maxGrade}</b></span></div>
          ${spark("#1E40AF", `<polyline points="0,30 18,26 36,28 54,22 72,18 90,20 108,14 130,10" fill="none" stroke="#1E40AF" stroke-width="2.2"/>`)}
        </div>
 
        <div class="a-kpi">
          <div class="a-kpi-l">Здали (≥4)</div>
          <div class="a-kpi-v ok">${passCount}</div>
          <div class="a-kpi-d"><span class="pos">${passRate}%</span><span>від завершених</span></div>
          ${spark("#16A34A", `<polyline points="0,34 18,30 36,28 54,22 72,24 90,16 108,12 130,8" fill="none" stroke="#16A34A" stroke-width="2.2"/>`)}
        </div>
 
        <div class="a-kpi">
          <div class="a-kpi-l">Не здали (&lt;4)</div>
          <div class="a-kpi-v bad">${failCount}</div>
          <div class="a-kpi-d"><span class="neg">${grades.length?100-passRate:0}%</span><span>від завершених</span></div>
          ${spark("#DC2626", `<polyline points="0,18 18,22 36,16 54,24 72,18 90,26 108,22 130,30" fill="none" stroke="#DC2626" stroke-width="2.2"/>`)}
        </div>
 
      </div>
 
      <!-- Розподіл оцінок -->
      <div class="a-card">
        <div class="a-card-h">
          <h3>Розподіл оцінок</h3>
          <span class="a-card-h-meta">шкала 1–12 балів</span>
        </div>
        <div class="a-card-body">
          <div class="a-dist">
            ${dist.map(d=>{
              const h = d.count ? Math.max(8, Math.round(d.count/maxCount*120)) : 0;
              const col = gradeColor(d.grade);
              return `<div class="a-dist-col">
                <div class="a-dist-cnt" style="color:${d.count?col:"transparent"}">${d.count||"·"}</div>
                <div class="a-dist-bar-wrap">
                  <div class="a-dist-bar" style="background:${col};height:${h}px;opacity:${d.count?1:0}"></div>
                </div>
                <div class="a-dist-grade">${d.grade}</div>
              </div>`;
            }).join("")}
          </div>
          <div class="a-dist-legend">
            <div class="a-dist-legend-item"><i style="background:#16A34A"></i>Відмінно (10–12)</div>
            <div class="a-dist-legend-item"><i style="background:#1E40AF"></i>Добре (7–9)</div>
            <div class="a-dist-legend-item"><i style="background:#F59E0B"></i>Задовільно (4–6)</div>
            <div class="a-dist-legend-item"><i style="background:#DC2626"></i>Незадовільно (1–3)</div>
          </div>
        </div>
      </div>
 
      <!-- Топ студентів -->
      ${completed.length ? `
      <div class="a-card">
        <div class="a-card-h">
          <h3>Результати студентів</h3>
          <span class="a-card-h-meta">${completed.length} ${completed.length===1?"запис":(completed.length>=2&&completed.length<=4)?"записи":"записів"}</span>
        </div>
        <table class="a-tbl">
          <thead><tr>
            <th class="a-rank" style="width:40px">#</th>
            <th>Студент</th>
            <th style="width:90px">Оцінка</th>
            <th style="width:70px">%</th>
            <th>Група</th>
            <th>Дата</th>
          </tr></thead>
          <tbody>
            ${[...completed].sort((a,b)=>(b.grade12||0)-(a.grade12||0)).map((a,i)=>{
              const g=a.grade12||0;
              const l=links.find(x=>x.id===a.linkId);
              const dateStr=a.createdAt?new Date(a.createdAt).toLocaleDateString("uk-UA",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
              const pillCls=gradePillCls(g);
              const pct = a.score?.percent ?? 0;
              const pctColor = pct>=70?"#15803D":pct>=40?"#1E40AF":"#B91C1C";
              return `<tr>
                <td class="a-rank">${i+1}</td>
                <td><span class="a-stud">${esc(a.surname||"")} ${esc(a.name||"")}</span></td>
                <td><span class="a-grade-pill ${pillCls}">${g}/12</span></td>
                <td class="a-mono" style="font-weight:700;color:${pctColor}">${pct}%</td>
                <td>${esc(l?.group||"—")}</td>
                <td class="a-mono" style="color:var(--ink-500);font-size:12px;white-space:nowrap">${dateStr}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ` : ""}
    `;
  },

  showStats(testId){
    showSec("analytics");
    const sel=document.getElementById("an-test");
    if(sel){ sel.value=testId; }
    const lbl=document.getElementById("cd-an-test-label");
    const t=tests.find(x=>x.id===testId);
    if(lbl&&t) lbl.textContent=t.title;
    window.G.renderAnalytics&&window.G.renderAnalytics();
  },

  // ── Attempt deletion ──────────────────────────────────────────────────────
  confDelAttempt(id, name){ G.confDelAttempts([id], name); },
  // Видалення однієї чи кількох спроб — одним записом у базу
  confDelAttempts(ids, name){
    ids = (ids || []).filter(Boolean); if (!ids.length) return;
    window._delAttIds = ids;
    const one = ids.length === 1;
    const nm = one ? (name || (() => { const a = attempts.find(x => x.id === ids[0]); return a ? `${a.surname || ""} ${a.name || ""}`.trim() : ""; })()) : "";
    const t = $("del-att-title"); if (t) t.textContent = one ? "Видалити спробу?" : `Видалити ${ids.length} ${_plural(ids.length, "спробу", "спроби", "спроб")}?`;
    const x = $("del-att-text");
    if (x) x.innerHTML = one ? `Спробу студента <strong>${esc(nm || "без імені")}</strong> буде видалено назавжди — разом з відповідями й оцінкою.`
      : `Вибрані спроби буде видалено назавжди — разом з відповідями й оцінками.`;
    openM("m-del-attempt");
  },
  async doDelAttempt(){
    const ids = window._delAttIds || []; if (!ids.length) return;
    window._delAttIds = null;
    closeM("m-del-attempt");
    try{
      if (ids.length === 1) await dbDel(`attempts/${ids[0]}`);
      else await dbUpd("attempts", Object.fromEntries(ids.map(id => [id, null])));
      const gone = new Set(ids);
      attempts = attempts.filter(a => !gone.has(a.id)); window.attempts = attempts;
      ids.forEach(id => AT.sel.delete(id));
      renderAll();
      toast(ids.length === 1 ? "Спробу видалено" : `Видалено ${ids.length} ${_plural(ids.length, "спробу", "спроби", "спроб")}`);
    }catch(e){ toast("Помилка: "+e.message,"err"); }
  },

  async setLongAnswer(attId, qIdx, result){
    const a=attempts.find(x=>x.id===attId);
    if(!a) return;
    const pts=result==="correct"?1:result==="partial"?0.5:0;
    const details=a.score?.details?[...a.score.details]:[];
    while(details.length<=qIdx) details.push({});
    details[qIdx]={...(details[qIdx]||{}),longResult:result,points:pts};
    try{
      await dbUpd(`attempts/${attId}`,{"score/details":details});
      if(!a.score) a.score={};
      a.score.details=details;
      // Оновлюємо вміст модалки без закриття
      G.viewAtt(attId);
    }catch(e){ toast("Помилка: "+e.message,"err"); }
  },

  async setManualGrade(attId, grade){
    const a=attempts.find(x=>x.id===attId);
    if(!a) return;
    const btn=document.querySelector(`[onclick="G.setManualGrade('${attId}',${grade})"]`);
    // Підсвічуємо вибрану кнопку
    document.querySelectorAll(`[onclick^="G.setManualGrade('${attId}'"]`).forEach(b=>{
      b.style.outline="none";
    });
    if(btn){ btn.style.outline="3px solid #2d5be3"; btn.style.outlineOffset="2px"; }
    ldr(true);
    try{
      await dbUpd(`attempts/${attId}`,{grade12:grade,status:"completed"});
      a.grade12=grade; a.status="completed";
      // Оновлюємо списки без закриття модалки
      try{ renderAttemptRows && renderAttemptRows(); }catch(_){}
      try{ renderDashboard && renderDashboard(); }catch(_){}
      // Перерендеримо вміст модалки
      G.viewAtt(attId);
      toast(`Оцінка ${grade}/12 виставлена ✅`);
    }catch(e){ toast("Помилка: "+e.message,"err"); }
    finally{ ldr(false); }
  }}

// ─── Знайомство з платформою (onboarding.html) ─────────────────────────
// Новий викладач потрапляє туди одразу після реєстрації. Якщо знайомство не
// завершили — один раз перенаправляємо з головної, але лише для свіжих акаунтів
// (старі викладачі його ніколи не бачили, і нав'язувати його їм не треба).
window.openOnboarding = () => { location.href = "onboarding"; };
async function checkOnboarding(){
  try{
    const onDash = /\/(index(\.html)?)?$/.test(location.pathname);
    const key = "qf_ob_seen_" + _uid;
    if (!onDash || localStorage.getItem(key)) return;
    const [done, created] = await Promise.all([dbGet("meta/onboardingDone"), get(ref(db, `users/${_uid}/createdAt`))]);
    if (done.val() === true) return;
    const fresh = (Date.now() - (Number(created.val()) || 0)) < 14 * 864e5;
    localStorage.setItem(key, "1");
    if (fresh) location.href = "onboarding";
  }catch{}
}

// ─── NEWS ────────────────────────────────────────────────────────────────────
// Новини пише адмін (admin/news). Чернетки (draft:true) викладачам не показуються,
// HTML завжди очищається білим списком перед показом (shared/news-utils.js).
let _newsItems = [];
let _readNews = new Set();
let _newsFilter = "all", _newsQuery = "";

async function loadTeacherNews(){
  try{
    const {get:_g,ref:_r}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const [readRaw, newsSnap] = await Promise.all([
      _g(_r(db,"teachers/"+_uid+"/meta/readNews")).catch(()=>null),
      _g(_r(db,"news")),
    ]);
    if(readRaw&&readRaw.exists()){
      const rv=readRaw.val();
      _readNews=new Set(Array.isArray(rv)?rv:Object.values(rv));
    }
    _newsItems = newsSnap.exists()
      ? Object.entries(newsSnap.val()).map(([id,v])=>({id,...v})).filter(isPublished)
          .sort((a,b)=>(!!b.pinned-!!a.pinned) || ((b.publishedAt||b.createdAt||0)-(a.publishedAt||a.createdAt||0)))
      : [];
    renderNews();
    updateNewsBadge();
  }catch(e){ console.warn("loadTeacherNews:",e.message); }
}

const _newsDate = (n, opts) => { const t = n.publishedAt || n.createdAt; return t ? new Date(t).toLocaleDateString("uk-UA", opts || { day:"numeric", month:"long", year:"numeric" }) : ""; };
const _newsCatPill = n => { const c = catOf(n); return c ? `<span class="nw-cat" style="--c:${c.color};--cb:${c.bg}">${esc(c.label)}</span>` : ""; };

function updateNewsBadge(){
  const unread=_newsItems.filter(n=>!_readNews.has(n.id)).length;
  const badge=$("nb-news");
  if(badge){ badge.textContent=unread; badge.style.display=unread>0?"":"none"; }
  const dashBlock=$("dash-news-block");
  const dashBadge=$("dash-news-badge");
  if(dashBlock){
    if(_newsItems.length>0){
      dashBlock.style.display="block";
      if(dashBadge){ dashBadge.textContent=unread; dashBadge.style.display=unread>0?"":"none"; }
      renderDashNews();
    } else { dashBlock.style.display="none"; }
  }
}

function renderDashNews(){
  const cont=$("dash-news-items");
  if(!cont) return;
  cont.innerHTML=_newsItems.slice(0,3).map(n=>{
    const isRead=_readNews.has(n.id);
    const c=catOf(n);
    return `<button type="button" class="dn-item${isRead?"":" unread"}" onclick="openNews('${esc(n.id)}')">
      <span class="dn-top">${isRead?"":`<span class="dn-dot"></span>`}<span class="dn-title">${esc(n.title||"")}</span><span class="dn-date">${esc(_newsDate(n,{day:"numeric",month:"short"}))}</span></span>
      <span class="dn-ex">${c?`<b style="color:${c.color}">${esc(c.label)}</b> · `:""}${esc(newsExcerpt(n,80))}</span>
    </button>`;
  }).join("");
}

function renderNews(){
  const list = $("news-teacher-list");
  if (!list) return;

  const total   = _newsItems.length;
  const pinned  = _newsItems.filter(n => n.pinned).length;
  const unread  = _newsItems.filter(n => !_readNews.has(n.id)).length;
  const setT = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setT("nw-cnt-total", total); setT("nw-cnt-pinned", pinned); setT("nw-cnt-unread", unread);

  const chip = $("nw-status-chip");
  if (chip){
    chip.className = "nw-chip" + (unread ? " unread" : "");
    chip.textContent = unread ? `${unread} непрочитан${unread === 1 ? "а" : (unread % 10 >= 2 && unread % 10 <= 4 && (unread % 100 < 10 || unread % 100 >= 20) ? "і" : "их")}` : (total ? "Усе прочитано" : "Поки тихо");
  }
  const markAll = $("nw-mark-all");
  if (markAll) markAll.hidden = !unread;
  document.querySelectorAll("#nw-filter [data-f]").forEach(b => { b.classList.toggle("on", b.dataset.f === _newsFilter); b.setAttribute("aria-selected", b.dataset.f === _newsFilter); });
  const cntU = $("nw-f-unread"); if (cntU) cntU.textContent = unread || "";

  if (!total){
    list.innerHTML = `<div class="nw-empty">
      <div class="ei"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 9h6M7 13h6M7 17h4"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/></svg></div>
      <div class="et">Поки що тут тихо</div>
      <div class="es">Тут з'являтимуться оновлення продукту, нові функції та інша важлива інформація від команди QuizFlow.</div>
    </div>`;
    return;
  }

  const q = _newsQuery.trim().toLowerCase();
  const items = _newsItems.filter(n => (_newsFilter !== "unread" || !_readNews.has(n.id))
    && (!q || (n.title || "").toLowerCase().includes(q) || newsPlainText(n.text).toLowerCase().includes(q)));
  if (!items.length){
    list.innerHTML = `<div class="nw-empty small"><div class="et">${q ? "Нічого не знайдено" : "Усе прочитано 🎉"}</div><div class="es">${q ? "Спробуйте інший запит" : "Нових повідомлень немає — перегляньте всі новини"}</div></div>`;
    return;
  }

  const NEWS_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 9h6M7 13h6M7 17h4"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/></svg>';
  const hero = !q && _newsFilter === "all" ? items.find(n => n.pinned) : null;
  const rest = hero ? items.filter(n => n !== hero) : items;
  let html = "";

  if (hero){
    const isUnread = !_readNews.has(hero.id), c = catOf(hero);
    html += `<button type="button" class="nw-hero" onclick="openNews('${esc(hero.id)}')" style="${c ? `--hc:${c.color}` : ""}">
      <div class="nw-hero-cover">
        <div style="position:relative;z-index:1">
          <span class="nw-hero-tag">★ Закріплено${c ? ` · ${esc(c.label)}` : ""}</span>
          <div class="nw-hero-title">${esc(hero.title || "—")}</div>
        </div>
      </div>
      <div class="nw-hero-body">
        <p>${esc(newsExcerpt(hero, 260))}</p>
        <div class="nw-hero-foot">
          <span class="item">${esc(_newsDate(hero))}</span>
          <span class="item">${readMinutes(hero.text)} хв читання</span>
          ${isUnread ? `<span class="item" style="color:var(--nav-accent);font-weight:700">● Не прочитано</span>` : ""}
          <span class="item" style="margin-left:auto;color:var(--nav-600);font-weight:700">Читати →</span>
        </div>
      </div>
    </button>`;
    if (rest.length) html += `<div class="nw-section-l">Інші публікації</div>`;
  }

  html += `<div class="nw-list">${rest.map(n => {
    const isUnread = !_readNews.has(n.id), c = catOf(n);
    return `<button type="button" class="nw-item${isUnread ? " unread" : ""}${n.pinned ? " pinned" : ""}" onclick="openNews('${esc(n.id)}')">
      <span class="nw-thumb" style="${c ? `background:linear-gradient(135deg,${c.color}CC,${c.color})` : ""}">${NEWS_ICON}</span>
      <span class="nw-body">
        <span class="nw-tag">${_newsCatPill(n)}${n.pinned ? `<span class="pinned-mark">★ Закріплено</span>` : ""}</span>
        <span class="nw-title">${isUnread ? `<span class="unread-dot" title="Не прочитано"></span>` : ""}${esc(n.title || "—")}</span>
        <span class="nw-excerpt">${esc(newsExcerpt(n))}</span>
        <span class="nw-foot">
          <span class="read-time">${esc(_newsDate(n, { day:"numeric", month:"short", year:"numeric" }))} · ${readMinutes(n.text)} хв</span>
          <span class="arr"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span>
        </span>
      </span>
    </button>`;
  }).join("")}</div>`;

  list.innerHTML = html;
}

async function _saveReadNews(){
  try{
    const {ref:_r,set:_s}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    await _s(_r(db,"teachers/"+_uid+"/meta/readNews"),Array.from(_readNews));
  }catch(e){ console.warn(e); }
}

// Перегляд новини: категорія, дата, час читання, гортання до попередньої/наступної
window.openNews = async (id) => {
  const idx=_newsItems.findIndex(x=>x.id===id);
  const n=_newsItems[idx];
  if(!n) return;
  const c=catOf(n);
  const cat=$("news-view-cat");
  if(cat){ cat.innerHTML = c ? `<span class="nw-cat" style="--c:${c.color};--cb:${c.bg}">${esc(c.label)}</span>` : `<span class="nw-cat">Новина</span>`; if(n.pinned) cat.innerHTML += `<span class="nw-cat pin">★ Закріплено</span>`; }
  $("news-view-title").textContent=n.title||"";
  $("news-view-text").innerHTML=sanitizeNewsHtml(n.text);
  const when=n.publishedAt||n.createdAt;
  $("news-view-date").textContent=[when?new Date(when).toLocaleDateString("uk-UA",{day:"numeric",month:"long",year:"numeric"}):"", readMinutes(n.text)+" хв читання"].filter(Boolean).join(" · ");
  const prev=$("news-view-prev"), next=$("news-view-next");
  if(prev){ const p=_newsItems[idx-1]; prev.hidden=!p; if(p){ prev.onclick=()=>openNews(p.id); prev.querySelector("span").textContent=p.title||""; } }
  if(next){ const x=_newsItems[idx+1]; next.hidden=!x; if(x){ next.onclick=()=>openNews(x.id); next.querySelector("span").textContent=x.title||""; } }
  if(!$("m-news-view").classList.contains("on")) openM("m-news-view");
  $("news-view-body")?.scrollTo?.(0,0);
  if(!_readNews.has(id)){
    _readNews.add(id);
    updateNewsBadge();
    renderNews();
    _saveReadNews();
  }
};

window.markAllNewsRead = async () => {
  const before=_readNews.size;
  _newsItems.forEach(n=>_readNews.add(n.id));
  if(_readNews.size===before) return;
  updateNewsBadge(); renderNews();
  await _saveReadNews();
  toast("Усі новини позначено прочитаними");
};
window.setNewsFilter = f => { _newsFilter = f; renderNews(); };
window.setNewsQuery = q => { _newsQuery = q; renderNews(); };

// ─── ІНІЦІАЛІЗАЦІЯ ───────────────────────────────────────────────────────────



// ─── Sync declared functions to window (для inline handlers і старого коду) ────
window.renderTests = renderTests;
window.fillSelects = fillSelects;
window.renderAttempts = renderAttempts;
window.renderLinks = renderLinks;

// ─── Real-time listeners (адаптовано з index.html) ───────────────────────
// Нові / завершені спроби → сповіщення. Map замість find() у циклі (було O(n²) на кожну зміну)
function _notifyAttemptChanges(prev, next){
  if (!prev.length) return;
  const byId = new Map(prev.map(a => [a.id, a]));
  for (const na of next){
    const old = byId.get(na.id);
    if (!old && na.status === "completed") showNotification(na, "new");
    else if (old && old.status === "in_progress" && na.status === "completed") showNotification(na, "completed");
    else if (!old && na.status === "in_progress") showNotification(na, "started");
  }
}
function _afterAttemptsChanged(){
  if (typeof renderDashAtt === "function") try { renderDashAtt(); } catch {}
  if (typeof renderAttempts === "function") try { renderAttempts(); } catch {}
  if (typeof renderStats === "function") try { renderStats(); } catch {}
  if (typeof updateBadges === "function") try { updateBadges(); } catch {}
  const sec = document.querySelector(".sec.on")?.id;
  if(sec==="sec-analytics" && window.G?.renderAnalytics) try { window.G.renderAnalytics(); } catch {}
  if(sec==="sec-students" && window.G?.renderStudents) try { window.G.renderStudents(); } catch {}
}
function _afterLinksChanged(){
  if (typeof renderLinks === "function") try { renderLinks(); } catch {}
  if (typeof renderDashLinks === "function") try { renderDashLinks(); } catch {}
  if (typeof renderDashAtt === "function") try { renderDashAtt(); } catch {}
  if (typeof updateBadges === "function") try { updateBadges(); } catch {}
  if (typeof fillSelects === "function") try { fillSelects(); } catch {}
  const sec2 = document.querySelector(".sec.on")?.id;
  if(sec2==="sec-students" && window.G?.renderStudents) try { window.G.renderStudents(); } catch {}
}

function startRealtimeListeners(){
  if (_realtimeActive) return;
  _realtimeActive = true;

  if (window._qfLive){
    // Дані слухає app.js; тут лише збираємо зміни пачкою. Під час тесту кожен студент
    // пише прогрес після кожної відповіді — без пачок сторінка перемальовувалась десятки разів на секунду.
    const pending = new Set();
    let timer = 0;
    const flush = () => {
      timer = 0;
      if (pending.has("attempts")){
        const next = window.attempts || [];
        if (next !== attempts){ _notifyAttemptChanges(attempts, next); attempts = next; }
        _bust(); _afterAttemptsChanged();
      }
      if (pending.has("links")){
        if (window.links !== links) links = window.links || [];
        _bust(); _afterLinksChanged();
      }
      pending.clear();
    };
    document.addEventListener("qf:live", e => {
      pending.add(e.detail.name);
      if (!timer) timer = setTimeout(flush, 200);
    });
  } else {
  onValue(ref(db, tp("attempts")), (snap) => {
    const newAttempts = toArr(snap).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    _notifyAttemptChanges(attempts, newAttempts);
    attempts = newAttempts;
    window.attempts = attempts;
    _bust();  // кеш застарілий — стерти
    // Оновлюємо те що на сторінці є
    if (typeof renderDashAtt === "function") try { renderDashAtt(); } catch {}
    if (typeof renderAttempts === "function") try { renderAttempts(); } catch {}
    if (typeof renderStats === "function") try { renderStats(); } catch {}
    if (typeof updateBadges === "function") try { updateBadges(); } catch {}
    const sec = document.querySelector(".sec.on")?.id;
    if(sec==="sec-analytics" && window.G?.renderAnalytics) try { window.G.renderAnalytics(); } catch {}
    if(sec==="sec-students" && window.G?.renderStudents) try { window.G.renderStudents(); } catch {}
  });

  onValue(ref(db, tp("links")), (snap) => {
    links = toArr(snap).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    window.links = links;
    _bust();
    if (typeof renderLinks === "function") try { renderLinks(); } catch {}
    if (typeof renderDashLinks === "function") try { renderDashLinks(); } catch {}
    if (typeof renderDashAtt === "function") try { renderDashAtt(); } catch {}
    if (typeof updateBadges === "function") try { updateBadges(); } catch {}
    if (typeof fillSelects === "function") try { fillSelects(); } catch {}
    const sec2 = document.querySelector(".sec.on")?.id;
    if(sec2==="sec-students" && window.G?.renderStudents) try { window.G.renderStudents(); } catch {}
  });
  }

  let _prevNotifCount = 0;
  onValue(ref(db, tp("meta/suspReadCount")), (snap) => {
    const suspRead = snap.exists() ? (snap.val()||0) : 0;
    const suspCount = attempts.filter(a=>
      (a.tabSwitches||0)*2+(a.copyAttempts||0)*3+(a.screenshots||0)*5>0
      &&(a.status==="completed"||a.status==="pending_review")
    ).length;
    const suspNew = Math.max(0, suspCount - suspRead);
    const nbS=$("nb-suspicious");
    if(nbS){ nbS.textContent=suspNew; nbS.style.display=suspNew>0?"":"none"; }
  });

  onValue(ref(db, tp("notifications")), (snap) => {
    const all = snap.exists()
      ? Object.entries(snap.val()).map(([id,v])=>({id,...v})).sort((a,b)=>(b.ts||0)-(a.ts||0))
      : [];
    const newCount = all.filter(n=>!n.read).length;
    if(_prevNotifCount > 0 && newCount > _prevNotifCount){
      const newest = all[0];
      playNotifSound(!!(newest?.isWarning));
    }
    _prevNotifCount = newCount;
    _notifications = all;
    window._notifications = _notifications;
    if (typeof updateNotifBadge === "function") try { updateNotifBadge(); } catch {}
    if(document.querySelector("#sec-notifications.on") && window.G?.renderNotifications) {
      try { window.G.renderNotifications(); } catch {}
    }
  });
}

// ─── Ініціалізація features ─────────────────────────────────────────────
// Викликається з кожної сторінки ПІСЛЯ того як дані (tests/links/attempts)
// завантажилися через app.js
window.initFeatures = async function initFeatures(){
  folders = window.folders || [];
  tests = window.tests || [];
  links = window.links || [];
  attempts = window.attempts || [];

  // Ставимо всі потрібні ф-ції на window
  window.folders = folders;
  window.tests = tests;
  window.links = links;
  window.attempts = attempts;
  window._notifications = _notifications;

  // Експонуємо функції
  window.renderAll = (typeof renderAll === "function") ? renderAll : (window.renderAll || (()=>{}));
  window.renderStats = (typeof renderStats === "function") ? renderStats : (window.renderStats || (()=>{}));
  window.updateBadges = (typeof updateBadges === "function") ? updateBadges : (window.updateBadges || (()=>{}));
  window.renderDashAtt = (typeof renderDashAtt === "function") ? renderDashAtt : (window.renderDashAtt || (()=>{}));
  window.renderDashLinks = (typeof renderDashLinks === "function") ? renderDashLinks : (window.renderDashLinks || (()=>{}));
  window.renderDashNews = (typeof renderDashNews === "function") ? renderDashNews : (window.renderDashNews || (()=>{}));
  window.renderNews = (typeof renderNews === "function") ? renderNews : (window.renderNews || (()=>{}));
  window.buildTestRow = (typeof buildTestRow === "function") ? buildTestRow : (window.buildTestRow || (()=>{}));
  window.setFolderFilter = (typeof setFolderFilter === "function") ? setFolderFilter : (window.setFolderFilter || (()=>{}));
  window.callGroq = (typeof callGroq === "function") ? callGroq : (window.callGroq || (()=>{}));
  window.loadStoredNotifs = (typeof loadStoredNotifs === "function") ? loadStoredNotifs : (window.loadStoredNotifs || (async()=>{}));
  window.updateNotifBadge = (typeof updateNotifBadge === "function") ? updateNotifBadge : (window.updateNotifBadge || (()=>{}));
  window.loadTeacherNews = (typeof loadTeacherNews === "function") ? loadTeacherNews : (window.loadTeacherNews || (async()=>{}));
  window.updateNewsBadge = (typeof updateNewsBadge === "function") ? updateNewsBadge : (window.updateNewsBadge || (()=>{}));
  window.checkOnboarding = (typeof checkOnboarding === "function") ? checkOnboarding : (window.checkOnboarding || (()=>{}));
  window.renderDashTests = (typeof renderDashTests === "function") ? renderDashTests : (window.renderDashTests || (()=>{}));
  // Завантажуємо збережені нотифікації
  if (typeof loadStoredNotifs === "function") {
    try { await loadStoredNotifs(); } catch(e) { console.warn("loadStoredNotifs:", e); }
  }
  if (typeof loadTeacherNews === "function") {
    try { await loadTeacherNews(); } catch(e) { console.warn("loadTeacherNews:", e); }
  }

  // Запускаємо real-time
  startRealtimeListeners();

  // Онбординг
  setTimeout(()=>{ if(typeof checkOnboarding==="function") checkOnboarding(); }, 300);
};
// ─── Helpers для нового дизайну ────────────────────────────────────────

// Avatar: ініціали + детермінований колір (hash по імені)
function _attAva(name, surname){
  const initials = ((surname?.[0] || "") + (name?.[0] || "")).toUpperCase() || "?";
  const str = String(surname || "") + String(name || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash + str.charCodeAt(i)) | 0;
  const colors = ["#3B82F6","#DB2777","#16A34A","#F59E0B","#6366F1","#0EA5E9","#8B5CF6","#EF4444","#14B8A6","#F97316"];
  const c = colors[Math.abs(hash) % colors.length];
  return `<div class="att-ava" style="background:linear-gradient(135deg, ${c}CC, ${c})">${esc(initials)}</div>`;
}

// Violation score: tabSwitches×2 + copyAttempts×3 + screenshots×5
function _attViolation(a){
  return (a.tabSwitches || 0) * 2 + (a.copyAttempts || 0) * 3 + (a.screenshots || 0) * 5;
}

// Grade chip colors (grade12 → fg/bg)
function _attGradeColors(g){
  if (g == null)  return { fg: "var(--ink-400)", bg: "#F1F5FB" };
  if (g >= 10)    return { fg: "#15803D", bg: "#DCFCE7" };
  if (g >= 7)     return { fg: "#1E40AF", bg: "#DBEAFE" };
  if (g >= 4)     return { fg: "#B45309", bg: "#FEF3C7" };
  return           { fg: "#B91C1C", bg: "#FEE2E2" };
}

// Status pill
function _attStatusPill(status){
  if (status === "completed")      return `<span class="pill on">Завершено</span>`;
  if (status === "pending_review") return `<span class="pill draft">Перевіряється</span>`;
  if (status === "in_progress")    return `<span class="pill info">В процесі</span>`;
  return `<span class="pill off">—</span>`;
}

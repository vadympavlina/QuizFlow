// ═══════════════════════════════════════════════════════════════════════
// shared/features.js — увесь функціонал QuizFlow
//
// Підключається ПІСЛЯ shared/app.js — потребує window._fb, _user, _uid,
// toast, ldr, tp, $, esc, toArr, folders, tests, links, attempts
// ═══════════════════════════════════════════════════════════════════════

import { NEWS_CATS, sanitizeNewsHtml, newsPlainText, newsExcerpt, readMinutes, catOf, isPublished } from "./news-utils.js?v=1";
import { buildQuestions, qVersionKey } from "./qorder.js?v=1";
import { trackAI, tokensOf } from "./ai-usage.js?v=1";

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

// ═════════════════════════════════════════════════════════════════════
// СТУДЕНТИ: картка (teachers/{uid}/students) + живі спроби
// Картку створює сторінка тесту, і список спроб у ній лише копія: видалена
// спроба в ній лишалась, «на перевірці» рахувалась як 0, а пізніше виставлена
// оцінка не підтягувалась. Тепер усі цифри рахуються з самих спроб; картка
// дає лише ім'я, групи, архів і прив'язку (id спроб + studentIndex).
// ═════════════════════════════════════════════════════════════════════
let _stIndex = {};           // studentIndex: ключ імені → id картки
let _stCache = null, _stReloadAt = 0, _stReloadN = 0;
// Те саме, що nameKey() у test.html — інакше індекс не збігатиметься
const _stKey = (name, surname) => `${String(surname || "").trim()}_${String(name || "").trim()}`.toLowerCase()
  .replace(/\s+/g, " ").replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, "_").slice(0, 200) || "_";
const _stTone = g => g == null ? "" : g >= 10 ? "ok" : g >= 7 ? "info" : g >= 4 ? "warn" : "bad";
const _stColor = g => g == null ? "var(--ink-400)" : g >= 10 ? "#15803D" : g >= 7 ? "#1E40AF" : g >= 4 ? "#B45309" : "#B91C1C";
const _stColorOnDark = g => g == null ? "#fff" : g >= 10 ? "#4ADE80" : g >= 7 ? "#93C5FD" : g >= 4 ? "#FCD34D" : "#FCA5A5";
const _stFmt1 = v => v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString("uk-UA");
const _stBg = g => g == null ? "#F1F5FB" : g >= 10 ? "#DCFCE7" : g >= 7 ? "#DBEAFE" : g >= 4 ? "#FEF3C7" : "#FEE2E2";
const _stBar = g => g >= 10 ? "#16A34A" : g >= 7 ? "#2563EB" : g >= 4 ? "#F59E0B" : "#DC2626";
const _ST_AVA = ["#3B82F6","#DB2777","#16A34A","#F59E0B","#6366F1","#0EA5E9","#8B5CF6","#EF4444","#14B8A6"];
const _stAvaColor = s => { let h = 0; for (const ch of String(s.surname || "") + String(s.name || "")) h = (h * 31 + ch.codePointAt(0)) | 0; return _ST_AVA[Math.abs(h) % _ST_AVA.length]; };
const _stInit = s => ((s.surname?.[0] || "") + (s.name?.[0] || "")).toUpperCase() || "?";
const _stDate = (t, time = true) => t ? new Date(t).toLocaleDateString("uk-UA", time ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }) : "—";
// Стовпчики останніх оцінок (1–12) з лініями 4/8/12
function _stChart(att, n){
  const g = att.filter(a => a.grade != null).slice(-n);
  if (!g.length) return "";
  return `<div class="stc"><div class="stc-in">${[4, 8, 12].map(v => `<i class="stc-l" style="bottom:${v / 12 * 100}%"><em>${v}</em></i>`).join("")}
    <div class="stc-bars">${g.map(a => `<div class="stc-b" title="${esc(a.title)} · ${a.grade}/12 · ${_stDate(a.date, false)}"><span style="height:${Math.max(4, a.grade / 12 * 100)}%;background:${_stBar(a.grade)}"><b>${a.grade}</b></span></div>`).join("")}</div></div></div>`;
}

function _stDerive(){
  if (_stCache && _stCache.a === attempts && _stCache.s === _students && _stCache.t === tests && _stCache.l === links) return _stCache.list;
  const byId = new Map(_students.map(c => [c.id, c]));
  const keyTo = new Map();
  _students.forEach(c => keyTo.set(_stKey(c.name, c.surname), c.id));
  Object.entries(_stIndex || {}).forEach(([k, id]) => { if (byId.has(id) && !keyTo.has(k)) keyTo.set(k, id); });
  const own = new Map();   // id спроби → id картки (зі списку в картці)
  _students.forEach(c => (Array.isArray(c.attempts) ? c.attempts : Object.values(c.attempts || {}))
    .forEach(e => { const aid = e?.attemptId || e?.id; if (aid && !own.has(aid)) own.set(aid, c.id); }));
  const tMap = new Map(tests.map(t => [t.id, t])), lMap = new Map(links.map(l => [l.id, l]));
  const acc = new Map(_students.map(c => [c.id, []]));
  let orphans = 0;
  for (const a of attempts){
    if (a.status !== "completed" && a.status !== "pending_review") continue;
    const cid = own.get(a.id) || keyTo.get(_stKey(a.name, a.surname));
    if (!cid || !acc.has(cid)){ orphans++; continue; }
    acc.get(cid).push(a);
  }
  const list = _students.map(c => {
    const at = acc.get(c.id).map(a => {
      const g = Number(a.grade12);
      return {
        id: a.id, testId: a.testId, title: tMap.get(a.testId)?.title || "Тест видалено",
        grade: a.status === "completed" && a.grade12 != null && a.grade12 !== "" && Number.isFinite(g) ? g : null,
        pending: a.status === "pending_review", percent: a.score?.percent ?? null,
        date: a.finishedAt || a.createdAt || 0, group: a.group || lMap.get(a.linkId)?.group || "",
        flags: (a.tabSwitches || 0) + (a.copyAttempts || 0) + (a.screenshots || 0),
      };
    }).sort((x, y) => x.date - y.date);
    const g = at.filter(x => x.grade != null).map(x => x.grade);
    return {
      ...c, _att: at, _graded: g,
      _avg: g.length ? g.reduce((s, v) => s + v, 0) / g.length : null,
      _best: g.length ? Math.max(...g) : null,
      _pass: g.length ? Math.round(g.filter(v => v >= 4).length / g.length * 100) : null,
      _pending: at.filter(x => x.pending).length,
      _flags: at.filter(x => x.flags > 0).length,
      _last: at.length ? at[at.length - 1].date : (c.lastSeen || 0),
      _groups: [...new Set([...(c.groups || []), ...at.map(x => x.group)].filter(Boolean))],
    };
  });
  _stCache = { a: attempts, s: _students, t: tests, l: links, list, orphans };
  // Спроба без картки (картку щойно створили) — підтягуємо картки ще раз, не частіше ніж раз на 10 с
  if (orphans && _stReloadN < 5 && Date.now() - _stReloadAt > 10000 && $("students-body")){ _stReloadAt = Date.now(); _stReloadN++; setTimeout(() => G.initStudents?.(true), 300); }
  return list;
}
const _stFind = id => _stDerive().find(s => s.id === id);

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
  // Стабільний id: якщо відкрито кілька вкладок, усі пишуть той самий запис — без дублів
  const id = notif.attemptId && notif.type ? `a_${notif.attemptId}_${notif.type}` : Date.now()+"_"+Math.random().toString(36).slice(2);
  if (_notifications.some(n => n.id === id)) return;
  const item = { ...notif, id, read: false, ts: notif.ts||Date.now() };
  _notifications.unshift(item);
  updateNotifBadge();
  if(document.querySelector("#sec-notifications.on")) G.renderNotifications();
  // Звук грає слухач notifications (один раз на нове сповіщення)
  try { await dbSet(`notifications/${id}`, item); } catch(e){ console.warn(e.message); }
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

// ─── Сторінка сповіщень: стан і хелпери ───────────────────────────────
const NF = { filter: "", limit: 50, fresh: new Set(), bound: false, known: null, pending: new Set(), timer: null };
const NF_MAX = 300;                       // зберігаємо не більше стільки сповіщень
const _nfSafeId = s => typeof s === "string" && /^[\w-]{1,64}$/.test(s);
// Сповіщення може записати будь-хто (студент — про скріншот, колега — про тест),
// тому весь текст — лише як текст: теги прибираємо, решту екрануємо.
const _nfTxt = s => esc(String(s ?? "").replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]));
const _nfSusp = a => a ? (a.tabSwitches || 0) * 2 + (a.copyAttempts || 0) * 3 + (a.screenshots || 0) * 5 : 0;
const _NF_ICO = {
  started:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/></svg>`,
  shot:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  shared:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,
  pending:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>`,
  done:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  bell:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></svg>`,
};

// Одне сповіщення → що показати. Ім'я, тест і оцінку беремо з живої спроби
// (оцінка могла змінитися після перевірки), збережений текст — лише запасний.
function _nfView(n, aMap){
  const a = n.attemptId ? aMap.get(n.attemptId) : null;
  const kind = n.sharedTestId ? "shared"
    : n.type === "screenshot" ? "screenshot"
    : (n.type === "completed" || n.type === "new") ? "completed"
    : n.type === "started" ? "started" : "other";
  const t = a ? tests.find(x => x.id === a.testId) : null;
  const who = a ? esc(`${a.surname || ""} ${a.name || ""}`.trim() || "Студент") : "";
  const testT = t ? esc(t.title) : a?.testTitle ? esc(a.testTitle) : "";
  const score = _nfSusp(a);
  const warn = kind === "screenshot" || !!n.isWarning || (kind === "completed" && score > 0);
  const chips = [];
  let lv = "info", ico = _NF_ICO.bell, tag = "Активність", title, text = "";

  if (kind === "completed") {
    tag = "Завершено";
    title = a ? `<b>${who}</b> завершив(ла) тест` : _nfTxt(n.title);
    text = a ? testT : _nfTxt(n.desc || n.msg);
    if (a?.status === "pending_review") {
      lv = "warn"; ico = _NF_ICO.pending; tag = "На перевірці";
      chips.push(`<span class="chip warn">${_svg(_IC.clock, 11)} чекає перевірки</span>`);
    } else if (a && a.grade12 != null) {
      const g = +a.grade12;
      lv = g >= 10 ? "ok" : g >= 7 ? "info" : g >= 4 ? "warn" : "bad";
      ico = `<span class="g">${g}</span>`;
      chips.push(`<span class="chip ${lv}"><b>${g}</b>/12${a.percent != null ? ` · ${Math.round(a.percent)}%` : ""}</span>`);
    } else { lv = "ok"; ico = _NF_ICO.done; }
  } else if (kind === "started") {
    tag = "Розпочато";
    title = a ? `<b>${who}</b> розпочав(ла) тест` : _nfTxt(n.title);
    text = a ? testT : _nfTxt(n.desc || n.msg);
    ico = _NF_ICO.started;
    if (a?.status === "in_progress") chips.push(`<span class="chip live"><i class="dot"></i>проходить зараз</span>`);
  } else if (kind === "screenshot") {
    lv = "bad"; tag = "Скріншот"; ico = _NF_ICO.shot;
    title = a ? `<b>${who}</b> зробив(ла) скріншот` : _nfTxt(n.title);
    text = _nfTxt(n.desc || n.msg);
  } else if (kind === "shared") {
    tag = "Від колеги"; ico = _NF_ICO.shared;
    title = _nfTxt(n.title) || "Вам надіслали тест";
    text = _nfTxt(n.msg || n.desc);
  } else {
    title = _nfTxt(n.title) || "Сповіщення";
    text = _nfTxt(n.desc || n.msg);
  }
  if (a?.group) chips.push(`<span class="chip">${esc(a.group)}</span>`);
  if (warn && kind === "completed") {
    const bits = [];
    if (a.tabSwitches)  bits.push(`${a.tabSwitches} ${_plural(a.tabSwitches, "вихід", "виходи", "виходів")}`);
    if (a.copyAttempts) bits.push(`${a.copyAttempts} копіюв.`);
    if (a.screenshots)  bits.push(`${a.screenshots} скрін.`);
    chips.push(`<span class="chip bad">${_svg(_IC.flag, 11)} ${bits.join(" · ") || "підозріла активність"}</span>`);
  }
  if (n.attemptId && !a && kind !== "shared") chips.push(`<span class="chip muted">спробу видалено</span>`);

  const open = kind === "shared" ? _nfSafeId(n.sharedTestId) : !!a;
  return { id: n.id, ts: n.ts, aid: n.attemptId || null, kind, warn, lv, ico, tag, title, text, chips: chips.join(""), open };
}

// Прочитано — одним multi-path записом (замість запиту на кожне сповіщення)
function _nfMarkRead(ids){
  ids.forEach(id => NF.pending.add(id));
  _notifications = _notifications.map(n => NF.pending.has(n.id) ? { ...n, read: true } : n);
  updateNotifBadge();
  clearTimeout(NF.timer);
  return new Promise(res => {
    NF.timer = setTimeout(async () => {
      const upd = {};
      NF.pending.forEach(id => { if (_nfSafeId(id)) upd[`${id}/read`] = true; });
      NF.pending.clear();
      if (Object.keys(upd).length) {
        try { await update(ref(db, tp("notifications")), upd); } catch (e) { console.warn("notif read:", e.message); }
      }
      res();
    }, 250);
  });
}

function _nfSyncSoundBtn(){
  const btn = $("notif-sound-btn");
  if (!btn) return;
  btn.classList.toggle("snd-off", !_soundEnabled);
  btn.title = _soundEnabled ? "Звук увімкнено — натисніть, щоб вимкнути" : "Звук вимкнено — натисніть, щоб увімкнути";
  btn.setAttribute("aria-pressed", String(_soundEnabled));
}

function _nfBind(){
  NF.bound = true;
  _nfSyncSoundBtn();
  $("nf-tabs")?.addEventListener("click", e => {
    const b = e.target.closest(".nf-tab"); if (b) G.selectNotifFilter(b.dataset.val || "");
  });
  $("notif-list")?.addEventListener("click", e => {
    const act = e.target.closest("[data-nf]")?.dataset.nf;
    if (act === "more") { NF.limit += 50; G.renderNotifications(); return; }
    const row = e.target.closest(".notif"); if (!row) return;
    const id = row.dataset.nid;
    if (act === "del") G.delNotif(id);
    else if (act === "open" || row.classList.contains("can-open")) G.openNotif(id);
  });
}


// ─── Нотифікації ─────────────────────────────────────────────────────────────
let _notifQueue = [];
let _notifActive = false;

function showNotification(attempt, type){
  const test = tests.find(t=>t.id===attempt.testId);
  const name = `${attempt.name||""} ${attempt.surname||""}`.trim() || "Студент";
  const testTitle = test?.title || "—";
  const started = type === "started";
  const icon  = _svg(started ? _IC.play : _IC.check, 18);
  const title = `${name} ${started ? "розпочав(ла)" : "завершив(ла)"} тест`;
  const desc  = !started && attempt.grade12 != null ? `${testTitle} · Оцінка ${attempt.grade12}/12` : testTitle;
  const color = started ? "#2d5be3" : "#0d9e85";

  addNotification({ title, desc, attemptId: attempt.id, type, ts: Date.now() });

  // Ім'я й назву пише студент/викладач — у банер лише екрановані
  _notifQueue.push({icon, msg: `<strong>${esc(name)}</strong> · ${esc(desc)}`, color, id: attempt.id});
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
    <span style="display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:${color};color:#fff;flex-shrink:0">${icon}</span>
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
  if (has("sec-dashboard")) renderDashAtt();
  // Дашборд: активні посилання
  if (has("d-lnk")) renderDashLinks();
  // Дашборд: KPI картки
  if (has("s-t") || has("s-a") || has("s-l") || has("s-pending") || has("s-passrate")) renderStats();
  // Тести + папки
  if (has("tc")) renderTests();
  // Таблиця спроб
  if (has("att-tbl")) renderAttempts();
  // Таблиця посилань
  if (has("lnk-tbl")) renderLinks();
  // Селекти фільтрів (заповнюються лише якщо хоч один select існує)
  if (has("nl-t")) fillSelects();
  // Журнал і аналітика оновлюються разом з даними (раніше — лише при відкритті сторінки)
  if (has("gradebook-body") && GB.bound) G.renderGradebook();
  if (has("analytics-body")) G.renderAnalytics();
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
  // Підозрілі — з локального стану, без запиту до бази на кожну зміну спроб
  _suspBadge();
  const nbO = $("nb-online");
  if (nbO){ const n = attempts.filter(a => _isOnline(a)).length; nbO.textContent = n; nbO.style.display = n ? "" : "none"; }
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
  return _suspScore(a) > 0 && (a.status === "completed" || a.status === "pending_review");
}
// Студент зараз у тесті: статус in_progress і сторінка тесту «дихала» (heartbeat кожні 15 с)
// не більше 10 хв тому. Без цього вкладка, яку просто закрили, висіла б «онлайн» годинами.
const _lastSeen = a => a.lastSeen || a.startedAt || a.createdAt || 0;
function _isOnline(a, now = Date.now()){ return a.status === "in_progress" && now - _lastSeen(a) < 10 * 60e3; }
function _suspScore(a){ return (a.tabSwitches || 0) * 2 + (a.copyAttempts || 0) * 3 + (a.screenshots || 0) * 5; }
const _suspAt = a => a.finishedAt || a.createdAt || 0;
// «Нові» підозрілі — завершені після останнього візиту на сторінку (meta/suspSeenAt)
// і ще не переглянуті. Раніше рахувалося як «кількість − збережена кількість»:
// після видалення спроби нові ховалися, а стан тягнувся запитом на кожну зміну спроб.
const _suspMeta = { loaded: false, seenAt: null, readCount: 0 };
function _suspNewCount(){
  if (!_suspMeta.loaded) return 0;
  const list = attempts.filter(a => _isSusp(a) && !a.suspReviewed);
  if (_suspMeta.seenAt == null) return Math.max(0, attempts.filter(_isSusp).length - _suspMeta.readCount);
  return list.filter(a => _suspAt(a) > _suspMeta.seenAt).length;
}
function _suspBadge(){
  const n = document.querySelector("#sec-suspicious.on") ? 0 : _suspNewCount();
  const nbS = $("nb-suspicious");
  if (nbS){ nbS.textContent = n; nbS.style.display = n > 0 ? "" : "none"; }
  return n;
}
// ─── Сторінка «Підозрілі»: стан і хелпери ─────────────────────────────
const SP = { tab: "open", group: "", test: "", period: "", level: "", sort: "risk", limit: 20, drops: {}, bound: false, open: new Set(), fresh: new Set(), seen: null };
// Іконки-SVG замість емодзі (див. CLAUDE.md)
const _svg = (d, w = 13) => `<svg class="ic" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const _IC = {
  swap:   '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  copy:   '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  code:   '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  clock:  '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  flag:   '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  check:  '<polyline points="20 6 9 17 4 12"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
  link: '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  play:   '<polygon points="6 4 20 12 6 20 6 4"/>',
  x:      '<path d="M18 6L6 18M6 6l12 12"/>',
  minus:  '<path d="M5 12h14"/>',
  spark:  '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>',
  refresh:'<path d="M21 12a9 9 0 11-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
};
const _SP_EV = {
  tab_hidden:   [_IC.swap, "Відкрив(ла) іншу вкладку"],
  window_blur:  [_IC.window, "Перейшов(ла) в інше вікно"],
  copy_attempt: [_IC.copy, "Спроба скопіювати текст"],
  screenshot:   [_IC.camera, "Спроба зробити скріншот"],
  devtools:     [_IC.code, "Спроба відкрити інструменти розробника"],
};
function _spMMSS(ms){
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function _spCase(c){
  const a = c.a, t = tests.find(x => x.id === a.testId);
  const lv = c.score >= 10 ? "bad" : c.score >= 5 ? "warn" : "info";
  const lvTxt = lv === "bad" ? "Високий" : lv === "warn" ? "Середній" : "Низький";
  const who = `${a.surname || ""} ${a.name || ""}`.trim() || "Студент";
  const initials = ((a.surname?.[0] || "") + (a.name?.[0] || "")).toUpperCase() || "?";
  let h = 0; for (const ch of who) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const ava = ["", "b", "g", "o", "r"][Math.abs(h) % 5];
  const when = c.at ? new Date(c.at).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const grade = a.status === "pending_review" ? `<span class="case-grade warn">${_svg(_IC.clock, 12)} на перевірці</span>`
    : a.grade12 != null ? `<span class="case-grade ${_stTone(+a.grade12)}"><b>${+a.grade12}</b>/12</span>` : "";
  const tags = [
    a.tabSwitches  ? `<span class="case-tag tabs" title="Виходи з тесту (вкладка/вікно)">${_svg(_IC.swap, 11)} ${a.tabSwitches}</span>` : "",
    a.copyAttempts ? `<span class="case-tag copies" title="Спроби копіювання">${_svg(_IC.copy, 11)} ${a.copyAttempts}</span>` : "",
    a.screenshots  ? `<span class="case-tag shots" title="Спроби скріншоту">${_svg(_IC.camera, 11)} ${a.screenshots}</span>` : "",
  ].join("");

  const concl = [];
  if (a.screenshots)  concl.push(`${a.screenshots} ${_plural(a.screenshots, "спроба", "спроби", "спроб")} зробити скріншот`);
  if (a.copyAttempts) concl.push(`${a.copyAttempts} ${_plural(a.copyAttempts, "спроба", "спроби", "спроб")} скопіювати текст питань`);
  if (a.tabSwitches)  concl.push(`${a.tabSwitches} ${_plural(a.tabSwitches, "вихід", "виходи", "виходів")} з тесту`);
  const advice = lv === "bad" ? "Варто поговорити зі студентом або переглянути відповіді."
    : lv === "warn" ? "Перегляньте відповіді на питання, де був вихід."
    : "Найімовірніше випадковість — наприклад, сповіщення на екрані.";

  const evRaw = a.suspiciousEvents ? (Array.isArray(a.suspiciousEvents) ? a.suspiciousEvents : Object.values(a.suspiciousEvents)) : [];
  const start = a.startedAt || a.createdAt || 0;
  const evs = evRaw.filter(e => e && e.time).sort((x, y) => x.time - y.time);
  const timeline = evs.length ? `<div class="case-section-l">Хронологія · ${evs.length} ${_plural(evs.length, "подія", "події", "подій")}</div>
    <ol class="sp-tl">${evs.slice(0, 30).map(e => {
      const [ico, txt] = _SP_EV[e.type] || ['<circle cx="12" cy="12" r="3"/>', ""];
      return `<li><span class="tm">${start && e.time >= start ? "+" + _spMMSS(e.time - start) : new Date(e.time).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span><span class="ic">${_svg(ico, 14)}</span><span>${esc(txt || e.description || e.type || "Подія")}</span></li>`;
    }).join("")}${evs.length > 30 ? `<li class="more">і ще ${evs.length - 30}…</li>` : ""}</ol>` : "";

  const meter = (cls, ico, label, v, mul) => `<div class="meter ${v ? cls : "zero"}">
      <div class="meter-l"><span class="ico">${ico}</span> ${label}</div>
      <div class="meter-v">${v || 0}</div><div class="meter-sub">${v ? `+${v * mul} до ризику` : `×${mul} за подію`}</div></div>`;
  const id = esc(a.id);
  return `<div class="case${SP.open.has(a.id) ? " expanded" : ""}${c.reviewed ? " reviewed" : ""}" data-case-id="${id}">
    <div class="case-h" data-sp-toggle role="button" tabindex="0" aria-expanded="${SP.open.has(a.id)}">
      <div class="case-ava ${ava}">${esc(initials)}</div>
      <div class="case-info">
        <div class="case-name">${SP.fresh.has(a.id) && !c.reviewed ? `<span class="case-new">нове</span>` : ""}${esc(who)}${c.reviewed ? `<span class="case-ok">${_svg(_IC.check, 11)} переглянуто</span>` : ""}</div>
        <div class="case-sub">${esc(t?.title || "Видалений тест")}${c.group ? ` · ${esc(c.group)}` : ""} · ${when}</div>
      </div>
      <div class="case-right">
        <div class="case-tags">${tags}</div>
        ${grade}
        <div class="case-score" title="Бал ризику: вихід ×2, копіювання ×3, скріншот ×5"><span class="l">Ризик</span><span class="v ${lv}">${c.score}</span></div>
        <span class="case-pill ${lv}">${lvTxt}</span>
        <span class="case-chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
      </div>
    </div>
    <div class="case-body">
      <div class="meters">
        ${meter("tabs", _svg(_IC.swap, 12), "Виходи з тесту", a.tabSwitches, 2)}
        ${meter("copies", _svg(_IC.copy, 12), "Копіювання", a.copyAttempts, 3)}
        ${meter("shots", _svg(_IC.camera, 12), "Скріншоти", a.screenshots, 5)}
      </div>
      ${timeline}
      <div class="case-concl ${lv}">
        <span class="ico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
        <div><div class="t">${lvTxt} ризик · ${c.score} ${_plural(c.score, "бал", "бали", "балів")}</div>
          <div class="d">${esc(concl.join(", "))}. ${advice}</div></div>
      </div>
      <div class="case-foot">
        <button type="button" class="sp-btn" data-sp-act="student">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Усі спроби студента
        </button>
        <button type="button" class="sp-btn" data-sp-act="view">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Відповіді
        </button>
        ${c.reviewed
          ? `<button type="button" class="sp-btn" data-sp-act="unreview">Повернути в роботу</button>`
          : `<button type="button" class="sp-btn primary" data-sp-act="review"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Переглянуто</button>`}
      </div>
    </div>
  </div>`;
}
function _spBind(){
  SP.bound = true;
  $("sp-tabs")?.addEventListener("click", e => { const b = e.target.closest("[data-sp-tab]"); if (b) G.setSuspTab(b.dataset.spTab); });
  $("sp-kpi-grid")?.addEventListener("click", e => { const b = e.target.closest("[data-sp-level]"); if (b) G.setSuspLevel(b.dataset.spLevel); });
  $("sp-reset")?.addEventListener("click", () => G.resetSuspFilters());
  const body = $("suspicious-body");
  body?.addEventListener("click", e => {
    if (e.target.closest("[data-sp-reset]")) return G.resetSuspFilters();
    if (e.target.closest("[data-sp-more]")) { SP.limit += 20; return G.renderSuspicious(); }
    const card = e.target.closest(".case"); if (!card) return;
    const id = card.dataset.caseId;
    const act = e.target.closest("[data-sp-act]")?.dataset.spAct;
    if (act === "view") return G.viewAtt(id);
    if (act === "review" || act === "unreview") return G.setSuspReviewed(id, act === "review");
    if (act === "student") {
      const a = attempts.find(x => x.id === id);
      if (a) location.href = "attempts?q=" + encodeURIComponent(`${a.surname || ""} ${a.name || ""}`.trim());
      return;
    }
    if (e.target.closest("[data-sp-toggle]")) G.toggleSuspCase(id);
  });
  body?.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-sp-toggle]")) {
      e.preventDefault(); G.toggleSuspCase(e.target.closest(".case").dataset.caseId);
    }
  });
}

// Дашборд живе в shared/dash.js (лише на головній); тут — точка входу для старих викликів
function renderDashAtt(){ if (typeof window.renderDash === "function") window.renderDash(); }

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

// ═════════════════════════════════════════════════════════════════════
// ЖУРНАЛ І АНАЛІТИКА — спільні розрахунки
// • Група береться зі спроби (a.group): посилання могли видалити, а
//   результати мають лишитися в журналі.
// • Один студент — одне ім'я без урахування регістру й зайвих пробілів
//   («Коваль Олена» і «коваль  олена» — один рядок).
// • Оцінка без значення — «—», а не 0.
// ═════════════════════════════════════════════════════════════════════
const _rpNorm = s => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/[’ʼ`]/g, "'");
const _rpGrade = a => { const g = Number(a.grade12); return a.grade12 != null && a.grade12 !== "" && Number.isFinite(g) ? g : null; };
const _rpTone = g => g == null ? "none" : g >= 10 ? "best" : g >= 7 ? "good" : g >= 4 ? "mid" : "bad";
const _rpAvg = arr => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null;
const _r1 = v => v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString("uk-UA");
const _rpPlain = html => new DOMParser().parseFromString(String(html ?? ""), "text/html").body.textContent.replace(/\s+/g, " ").trim();
const _rpIc = p => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const _RP_IC_GROUP = _rpIc('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>');
const _RP_IC_TEST  = _rpIc('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>');

function _rpRows(){
  const lMap = new Map(links.map(l => [l.id, l]));
  const out = [];
  for (const a of attempts){
    if (a.status !== "completed" && a.status !== "pending_review") continue;
    out.push({
      a, group: a.group || lMap.get(a.linkId)?.group || "",
      grade: a.status === "completed" ? _rpGrade(a) : null,
      key: _rpNorm(a.surname) + "|" + _rpNorm(a.name),
      t: a.finishedAt || a.createdAt || 0,
    });
  }
  return out;
}
// Групи для фільтра з кількістю результатів; архівовані групи (усі посилання приховані) не показуємо
function _rpGroupItems(rows, allLabel){
  const hidden = new Set(), shown = new Set();
  links.forEach(l => { if (l.group) (l.groupHidden ? hidden : shown).add(l.group); });
  const cnt = new Map();
  rows.forEach(r => { if (r.group) cnt.set(r.group, (cnt.get(r.group) || 0) + 1); });
  const items = [...cnt].filter(([g]) => !(hidden.has(g) && !shown.has(g)))
    .map(([g, n]) => ({ value: g, label: g, count: n })).sort((a, b) => a.label.localeCompare(b.label, "uk"));
  return allLabel ? [{ value: "", label: allLabel }, ...items] : items;
}
function _rpTestItems(rows, allLabel){
  const cnt = new Map();
  rows.forEach(r => cnt.set(r.a.testId, (cnt.get(r.a.testId) || 0) + 1));
  const tMap = new Map(tests.map(t => [t.id, t]));
  return [{ value: "", label: allLabel }, ...[...cnt].map(([id, n]) => ({ value: id, label: tMap.get(id)?.title || "Тест видалено", count: n }))
    .sort((a, b) => a.label.localeCompare(b.label, "uk"))];
}
// Фільтри в адресі — сторінку можна оновити або надіслати посилання колезі
function _rpUrl(params){
  const u = new URL(location.href);
  Object.entries(params).forEach(([k, v]) => v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
  if (u.search !== location.search) history.replaceState(null, "", u.pathname + u.search);
}
function _rpDownload(name, blob){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]+/g, " ").trim();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// CSV для Excel з українською локаллю: BOM + «;»
const _rpCsv = rows => "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");

// Підказка при наведенні на елементи з data-tip (стовпці, точки графіка, клітинки)
let _rpTipEl = null;
function _rpBindTips(root){
  if (!root || root._tips) return;
  root._tips = true;
  const hide = () => { if (_rpTipEl) _rpTipEl.hidden = true; };
  root.addEventListener("mouseover", e => {
    const t = e.target.closest("[data-tip]"); if (!t || !root.contains(t)) return hide();
    if (!_rpTipEl){ _rpTipEl = document.createElement("div"); _rpTipEl.className = "rp-tip"; _rpTipEl.setAttribute("role", "tooltip"); document.body.appendChild(_rpTipEl); }
    _rpTipEl.innerHTML = t.dataset.tip; _rpTipEl.hidden = false;
    const r = t.getBoundingClientRect(), w = _rpTipEl.offsetWidth, h = _rpTipEl.offsetHeight;
    _rpTipEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
    _rpTipEl.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + "px";
  });
  root.addEventListener("mouseleave", hide);
  addEventListener("scroll", hide, true);
}

// ─── Журнал: матриця «студент × тест» ────────────────────────────────
const GB = { group: null, test: "", q: "", sort: "name", drops: {}, urlDone: false, bound: false };
function _gbBuild(rows){
  const sel = rows.filter(r => r.group === GB.group && (!GB.test || r.a.testId === GB.test));
  const tMap = new Map(tests.map(t => [t.id, t]));
  // Колонки — тести в порядку першого проходження (як у паперовому журналі)
  const first = new Map();
  sel.forEach(r => { const f = first.get(r.a.testId); if (f == null || r.t < f) first.set(r.a.testId, r.t); });
  const cols = [...first].sort((a, b) => a[1] - b[1]).map(([id]) => ({ id, title: tMap.get(id)?.title || "Тест видалено" }));
  const studs = new Map();
  sel.forEach(r => {
    let s = studs.get(r.key);
    if (!s) studs.set(r.key, s = { key: r.key, name: "", surname: "", t: -1, cells: {} });
    // Написання імені: з великої літери має перевагу, серед рівних — найновіше
    const nm = String(r.a.name || "").trim().replace(/\s+/g, " "), sn = String(r.a.surname || "").trim().replace(/\s+/g, " ");
    const nice = /^\p{Lu}/u.test(sn) + /^\p{Lu}/u.test(nm);
    if (s.t < 0 || nice > s.nice || (nice === s.nice && r.t >= s.t)){ s.t = r.t; s.nice = nice; s.name = nm || s.name; s.surname = sn || s.surname; }
    const c = s.cells[r.a.testId] || (s.cells[r.a.testId] = { tries: 0, best: null, id: null, pending: null });
    c.tries++;
    if (r.grade != null){ if (c.best == null || r.grade > c.best){ c.best = r.grade; c.id = r.a.id; } }
    else if (r.a.status === "pending_review" && !c.pending) c.pending = r.a.id;
  });
  const list = [...studs.values()];
  list.forEach(s => {
    const g = cols.map(c => s.cells[c.id]?.best).filter(v => v != null);
    s.avg = _rpAvg(g); s.debts = g.filter(v => v < 4).length;
  });
  const colStats = cols.map(c => {
    const g = list.map(s => s.cells[c.id]?.best).filter(v => v != null);
    return { n: g.length, avg: _rpAvg(g), pass: g.filter(v => v >= 4).length };
  });
  return { sel, cols, list, colStats };
}

// ─── Аналітика ───────────────────────────────────────────────────────
const AN = { group: "", test: "", drops: {}, urlDone: false, showAll: false, allQ: false, bound: false };
const _weekStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };

// ATTEMPTS
fillSelects = function(){
  // Групи з посилань (без прихованих через архівацію студентської групи)
  const groups=[...new Set(links.filter(l=>!l.groupHidden).map(l=>l.group).filter(Boolean))].sort();
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
// qfDateTime — власний вибір дати й часу замість <input type="datetime-local">.
// Поле лишається звичайним input (value у форматі «YYYY-MM-DDTHH:MM», як у
// datetime-local), тому код, що читає/пише .value, не змінюється.
// ═════════════════════════════════════════════════════════════════════
const _DT_MON = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
function qfDateTime(inp){
  if (!inp || inp._qfdt) return;
  inp._qfdt = true;
  const p2 = n => String(n).padStart(2, "0");
  const parse = v => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null; };
  const fmt = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "qdt-btn " + inp.className;
  btn.setAttribute("aria-haspopup", "dialog");
  inp.type = "hidden";
  inp.after(btn);
  const paint = () => {
    const d = parse(inp.value);
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` +
      (d ? `<span>${d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" })}, <b>${p2(d.getHours())}:${p2(d.getMinutes())}</b></span>` : `<span class="qdt-ph">${esc(inp.placeholder || "Не задано")}</span>`);
    btn.classList.toggle("set", !!d);
  };
  // Програмна зміна .value (пресети «через 1 год» тощо) одразу видна на кнопці
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  Object.defineProperty(inp, "value", { get(){ return desc.get.call(this); }, set(v){ desc.set.call(this, v); paint(); }, configurable: true });
  const commit = d => { inp.value = d ? fmt(d) : ""; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); };

  let pop = null, view = null;
  function close(){ if (!pop) return; pop.remove(); pop = null; btn.classList.remove("open"); document.removeEventListener("mousedown", outside, true); removeEventListener("keydown", onKey, true); }
  const outside = e => { if (pop && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); };
  const onKey = e => { if (e.key === "Escape" && pop){ e.stopImmediatePropagation(); e.preventDefault(); close(); btn.focus(); } };
  function render(){
    const cur = parse(inp.value), today = new Date(); today.setHours(0, 0, 0, 0);
    const y = view.getFullYear(), m = view.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    let cells = "";
    for (let i = 0; i < first; i++) cells += `<span></span>`;
    for (let d = 1; d <= days; d++){
      const dt = new Date(y, m, d), past = dt < today;
      const sel = cur && cur.getFullYear() === y && cur.getMonth() === m && cur.getDate() === d;
      cells += `<button type="button" class="qdt-d${sel ? " on" : ""}${+dt === +today ? " today" : ""}${past ? " past" : ""}" data-d="${d}">${d}</button>`;
    }
    const hh = cur ? cur.getHours() : 9, mm = cur ? cur.getMinutes() : 0;
    pop.innerHTML = `<div class="qdt-h"><button type="button" data-nav="-1" aria-label="Попередній місяць">‹</button><b>${_DT_MON[m]} ${y}</b><button type="button" data-nav="1" aria-label="Наступний місяць">›</button></div>
      <div class="qdt-w">${["Пн","Вт","Ср","Чт","Пт","Сб","Нд"].map(w => `<span>${w}</span>`).join("")}</div>
      <div class="qdt-g">${cells}</div>
      <div class="qdt-t"><span>Час</span><input type="text" inputmode="numeric" maxlength="2" class="qdt-hh" value="${p2(hh)}" aria-label="Години"><i>:</i><input type="text" inputmode="numeric" maxlength="2" class="qdt-mm" value="${p2(mm)}" aria-label="Хвилини">
        <span class="qdt-q">${["08:00","09:00","12:00","15:00","18:00","23:59"].map(t => `<button type="button" data-t="${t}">${t}</button>`).join("")}</span></div>
      <div class="qdt-f"><button type="button" data-clear>Очистити</button><button type="button" class="ok" data-ok>Готово</button></div>`;
  }
  function readTime(){
    const hh = Math.min(23, Math.max(0, parseInt(pop.querySelector(".qdt-hh").value, 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(pop.querySelector(".qdt-mm").value, 10) || 0));
    return [hh, mm];
  }
  function open(){
    document.querySelectorAll(".qd-pop,.qdt-pop").forEach(x => x._close?.());
    const cur = parse(inp.value) || new Date();
    view = new Date(cur.getFullYear(), cur.getMonth(), 1);
    pop = document.createElement("div"); pop.className = "qdt-pop"; pop._close = close; pop.dataset.open = "1";
    pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Вибір дати й часу");
    document.body.appendChild(pop); render();
    const r = btn.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    let top = r.bottom + 6; if (top + pr.height > innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pr.width - 8)) + "px"; pop.style.top = top + "px";
    btn.classList.add("open");
    document.addEventListener("mousedown", outside, true); addEventListener("keydown", onKey, true);
    pop.addEventListener("mousedown", e => { if (!e.target.closest("input")) e.preventDefault(); });
    pop.addEventListener("click", e => {
      const nav = e.target.closest("[data-nav]"); if (nav){ view.setMonth(view.getMonth() + +nav.dataset.nav); const t = readTime(); render(); pop.querySelector(".qdt-hh").value = p2(t[0]); pop.querySelector(".qdt-mm").value = p2(t[1]); return; }
      const d = e.target.closest("[data-d]");
      if (d){ const [hh, mm] = readTime(); commit(new Date(view.getFullYear(), view.getMonth(), +d.dataset.d, hh, mm)); const t = readTime(); render(); pop.querySelector(".qdt-hh").value = p2(t[0]); pop.querySelector(".qdt-mm").value = p2(t[1]); return; }
      const t = e.target.closest("[data-t]");
      if (t){ const [hh, mm] = t.dataset.t.split(":"); pop.querySelector(".qdt-hh").value = hh; pop.querySelector(".qdt-mm").value = mm; const c = parse(inp.value) || new Date(); c.setHours(+hh, +mm, 0, 0); commit(c); render(); return; }
      if (e.target.closest("[data-clear]")){ commit(null); close(); btn.focus(); return; }
      if (e.target.closest("[data-ok]")){ const c = parse(inp.value); if (c){ const [hh, mm] = readTime(); c.setHours(hh, mm, 0, 0); commit(c); } close(); btn.focus(); }
    });
    pop.addEventListener("change", e => { if (e.target.matches(".qdt-hh,.qdt-mm")){ const c = parse(inp.value); if (c){ const [hh, mm] = readTime(); c.setHours(hh, mm, 0, 0); commit(c); } } });
  }
  btn.addEventListener("click", () => pop ? close() : open());
  paint();
}
window.qfDateTime = qfDateTime;

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
  const flag = r.viol > 0 ? `<span class="flag-icon" title="${[a.tabSwitches ? `переключень вкладок: ${a.tabSwitches}` : "", a.copyAttempts ? `спроб копіювання: ${a.copyAttempts}` : "", a.screenshots ? `скріншотів: ${a.screenshots}` : ""].filter(Boolean).join(", ")}">${_svg(_IC.flag, 11)} ${r.viol}</span>` : "";
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
  if (!p.has("test") && !p.has("group") && !p.has("status") && !p.has("q")){ AT.urlDone = true; return; }
  if (p.get("test") && !rows.length && !tests.length) return;   // дані ще не прийшли
  AT.urlDone = true;
  AT.test = p.get("test") || ""; AT.group = p.get("group") || "";
  AT.q = p.get("q") || "";
  if (AT.q && $("att-srch")){ $("att-srch").value = AT.q; $("att-srch-wrap")?.classList.add("has-q"); }
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

// Обгортка: рахуємо кожне звернення (успіх / помилка) для адмінки
async function callGroq(messages, maxTokens=800, temp=0.5, feature="analysis"){
  try{
    const { text, data } = await callAIRaw(messages, maxTokens, temp, feature);
    trackAI(db, _uid, feature, { tokens: tokensOf(data) });
    return text;
  }catch(e){ trackAI(db, _uid, feature, { ok: false }); throw e; }
}
async function callAIRaw(messages, maxTokens, temp, feature){
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
      return { text: d.candidates?.[0]?.content?.parts?.[0]?.text || "", data: d };
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
      return { text: d.choices?.[0]?.message?.content || "", data: d };
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
        <span style="color:var(--muted);display:grid">${_svg(_IC.archive, 18)}</span>
        <div style="flex:1">
          <div style="font-weight:500;font-size:14px;color:var(--muted)">${esc(t.title)}</div>
          <div style="font-size:12px;color:var(--light);margin-top:2px">${attCount} спроб · Архівовано ${timeAgo(t.archivedAt||t.createdAt)}</div>
        </div>
        <button class="btn bs btn-sm" onclick="G.restoreTest('${t.id}')" style="font-size:12px">↩ Відновити</button>
        <button class="btn bd btn-sm" onclick="G.permDeleteTest('${t.id}',${jsq(t.title)})" style="font-size:12px" title="Видалити назавжди" aria-label="Видалити назавжди">${_svg(_IC.trash, 14)}</button>
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
      {val:"active",  label:"Активний",  color:"#0d9e85"},
      {val:"draft",   label:"Чернетка",  color:"var(--muted)"},
      {val:"closed",  label:"Закрито",   color:"#be123c"},
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

  // ═══ СПОВІЩЕННЯ ═══════════════════════════════════════════════════════
  // Показ без markAll при кожному рендері: непрочитані, що були на момент
  // відкриття сторінки (або прийшли поки вона відкрита), лишаються підсвіченими
  // як «нові» до кінця візиту, а в базі одним записом стають прочитаними.
  renderNotifications(){
    const list = $("notif-list");
    if (!list) return;
    if (!NF.bound) _nfBind();

    const unread = _notifications.filter(n => n.id && !n.read);
    if (unread.length && document.querySelector("#sec-notifications.on")) {
      unread.forEach(n => NF.fresh.add(n.id));
      _nfMarkRead(unread.map(n => n.id));
    }

    const aMap = new Map(attempts.map(a => [a.id, a]));
    const all = _notifications.map(n => _nfView(n, aMap));
    const doneIds = new Set(all.filter(v => v.kind === "completed" && v.aid).map(v => v.aid));
    // «Почав» зникає, коли є «Завершив» по тій самій спробі — інакше дублі
    const base = all.filter(v => !(v.kind === "started" && doneIds.has(v.aid)));

    const cnt = {
      "":        base.length,
      fresh:     all.filter(v => NF.fresh.has(v.id)).length,
      completed: all.filter(v => v.kind === "completed").length,
      started:   all.filter(v => v.kind === "started").length,
      warn:      all.filter(v => v.warn).length,
      shared:    all.filter(v => v.kind === "shared").length,
    };
    document.querySelectorAll("#nf-tabs .nf-tab").forEach(b => {
      const k = b.dataset.val || "";
      const c = b.querySelector(".cnt"); if (c) c.textContent = cnt[k] ?? 0;
      b.classList.toggle("on", k === NF.filter);
      if (k === "shared") b.hidden = !cnt.shared && NF.filter !== "shared";
    });
    const head = $("nf-unread-count");
    if (head) head.textContent = cnt.fresh
      ? `${cnt.fresh} ${_plural(cnt.fresh, "нове", "нові", "нових")} з останнього візиту`
      : "Нових немає";

    const f = NF.filter;
    const rows = f === ""        ? base
               : f === "fresh"   ? all.filter(v => NF.fresh.has(v.id))
               : f === "warn"    ? all.filter(v => v.warn)
               : all.filter(v => v.kind === f);

    const meta = $("nf-meta-r");
    if (meta) meta.textContent = `${rows.length} ${_plural(rows.length, "сповіщення", "сповіщення", "сповіщень")}`;
    const clr = $("nf-clear"); if (clr) clr.disabled = !_notifications.length;

    if (!rows.length) {
      list.innerHTML = `<div class="nf-empty">
        <div class="ei"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></svg></div>
        <div class="et">${f ? "Тут порожньо" : "Немає сповіщень"}</div>
        <div class="es">${f ? "У цій вкладці поки немає сповіщень" : "Тут з'являтимуться повідомлення про активність студентів"}</div>
      </div>`;
      return;
    }

    const today = new Date().toDateString();
    const yest  = new Date(Date.now() - 864e5).toDateString();
    let lastDay = null;
    const shown = rows.slice(0, NF.limit);
    list.innerHTML = shown.map(v => {
      const d = new Date(v.ts || 0);
      const ds = d.toDateString();
      let sep = "";
      if (ds !== lastDay) {
        lastDay = ds;
        const lbl = ds === today ? "Сьогодні" : ds === yest ? "Вчора"
          : d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
        sep = `<div class="nf-day-sep"><div class="ln"></div><span class="lbl">${lbl}</span><div class="ln"></div></div>`;
      }
      const time = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
      const when = ds === today ? `${timeAgo(v.ts)} · ${time}` : time;
      return sep + `
        <div class="notif${NF.fresh.has(v.id) ? " unread" : ""}${v.open ? " can-open" : ""}" data-nid="${esc(v.id)}">
          <div class="notif-ico ${v.lv}">${v.ico}</div>
          <div class="notif-body">
            <div class="notif-title">${v.title}</div>
            ${v.text ? `<div class="notif-text">${v.text}</div>` : ""}
            <div class="notif-meta">
              <span class="item"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${when}</span>
              <span class="tag ${v.kind === "completed" ? (v.lv === "warn" ? "warn" : "ok") : v.lv}">${v.tag}</span>
              ${v.chips}
            </div>
          </div>
          <div class="notif-actions">
            ${v.open ? `<button type="button" class="ib" data-nf="open" title="${v.kind === "shared" ? "Відкрити тест" : "Деталі спроби"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>` : ""}
            <button type="button" class="ib d" data-nf="del" title="Видалити"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
          </div>
        </div>`;
    }).join("") + (rows.length > shown.length
      ? `<button type="button" class="nf-more" data-nf="more">Показати ще ${Math.min(50, rows.length - shown.length)} · залишилось ${rows.length - shown.length}</button>`
      : "");
  },

  async markAllNotifsAsRead(){
    const ids = _notifications.filter(n => n.id && !n.read).map(n => n.id);
    NF.fresh.clear();
    if (ids.length) await _nfMarkRead(ids);
    G.renderNotifications();
    toast(ids.length ? "Усі сповіщення прочитано" : "Усе вже прочитано");
  },

  openNotif(id){
    const n = _notifications.find(x => x.id === id);
    if (!n) return;
    if (n.sharedTestId && _nfSafeId(n.sharedTestId)) { location.href = `tests?hl=${encodeURIComponent(n.sharedTestId)}`; return; }
    if (n.attemptId && attempts.some(a => a.id === n.attemptId)) G.viewAtt(n.attemptId);
    else if (n.attemptId) toast("Спробу вже видалено", "err");
  },

  selectNotifFilter(value){
    NF.filter = value || "";
    NF.limit = 50;
    G.renderNotifications();
    $("notif-list")?.scrollTo?.(0, 0);
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
    _notifications = _notifications.filter(n => n.id !== id);
    NF.fresh.delete(id);
    updateNotifBadge();
    G.renderNotifications();
    try { await dbDel(`notifications/${id}`); } catch (e) { console.warn(e); toast("Не вдалося видалити", "err"); }
  },

  toggleNotifSound(){
    _soundEnabled = !_soundEnabled;
    try { localStorage.setItem("qf_sound", _soundEnabled ? "1" : "0"); } catch {}
    _nfSyncSoundBtn();
    if (_soundEnabled) playNotifSound(false);
    toast(_soundEnabled ? "Звук сповіщень увімкнено" : "Звук сповіщень вимкнено");
  },

  async clearAllNotifs(){
    if (!_notifications.length) return;
    if (!confirm(`Видалити всі ${_notifications.length} ${_plural(_notifications.length, "сповіщення", "сповіщення", "сповіщень")}? Це незворотно.`)) return;
    const prev = _notifications;
    _notifications = [];
    NF.fresh.clear();
    updateNotifBadge();
    G.renderNotifications();
    try { await dbDel("notifications"); toast("Сповіщення очищено"); }
    catch (e) { _notifications = prev; updateNotifBadge(); G.renderNotifications(); toast("Не вдалося очистити: " + e.message, "err"); }
  },


  // ═══ СТУДЕНТИ ═════════════════════════════════════════════════════════
  async initStudents(reload){
    try {
      const [snap, idx] = await Promise.all([dbGet("students"), dbGet("studentIndex").catch(() => null)]);
      _students = snap.exists()
        ? Object.entries(snap.val()).map(([id, v]) => ({ ...v, id }))
            .sort((a, b) => (a.surname || "").localeCompare(b.surname || "", "uk") || (a.name || "").localeCompare(b.name || "", "uk"))
        : [];
      _stIndex = idx?.val() || {};
    } catch (e) { if (!reload) _students = []; }
    _stCache = null;
    if (window._stTab == null) window._stTab = "active";
    if (window._stGroup == null){
      const p = new URLSearchParams(location.search);
      window._stGroup = p.get("group") || "";
      if (p.get("q") && $("student-srch")) $("student-srch").value = p.get("q");
    }
    const tabSeg = $("st-tab-seg");
    if (tabSeg && !tabSeg.dataset.wired){
      tabSeg.dataset.wired = "1";
      tabSeg.addEventListener("click", e => {
        const btn = e.target.closest("button[data-tab]"); if (!btn) return;
        window._stTab = btn.dataset.tab;
        tabSeg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === btn));
        window._stFiltersChanged = true; window._selectedStId = null;
        G.renderStudents();
      });
      $("st-chips")?.addEventListener("click", e => { const c = e.target.closest(".st-chip"); if (c) G.selectStFilter(c.dataset.val || ""); });
      $("students-body")?.addEventListener("click", e => {
        const pg = e.target.closest("[data-st-page]"); if (pg){ G.setStudentsPage(+pg.dataset.stPage); return; }
        const tr = e.target.closest("tr[data-st-id]"); if (tr) G.selectStudent(tr.dataset.stId);
      });
    }
    G.renderStudents();
  },

  selectStFilter(value){
    window._stGroup = value || "";
    window._stFiltersChanged = true;
    G.renderStudents();
  },

  refreshStGroupFilters(list){
    const tab = window._stTab || "active";
    const all = list || _stDerive();
    const pool = all.filter(s => tab === "archived" ? !!s.archived : !s.archived);
    const cnt = new Map();
    pool.forEach(s => s._groups.forEach(g => cnt.set(g, (cnt.get(g) || 0) + 1)));
    const groups = [...cnt.keys()].sort((a, b) => a.localeCompare(b, "uk"));
    if (window._stGroup && !cnt.has(window._stGroup)){ window._stGroup = ""; window._stFiltersChanged = true; }
    const cur = window._stGroup || "";
    const ctA = $("st-ct-active"), ctR = $("st-ct-archived");
    if (ctA) ctA.textContent = all.filter(s => !s.archived).length;
    if (ctR) ctR.textContent = all.filter(s => s.archived).length;
    const chipsEl = $("st-chips");
    if (chipsEl){
      const html = `<button type="button" class="st-chip${cur ? "" : " on"}" data-val="">Усі групи</button>` +
        groups.map(g => `<button type="button" class="st-chip${cur === g ? " on" : ""}" data-val="${esc(g)}">${esc(g)} <i>${cnt.get(g)}</i></button>`).join("");
      if (chipsEl.innerHTML !== html) chipsEl.innerHTML = html;
    }
    const archBtn = $("st-gbar-archive-btn");
    if (archBtn){
      archBtn.textContent = tab === "archived" ? "Відновити групу" : "Архівувати групу";
      archBtn.onclick = () => tab === "archived" ? G.restoreGroupBulk() : G.archiveGroupBulk();
    }
    // Підсумок у заголовку
    const summary = $("st-summary");
    if (summary){
      const act = all.filter(s => !s.archived), gAll = new Set(act.flatMap(s => s._groups)).size;
      summary.innerHTML = `<b>${act.length}</b> ${_plural(act.length, "студент", "студенти", "студентів")} у <b>${gAll}</b> ${_plural(gAll, "групі", "групах", "групах")}`;
    }
    const chip = $("st-page-chip");
    if (chip){
      const g = all.filter(s => !s.archived).flatMap(s => s._graded);
      chip.textContent = g.length ? `Середній бал ${_stFmt1(g.reduce((a, b) => a + b, 0) / g.length)}` : "Ще немає оцінок";
    }
    const badge = $("nb-students");
    if (badge){ const n = all.filter(s => !s.archived).length; badge.textContent = n; badge.style.display = n ? "" : "none"; }
  },

  renderStudents(){
    const body = $("students-body");
    if (!body) return;
    const all = _stDerive();
    G.refreshStGroupFilters(all);
    const q = _rpNorm($("student-srch")?.value || "");
    const grp = window._stGroup || "";
    const tab = window._stTab || "active";

    let list = all.filter(s => tab === "archived" ? !!s.archived : !s.archived);
    if (q) list = list.filter(s => _rpNorm(`${s.surname} ${s.name}`).includes(q) || _rpNorm(`${s.name} ${s.surname}`).includes(q));
    if (grp) list = list.filter(s => s._groups.includes(grp));

    const gbar = $("st-group-bar");
    if (gbar){
      gbar.hidden = !grp;
      if (grp){ $("st-gbar-name").textContent = grp; $("st-gbar-count").textContent = list.length; }
    }

    const PAGE_SIZE = 20;
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (window._stPage == null || window._stFiltersChanged){ window._stPage = 1; window._stFiltersChanged = false; }
    window._stPage = Math.min(Math.max(1, window._stPage), totalPages);
    const page = window._stPage, from = (page - 1) * PAGE_SIZE, to = Math.min(from + PAGE_SIZE, list.length);
    const pageList = list.slice(from, to);
    const cntEl = $("st-list-count");
    if (cntEl) cntEl.textContent = list.length ? (totalPages > 1 ? `${from + 1}–${to} з ${list.length}` : `${list.length}`) : "0";

    if (!list.length){
      body.innerHTML = `<div class="st-empty">
        <div class="st-empty-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="4"/><path d="M3 21c0-4 4-7 9-7s9 3 9 7"/></svg></div>
        <div class="st-empty-title">${q || grp ? "Нічого не знайдено" : tab === "archived" ? "Архів порожній" : "Ще немає студентів"}</div>
        <div class="st-empty-hint">${q || grp ? "Спробуйте змінити запит або групу" : tab === "archived" ? "Сюди потрапляють заархівовані студенти й групи" : "Студенти з'являться після першого проходження тесту"}</div>
      </div>`;
      G.selectStudent(null);
      return;
    }

    const rows = pageList.map(s => {
      const initials = _stInit(s), color = _stAvaColor(s);
      const n = s._att.length;
      return `<tr class="${window._selectedStId === s.id ? "is-selected" : ""}" data-st-id="${esc(s.id)}">
        <td>
          <div class="st-stud">
            <div class="st-ava" style="background:linear-gradient(135deg, ${color}DD, ${color})">${esc(initials)}</div>
            <div class="st-stud-info">
              <div class="st-stud-name">${esc(`${s.surname || ""} ${s.name || ""}`.trim() || "Без імені")}${s._flags ? `<span class="st-stud-flag" title="Спроб з підозрілою активністю: ${s._flags}">${_svg(_IC.flag, 11)}${s._flags}</span>` : ""}</div>
              <div class="st-stud-sub">${n} ${_plural(n, "спроба", "спроби", "спроб")}${s._pending ? ` · ${s._pending} на перевірці` : ""}${s._last ? ` · ${timeAgo(s._last)}` : ""}</div>
            </div>
          </div>
        </td>
        <td>${s._groups.length ? s._groups.map(g => `<span class="st-pill">${esc(g)}</span>`).join(" ") : `<span class="st-none">—</span>`}</td>
        <td class="mono">${n}</td>
        <td class="mono ${_stTone(s._avg)}">${_stFmt1(s._avg)}</td>
        <td class="mono ${_stTone(s._best)}">${s._best ?? "—"}</td>
        <td class="mono">${s._pass != null ? s._pass + "%" : "—"}</td>
      </tr>`;
    }).join("");

    let pagHtml = "";
    if (totalPages > 1){
      let a = Math.max(1, page - 2), b = Math.min(totalPages, a + 4); a = Math.max(1, b - 4);
      const btn = (p, label, dis, cls = "") => `<button type="button" class="st-pg-btn ${cls}" ${dis ? "disabled" : `data-st-page="${p}"`}>${label}</button>`;
      const nums = [];
      if (a > 1){ nums.push(btn(1, "1")); if (a > 2) nums.push(`<span class="st-pg-ellipsis">…</span>`); }
      for (let p = a; p <= b; p++) nums.push(btn(p, String(p), false, p === page ? "is-active" : ""));
      if (b < totalPages){ if (b < totalPages - 1) nums.push(`<span class="st-pg-ellipsis">…</span>`); nums.push(btn(totalPages, String(totalPages))); }
      const chev = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="${d}"/></svg>`;
      pagHtml = `<div class="st-pagination">${btn(page - 1, chev("15 18 9 12 15 6"), page <= 1, "prev")}${nums.join("")}${btn(page + 1, chev("9 18 15 12 9 6"), page >= totalPages, "next")}</div>`;
    }

    body.innerHTML = `<table class="st-tbl">
      <thead><tr><th>Студент</th><th>Група</th><th>Спроб</th><th title="Середня оцінка за оціненими спробами">Сер. бал</th><th>Кращий</th><th title="Частка оцінених спроб з оцінкою 4 і вище">Склав</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${pagHtml}`;

    // Профіль праворуч: вибраний, або перший на сторінці
    if (window._selectedStId && list.some(s => s.id === window._selectedStId)) G.selectStudent(window._selectedStId, true);
    else G.selectStudent(pageList[0].id);
  },

  setStudentsPage(page){
    window._stPage = page;
    window._selectedStId = null;
    G.renderStudents();
    $("students-body")?.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  searchStudents(){
    window._stFiltersChanged = true;
    G.renderStudents();
  },

  selectStudent(id, skipTableUpdate){
    window._selectedStId = id;
    if (!skipTableUpdate) document.querySelectorAll("#students-body tr[data-st-id]").forEach(tr => tr.classList.toggle("is-selected", tr.dataset.stId === id));
    const noneEl = $("pf-none"), contEl = $("pf-content");
    if (!contEl || !noneEl) return;
    const s = id ? _stFind(id) : null;
    if (!s){ noneEl.style.display = "block"; contEl.style.display = "none"; contEl.innerHTML = ""; return; }
    noneEl.style.display = "none"; contEl.style.display = "block";

    const att = s._att, color = _stAvaColor(s);
    const fullName = `${s.surname || ""} ${s.name || ""}`.trim() || "Студент";
    const nGraded = att.filter(a => a.grade != null).length;
    const chart = _stChart(att, 12);
    const recent = [...att].reverse().slice(0, 5);
    const listHtml = recent.length ? `<div class="pf-list">${recent.map(a => `<button type="button" class="pf-li" onclick="G.viewAtt('${esc(a.id)}')">
        <span class="pf-li-l"><b>${esc(a.title)}</b><small>${_stDate(a.date)}${a.group ? " · " + esc(a.group) : ""}</small></span>
        ${a.flags ? `<span class="pf-li-flag" title="Підозріла активність">${_svg(_IC.flag, 12)}</span>` : ""}
        <span class="pf-grade" style="color:${_stColor(a.grade)};background:${_stBg(a.grade)}">${a.pending ? _svg(_IC.clock, 12) : a.grade != null ? a.grade : "—"}</span>
      </button>`).join("")}</div>`
      : `<div class="pf-empty">Жодної спроби ще немає</div>`;

    contEl.innerHTML = `
      <div class="pf-head">
        <div class="pf-ava" style="background:${color}">${esc(_stInit(s))}</div>
        <div class="pf-info">
          <div class="pf-name">${esc(fullName)}</div>
          <div class="pf-groups">${s._groups.length ? s._groups.map(g => `<span>${esc(g)}</span>`).join("") : `<em>без групи</em>`}${s.archived ? `<span class="arch">в архіві</span>` : ""}</div>
          <div class="pf-status">${s._last ? `Остання спроба ${timeAgo(s._last)}` : "Ще не проходив(ла) тести"}</div>
        </div>
      </div>
      <div class="pf-stat">
        <div><b>${att.length}</b><span>${_plural(att.length, "спроба", "спроби", "спроб")}</span></div>
        <div style="background:${_stBg(s._avg)}"><b style="color:${_stColor(s._avg)}">${_stFmt1(s._avg)}</b><span>середня</span></div>
        <div><b style="color:${_stColor(s._best)}">${s._best ?? "—"}</b><span>найкраща</span></div>
      </div>
      ${s._pending || s._flags ? `<div class="pf-notes">
        ${s._pending ? `<div class="pf-note">${_svg(_IC.clock, 13)} ${s._pending} ${_plural(s._pending, "спроба чекає", "спроби чекають", "спроб чекають")} перевірки</div>` : ""}
        ${s._flags ? `<div class="pf-note warn">${_svg(_IC.flag, 13)} Підозріла активність у ${s._flags} ${_plural(s._flags, "спробі", "спробах", "спробах")}</div>` : ""}
      </div>` : ""}
      <div class="pf-block"><div class="pf-block-h">Динаміка оцінок${nGraded ? `<span>останні ${Math.min(12, nGraded)}</span>` : ""}</div>
        ${chart || `<div class="pf-empty">${att.length ? "Оцінок ще немає — спроби на перевірці" : "Поки що немає історії"}</div>`}</div>
      <div class="pf-block"><div class="pf-block-h">Останні спроби${att.length > recent.length ? `<button type="button" onclick="G.viewStudentAttempts('${esc(s.id)}')">усі ${att.length}</button>` : ""}</div>${listHtml}</div>
      <div class="pf-foot">
        <button class="pf-btn primary" type="button" onclick="G.openStudentCard('${esc(s.id)}')">${_svg(_IC.users, 14)} Відкрити картку</button>
        <div class="pf-foot-row">
          <button class="pf-btn" type="button" onclick="G.viewStudentAttempts('${esc(s.id)}')">${_svg(_IC.list, 14)} Усі спроби</button>
          <button class="pf-btn" type="button" title="${s.archived ? "Повернути у список активних" : "Приховати зі списку активних, дані збережуться"}" onclick="G.archiveStudent('${esc(s.id)}', ${s.archived ? "false" : "true"})">${_svg(_IC.archive, 14)} ${s.archived ? "Відновити" : "В архів"}</button>
          <button class="pf-btn danger ico" type="button" title="Видалити картку" aria-label="Видалити картку" onclick="G.deleteStudent('${esc(s.id)}')">${_svg(_IC.trash, 15)}</button>
        </div>
      </div>`;
  },

  // «Усі спроби» — сторінка спроб з пошуком за цим студентом
  viewStudentAttempts(id){
    const s = _stFind(id); if (!s) return;
    location.href = "attempts?q=" + encodeURIComponent(`${s.surname || ""} ${s.name || ""}`.trim());
  },

  async archiveStudent(id, archived){
    const idx = _students.findIndex(s => s.id === id);
    if (idx < 0) return;
    await dbUpd(`students/${id}`, { archived, archivedAt: archived ? Date.now() : null });
    _students = _students.map(s => s.id === id ? { ...s, archived, archivedAt: archived ? Date.now() : null } : s);
    toast(archived ? "Студента архівовано" : "Студента відновлено");
    window._selectedStId = null;
    G.renderStudents();
  },
  async archiveGroupBulk(){
    const grp = window._stGroup || "";
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
    const grp = window._stGroup || "";
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
    const grp = window._stGroup || "";
    if (!grp) return;
    const tab = window._stTab || "active";
    const targets = _students.filter(s => (s.groups||[]).includes(grp) && (tab === "archived" ? !!s.archived : !s.archived));
    if (!targets.length){ toast("Немає студентів для видалення в цій групі","err"); return; }
    const grpLinks = links.filter(l => l.group === grp);
    const grpLinkIds = new Set(grpLinks.map(l => l.id));
    const linkAttemptIds = attempts.filter(a => grpLinkIds.has(a.linkId) || a.group === grp).map(a => a.id);
    const studentAttemptIds = targets.flatMap(s => (_stFind(s.id)?._att || []).map(a => a.id));
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
    // Одним записом у базу (раніше — окремий запит на кожну спробу, студента й посилання)
    const upd = {};
    targets.forEach(s => { upd[`students/${s.id}`] = null; });
    grpLinks.forEach(l => { upd[`links/${l.id}`] = null; });
    attemptIds.forEach(aid => { upd[`attempts/${aid}`] = null; });
    Object.entries(_stIndex).forEach(([k, v]) => { if (targets.some(t => t.id === v)) { upd[`studentIndex/${k}`] = null; delete _stIndex[k]; } });
    try { await update(ref(db, `teachers/${_uid}`), upd); } catch (e) { toast("Не вдалося видалити: " + e.message, "err"); return; }
    const ids = new Set(targets.map(s => s.id));
    const linkIds = new Set(grpLinks.map(l => l.id));
    _students = _students.filter(s => !ids.has(s.id));
    links = links.filter(l => !linkIds.has(l.id));
    const delSet = new Set(attemptIds);
    attempts = attempts.filter(a => !delSet.has(a.id));
    window.links = links;
    window.attempts = attempts;
    toast(`Видалено групу «${grp}»: ${targets.length} студентів, ${grpLinks.length} посилань, ${attemptIds.length} спроб`);
    window._selectedStId = null;
    G.selectStFilter("");
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
      window._adCur = a.id;
      const dateStr = a.finishedAt || a.createdAt
        ? new Date(a.finishedAt || a.createdAt).toLocaleString("uk-UA", { day:"numeric", month:"long", hour:"2-digit", minute:"2-digit" })
        : "—";
      let durStr = "";
      if (a.finishedAt && a.startedAt && a.finishedAt > a.startedAt){
        const secs = Math.floor((a.finishedAt - a.startedAt) / 1000);
        durStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2,"0")}`;
      }
      const pctRaw = (a.score?.percent != null) ? a.score.percent : null;
      const group = a.group || l?.group || "";
      const fullName = `${a.surname || ""} ${a.name || ""}`.trim() || "Без імені";
      const has = v => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
      const IC_OK = _svg(_IC.check, 13), IC_X = _svg(_IC.x, 13);

      // ── Питання ──
      const cnt = { ok: 0, partial: 0, bad: 0, none: 0, pending: 0 };
      const qHtml = qs.map((q, i) => {
        const rawAns = ans[i];
        const userAns = (rawAns !== null && rawAns !== undefined && typeof rawAns === "object" && !Array.isArray(rawAns) && "value" in rawAns)
          ? rawAns.value : rawAns;
        const det = a.score?.details?.[i];
        const pts = det?.points;
        let st = "none";
        if (q.type === "long"){
          const lr = det?.longResult;
          st = lr === "correct" ? "ok" : lr === "partial" ? "partial" : lr === "wrong" ? "bad" : "pending";
        } else if (has(userAns)){
          if (pts > 0) st = pts >= (q.points || 1) ? "ok" : "partial";
          else if (pts === 0) st = "bad";
          else if (rawAns && typeof rawAns === "object" && "correct" in rawAns) st = rawAns.correct ? "ok" : "bad";
        }
        cnt[st]++;
        const ptsStr = pts != null ? (pts > 0 ? "+" + pts : String(pts)) : "";

        let body = "";
        if (q.type === "single" || q.type === "multi"){
          const opts = q.options || [];
          const userIdxs = (Array.isArray(userAns) ? userAns : (userAns != null ? [userAns] : [])).map(Number);
          const correctIdxs = (Array.isArray(q.correct) ? q.correct : (q.correct != null ? [q.correct] : [])).map(Number);
          body = '<div class="ad-opts">' + opts.map((o, j) => {
            const ch = userIdxs.includes(j), co = correctIdxs.includes(j);
            const cls = ch && co ? "cc" : ch ? "wc" : co ? "cm" : "pl";
            const tag = ch && co ? "відповідь студента" : ch ? "відповідь студента" : co ? "правильна" : "";
            return `<div class="ad-opt ${cls}"><span class="ad-opt-ico">${co ? IC_OK : ch ? IC_X : ""}</span><span class="ad-opt-t">${esc(String(o ?? ""))}</span>${tag ? `<em>${tag}</em>` : ""}</div>`;
          }).join("") + '</div>';
          if (!userIdxs.length) body += '<div class="ad-noans">Студент не відповів</div>';
        } else if (q.type === "text" || q.type === "number"){
          const ua = (userAns != null && userAns !== "" && typeof userAns !== "object") ? String(userAns) : null;
          const cv = q.correct != null ? String(q.correct) : (q.answer != null ? String(q.answer) : null);
          body = `<div class="ad-kv"><span>Відповідь студента</span><b class="${ua ? (st === "ok" ? "ok" : "bad") : "none"}">${ua ? esc(ua) : "немає"}</b></div>`;
          if (st !== "ok" && cv) body += `<div class="ad-kv"><span>Правильна відповідь</span><b class="ok">${esc(cv)}</b></div>`;
        } else if (q.type === "order"){
          const ua = Array.isArray(userAns) ? userAns : [];
          body = ua.length ? `<ol class="ad-order">${ua.map(x => `<li>${esc(String(x))}</li>`).join("")}</ol>` : '<div class="ad-noans">Студент не відповів</div>';
        } else if (q.type === "long"){
          const ua = (userAns != null && userAns !== "" && typeof userAns !== "object") ? String(userAns).trim() : null;
          body = `<div class="ad-long-text${ua ? "" : " empty"}">${ua ? esc(ua) : "Немає відповіді"}</div>`;
          if (a.grade12 == null){
            const lr = det?.longResult || "";
            const b = (v, cls, ic, t) => `<button type="button" class="${cls}${lr === v ? " active" : ""}" onclick="G.setLongAnswer('${esc(a.id)}', ${i}, '${v}')">${ic}${t}</button>`;
            body += `<div class="ad-long-grade">${b("correct", "g-ok", IC_OK, "Правильно")}${b("partial", "g-partial", _svg(_IC.minus, 13), "Частково")}${b("wrong", "g-bad", IC_X, "Неправильно")}</div>`;
          }
        } else if (has(userAns)){
          body = `<div class="ad-kv"><span>Відповідь студента</span><b>${esc(typeof userAns === "object" ? JSON.stringify(userAns) : String(userAns))}</b></div>`;
        } else body = '<div class="ad-noans">Студент не відповів</div>';

        return `<div class="ad-q ${st}"><div class="ad-q-head"><span class="ad-q-n">${i + 1}</span>`
          + `<div class="ad-q-text"><span class="qf-rich">${q.text || q.question || ""}</span></div>`
          + (ptsStr ? `<span class="ad-q-pts ${st}">${ptsStr}</span>` : st === "pending" ? `<span class="ad-q-pts pending">${_svg(_IC.clock, 12)}</span>` : "")
          + `</div>${body}</div>`;
      }).join("");

      // ── Оцінювання вручну + ШІ ──
      const longIdxs = qs.map((_q, qi) => qi).filter(qi => qs[qi].type === "long");
      const allLongGraded = longIdxs.length === 0 || longIdxs.every(qi => a.score?.details?.[qi]?.longResult);
      const hasGrade = a.grade12 != null;
      const canAnalyse = allLongGraded && hasGrade;
      const tone = g => g == null ? "none" : g >= 10 ? "best" : g >= 7 ? "good" : g >= 4 ? "mid" : "bad";

      let gradePicker = "";
      if (a.status === "pending_review"){
        gradePicker = allLongGraded
          ? `<div class="ad-grade-pick"><div class="ad-gp-label">Виставте оцінку<span>шкала 1–12${pctRaw != null ? ` · результат ${pctRaw}%` : ""}</span></div><div class="ad-gp-grid">${
              Array.from({ length: 12 }, (_, k) => k + 1).map(g => `<button type="button" class="t-${tone(g)}${a.grade12 === g ? " on" : ""}" onclick="G.setManualGrade('${esc(a.id)}', ${g})">${g}</button>`).join("")}</div></div>`
          : `<div class="ad-pending">${_svg(_IC.clock, 16)}<span>Оцініть відкриті відповіді нижче — після цього можна буде виставити оцінку</span></div>`;
      }

      let aiBlock = "";
      const aiText = a.personalAnalysis || a.aiComment || "";
      if (aiText || canAnalyse || window._AI_ANALYSIS !== false){
        aiBlock = `<div class="ad-ai"><div class="ad-ai-h"><span class="ad-ai-ico">${_svg(_IC.spark, 18)}</span>
            <div class="ad-ai-t"><b>Розбір від ШІ</b><small>${aiText ? "Що студент не зрозумів і що варто повторити" : canAnalyse ? "Короткий персональний розбір помилок студента" : hasGrade ? "Спершу оцініть відкриті відповіді" : "Стане доступним після виставлення оцінки"}</small></div>
            ${aiText ? `<button type="button" class="ad-ai-btn" onclick="G.personalAnalysis('${esc(a.id)}')">Відкрити</button>`
              : canAnalyse ? `<button type="button" class="ad-ai-btn pri" onclick="G.personalAnalysis('${esc(a.id)}')">${_svg(_IC.spark, 13)} Згенерувати</button>` : ""}
          </div>${aiText ? `<div class="ad-ai-body" onclick="G.personalAnalysis('${esc(a.id)}')">${esc(aiText.replace(/\s+/g, " ").trim())}</div>` : ""}</div>`;
      }

      // ── Шапка з оцінкою ──
      const g12 = a.grade12;
      const total = qs.length || 1;
      const seg = (n, cls) => n ? `<i class="${cls}" style="flex:${n}"></i>` : "";
      const lg = (n, cls, t) => n ? `<span><i class="${cls}"></i>${n} ${t}</span>` : "";
      let html = `<div class="ad-head">
          <div class="ad-ava" style="background:${_stAvaColor(a)}">${esc(_stInit(a))}</div>
          <div class="ad-who"><h2>${esc(fullName)}</h2><div class="ad-sub">${esc(t?.title || "Тест видалено")}${group ? ` <span class="ad-grp">${esc(group)}</span>` : ""}</div></div>
        </div>
        <div class="ad-body">
          <div class="ad-sum">
            <div class="ad-grade t-${tone(g12)}">${g12 != null ? `<b>${g12}</b><span>із 12</span>` : `${_svg(_IC.clock, 22)}<span>перевірка</span>`}</div>
            <div class="ad-sum-r">
              <div class="ad-sum-top"><b>${pctRaw != null ? pctRaw + "%" : "—"}</b><span>${cnt.ok} з ${qs.length} правильно</span></div>
              <div class="ad-seg">${seg(cnt.ok, "ok")}${seg(cnt.partial, "partial")}${seg(cnt.bad, "bad")}${seg(cnt.pending, "pending")}${seg(cnt.none, "none")}${qs.length ? "" : `<i class="none" style="flex:1"></i>`}</div>
              <div class="ad-lg">${lg(cnt.ok, "ok", "правильно")}${lg(cnt.partial, "partial", "частково")}${lg(cnt.bad, "bad", _plural(cnt.bad, "помилка", "помилки", "помилок"))}${lg(cnt.pending, "pending", "на перевірці")}${lg(cnt.none, "none", "без відповіді")}</div>
              <div class="ad-sum-meta">${durStr ? `${_svg(_IC.clock, 12)} ${durStr} хв · ` : ""}${esc(dateStr)}</div>
            </div>
          </div>
          ${gradePicker}${aiBlock}
          <div class="ad-qs" data-f="all">
            <div class="ad-qs-h"><b>Питання</b>${qs.length ? `<div class="ad-filt">
              <button type="button" class="on" onclick="G._adFilter(this,'all')">Усі <i>${qs.length}</i></button>
              ${cnt.bad + cnt.partial + cnt.none ? `<button type="button" onclick="G._adFilter(this,'bad')">Помилки <i>${cnt.bad + cnt.partial + cnt.none}</i></button>` : ""}
              ${cnt.ok ? `<button type="button" onclick="G._adFilter(this,'ok')">Правильні <i>${cnt.ok}</i></button>` : ""}
              ${cnt.pending ? `<button type="button" onclick="G._adFilter(this,'pending')">Перевірити <i>${cnt.pending}</i></button>` : ""}
            </div>` : ""}</div>
            ${qHtml || '<div class="ad-empty">Немає даних про відповіді</div>'}
          </div>
        </div>
        <div class="ad-foot">
          <button type="button" class="ad-btn-sec" onclick="closeM('m-attempt');location.href='attempts?q='+encodeURIComponent(${esc(JSON.stringify(fullName))})">${_svg(_IC.list, 15)} Усі спроби студента</button>
          <button type="button" class="ad-btn-sec danger" onclick="G.confDelAttempt('${esc(a.id)}')">${_svg(_IC.trash, 15)} Видалити</button>
        </div>`;

      const target = document.getElementById("att-det");
      if (!target){ toast("Помилка: модалка не готова","err"); return; }
      target.innerHTML = html;
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
 
  // Фільтр питань у деталях спроби: усі / помилки / правильні / на перевірку
  _adFilter(btn, f){
    const box = btn.closest(".ad-qs"); if (!box) return;
    box.dataset.f = f;
    box.querySelectorAll(".ad-filt button").forEach(b => b.classList.toggle("on", b === btn));
  },

    async personalAnalysis(attId, force){
    const a=attempts.find(x=>x.id===attId);
    if(!a){ toast("Спробу не знайдено","err"); return; }

    // Якщо вже є збережений аналіз — показуємо (навіть коли генерацію вимкнено)
    if(a.personalAnalysis && !force){
      G._showAiPanel(a.personalAnalysis, attId); return;
    }
    if(window._AI_ANALYSIS===false){ toast("Персональний аналіз вимкнено адміністратором","err"); return; }

    // Відкриваємо панель зі скелетоном
    G._aiPanelOpen(attId, `<div class="ai-wait"><div class="ai-wait-h"><span class="ai-spin"></span>Аналізую відповіді студента…</div>
      <i style="width:92%"></i><i style="width:78%"></i><i style="width:85%"></i><i style="width:60%"></i><span class="ai-gap"></span><i style="width:88%"></i><i style="width:70%"></i></div>`, true);

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
        const text="Студент відповів правильно на всі питання! Відмінна робота.";
        await dbUpd(`attempts/${attId}`,{personalAnalysis:text});
        a.personalAnalysis=text;
        G._showAiPanel(text, attId); return;
      }

      const prompt = `Ти репетитор. Студент ${esc(a.name)} ${esc(a.surname)} отримав оцінку ${a.grade12}/12 за тест "${t?.title || ""}". Помилкові відповіді: ${wrongList.slice(0, 8).join("")}. Напиши короткий персональний розбір (5–8 речень): що студент не зрозумів, на що звернути увагу, як виправити знання. Звертайся до студента напряму.`;
      const res=await callGroq([{role:"user",content:prompt}],600,0.5,"analysis");
      await dbUpd(`attempts/${attId}`,{personalAnalysis:res});
      a.personalAnalysis=res;
      G._showAiPanel(res, attId);
      if(window._adCur===attId && document.getElementById("m-attempt")?.classList.contains("on")) G.viewAtt(attId);
    }catch(e){
      G._aiPanelOpen(attId, `<div class="ai-err">${_svg(_IC.x, 16)}<div><b>Не вдалося отримати розбір</b><span>${esc(e.message)}</span></div></div>
        <button type="button" class="btn bs" onclick="G.personalAnalysis('${esc(attId)}', true)">${_svg(_IC.refresh, 14)} Спробувати ще раз</button>`, true);
    }
  },

  // Панель розбору: шапка зі студентом, тіло, дії
  _aiPanelOpen(attId, bodyHtml, busy){
    const a=attempts.find(x=>x.id===attId)||{}, t=tests.find(x=>x.id===a.testId);
    const who=document.getElementById("ai-side-who");
    if(who) who.innerHTML=`<b>${esc(`${a.surname||""} ${a.name||""}`.trim()||"Студент")}</b><span>${esc(t?.title||"")}${a.grade12!=null?` · ${a.grade12}/12`:""}</span>`;
    document.getElementById("ai-side-content").innerHTML=bodyHtml;
    const f=document.getElementById("ai-side-foot");
    if(f){ f.hidden=!!busy; f.dataset.id=attId; }
    const p=document.getElementById("ai-side-panel");
    p.classList.add("on"); p.dataset.open="1";   // data-open: глобальний Esc спершу закриває панель, а не модалку під нею
    if(!G._aiEsc){ G._aiEsc=true; addEventListener("keydown",e=>{ if(e.key==="Escape"&&document.getElementById("ai-side-panel")?.classList.contains("on")){ e.stopImmediatePropagation(); e.preventDefault(); G.closeAiPanel(); } }, true); }
    document.getElementById("ai-side-overlay").style.display="block";
    G._aiText=busy?"":(a.personalAnalysis||"");
  },

  _showAiPanel(text, attId){
    // Абзаци, списки («•», «-», «1.») і **жирний** — з уже екранованого тексту
    const inl=v=>esc(v).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>");
    const blocks=String(text||"").replace(/\r/g,"").split(/\n\s*\n/).map(b=>b.trim()).filter(Boolean);
    const html=blocks.map(b=>{
      const lines=b.split("\n").map(x=>x.trim()).filter(Boolean);
      const isLi=x=>/^([•\-*–]|\d+[.)])\s+/.test(x);
      if(lines.some(isLi)){
        let out="", open=false;
        lines.forEach(x=>{
          if(isLi(x)){ if(!open){ out+="<ul>"; open=true; } out+=`<li>${inl(x.replace(/^([•\-*–]|\d+[.)])\s+/,""))}</li>`; }
          else { if(open){ out+="</ul>"; open=false; } out+=`<p>${inl(x)}</p>`; }
        });
        return out+(open?"</ul>":"");
      }
      return `<p>${lines.map(inl).join("<br>")}</p>`;
    }).join("");
    G._aiPanelOpen(attId, `<div class="ai-panel-text">${html}</div><div class="ai-note">${_svg(_IC.spark, 12)} Згенеровано ШІ — перевірте перед тим, як ділитися зі студентом</div>`);
    G._aiText=text;
  },

  async copyAiText(){
    try{ await navigator.clipboard.writeText(G._aiText||""); toast("Розбір скопійовано"); }
    catch{ toast("Не вдалося скопіювати","err"); }
  },

  closeAiPanel(){
    const p=document.getElementById("ai-side-panel");
    p.classList.remove("on"); delete p.dataset.open;
    document.getElementById("ai-side-overlay").style.display="none";
  },

  openStudentCard(id){
    const s = _stFind(id);
    if (!s) return;
    const att = s._att, g = s._graded, color = _stAvaColor(s);
    const tests_ = new Set(att.map(a => a.testId)).size;
    const passN = g.filter(v => v >= 4).length;
    const chart = _stChart(att, 24);
    const rows = [...att].reverse().map(a => `<tr onclick="closeM('m-student');G.viewAtt('${esc(a.id)}')" title="Відкрити спробу">
        <td class="sc-t">${esc(a.title)}${a.flags ? `<span class="sc-flag" title="Підозріла активність">${_svg(_IC.flag, 12)}</span>` : ""}</td>
        <td>${a.pending ? `<span class="sc-pill pend">${_svg(_IC.clock, 12)} перевірка</span>` : a.grade != null ? `<span class="sc-pill" style="color:${_stColor(a.grade)};background:${_stBg(a.grade)}">${a.grade}/12</span>` : "—"}</td>
        <td>${a.percent != null ? `<span class="sc-pct"><i><b style="width:${Math.max(2, Math.min(100, a.percent))}%;background:${a.grade != null ? _stBar(a.grade) : "#94A3B8"}"></b></i>${a.percent}%</span>` : "—"}</td>
        <td class="sc-m">${esc(a.group || "—")}</td>
        <td class="sc-m sc-d">${_stDate(a.date)}</td>
      </tr>`).join("");
    $("m-student-body").innerHTML = `
      <div class="sc-head">
        <div class="sc-ava" style="background:${color}">${esc(_stInit(s))}</div>
        <div class="sc-who">
          <div class="sc-name"><span id="sc-fullname">${esc(`${s.surname || ""} ${s.name || ""}`.trim())}</span>
            <button type="button" class="sc-edit" onclick="G.editStudentName('${esc(s.id)}')" title="Змінити ім'я" aria-label="Змінити ім'я">${_svg(_IC.pencil, 13)}</button></div>
          <div class="sc-groups">${s._groups.length ? s._groups.map(x => `<span>${esc(x)}</span>`).join("") : `<em>Без групи</em>`}${s.archived ? `<span class="arch">в архіві</span>` : ""}</div>
          <div class="sc-meta">${s._last ? `Остання спроба ${timeAgo(s._last)}` : "Ще не проходив(ла) тести"}</div>
        </div>
      </div>
      <div class="sc-kpis">
        <div class="hl" style="background:${_stBg(s._avg)}"><b style="color:${_stColor(s._avg)}">${_stFmt1(s._avg)}</b><span>Середня оцінка</span></div>
        <div><b>${att.length}</b><span>${_plural(att.length, "Спроба", "Спроби", "Спроб")} · ${tests_} ${_plural(tests_, "тест", "тести", "тестів")}</span></div>
        <div><b>${passN}${g.length ? `<small>/${g.length}</small>` : ""}</b><span>Склав (≥ 4)</span></div>
        <div><b style="color:${_stColor(s._best)}">${s._best ?? "—"}</b><span>Найкраща</span></div>
      </div>
      ${chart ? `<div class="sc-sec"><div class="sc-sec-h">Динаміка оцінок<span>від старіших до нових</span></div>${chart}</div>` : ""}
      <div class="sc-sec"><div class="sc-sec-h">Спроби<span>${att.length ? "натисніть, щоб відкрити" : ""}</span></div>
        ${att.length ? `<div class="sc-tbl-w"><table class="sc-tbl"><thead><tr><th>Тест</th><th>Оцінка</th><th>Результат</th><th>Група</th><th>Дата</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : `<div class="sc-empty">${_svg(_IC.inbox, 16)} Немає спроб</div>`}
      </div>
      <div class="sc-foot">
        <button type="button" class="btn bs" onclick="G.openMergeModal('${esc(s.id)}')">${_svg(_IC.link, 14)} Об'єднати з іншою карткою</button>
        <button type="button" class="btn bs sc-del" onclick="G.deleteStudent('${esc(s.id)}')">${_svg(_IC.trash, 14)} Видалити картку</button>
      </div>`;
    openM("m-student");
  },


  openMergeModal(sourceId){
    closeM("m-merge");  // на випадок якщо вже відкрито
    closeM("m-student");
    const source = _stFind(sourceId);
    if(!source) return;
    window._mergeSourceId = sourceId;
    window._mergeTargetId = null;

    document.getElementById("m-merge-sub").textContent =
      `Об'єднати картку "${source.surname} ${source.name}" з:`;

    // Показуємо всіх студентів крім поточного
    const list = document.getElementById("m-merge-list");
    const others = _stDerive().filter(s=>s.id!==sourceId);

    if(!others.length){
      list.innerHTML=`<div class="m-empty">Немає інших карток для об'єднання</div>`;
      document.getElementById("merge-confirm-btn").disabled=true;
    } else {
      list.innerHTML = others.map(s=>{
        return `<button type="button" class="m-opt merge-item" id="mi-${esc(s.id)}" data-name="${esc((s.surname||'')+ ' '+(s.name||''))}" onclick="G.selectMergeTarget('${esc(s.id)}')">
          <span class="m-opt-ava">${esc(((s.surname||"")[0]||"") + ((s.name||"")[0]||"")).toUpperCase() || "?"}</span>
          <span class="m-opt-b"><b>${esc(s.surname)} ${esc(s.name)}</b><small>${s._att.length} ${_plural(s._att.length, "спроба", "спроби", "спроб")} · середня ${_stFmt1(s._avg)}${s._groups.length ? " · " + esc(s._groups.join(", ")) : ""}</small></span>
          <span class="m-opt-radio"></span>
        </button>`;
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
    window._mergeTargetId = targetId;
    document.querySelectorAll(".merge-item").forEach(el => el.classList.toggle("on", el.id === `mi-${targetId}`));
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

    // Одним записом: target отримує спроби, source видаляється, а всі ключі імені
    // source у studentIndex тепер ведуть на target. Інакше наступна спроба під
    // старим написанням імені знову створювала окрему картку.
    const upd = { [`students/${targetId}/attempts`]: merged, [`students/${targetId}/groups`]: groups, [`students/${targetId}/avgGrade`]: avgGrade, [`students/${targetId}/lastSeen`]: Date.now(), [`students/${sourceId}`]: null };
    const srcKeys = new Set([_stKey(source.name, source.surname), ...Object.entries(_stIndex).filter(([, v]) => v === sourceId).map(([k]) => k)]);
    srcKeys.forEach(k => { upd[`studentIndex/${k}`] = targetId; _stIndex[k] = targetId; });
    try { await update(ref(db, `teachers/${_uid}`), upd); }
    catch (e) { toast("Не вдалося об'єднати: " + e.message, "err"); btn.disabled = false; btn.textContent = "Об'єднати"; return; }

    _students = _students.filter(s=>s.id!==sourceId);
    _students = _students.map(s => s.id === targetId ? { ...s, attempts: merged, groups, avgGrade } : s);
    window._selectedStId = targetId;

    closeM("m-merge");
    G.renderStudents();
    toast(`Картки об'єднано: ${merged.length} спроб`);
    btn.disabled=false; btn.textContent="Об'єднати";
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
      // Нове написання теж веде на цю картку (старе лишається — студент може й далі так писати)
      const nk = _stKey(name, surname);
      const upd = { [`students/${sid}/surname`]: surname, [`students/${sid}/name`]: name };
      if (!_stIndex[nk] || !_students.some(x => x.id === _stIndex[nk])) { upd[`studentIndex/${nk}`] = sid; _stIndex[nk] = sid; }
      await update(ref(db, `teachers/${_uid}`), upd);
      _students = _students.map(x => x.id === sid ? { ...x, surname, name } : x);

      closeM("m-edit-student");
      G.renderStudents();
      toast("Ім'я збережено");
      // Повертаємо картку студента з оновленими даними
      G.openStudentCard(sid);
    } catch(e){
      errEl.textContent = "Помилка: " + e.message;
    }
    btn.disabled = false; btn.textContent = "Зберегти";
  },

  deleteStudent(id){
    const s=_stFind(id);
    if(!s) return;
    const nameEl=document.getElementById("del-student-name");
    if(nameEl) nameEl.textContent=`${s.surname} ${s.name}`;
    document.getElementById("del-student-confirm-btn").onclick = async () => {
      closeM("m-del-student");
      const attemptIds = s._att.map(a => a.id);
      const upd = { [`students/${id}`]: null };
      attemptIds.forEach(aid => { upd[`attempts/${aid}`] = null; });
      Object.entries(_stIndex).forEach(([k, v]) => { if (v === id) { upd[`studentIndex/${k}`] = null; delete _stIndex[k]; } });
      try { await update(ref(db, `teachers/${_uid}`), upd); } catch (e) { toast("Не вдалося видалити: " + e.message, "err"); return; }
      const del = new Set(attemptIds);
      _students=_students.filter(x=>x.id!==id);
      attempts=attempts.filter(a=>!del.has(a.id));
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

  // ═══ ПІДОЗРІЛІ ════════════════════════════════════════════════════════
  setSuspTab(tab){ SP.tab = tab; SP.limit = 20; G.renderSuspicious(); },
  setSuspLevel(lv){ SP.level = SP.level === lv ? "" : lv; SP.limit = 20; G.renderSuspicious(); },
  resetSuspFilters(){
    Object.assign(SP, { group: "", test: "", period: "", level: "", limit: 20 });
    G.renderSuspicious();
  },
  toggleSuspCase(id){
    SP.open.has(id) ? SP.open.delete(id) : SP.open.add(id);
    document.querySelector(`.case[data-case-id="${CSS.escape(id)}"]`)?.classList.toggle("expanded", SP.open.has(id));
  },
  async setSuspReviewed(id, on){
    const a = attempts.find(x => x.id === id); if (!a) return;
    const prev = a.suspReviewed ?? null;
    a.suspReviewed = on ? Date.now() : null;
    SP.open.delete(id);
    G.renderSuspicious(); _suspBadge();
    try {
      await dbUpd(`attempts/${id}`, { suspReviewed: a.suspReviewed });
      toast(on ? "Позначено як переглянуте" : "Повернуто в «Потребують уваги»");
    } catch (e) {
      a.suspReviewed = prev; G.renderSuspicious(); _suspBadge();
      toast("Не вдалося зберегти: " + e.message, "err");
    }
  },

  renderSuspicious(){
    const body = $("suspicious-body");
    if (!body) return;
    const onPage = !!document.querySelector("#sec-suspicious.on");
    if (!SP.bound) _spBind();

    const all = attempts.filter(_isSusp).map(a => {
      const l = a.linkId ? links.find(x => x.id === a.linkId) : null;
      return { a, score: _suspScore(a), at: _suspAt(a), group: a.group || l?.group || "", reviewed: !!a.suspReviewed };
    });

    // «Нові з останнього візиту»: підсвічуємо до кінця візиту, у базі — одна позначка часу
    if (onPage && _suspMeta.loaded) {
      if (SP.seen == null) {
        SP.seen = _suspMeta.seenAt;
        if (SP.seen == null) {           // старий формат (лічильник) → останні N за часом
          const n = Math.max(0, all.length - _suspMeta.readCount);
          [...all].sort((x, y) => y.at - x.at).slice(0, n).forEach(c => SP.fresh.add(c.a.id));
        }
      }
      const newer = all.filter(c => !c.reviewed && SP.seen != null && c.at > SP.seen);
      newer.forEach(c => SP.fresh.add(c.a.id));
      const maxAt = Math.max(Date.now(), ...all.map(c => c.at));
      if (SP.seen == null || newer.length || _suspMeta.seenAt == null) {
        SP.seen = maxAt;
        _suspMeta.seenAt = maxAt;
        dbUpd("meta", { suspSeenAt: maxAt, suspReadCount: null }).catch(() => {});
      }
      _suspBadge();
    }

    // Фільтри (без рівня — він обирається карткою KPI)
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const since = SP.period === "today" ? now.getTime() : SP.period ? Date.now() - (+SP.period) * 864e5 : 0;
    const scope = all.filter(c =>
      (!SP.group || c.group === SP.group) &&
      (!SP.test || c.a.testId === SP.test) &&
      (!since || c.at >= since));
    const tabCnt = { open: scope.filter(c => !c.reviewed).length, reviewed: scope.filter(c => c.reviewed).length, all: scope.length };
    const inTab = SP.tab === "all" ? scope : scope.filter(c => SP.tab === "reviewed" ? c.reviewed : !c.reviewed);
    const lvOf = c => c.score >= 10 ? "high" : c.score >= 5 ? "mid" : "low";
    const rows = (SP.level ? inTab.filter(c => lvOf(c) === SP.level) : inTab)
      .sort(SP.sort === "new" ? (x, y) => y.at - x.at : (x, y) => y.score - x.score || y.at - x.at);

    // Шапка
    const openAll = all.filter(c => !c.reviewed);
    const high = openAll.filter(c => c.score >= 10).length;
    const hc = $("sp-cases-count");
    if (hc) hc.textContent = openAll.length
      ? `${openAll.length} ${_plural(openAll.length, "потребує", "потребують", "потребують")} уваги${SP.fresh.size ? ` · ${SP.fresh.size} ${_plural(SP.fresh.size, "нова", "нові", "нових")}` : ""}`
      : "Усе переглянуто";
    const chip = $("sp-status-chip");
    if (chip) {
      chip.className = "sp-chip " + (high ? "bad" : openAll.length ? "warn" : "ok");
      chip.textContent = high ? `${high} з високим ризиком` : openAll.length ? "Є що перевірити" : "Усе спокійно";
    }

    // KPI (у межах вкладки й фільтрів)
    const kpi = $("sp-kpi-grid");
    if (kpi) {
      const n = { high: 0, mid: 0, low: 0 };
      inTab.forEach(c => n[lvOf(c)]++);
      const done = attempts.filter(a => (a.status === "completed" || a.status === "pending_review") &&
        (!SP.group || (a.group || links.find(l => l.id === a.linkId)?.group || "") === SP.group) &&
        (!SP.test || a.testId === SP.test) && (!since || _suspAt(a) >= since));
      const clean = done.length - scope.length;
      const card = (lv, cls, label, v, sub) => `<button type="button" class="risk-card ${cls}${SP.level === lv ? " on" : ""}" data-sp-level="${lv}" aria-pressed="${SP.level === lv}">
          <div class="risk-l">${label}</div><div class="risk-score ${cls}">${v}</div><div class="sub">${sub}</div></button>`;
      kpi.innerHTML =
        card("high", "bad", "Високий ризик", n.high, "10+ балів · скріншоти, копіювання") +
        card("mid", "warn", "Середній ризик", n.mid, "5–9 балів") +
        card("low", "info", "Низький ризик", n.low, "до 5 балів · 1–2 виходи") +
        `<div class="risk-card good"><div class="risk-l">Чесні спроби</div>
          <div class="risk-score good">${done.length ? Math.round(clean / done.length * 100) + "%" : "—"}</div>
          <div class="sub">${clean} з ${done.length} без жодного порушення</div></div>`;
    }

    // Вкладки, дропдауни, лічильник
    document.querySelectorAll("#sp-tabs [data-sp-tab]").forEach(b => {
      b.classList.toggle("on", b.dataset.spTab === SP.tab);
      const c = b.querySelector(".cnt"); if (c) c.textContent = tabCnt[b.dataset.spTab];
    });
    const gCount = new Map(), tCount = new Map();
    all.forEach(c => { if (c.group) gCount.set(c.group, (gCount.get(c.group) || 0) + 1); tCount.set(c.a.testId, (tCount.get(c.a.testId) || 0) + 1); });
    const gItems = [{ value: "", label: "Усі групи" }, ...[...gCount].sort((x, y) => x[0].localeCompare(y[0], "uk")).map(([g, n]) => ({ value: g, label: g, count: n }))];
    const tItems = [{ value: "", label: "Усі тести" }, ...[...tCount].map(([id, n]) => ({ value: id, label: tests.find(t => t.id === id)?.title || "Видалений тест", count: n })).sort((x, y) => x.label.localeCompare(y.label, "uk"))];
    const pItems = [{ value: "", label: "За весь час" }, { value: "today", label: "Сьогодні" }, { value: "7", label: "Останні 7 днів" }, { value: "30", label: "Останні 30 днів" }];
    const sItems = [{ value: "risk", label: "Спершу ризиковані" }, { value: "new", label: "Спершу нові" }];
    if (!SP.drops.group && $("sp-f-group")) {
      const re = () => { SP.limit = 20; G.renderSuspicious(); };
      SP.drops.group  = qfDrop($("sp-f-group"),  { items: gItems, value: SP.group, width: 200, searchPlaceholder: "Пошук групи…", icon: _RP_IC_GROUP, onChange: v => { SP.group = v; re(); } });
      SP.drops.test   = qfDrop($("sp-f-test"),   { items: tItems, value: SP.test, width: 260, searchPlaceholder: "Пошук тесту…", icon: _RP_IC_TEST, onChange: v => { SP.test = v; re(); } });
      SP.drops.period = qfDrop($("sp-f-period"), { items: pItems, value: SP.period, width: 180, search: false, onChange: v => { SP.period = v; re(); } });
      SP.drops.sort   = qfDrop($("sp-f-sort"),   { items: sItems, value: SP.sort, defaultValue: "risk", width: 190, search: false, onChange: v => { SP.sort = v; re(); } });
    } else if (SP.drops.group) {
      SP.drops.group.setItems(gItems); SP.drops.group.set(SP.group);
      SP.drops.test.setItems(tItems);  SP.drops.test.set(SP.test);
      SP.drops.period.set(SP.period);  SP.drops.sort.set(SP.sort);
    }
    const filtered = !!(SP.group || SP.test || SP.period || SP.level);
    const rst = $("sp-reset"); if (rst) rst.hidden = !filtered;
    const meta = $("sp-fb-meta"); if (meta) meta.textContent = `${rows.length} ${_plural(rows.length, "випадок", "випадки", "випадків")}`;

    if (!rows.length) {
      const ok = !filtered && SP.tab !== "reviewed";
      body.innerHTML = `<div class="sp-empty">
        <div class="ei">${ok ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`}</div>
        <div class="et">${filtered ? "За цими фільтрами нічого немає" : SP.tab === "reviewed" ? "Переглянутих поки немає" : SP.tab === "open" && all.length ? "Усе переглянуто" : "Підозрілих спроб немає"}</div>
        <div class="es">${filtered ? `<button type="button" class="sp-link" data-sp-reset>Скинути фільтри</button>` : SP.tab === "reviewed" ? "Позначайте випадки переглянутими — вони переїдуть сюди" : "Студенти проходили тести без порушень"}</div>
      </div>`;
      return;
    }

    const shown = rows.slice(0, SP.limit);
    body.innerHTML = `<div class="case-list">${shown.map(_spCase).join("")}</div>` + (rows.length > shown.length
      ? `<button type="button" class="sp-more" data-sp-more>Показати ще ${Math.min(20, rows.length - shown.length)} · залишилось ${rows.length - shown.length}</button>` : "");
  },
  // ═══ ЖУРНАЛ ОЦІНОК ═══════════════════════════════════════════════════
  initGradebook(){
    if (!GB.bound && $("gradebook-body")){
      GB.bound = true;
      $("gb-q")?.addEventListener("input", e => { GB.q = e.target.value; G.renderGradebook(); });
      $("gradebook-body").addEventListener("click", e => {
        const att = e.target.closest("[data-att]"); if (att) return G.viewAtt(att.dataset.att);
        const grp = e.target.closest("[data-gb-group]"); if (grp) return G._gbSetGroup(grp.dataset.gbGroup);
        const srt = e.target.closest("[data-sort]"); if (srt){ GB.sort = GB.sort === srt.dataset.sort && srt.dataset.sort !== "name" ? "name" : srt.dataset.sort; G.renderGradebook(); }
      });
      _rpBindTips($("gradebook-body"));
    }
    G.renderGradebook();
  },
  _gbSetGroup(g){
    GB.group = g; GB.test = "";
    try { localStorage.setItem("qf_gb_group", g); } catch {}
    G.renderGradebook();
  },

  renderGradebook(){
    const body = $("gradebook-body"); if (!body) return;
    const rows = _rpRows();
    if (!GB.urlDone){
      const p = new URLSearchParams(location.search);
      if (p.get("group")) GB.group = p.get("group");
      GB.test = p.get("test") || "";
      GB.urlDone = true;
    }
    const gItems = _rpGroupItems(rows);
    // Група не обрана — остання з цього пристрою або єдина наявна
    if (!GB.group && rows.length){
      let last = ""; try { last = localStorage.getItem("qf_gb_group") || ""; } catch {}
      GB.group = gItems.some(i => i.value === last) ? last : gItems.length === 1 ? gItems[0].value : "";
    }
    const inGroup = GB.group ? rows.filter(r => r.group === GB.group) : [];
    const tItems = _rpTestItems(inGroup, "Усі тести");
    if (GB.test && rows.length && !tItems.some(i => i.value === GB.test)) GB.test = "";

    const gDropItems = GB.group && !gItems.some(i => i.value === GB.group) ? [...gItems, { value: GB.group, label: GB.group, count: 0 }] : gItems;
    if (!GB.drops.group && $("gb-f-group")){
      GB.drops.group = qfDrop($("gb-f-group"), { items: gDropItems, value: GB.group || "", placeholder: "Оберіть групу", width: 220, searchPlaceholder: "Пошук групи…", icon: _RP_IC_GROUP, onChange: v => G._gbSetGroup(v) });
      GB.drops.test = qfDrop($("gb-f-test"), { items: tItems, value: GB.test, width: 280, searchPlaceholder: "Пошук тесту…", icon: _RP_IC_TEST, onChange: v => { GB.test = v; G.renderGradebook(); } });
    } else if (GB.drops.group){
      GB.drops.group.setItems(gDropItems); GB.drops.group.set(GB.group || "");
      GB.drops.test.setItems(tItems); GB.drops.test.set(GB.test);
    }
    ["gb-export-csv", "gb-export-html", "gb-q"].forEach(id => { const el = $(id); if (el) el.disabled = !GB.group; });
    _rpUrl({ group: GB.group, test: GB.test });

    if (!rows.length){
      body.innerHTML = `<div class="rp-empty"><div class="rp-empty-ic">${_svg(_IC.list, 24)}</div><b>Поки немає результатів</b><span>Коли студенти пройдуть тести за посиланнями, оцінки з'являться тут</span></div>`;
      return;
    }
    if (!GB.group){
      body.innerHTML = `<div class="rp-empty"><div class="rp-empty-ic">${_svg(_IC.users, 24)}</div><b>Оберіть групу</b><span>Журнал складається окремо для кожної групи</span>
        <div class="rp-chips">${gItems.map(g => `<button type="button" class="rp-chip" data-gb-group="${esc(g.value)}">${esc(g.label)}<i>${g.count}</i></button>`).join("")}</div></div>`;
      return;
    }
    const d = _gbBuild(rows);
    if (!d.list.length){
      body.innerHTML = `<div class="rp-empty"><div class="rp-empty-ic">${_svg(_IC.list, 24)}</div><b>Немає завершених спроб</b><span>У групі «${esc(GB.group)}» поки немає оцінок${GB.test ? " за цим тестом" : ""}</span></div>`;
      return;
    }

    // Пошук і сортування
    const q = _rpNorm(GB.q);
    let list = q ? d.list.filter(s => _rpNorm(`${s.surname} ${s.name}`).includes(q)) : [...d.list];
    const byName = (a, b) => (a.surname || "").localeCompare(b.surname || "", "uk") || (a.name || "").localeCompare(b.name || "", "uk");
    if (GB.sort === "avg") list.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || byName(a, b));
    else if (GB.sort === "debts") list.sort((a, b) => b.debts - a.debts || (a.avg ?? 99) - (b.avg ?? 99) || byName(a, b));
    else list.sort(byName);

    const allGrades = d.list.flatMap(s => d.cols.map(c => s.cells[c.id]?.best).filter(v => v != null));
    const groupAvg = _rpAvg(allGrades);
    const debtStud = d.list.filter(s => s.debts).length;
    const pend = d.list.reduce((n, s) => n + d.cols.filter(c => s.cells[c.id]?.pending && s.cells[c.id]?.best == null).length, 0);
    const arrow = k => GB.sort === k ? " ↓" : "";

    body.innerHTML = `
      <div class="rp-kpis">
        <div class="rp-kpi"><span>Студентів</span><b>${d.list.length}</b><small>у групі ${esc(GB.group)}</small></div>
        <div class="rp-kpi"><span>Тестів</span><b>${d.cols.length}</b><small>${allGrades.length} ${_plural(allGrades.length, "оцінка", "оцінки", "оцінок")}</small></div>
        <div class="rp-kpi"><span>Середній бал</span><b class="t-${_rpTone(groupAvg)}">${_r1(groupAvg)}</b><small>за шкалою 1–12</small></div>
        <div class="rp-kpi" data-sort="debts" style="cursor:pointer" title="Показати спершу студентів із заборгованостями"><span>Мають оцінку &lt; 4</span><b class="${debtStud ? "t-bad" : "t-best"}">${debtStud}</b><small>${debtStud ? "натисніть, щоб показати їх першими" : "заборгованостей немає"}${pend ? ` · ${pend} на перевірці` : ""}</small></div>
      </div>
      <div class="gb-card">
        <div class="gb-scroll">
          <table class="gb-tbl">
            <thead><tr>
              <th class="gb-sticky"><button type="button" class="gb-sort${GB.sort === "name" ? " on" : ""}" data-sort="name">Студент${arrow("name")}</button></th>
              ${d.cols.map((c, i) => { const st = d.colStats[i]; return `<th class="gb-th-test" title="${esc(c.title)}"><div class="gb-th-t">${esc(c.title)}</div><div class="gb-th-s">${st.n ? `ø ${_r1(st.avg)} · склали ${st.pass}/${st.n}` : "немає оцінок"}</div></th>`; }).join("")}
              <th class="gb-th-avg"><button type="button" class="gb-sort${GB.sort === "avg" ? " on" : ""}" data-sort="avg">Середня${arrow("avg")}</button></th>
            </tr></thead>
            <tbody>${list.length ? list.map(s => `<tr>
              <td class="gb-sticky gb-stud"><b>${esc(s.surname)}</b> ${esc(s.name)}${s.debts ? `<span class="gb-debt" title="Оцінок нижче 4: ${s.debts}">${s.debts}</span>` : ""}</td>
              ${d.cols.map(c => {
                const x = s.cells[c.id];
                if (!x) return `<td class="gb-c"><span class="gb-miss" title="Не проходив(ла)">—</span></td>`;
                if (x.best == null) return `<td class="gb-c"><button type="button" class="gb-cell t-pend" data-att="${esc(x.pending || "")}" data-tip="Очікує перевірки викладача">${_svg(_IC.clock, 13)}</button></td>`;
                return `<td class="gb-c"><button type="button" class="gb-cell t-${_rpTone(x.best)}" data-att="${esc(x.id)}" data-tip="${esc(c.title)}<br><b>${x.best}/12</b>${x.tries > 1 ? ` · найкраща з ${x.tries} спроб` : ""}">${x.best}${x.tries > 1 ? `<sup>×${x.tries}</sup>` : ""}</button></td>`;
              }).join("")}
              <td class="gb-c gb-avg t-${_rpTone(s.avg)}">${_r1(s.avg)}</td>
            </tr>`).join("") : `<tr><td class="gb-sticky gb-none" colspan="${d.cols.length + 2}">Нікого не знайдено за «${esc(GB.q)}»</td></tr>`}</tbody>
            <tfoot><tr>
              <td class="gb-sticky">Середнє по групі</td>
              ${d.colStats.map(st => `<td class="gb-c t-${_rpTone(st.avg)}">${_r1(st.avg)}</td>`).join("")}
              <td class="gb-c t-${_rpTone(groupAvg)}">${_r1(groupAvg)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>
      <div class="gb-legend">
        <span><i class="t-best"></i>10–12</span><span><i class="t-good"></i>7–9</span><span><i class="t-mid"></i>4–6</span><span><i class="t-bad"></i>1–3</span>
        <span>${_svg(_IC.clock, 12)} на перевірці</span><span>— не проходив(ла)</span><span><sup>×2</sup> кілька спроб, показано найкращу</span>
        <span class="gb-legend-hint">Натисніть на оцінку, щоб відкрити спробу</span>
      </div>`;
  },

  exportGradebook(format = "csv"){
    if (!GB.group){ toast("Спочатку виберіть групу", "err"); return; }
    const d = _gbBuild(_rpRows());
    if (!d.list.length){ toast("Немає даних для експорту", "err"); return; }
    const list = [...d.list].sort((a, b) => (a.surname || "").localeCompare(b.surname || "", "uk") || (a.name || "").localeCompare(b.name || "", "uk"));
    const cell = x => !x ? "" : x.best != null ? x.best : x.pending ? "на перевірці" : "";
    const dateStr = new Date().toLocaleDateString("uk-UA");
    const fname = `Журнал ${GB.group} ${dateStr}`;
    if (format === "csv"){
      const rows = [["Прізвище", "Ім'я", ...d.cols.map(c => c.title), "Середня"],
        ...list.map(s => [s.surname, s.name, ...d.cols.map(c => cell(s.cells[c.id])), s.avg == null ? "" : _r1(s.avg)]),
        ["Середнє по групі", "", ...d.colStats.map(st => st.avg == null ? "" : _r1(st.avg)), _r1(_rpAvg(list.map(s => s.avg).filter(v => v != null)))]];
      _rpDownload(fname + ".csv", new Blob([_rpCsv(rows)], { type: "text/csv;charset=utf-8" }));
      toast("CSV завантажено");
      return;
    }
    const col = g => g == null ? "#8691AC" : g >= 10 ? "#15803D" : g >= 7 ? "#1E40AF" : g >= 4 ? "#B45309" : "#B91C1C";
    const html = `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Журнал оцінок — ${esc(GB.group)} — ${dateStr}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;padding:32px;background:#F4F6FB;color:#0B1437}
  h1{font-size:22px;font-weight:800;margin-bottom:4px}
  .meta{font-size:13px;color:#5B6A8F;margin-bottom:22px}
  table{border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(11,20,55,.08);min-width:60%}
  th{background:#1E3A8A;color:#fff;padding:10px 12px;font-size:12px;text-align:center;font-weight:700}
  th:first-child,td:first-child{text-align:left}
  td{padding:9px 12px;border-bottom:1px solid #E3E8F2;font-size:14px;text-align:center;font-variant-numeric:tabular-nums}
  tfoot td{background:#F4F6FB;font-weight:700}
  .foot{margin-top:16px;font-size:12px;color:#8691AC}
  @media print{body{background:#fff;padding:0}table{box-shadow:none}th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h1>Журнал оцінок — ${esc(GB.group)}</h1>
<div class="meta">${dateStr} · ${list.length} ${_plural(list.length, "студент", "студенти", "студентів")} · ${d.cols.length} ${_plural(d.cols.length, "тест", "тести", "тестів")} · шкала 1–12</div>
<table><thead><tr><th>Студент</th>${d.cols.map(c => `<th>${esc(c.title)}</th>`).join("")}<th>Середня</th></tr></thead>
<tbody>${list.map(s => `<tr><td>${esc(s.surname)} ${esc(s.name)}</td>${d.cols.map(c => { const x = s.cells[c.id]; const v = cell(x); return `<td style="color:${col(x?.best)};font-weight:700">${v === "" ? "—" : esc(String(v))}</td>`; }).join("")}<td style="font-weight:800;color:${col(s.avg)}">${_r1(s.avg)}</td></tr>`).join("")}</tbody>
<tfoot><tr><td>Середнє по групі</td>${d.colStats.map(st => `<td>${_r1(st.avg)}</td>`).join("")}<td>${_r1(_rpAvg(list.map(s => s.avg).filter(v => v != null)))}</td></tr></tfoot></table>
<div class="foot">Сформовано в QuizFlow · найкраща оцінка з кількох спроб</div>
</body></html>`;
    _rpDownload(fname + ".html", new Blob([html], { type: "text/html;charset=utf-8" }));
    toast("HTML-звіт завантажено");
  },

  // ─── SHARE TEST ──────────────────────────────────────────────────────────────
  _shareTestId: null,
  _shareSelectedUid: null,

  _shareUsers: [],

  _renderShareList(query=""){
    const list=document.getElementById("share-teachers-list");
    if(!list) return;
    const norm=v=>String(v||"").toLowerCase().replace(/ё/g,"е").trim();
    const words=norm(query).split(/\s+/).filter(Boolean);
    const all=G._shareUsers;
    // Шукаємо по кожному слову окремо: «мельник андрій», «a.melnyk», «@itstep»
    const filtered=words.length ? all.filter(u=>words.every(w=>u._q.includes(w))) : all;
    const cnt=document.getElementById("share-count");
    if(cnt) cnt.textContent=words.length ? `Знайдено: ${filtered.length}` : `${all.length} ${_plural(all.length,"викладач","викладачі","викладачів")}`;
    if(!filtered.length){ list.innerHTML=`<div class="m-empty">Нікого не знайдено за «${esc(query.trim())}»</div>`; return; }
    const hl=v=>{ let h=esc(v||""); if(!words.length) return h;
      const re=new RegExp("("+words.map(w=>esc(w).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")","gi");
      return h.replace(re,"<mark>$1</mark>"); };
    const recent=G._shareRecent();
    list.innerHTML=filtered.map(u=>{
      const meta=[u.login?"@"+u.login:"", u.email||""].filter(Boolean);
      return `<button type="button" class="m-opt sh-opt${G._shareSelectedUid===u.id?" on":""}" onclick="G._selectShareTeacher('${esc(u.id)}')">
        <span class="m-opt-ava" style="background:${u._c}1F;color:${u._c}">${esc(u._ini)}</span>
        <span class="m-opt-b"><b><span class="sh-n">${hl(u._full)}</span>${u.role==="admin"?`<i class="sh-tag">адмін</i>`:""}${recent.includes(u.id)?`<i class="sh-tag rec">нещодавно</i>`:""}</b>
          <small>${meta.length?meta.map(hl).join(" · "):"логін не вказано"}</small></span>
        <span class="m-opt-radio"></span>
      </button>`;
    }).join("");
  },

  _shareRecent(){ try{ return JSON.parse(localStorage.getItem("qf_share_recent")||"[]"); }catch{ return []; } },

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
    btn.disabled=false; btn.textContent="Надіслати копію";
    const list=document.getElementById("share-teachers-list");
    list.innerHTML=`<div class="m-empty">Завантаження…</div>`;
    openM("m-share");
    try{
      const {get:_g,ref:_r}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const snap=await _g(_r(db,"users"));
      if(!snap.exists()){ list.innerHTML=`<div class="m-empty">Немає викладачів</div>`; return; }
      const recent=G._shareRecent();
      G._shareUsers=Object.entries(snap.val()).map(([id,u])=>({id,...u})).filter(u=>u.id!==_uid&&!u.blocked&&u.role!=="student").map(u=>{
        const full=[u.surname,u.name].filter(Boolean).join(" ")||u.login||u.email||"Без імені";
        const ini=((u.surname||"")[0]||"")+((u.name||"")[0]||"");
        return {...u,_full:full,_ini:(ini||full[0]||"?").toUpperCase(),_c:_stAvaColor(u),
          _q:[full,u.name,u.login,u.email].map(v=>String(v||"").toLowerCase().replace(/ё/g,"е")).join(" ")};
      }).sort((a,b)=>{ const ra=recent.indexOf(a.id), rb=recent.indexOf(b.id);
        return (ra<0?99:ra)-(rb<0?99:rb) || a._full.localeCompare(b._full,"uk"); });
      if(!G._shareUsers.length){ list.innerHTML=`<div class="m-empty">Немає інших викладачів</div>`; return; }
      G._renderShareList();
    }catch(e){ list.innerHTML="<div style='color:#be123c;font-size:13px'>"+esc(e.message)+"</div>"; }
  },

  async doShareTest(){
    const errEl=document.getElementById("share-err");
    if(!G._shareSelectedUid){ errEl.textContent="Оберіть викладача"; return; }
    const test=tests.find(t=>t.id===G._shareTestId);
    if(!test) return;
    const btn=document.getElementById("share-btn");
    btn.disabled=true; btn.textContent="Надсилаю…";
    try{
      const {push:_p,ref:_r,set:_s}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const newRef=_p(_r(db,"teachers/"+G._shareSelectedUid+"/tests"));
      await _s(newRef,{
        title:test.title, description:test.description||"",
        questions:test.questions||[], timeLimit:test.timeLimit||600,
        status:"draft", folderId:null, tags:test.tags||[],
        sharedFrom:_user.name||_user.login, sharedAt:ts(), createdAt:ts()
      });
      try{ localStorage.setItem("qf_share_recent", JSON.stringify([G._shareSelectedUid,...G._shareRecent().filter(x=>x!==G._shareSelectedUid)].slice(0,5))); }catch{}
      const nRef=_p(_r(db,"teachers/"+G._shareSelectedUid+"/notifications"));
      const senderName=esc(_user.name||_user.login);
      const testName=esc(test.title);
      await _s(nRef,{
        title:"Новий тест від "+senderName,
        msg:"<strong>"+senderName+"</strong> поділився тестом «<strong>"+testName+"</strong>»",
        color:"#2d5be3", read:false, ts:ts(),
        sharedTestId: newRef.key,
        actionLabel: "Відкрити тест →"
      });
      closeM("m-share");
      toast("Тест надіслано");
    }catch(e){ errEl.textContent="Помилка: "+e.message; btn.disabled=false; btn.textContent="Надіслати копію"; }
  }
,

  // ═══ АНАЛІТИКА ════════════════════════════════════════════════════════
  renderAnalytics(){
    const body = $("analytics-body"); if (!body) return;
    const rows = _rpRows();
    if (!AN.urlDone){
      const p = new URLSearchParams(location.search);
      AN.group = p.get("group") || ""; AN.test = p.get("test") || "";
      AN.urlDone = true;
    }
    if (!AN.bound){
      AN.bound = true;
      body.addEventListener("click", e => {
        const att = e.target.closest("[data-att]"); if (att) return G.viewAtt(att.dataset.att);
        if (e.target.closest("[data-an-more]")){ AN.showAll = true; G.renderAnalytics(); }
        if (e.target.closest("[data-an-allq]")){ AN.allQ = !AN.allQ; G.renderAnalytics(); }
        const t = e.target.closest("[data-an-test]"); if (t){ AN.test = t.dataset.anTest; G.renderAnalytics(); }
      });
      _rpBindTips(body);
    }
    const gItems = _rpGroupItems(rows, "Усі групи");
    const inGroup = AN.group ? rows.filter(r => r.group === AN.group) : rows;
    const tItems = _rpTestItems(inGroup, "Усі тести");
    if (AN.test && rows.length && !tItems.some(i => i.value === AN.test)) AN.test = "";
    if (!AN.drops.group && $("an-f-group")){
      AN.drops.group = qfDrop($("an-f-group"), { items: gItems, value: AN.group, width: 220, searchPlaceholder: "Пошук групи…", icon: _RP_IC_GROUP, onChange: v => { AN.group = v; AN.showAll = false; G.renderAnalytics(); } });
      AN.drops.test = qfDrop($("an-f-test"), { items: tItems, value: AN.test, width: 280, searchPlaceholder: "Пошук тесту…", icon: _RP_IC_TEST, onChange: v => { AN.test = v; AN.showAll = false; AN.allQ = false; G.renderAnalytics(); } });
    } else if (AN.drops.group){
      AN.drops.group.setItems(gItems); AN.drops.group.set(AN.group);
      AN.drops.test.setItems(tItems); AN.drops.test.set(AN.test);
    }
    _rpUrl({ group: AN.group, test: AN.test });
    const t = AN.test ? tests.find(x => x.id === AN.test) : null;
    const chip = $("a-chip");
    if (chip) chip.textContent = [t?.title || (AN.test ? "Тест видалено" : ""), AN.group].filter(Boolean).join(" · ") || "Усі групи й тести";

    const sel = inGroup.filter(r => !AN.test || r.a.testId === AN.test);
    if (!sel.length){
      body.innerHTML = `<div class="rp-empty"><div class="rp-empty-ic">${_svg(_IC.chart, 24)}</div><b>${rows.length ? "Немає результатів за цими фільтрами" : "Поки немає результатів"}</b><span>${rows.length ? "Оберіть іншу групу або тест" : "Аналітика з'явиться, щойно студенти пройдуть тести"}</span></div>`;
      return;
    }

    const graded = sel.filter(r => r.grade != null);
    const grades = graded.map(r => r.grade);
    const avg = _rpAvg(grades);
    const pass = grades.filter(g => g >= 4).length, fail = grades.length - pass;
    const pendN = sel.filter(r => r.a.status === "pending_review").length;
    const passRate = grades.length ? Math.round(pass / grades.length * 100) : 0;
    const students = new Set(sel.map(r => r.key)).size;

    // Розподіл оцінок 1–12
    const dist = Array.from({ length: 12 }, (_, i) => grades.filter(g => g === i + 1).length);
    const maxC = Math.max(1, ...dist);

    // Динаміка: середня оцінка по тижнях (лише якщо є хоча б 2 тижні з оцінками)
    const wk = new Map();
    graded.forEach(r => { if (!r.t) return; const k = _weekStart(r.t); const w = wk.get(k) || { s: 0, n: 0 }; w.s += r.grade; w.n++; wk.set(k, w); });
    const weeks = [...wk].sort((a, b) => a[0] - b[0]).slice(-12).map(([k, w]) => ({ k, avg: w.s / w.n, n: w.n }));
    let trend = "", half = false;
    if (weeks.length >= 2){
      // Ширина — за контейнером, щоб текст осей не збільшувався разом із графіком
      // На широкому екрані графік стоїть поруч із розподілом — половина ширини
      const bw = body.clientWidth || 900; half = bw >= 980;
      const W = Math.max(380, Math.round((half ? (bw - 22) / 2 : bw) - 46)), H = half ? 262 : 200, L = 30, R = 14, T = 12, B = 26;
      const x = i => L + (W - L - R) * (i / (weeks.length - 1));
      const y = v => T + (H - T - B) * (1 - v / 12);
      const fmtW = k => new Date(k).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
      const pts = weeks.map((w, i) => `${x(i).toFixed(1)},${y(w.avg).toFixed(1)}`).join(" ");
      const every = Math.ceil(weeks.length / 6);
      trend = `<div class="a-card"><div class="a-card-h"><h3>Середня оцінка по тижнях</h3><span class="a-card-h-meta">останні ${weeks.length} ${_plural(weeks.length, "тиждень", "тижні", "тижнів")} з результатами</span></div>
        <div class="a-card-body"><svg class="a-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Середня оцінка по тижнях">
          ${[4, 8, 12].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="a-grid"/><text x="${L - 8}" y="${y(v) + 4}" class="a-ax" text-anchor="end">${v}</text>`).join("")}
          <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="a-base"/>
          <polyline points="${pts}" class="a-line"/>
          ${weeks.map((w, i) => `<circle cx="${x(i)}" cy="${y(w.avg)}" r="4.5" class="a-dot"/>
            <circle cx="${x(i)}" cy="${y(w.avg)}" r="14" class="a-hit" data-tip="Тиждень з ${fmtW(w.k)}<br><b>ø ${_r1(w.avg)}</b> · ${w.n} ${_plural(w.n, "оцінка", "оцінки", "оцінок")}"/>
            ${(i % every === 0 && weeks.length - 1 - i >= every) || i === weeks.length - 1 ? `<text x="${x(i)}" y="${H - 6}" class="a-ax" text-anchor="${i === 0 ? "start" : i === weeks.length - 1 ? "end" : "middle"}">${fmtW(w.k)}</text>` : ""}`).join("")}
        </svg></div></div>`;
    }

    // Складність питань — лише для одного тесту: частка правильних відповідей на кожне питання
    let diff = "";
    if (t && Array.isArray(t.questions) && t.questions.length){
      const st = new Map(t.questions.map((q, i) => [q.id, { q, i, ok: 0, part: 0, n: 0, skip: 0 }]));
      sel.forEach(r => (Array.isArray(r.a.answers) ? r.a.answers : []).forEach(a => {
        const s = st.get(a?.questionId); if (!s) return;
        const has = a.value !== null && a.value !== undefined && a.value !== "" && !(Array.isArray(a.value) && !a.value.length);
        if (!has){ s.skip++; return; }
        s.n++; if (a.correct) s.ok++; else if (a.partial) s.part++;
      }));
      const qs = [...st.values()].filter(s => s.n + s.skip > 0).map(s => ({ ...s, pct: s.n ? Math.round((s.ok + s.part * .5) / (s.n + s.skip) * 100) : 0 }))
        .sort((a, b) => a.pct - b.pct || a.i - b.i);
      if (qs.length){
        const shown = AN.allQ ? qs : qs.slice(0, 8);
        diff = `<div class="a-card"><div class="a-card-h"><h3>Складність питань</h3><span class="a-card-h-meta">частка правильних відповідей · спершу найважчі</span></div>
          <div class="a-card-body a-qs">${shown.map(s => {
            const txt = _rpPlain(s.q.text) || "Питання без тексту";
            return `<div class="a-q" data-tip="Питання ${s.i + 1}<br>правильно ${s.ok}${s.part ? ` · частково ${s.part}` : ""} · неправильно ${s.n - s.ok - s.part}${s.skip ? ` · без відповіді ${s.skip}` : ""}">
              <span class="a-q-n">${s.i + 1}</span>
              <span class="a-q-t">${esc(txt.length > 120 ? txt.slice(0, 120) + "…" : txt)}${s.pct < 40 ? `<em>складне</em>` : ""}</span>
              <span class="a-q-bar"><i class="${s.pct < 40 ? "t-bad" : s.pct < 70 ? "t-mid" : "t-best"}" style="width:${Math.max(s.pct, 1)}%"></i></span>
              <span class="a-q-v">${s.pct}%</span>
            </div>`; }).join("")}
            ${qs.length > 8 ? `<button type="button" class="a-more" data-an-allq>${AN.allQ ? "Згорнути" : `Показати всі ${qs.length}`}</button>` : ""}
          </div></div>`;
      }
    } else if (!AN.test){
      // Без обраного тесту — швидкий вибір найчастіших тестів, щоб подивитись складність питань
      const top = tItems.slice(1).sort((a, b) => b.count - a.count).slice(0, 5);
      if (top.length) diff = `<div class="a-card"><div class="a-card-h"><h3>Складність питань</h3><span class="a-card-h-meta">оберіть тест</span></div>
        <div class="a-card-body"><div class="rp-chips" style="justify-content:flex-start;margin:0">${top.map(i => `<button type="button" class="rp-chip" data-an-test="${esc(i.value)}">${esc(i.label)}<i>${i.count}</i></button>`).join("")}</div></div></div>`;
    }

    // Результати
    const done = [...graded].sort((a, b) => b.grade - a.grade || b.t - a.t);
    const lim = AN.showAll ? done : done.slice(0, 30);

    body.innerHTML = `
      <div class="rp-kpis">
        <div class="rp-kpi"><span>Результатів</span><b>${sel.length}</b><small>${students} ${_plural(students, "студент", "студенти", "студентів")}${pendN ? ` · ${pendN} на перевірці` : ""}</small></div>
        <div class="rp-kpi"><span>Середня оцінка</span><b class="t-${_rpTone(avg)}">${_r1(avg)}</b><small>${grades.length ? `мін ${Math.min(...grades)} · макс ${Math.max(...grades)}` : "немає оцінок"}</small></div>
        <div class="rp-kpi"><span>Склали (≥ 4)</span><b class="t-best">${pass}</b><small>${passRate}% оцінених</small></div>
        <div class="rp-kpi"><span>Не склали (&lt; 4)</span><b class="${fail ? "t-bad" : ""}">${fail}</b><small>${grades.length ? 100 - passRate : 0}% оцінених</small></div>
      </div>
      <div class="${trend && half ? "a-row" : ""}" style="${trend && half ? "" : "display:contents"}">
      <div class="a-card">
        <div class="a-card-h"><h3>Розподіл оцінок</h3><span class="a-card-h-meta">${grades.length} ${_plural(grades.length, "оцінка", "оцінки", "оцінок")} · шкала 1–12</span></div>
        <div class="a-card-body">
          <div class="a-dist">${dist.map((c, i) => `<div class="a-dist-col" data-tip="Оцінка ${i + 1}<br><b>${c}</b> ${_plural(c, "результат", "результати", "результатів")}${grades.length ? ` · ${Math.round(c / grades.length * 100)}%` : ""}">
              <div class="a-dist-cnt">${c || ""}</div>
              <div class="a-dist-bar-wrap"><div class="a-dist-bar t-${_rpTone(i + 1)}" style="height:${c ? Math.max(4, Math.round(c / maxC * 100)) : 0}%"></div></div>
              <div class="a-dist-grade">${i + 1}</div>
            </div>`).join("")}</div>
          <div class="a-dist-legend">
            <div class="a-dist-legend-item"><i class="t-best"></i>Відмінно (10–12)</div>
            <div class="a-dist-legend-item"><i class="t-good"></i>Добре (7–9)</div>
            <div class="a-dist-legend-item"><i class="t-mid"></i>Задовільно (4–6)</div>
            <div class="a-dist-legend-item"><i class="t-bad"></i>Незадовільно (1–3)</div>
          </div>
        </div>
      </div>
      ${trend}
      </div>
      ${diff}
      ${done.length ? `<div class="a-card">
        <div class="a-card-h"><h3>Результати студентів</h3><span class="a-card-h-meta">${done.length} ${_plural(done.length, "запис", "записи", "записів")} · натисніть рядок, щоб відкрити спробу</span></div>
        <table class="a-tbl">
          <thead><tr><th class="a-rank">#</th><th>Студент</th><th>Оцінка</th><th>%</th>${AN.group ? "" : "<th>Група</th>"}${AN.test ? "" : "<th>Тест</th>"}<th>Дата</th></tr></thead>
          <tbody>${lim.map((r, i) => {
            const tt = AN.test ? null : tests.find(x => x.id === r.a.testId);
            const pct = r.a.score?.percent;
            return `<tr data-att="${esc(r.a.id)}">
              <td class="a-rank">${i + 1}</td>
              <td><span class="a-stud">${esc(r.a.surname || "")} ${esc(r.a.name || "")}</span></td>
              <td><span class="a-grade-pill t-${_rpTone(r.grade)}">${r.grade}/12</span></td>
              <td class="a-mono">${pct != null ? pct + "%" : "—"}</td>
              ${AN.group ? "" : `<td>${esc(r.group || "—")}</td>`}
              ${AN.test ? "" : `<td class="a-tt">${esc(tt?.title || "Тест видалено")}</td>`}
              <td class="a-mono a-date">${r.t ? new Date(r.t).toLocaleDateString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
            </tr>`; }).join("")}</tbody>
        </table>
        ${done.length > lim.length ? `<button type="button" class="a-more" data-an-more>Показати всі ${done.length}</button>` : ""}
      </div>` : ""}`;
  },

  // Кнопка «Статистика» веде сюди з уже вибраним тестом
  showStats(testId){ location.href = "analytics?test=" + encodeURIComponent(testId); },

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
    if (ids.includes(window._adCur)) closeM("m-attempt");
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
      toast(`Оцінка ${grade}/12 виставлена`);
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
let _newsFilter = "all", _newsQuery = "", _newsCat = "", _newsLoaded = false, _nwBound = false;

async function loadTeacherNews(){
  try{
    const {get:_g,ref:_r}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const [readRaw, newsSnap] = await Promise.all([
      _g(_r(db,"teachers/"+_uid+"/meta/readNews")).catch(()=>null),
      _g(_r(db,"news")),
    ]);
    if(readRaw&&readRaw.exists()){
      // Старий формат — масив id; новий — {id: true} (дописується без перезапису)
      const rv=readRaw.val();
      _readNews=new Set(Array.isArray(rv)?rv.filter(Boolean):Object.entries(rv).map(([k,v])=>v===true?k:v).filter(x=>typeof x==="string"));
      // Разова міграція масиву у {id: true}
      if (Array.isArray(rv) || Object.values(rv).some(v => v !== true)){
        const obj = {}; _readNews.forEach(id => { if (/^[\w-]{1,64}$/.test(id)) obj[id] = true; });
        set(ref(db, tp("meta/readNews")), obj).catch(() => {});
      }
    }
    _newsItems = newsSnap.exists()
      ? Object.entries(newsSnap.val()).map(([id,v])=>({id,...v})).filter(isPublished)
          .sort((a,b)=>(!!b.pinned-!!a.pinned) || ((b.publishedAt||b.createdAt||0)-(a.publishedAt||a.createdAt||0)))
      : [];
    _newsLoaded = true;
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

const _NW_IC = {
  news:   '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 9h6M7 13h6M7 17h4"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/></svg>',
  pin:    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 6 4 4H6l4-4z"/></svg>',
  link:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
  down:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check:  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
};
const _nwWhen = n => n.publishedAt || n.createdAt || 0;
// Підсвічування збігу пошуку в заголовку — у вже екранованому тексті
const _nwMark = (s, q) => {
  const e = esc(s);
  if (!q) return e;
  const qe = esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return e.replace(new RegExp(qe, "gi"), m => `<mark>${m}</mark>`);
};
const _nwOpen = new Set();     // розгорнуті довгі новини
const _nwFresh = new Set();    // «Нове» — підсвічуємо до кінця візиту
let _nwIO = null, _nwFocus = null;

// Прочитано = картка побула на екрані хоча б секунду
function _nwObserve(){
  if (!("IntersectionObserver" in window)) return;
  _nwIO?.disconnect();
  const timers = new Map();
  _nwIO = new IntersectionObserver(entries => entries.forEach(en => {
    const id = en.target.dataset.nid;
    if (en.isIntersecting){
      if (!timers.has(id)) timers.set(id, setTimeout(() => {
        timers.delete(id);
        if (_readNews.has(id)) return;
        _readNews.add(id); updateNewsBadge(); _saveReadNews([id]); _nwHead();
        _nwIO?.unobserve(en.target);
      }, 1000));
    } else { clearTimeout(timers.get(id)); timers.delete(id); }
  }), { threshold: .5 });
  document.querySelectorAll("#news-teacher-list .nwa-card[data-nid]").forEach(el => { if (!_readNews.has(el.dataset.nid)) _nwIO.observe(el); });
}

function _nwBind(){
  _nwBound = true;
  $("nw-side")?.addEventListener("click", e => {
    const f = e.target.closest("[data-f]"); if (f){ _newsFilter = f.dataset.f; _newsCat = ""; renderNews(); return; }
    const c = e.target.closest("[data-cat]"); if (c){ _newsFilter = "all"; _newsCat = c.dataset.cat; renderNews(); }
  });
  $("nw-q")?.addEventListener("input", e => setNewsQuery(e.target.value));
  $("news-teacher-list")?.addEventListener("click", e => {
    if (e.target.closest("[data-nw-reset]")){ _newsCat = ""; _newsFilter = "all"; _newsQuery = ""; const q = $("nw-q"); if (q) q.value = ""; renderNews(); return; }
    const card = e.target.closest(".nwa-card"); if (!card) return;
    const id = card.dataset.nid;
    if (e.target.closest("[data-nw-copy]")){
      const url = `${location.origin}${location.pathname}?id=${encodeURIComponent(id)}`;
      navigator.clipboard?.writeText(url).then(() => toast("Посилання скопійовано"), () => toast("Не вдалося скопіювати", "err"));
      return;
    }
    if (e.target.closest("[data-nw-more]")){
      _nwOpen.has(id) ? _nwOpen.delete(id) : _nwOpen.add(id);
      card.classList.toggle("open", _nwOpen.has(id));
      if (!_nwOpen.has(id) && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  });
}

function _nwHead(){
  const total = _newsItems.length;
  const unread = _newsItems.filter(n => !_readNews.has(n.id)).length;
  const sub = $("nw-sub");
  if (sub) sub.innerHTML = total
    ? `${total} ${_plural(total, "публікація", "публікації", "публікацій")}${unread ? ` · <b>${unread} ${_plural(unread, "непрочитана", "непрочитані", "непрочитаних")}</b>` : " · усе прочитано"}`
    : "Оновлення платформи, нові функції та поради";
  const markAll = $("nw-mark-all"); if (markAll) markAll.hidden = !unread;
  const u = document.querySelector('#nw-side [data-f="unread"] em'); if (u) u.textContent = unread;
}

function renderNews(){
  const list = $("news-teacher-list");
  if (!list) return;
  if (!_nwBound) _nwBind();
  if (!_newsLoaded) return;
  _newsItems.forEach(n => { if (!_readNews.has(n.id)) _nwFresh.add(n.id); });

  const total = _newsItems.length;
  // Бокова панель: «Усі», «Непрочитані», категорії
  const side = $("nw-cats");
  if (side){
    const used = Object.entries(NEWS_CATS).map(([k, c]) => [k, c, _newsItems.filter(n => n.category === k).length]).filter(x => x[2]);
    const other = _newsItems.filter(n => !catOf(n)).length;
    if (_newsCat && _newsCat !== "_none" && !used.some(x => x[0] === _newsCat)) _newsCat = "";
    const row = (attr, on, dot, label, n) => `<button type="button" class="nwa-row${on ? " on" : ""}" ${attr} aria-pressed="${on}"><span>${dot}${label}</span><em>${n}</em></button>`;
    side.innerHTML =
      row('data-f="all"', _newsFilter === "all" && !_newsCat, `<i style="background:#1E3A8A"></i>`, "Усі", total) +
      row('data-f="unread"', _newsFilter === "unread", `<i style="background:#3B82F6"></i>`, "Непрочитані", _newsItems.filter(n => !_readNews.has(n.id)).length) +
      (used.length || other ? `<div class="nwa-sep"></div>` : "") +
      used.map(([k, c, n]) => row(`data-cat="${k}"`, _newsCat === k, `<i style="background:${c.color}"></i>`, esc(c.label), n)).join("") +
      (other && used.length ? row('data-cat="_none"', _newsCat === "_none", `<i style="background:#94A3B8"></i>`, "Без категорії", other) : "");
  }
  _nwHead();

  if (!total){
    list.innerHTML = `<div class="nwa-empty"><span class="ei">${_NW_IC.news}</span><b>Поки що тут тихо</b><span>Тут з'являтимуться оновлення платформи, нові функції та поради від команди QuizFlow.</span></div>`;
    return;
  }

  const q = _newsQuery.trim().toLowerCase();
  const items = _newsItems.filter(n => (_newsFilter !== "unread" || _nwFresh.has(n.id))
    && (!_newsCat || (_newsCat === "_none" ? !catOf(n) : n.category === _newsCat))
    && (!q || (n.title || "").toLowerCase().includes(q) || newsPlainText(n.text).toLowerCase().includes(q)));
  if (!items.length){
    const onlyUnread = _newsFilter === "unread" && !q && !_newsCat;
    list.innerHTML = `<div class="nwa-empty"><span class="ei">${onlyUnread ? _NW_IC.check : _NW_IC.search}</span>
      <b>${onlyUnread ? "Усе прочитано" : "Нічого не знайдено"}</b>
      <button type="button" class="nw-link" data-nw-reset>${onlyUnread ? "Показати всі новини" : "Скинути фільтри"}</button></div>`;
    return;
  }

  list.innerHTML = items.map(n => {
    const c = catOf(n), t = _nwWhen(n), d = t ? new Date(t) : null;
    const mon = d ? d.toLocaleDateString("uk-UA", { month: "short" }).replace(".", "") : "";
    const isNew = _nwFresh.has(n.id);
    return `<div class="nwa-item">
      <div class="nwa-date">${d ? `<b>${d.getDate()}</b><span>${esc(mon)} ${d.getFullYear()}</span>` : ""}</div>
      <article class="nwa-card${_nwOpen.has(n.id) ? " open" : ""}${isNew ? " fresh" : ""}${n.id === _nwFocus ? " focus" : ""}" data-nid="${esc(n.id)}" style="${c ? `--c:${c.color};--cb:${c.bg}` : ""}">
        <div class="nwa-meta">
          <span class="nw-cat"${c ? ` style="--c:${c.color};--cb:${c.bg}"` : ""}>${esc(c ? c.label : "Новина")}</span>
          ${n.pinned ? `<span class="nw-cat pin">${_NW_IC.pin} Закріплено</span>` : ""}
          ${isNew ? `<span class="nwa-new">Нове</span>` : ""}
          <span class="nwa-rt">${readMinutes(n.text)} хв читання</span>
          <button type="button" class="nwa-copy" data-nw-copy title="Скопіювати посилання на новину" aria-label="Скопіювати посилання">${_NW_IC.link}</button>
        </div>
        <h3 class="nwa-t">${_nwMark(n.title || "—", q)}</h3>
        <div class="nwa-body nv-text">${sanitizeNewsHtml(n.text)}</div>
        <button type="button" class="nwa-more" data-nw-more hidden><span class="o">Читати далі</span><span class="c">Згорнути</span>${_NW_IC.down}</button>
      </article>
    </div>`;
  }).join("");

  // «Читати далі» — лише там, де текст справді довший за згорнуту висоту
  list.querySelectorAll(".nwa-card").forEach(card => {
    const body = card.querySelector(".nwa-body");
    const long = body.scrollHeight > 260;
    card.classList.toggle("long", long);
    card.querySelector(".nwa-more").hidden = !long;
  });
  _nwObserve();

  // news?id=… — прокрутити до новини й розгорнути
  if (_nwFocus === null){
    _nwFocus = new URLSearchParams(location.search).get("id") || "";
    const el = _nwFocus && list.querySelector(`.nwa-card[data-nid="${CSS.escape(_nwFocus)}"]`);
    if (el){
      _nwOpen.add(_nwFocus); el.classList.add("open", "focus");
      // після зникнення лоадера сторінки, інакше прокрутка губиться
      // шукаємо заново: список міг перемалюватися, поки зникав лоадер
      setTimeout(() => document.querySelector(`#news-teacher-list .nwa-card[data-nid="${CSS.escape(_nwFocus)}"]`)?.scrollIntoView({ block: "start" }), 350);
      setTimeout(() => { _nwFocus = ""; document.querySelector("#news-teacher-list .nwa-card.focus")?.classList.remove("focus"); }, 2600);
    }
  }
}

async function _saveReadNews(ids){
  const upd = {};
  (ids || [..._readNews]).forEach(id => { if (/^[\w-]{1,64}$/.test(id)) upd[id] = true; });
  if (!Object.keys(upd).length) return;
  try { await update(ref(db, tp("meta/readNews")), upd); }
  catch(e){ console.warn("readNews:", e.message); }
}

// Перегляд новини: категорія, дата, час читання, гортання до попередньої/наступної
window.openNews = async (id) => {
  const idx=_newsItems.findIndex(x=>x.id===id);
  const n=_newsItems[idx];
  if(!n) return;
  // Сторінка «Новини» — прокрутити до картки й розгорнути; деінде (дашборд) — модалка
  const card = document.querySelector(`#news-teacher-list .nwa-card[data-nid="${CSS.escape(id)}"]`);
  if(card){
    _nwOpen.add(id); card.classList.add("open");
    card.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  const c=catOf(n);
  const cat=$("news-view-cat");
  if(cat){ cat.innerHTML = c ? `<span class="nw-cat" style="--c:${c.color};--cb:${c.bg}">${esc(c.label)}</span>` : `<span class="nw-cat">Новина</span>`; if(n.pinned) cat.innerHTML += `<span class="nw-cat pin">Закріплено</span>`; }
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
    _saveReadNews([id]);
  }
};

window.markAllNewsRead = async () => {
  const fresh=_newsItems.filter(n=>!_readNews.has(n.id)).map(n=>n.id);
  if(!fresh.length) return;
  fresh.forEach(id=>_readNews.add(id));
  updateNewsBadge(); renderNews();
  await _saveReadNews(fresh);
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
    // pending_review — теж завершення (є відкриті питання), раніше про нього не сповіщали
    const done = na.status === "completed" || na.status === "pending_review";
    if (done && (!old || old.status === "in_progress")) showNotification(na, "completed");
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
  if(sec==="sec-gradebook" && GB.bound) try { G.renderGradebook(); } catch {}
  if(sec==="sec-students" && window.G?.renderStudents) try { window.G.renderStudents(); } catch {}
  if(sec==="sec-suspicious") try { G.renderSuspicious(); } catch (e) { console.error(e); }
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

  onValue(ref(db, tp("meta")), (snap) => {
    const m = snap.val() || {};
    _suspMeta.loaded = true;
    _suspMeta.seenAt = typeof m.suspSeenAt === "number" ? m.suspSeenAt : null;
    _suspMeta.readCount = m.suspReadCount || 0;
    _suspBadge();
    if (document.querySelector("#sec-suspicious.on") && SP.seen == null) try { G.renderSuspicious(); } catch {}
    if ($("sec-dashboard")) try { renderDashAtt(); } catch {}
  });

  onValue(ref(db, tp("notifications")), (snap) => {
    const all = snap.exists()
      ? Object.entries(snap.val()).map(([id,v])=>({...v,id})).sort((a,b)=>(b.ts||0)-(a.ts||0))
      : [];
    // Звук — лише на справді нові непрочитані (після першого завантаження)
    if (NF.known) {
      const fresh = all.filter(n => !n.read && !NF.known.has(n.id));
      if (fresh.length) playNotifSound(fresh.some(n => n.isWarning || n.type === "screenshot"));
    }
    NF.known = new Set(all.map(n => n.id));
    // Прибираємо найстаріші понад ліміт — одним записом
    if (all.length > NF_MAX) {
      const upd = {};
      all.slice(NF_MAX).forEach(n => { if (_nfSafeId(n.id)) upd[n.id] = null; });
      update(ref(db, tp("notifications")), upd).catch(()=>{});
      all.length = NF_MAX;
    }
    _notifications = all.map(n => NF.pending.has(n.id) ? { ...n, read: true } : n);
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
  document.querySelectorAll("input[data-dt]").forEach(qfDateTime);
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
  // Хелпери для shared/dash.js
  window._qf = { isOnline: _isOnline, lastSeen: _lastSeen, suspScore: _suspScore, linkState, isOpenState: _isOpenState, lnkMax: _lnkMax, isSusp: _isSusp, suspNewCount: _suspNewCount, plural, qfDrop, timeAgo };
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

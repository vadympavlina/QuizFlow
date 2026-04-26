// ═══════════════════════════════════════════════════════════════════════
// shared/features.js — увесь функціонал QuizFlow
//
// Підключається ПІСЛЯ shared/app.js — потребує window._fb, _user, _uid,
// toast, ldr, tp, $, esc, toArr, folders, tests, links, attempts
// ═══════════════════════════════════════════════════════════════════════

const { db, ref, get, set, push, update, remove, onValue, off } = window._fb;
const _user = window._user;
const _uid = window._uid;
const tp = window.tp;
const dbGet = window.dbGet;
const $ = window.$;
const esc = window.esc;
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
  if (has("ft") || has("nl-t") || has("fgrp") || has("an-test") || has("an-group")) fillSelects();
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
  const al = links.filter(l=>l.status==="active").length;
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
  const nbt = $("nb-t"); if(nbt) nbt.textContent=tests.length;
  const nba = $("nb-a"); if(nba) nba.textContent=attempts.length;
  const nbl = $("nb-l"); if(nbl) nbl.textContent=links.filter(l=>l.status==="active").length;
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

function renderDashAtt(){
  // Привітання і дата
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 6 ? "Добрий вечір" : h < 12 ? "Доброго ранку" : h < 18 ? "Добрий день" : "Добрий вечір";
  const teacherFirstName = (_user.name || "").split(" ")[0] || _user.login || "";
  const el = $("dash-greeting");
  if (el) el.textContent = greeting + (teacherFirstName ? ", " + teacherFirstName : "") + " 👋";
  const dateEl = $("dash-date");
  if (dateEl) dateEl.textContent = now.toLocaleDateString("uk-UA", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
 
  // Додаткові метрики
  const completedCount = attempts.filter(a => a.status === "completed").length;
  const lbl = $("dash-completed-lbl");
  if (lbl) lbl.textContent = `Завершено: ${completedCount}`;
  const totalUsed = links.reduce((s, l) => s + (l.usedAttempts || 0), 0);
  const usedLbl = $("dash-used-lbl");
  if (usedLbl) usedLbl.textContent = totalUsed;
 
  // Онлайн банер
  const online = attempts.filter(a => a.status === "in_progress");
  const banner = document.getElementById("dash-online-banner");
  if (banner){
    if (online.length){
      banner.style.display = "flex";
      const txt = document.getElementById("dash-online-text");
      if (txt) txt.textContent = `${online.length} студент${online.length === 1 ? "" : "ів"} проходить тест прямо зараз`;
    } else {
      banner.style.display = "none";
    }
  }
 
  // Підозрілі (нові)
  const suspBlock = document.getElementById("dash-suspicious-block");
  if (suspBlock){
    dbGet("meta/suspReadCount").then(snap => {
      const suspRead = snap.exists() ? (snap.val() || 0) : 0;
      const suspAll = attempts.filter(a => (a.tabSwitches || 0)*2 + (a.copyAttempts || 0)*3 + (a.screenshots || 0)*5 > 0 && (a.status === "completed" || a.status === "pending_review")).length;
      const suspNew = Math.max(0, suspAll - suspRead);
      if (suspNew > 0){
        suspBlock.style.display = "block";
        const txt = document.getElementById("dash-suspicious-text");
        if (txt) txt.textContent = `${suspNew} нов${suspNew === 1 ? "а" : "их"} підозріл${suspNew === 1 ? "а" : "их"} спроб${suspNew === 1 ? "а" : ""}`;
      } else {
        suspBlock.style.display = "none";
      }
    }).catch(() => { suspBlock.style.display = "none"; });
  }
 
  // ── Activity list (новий дизайн) ──
  const tb = $("d-att");
  if (!tb) return;
 
  const r = attempts.slice(0, 5);
  if (!r.length){
    tb.innerHTML = `<div class="d-act-empty">
      <div style="font-size:32px;opacity:.4">📭</div>
      <div style="font-size:14px;color:var(--ink-500);margin-top:8px">Ще немає спроб</div>
    </div>`;
    return;
  }
 
  // Палітра кольорів аватарів — детермінована за іменем
  const avaColors = ["#3B82F6","#DB2777","#F59E0B","#16A34A","#6366F1","#0EA5E9","#8B5CF6","#EF4444","#14B8A6","#F97316"];
 
  tb.innerHTML = r.map(a => {
    const t = tests.find(x => x.id === a.testId);
    const initials = ((a.surname?.[0] || "") + (a.name?.[0] || "")).toUpperCase() || "??";
    const str = String(a.surname || "") + String(a.name || "");
    let hash = 0; for (let i = 0; i < str.length; i++) hash = (hash + str.charCodeAt(i)) | 0;
    const c = avaColors[Math.abs(hash) % avaColors.length];
 
    // Визначаємо текст та badge
    const violations = (a.tabSwitches || 0)*2 + (a.copyAttempts || 0)*3 + (a.screenshots || 0)*5;
    let text, badgeTone, badgeTxt, metaParts = [timeAgo(a.createdAt)];
 
    if (violations > 0 && (a.status === "completed" || a.status === "pending_review")){
      text = `<b>${esc(a.surname || "")} ${esc(a.name || "")}</b> підозра на списування`;
      badgeTone = "bad";
      badgeTxt = "FLAG";
      const issues = [];
      if (a.tabSwitches) issues.push(`${a.tabSwitches} перемикан${a.tabSwitches === 1 ? "ня" : "ь"}`);
      if (a.copyAttempts) issues.push(`${a.copyAttempts} копіюван${a.copyAttempts === 1 ? "ня" : "ь"}`);
      if (a.screenshots) issues.push(`${a.screenshots} скрін${a.screenshots === 1 ? "" : "ів"}`);
      if (issues.length) metaParts.push(issues[0]);
    } else if (a.status === "in_progress"){
      text = `<b>${esc(a.surname || "")} ${esc(a.name || "")}</b> почала «${esc(t?.title || "тест")}»`;
      badgeTone = "mid";
      badgeTxt = "Live";
    } else if (a.status === "pending_review"){
      text = `<b>${esc(a.surname || "")} ${esc(a.name || "")}</b> завершила «${esc(t?.title || "тест")}»`;
      badgeTone = "mid";
      badgeTxt = "Перевірка";
      if (a.score?.correct != null && a.score?.total != null){
        metaParts.push(`${a.score.correct}/${a.score.total}`);
      }
    } else if (a.status === "completed"){
      text = `<b>${esc(a.surname || "")} ${esc(a.name || "")}</b> завершила «${esc(t?.title || "тест")}»`;
      const pct = a.score?.percent;
      if (pct != null){
        if (pct >= 70) badgeTone = "ok";
        else if (pct >= 40) badgeTone = "mid";
        else badgeTone = "bad";
        badgeTxt = pct + "%";
      } else if (a.grade12 != null){
        if (a.grade12 >= 10) badgeTone = "ok";
        else if (a.grade12 >= 4) badgeTone = "mid";
        else badgeTone = "bad";
        badgeTxt = a.grade12 + "/12";
      } else {
        badgeTone = "mid";
        badgeTxt = "—";
      }
      if (a.score?.correct != null && a.score?.total != null){
        metaParts.push(`${a.score.correct}/${a.score.total}`);
      }
    } else {
      text = `<b>${esc(a.surname || "")} ${esc(a.name || "")}</b>`;
      badgeTone = "mid";
      badgeTxt = "new";
    }
 
    return `<div class="d-act-item" onclick="G.viewAtt && G.viewAtt('${a.id}')">
      <div class="d-act-ava" style="background:linear-gradient(135deg, ${c}CC, ${c})">${esc(initials)}</div>
      <div class="d-act-body">
        <div class="d-act-text">${text}</div>
        <div class="d-act-meta">${metaParts.map(m => `<span>${m}</span>`).join("")}</div>
      </div>
      <span class="d-act-badge ${badgeTone}">${esc(badgeTxt)}</span>
    </div>`;
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
    lbl.textContent = `${act} активн${act === 1 ? "е" : (act >= 2 && act <= 4) ? "і" : "их"} · ${cls} закрит${cls === 1 ? "е" : (cls >= 2 && cls <= 4) ? "і" : "их"}`;
  }

  if (!list.length){
    tb.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--ink-500);font-size:13px">
      Ще немає посилань. <button onclick="showSec('links')" style="background:transparent;border:0;color:var(--nav-600);font-weight:600;cursor:pointer;font-family:inherit">Перейти до посилань →</button>
    </td></tr>`;
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
  const c=$("d-lnk"),al=links.filter(l=>l.status==="active").slice(0,4);
  if(!c) return;
  if(!al.length){c.innerHTML=`<div style="text-align:center;color:var(--muted);padding:18px;font-size:14px">Немає активних посилань</div>`;return;}
  c.innerHTML=al.map(l=>{
    const t=tests.find(x=>x.id===l.testId);
    const pct=l.maxAttempts?Math.round(l.usedAttempts/l.maxAttempts*100):0;
    const barColor=pct>=80?"#f43f5e":pct>=50?"#f59e0b":"#2d5be3";
    return`<div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${esc(t?.title||"—")}</span>
        <span style="font-size:12px;color:var(--muted);flex-shrink:0;margin-left:8px">${l.usedAttempts}/${l.maxAttempts}</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:5px;overflow:hidden">
        <div style="background:${barColor};height:100%;border-radius:4px;width:${pct}%;transition:width .4s"></div>
      </div>
      ${l.group?`<div style="font-size:11px;color:var(--muted);margin-top:4px">${esc(l.group)}</div>`:""}
    </div>`;
  }).join("");
}

// TESTS & FOLDERS
let _fFilter = "all";

function setFolderFilter(v){ _fFilter=v; renderTests(document.getElementById("srch")?.value||""); }


// Палітра для превью карток тестів (по черзі якщо немає теми)
const _testPalette = [
  ["#a8c8f8","#c9b8f5","#6b9ef0"],  // блакитно-фіолетовий
  ["#b8f0e0","#a0e8d0","#5dd4b0"],  // зелений
  ["#ffd6a0","#ffb8b8","#ff9a6c"],  // помаранчевий
  ["#f5b8d8","#e8a0f0","#d06bc0"],  // рожево-фіолетовий
  ["#a0d8f8","#b8eaf8","#5bb8e8"],  // блакитний
  ["#c8f0a0","#e8f8b0","#8acc50"],  // жовто-зелений
];

function _testThemeGradient(t, idx){
  const theme = t.theme||"";
  if(theme==="ocean")   return "linear-gradient(135deg,#7ec8e3,#0ea5e9)";
  if(theme==="forest")  return "linear-gradient(135deg,#6ee7b7,#16a34a)";
  if(theme==="sunset")  return "linear-gradient(135deg,#fca5a5,#ea580c)";
  if(theme==="midnight")return "linear-gradient(135deg,#818cf8,#1e1b4b)";
  if(theme==="default") return "linear-gradient(135deg,#6b9ef0,#2d5be3)";
  const p = _testPalette[idx % _testPalette.length];
  return `linear-gradient(135deg,${p[0]},${p[1]})`;
}

function _testAbbr(title){
  const words = title.trim().split(/\s+/);
  if(words.length===1) return title.substring(0,3).toUpperCase();
  return words.slice(0,3).map(w=>w[0]).join("").toUpperCase();
}
// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — вставити перед buildTestCard (поруч із _testPalette / _testAbbr)
// ═══════════════════════════════════════════════════════════════════════════

// Палітра для папок (fallback якщо немає f.color)
const _folderFallbacks = ["#2d5be3","#0d9e85","#9333ea","#f59e0b","#f43f5e","#0ea5e9"];

// Освітлити hex-колір (шукає світліший варіант для градієнта)
function _lightenHex(hex, amt = 0.35){
  const h = hex.replace("#","");
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  const mix = (c) => Math.round(c + (255 - c) * amt);
  const toHex = (n) => n.toString(16).padStart(2,"0");
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

// Темніший варіант (для тексту "Відкрити →" на папці)
function _darkenHex(hex, amt = 0.25){
  const h = hex.replace("#","");
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  const mix = (c) => Math.round(c * (1 - amt));
  const toHex = (n) => n.toString(16).padStart(2,"0");
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

// Повертає колір папки з fallback по індексу
function _folderColor(f){
  if (f?.color) return f.color;
  const idx = folders.indexOf(f);
  return _folderFallbacks[Math.max(0, idx) % _folderFallbacks.length];
}

// Градієнт cover картки тесту — базується на кольорі папки (якщо є) або на _testPalette
function _quizCoverGradient(t, idx){
  const folder = folders.find(f => f.id === t.folderId);
  if (folder){
    const c = _folderColor(folder);
    return `linear-gradient(135deg, ${_lightenHex(c, 0.5)}, ${c})`;
  }
  // Без папки — беремо з palette за idx
  const p = _testPalette[idx % _testPalette.length];
  return `linear-gradient(135deg, ${p[0]}, ${p[2]})`;
}

// Колір акценту тесту (для thumb у папці)
function _quizAccentColor(t, idx){
  const folder = folders.find(f => f.id === t.folderId);
  if (folder) return _folderColor(folder);
  const p = _testPalette[idx % _testPalette.length];
  return p[2];
}

// END HELPERS
// Картка тесту (грід вю)
// ═══════════════════════════════════════════════════════════════════════════
// REPLACE: buildTestCard — нова картка тесту у вигляді "quiz-card"
// ═══════════════════════════════════════════════════════════════════════════

function buildTestCard(t, idx){
  const cnt = attempts.filter(a => a.testId === t.id).length;
  const passed = attempts.filter(a => a.testId === t.id && (a.grade12 || 0) >= 4).length;
  const allGrades = attempts.filter(a => a.testId === t.id && a.grade12 != null).map(a => a.grade12);
  const avgPct = allGrades.length ? Math.round(allGrades.reduce((s,g) => s+g, 0) / allGrades.length / 12 * 100) : null;
  const qCnt = (t.questions || []).length;
  const timeLimit = t.timeLimit ? `${Math.round(t.timeLimit / 60)} хв` : null;
  const abbr = _testAbbr(t.title);
  const grad = _quizCoverGradient(t, idx);

  const statusCfg = {
    active: { cls:"on",     label:"Активний" },
    draft:  { cls:"draft",  label:"Чернетка" },
    closed: { cls:"closed", label:"Закритий" },
  };
  const sc = statusCfg[t.status] || statusCfg.draft;
  const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString("uk-UA", { day:"numeric", month:"short" }) : "";
  const avgColor = avgPct != null
    ? (avgPct >= 70 ? "#15803D" : avgPct >= 40 ? "#1E40AF" : "#B91C1C")
    : "var(--ink-400)";

  return `<div class="t-quiz-card">
    <!-- Cover -->
    <div class="t-qc-cover" style="background:${grad}" onclick="location.href='constructor.html?id=${t.id}'">
      <span class="t-qc-code">${esc(abbr)}</span>
      <span class="t-qc-status"><span class="t-pill ${sc.cls}">${sc.label}</span></span>
    </div>
    <!-- Title + meta -->
    <div>
      <div class="t-qc-title" onclick="location.href='constructor.html?id=${t.id}'">${esc(t.title)}</div>
      <div class="t-qc-meta">
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${qCnt} пит.
        </span>
        ${timeLimit ? `<span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${timeLimit}
        </span>` : ""}
      </div>
    </div>
    <!-- Stats -->
    <div class="t-qc-stats">
      <div><div class="t-qc-stat-val">${cnt}</div><div class="t-qc-stat-lbl">Спроб</div></div>
      <div><div class="t-qc-stat-val">${passed}</div><div class="t-qc-stat-lbl">Здали</div></div>
      <div><div class="t-qc-stat-val" style="color:${avgColor}">${avgPct != null ? avgPct + "%" : "—"}</div><div class="t-qc-stat-lbl">Середній</div></div>
    </div>
    <!-- Footer -->
    <div class="t-qc-foot">
      <span class="t-qc-date">${dateStr ? "Створено " + dateStr : ""}</span>
      <div class="t-qc-foot-actions">
        <button class="t-edit-btn" onclick="location.href='constructor.html?id=${t.id}'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Редагувати
        </button>
        <div style="position:relative">
          <button class="t-menu-btn" onclick="event.stopPropagation();G._toggleTestMenu('${t.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/></svg>
          </button>
          <div id="tmenu-${t.id}" class="t-tmenu">
            <div class="t-tmenu-item" onclick="G.qLink('${t.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
              Нове посилання
            </div>
            <div class="t-tmenu-item" onclick="G.toggleTestStatus('${t.id}','${t.status}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Змінити статус
            </div>
            <div class="t-tmenu-item" onclick="G.showStats('${t.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Статистика
            </div>
            <div class="t-tmenu-item" onclick="G.openShareModal('${t.id}','${esc(t.title)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Поділитись
            </div>
            <div class="t-tmenu-sep"></div>
            <div class="t-tmenu-item d" onclick="G.confDelTest('${t.id}','${esc(t.title)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              Видалити
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
// ═══════════════════════════════════════════════════════════════════════════
// REPLACE: buildTestRow — рядок таблиці (list view)
// ═══════════════════════════════════════════════════════════════════════════

function buildTestRow(t, idx){
  const cnt = attempts.filter(a => a.testId === t.id).length;
  const allGrades = attempts.filter(a => a.testId === t.id && a.grade12 != null).map(a => a.grade12);
  const avgPct = allGrades.length ? Math.round(allGrades.reduce((s,g) => s+g, 0) / allGrades.length / 12 * 100) : null;
  const qCnt = (t.questions || []).length;
  const abbr = _testAbbr(t.title);
  const grad = _quizCoverGradient(t, idx || 0);
  const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString("uk-UA", { day:"numeric", month:"short" }) : "";

  const statusCfg = {
    active: { cls:"on",     label:"Активний" },
    draft:  { cls:"draft",  label:"Чернетка" },
    closed: { cls:"closed", label:"Закритий" },
  };
  const sc = statusCfg[t.status] || statusCfg.draft;
  const avgColor = avgPct != null
    ? (avgPct >= 70 ? "#15803D" : avgPct >= 40 ? "#1E40AF" : "#B91C1C")
    : "var(--ink-400)";

  return `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:12px">
        <div class="t-tile" style="background:${grad}">${esc(abbr)}</div>
        <div style="min-width:0">
          <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${esc(t.title)}</div>
          ${t.description ? `<div style="font-size:12px;color:var(--ink-400);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px">${esc(t.description.substring(0,60))}${t.description.length > 60 ? "…" : ""}</div>` : ""}
        </div>
      </div>
    </td>
    <td style="white-space:nowrap">
      <button onclick="G.toggleTestStatus('${t.id}','${t.status}')" style="background:transparent;border:0;padding:0;cursor:pointer" title="Змінити статус">
        <span class="t-pill ${sc.cls}">${sc.label}</span>
      </button>
    </td>
    <td class="t-mono">${qCnt} <span class="t-muted" style="font-size:11px">пит.</span></td>
    <td class="t-mono" style="color:${cnt > 0 ? "var(--ink-700)" : "var(--ink-400)"};font-weight:600">${cnt}</td>
    <td class="t-mono" style="color:${avgColor};font-weight:600">${avgPct != null ? avgPct + "%" : "—"}</td>
    <td class="t-mono t-muted" style="white-space:nowrap">${dateStr}</td>
    <td>
      <div class="t-ra">
        <button class="t-ib" title="Редагувати" onclick="location.href='constructor.html?id=${t.id}'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="t-ib" title="Нове посилання" onclick="G.qLink('${t.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        </button>
        <button class="t-ib" title="Статистика" onclick="G.showStats('${t.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </button>
        <button class="t-ib" title="Поділитись" onclick="G.openShareModal('${t.id}','${esc(t.title)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </button>
        <button class="t-ib d" title="Видалити" onclick="G.confDelTest('${t.id}','${esc(t.title)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </div>
    </td>
  </tr>`;
}

// Стан вью: 'grid' або 'list'
window._testsView = window._testsView || "grid";
// Стан фільтру статусу
window._testsStatus = window._testsStatus || "";

// ═══════════════════════════════════════════════════════════════════════════
// REPLACE: renderTests — root = ЛИШЕ папки, тести тільки всередині папки
// ═══════════════════════════════════════════════════════════════════════════

renderTests = function(q = ""){
  const c = $("tc");
  if (!c) return;

  if (!tests.length && !folders.length){
    c.innerHTML = `<div class="t-card"><div class="t-empty">
      <div class="t-empty-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg></div>
      <div class="t-empty-title">Ще немає папок чи тестів</div>
      <div class="t-empty-hint">Створіть першу папку, щоб почати</div>
      <button class="t-btn primary" onclick="openM('m-folder')" style="margin:0 auto">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Нова папка
      </button>
    </div></div>`;
    return;
  }

  // Закрити всі відкриті попап-меню при перерендері
  document.querySelectorAll(".t-tmenu.on").forEach(m => m.classList.remove("on"));

  let lst = tests.filter(t => t.status !== "archived");
  if (q) lst = lst.filter(t => t.title.toLowerCase().includes(q.toLowerCase()) || (t.tags || []).some(g => g.toLowerCase().includes(q.toLowerCase())));

  const noFolderTests = lst.filter(t => !t.folderId || !folders.find(f => f.id === t.folderId));
  const hasNoFolder = noFolderTests.length > 0;

  const inFolder = _fFilter && _fFilter !== "all" && _fFilter !== "none";
  const inOrphan = _fFilter === "none";

  // Оновити підзаголовок сторінки
  const sub = document.getElementById("t-subtitle");
  if (sub){
    if (inFolder){
      const folder = folders.find(f => f.id === _fFilter);
      sub.textContent = `${esc(folder?.name || "Папка")} · тести всередині папки`;
    } else if (inOrphan){
      sub.textContent = "Тести без папки";
    } else {
      const nF = folders.length + (hasNoFolder ? 1 : 0);
      const nT = lst.length;
      sub.textContent = `${nF} ${nF === 1 ? "папка" : (nF >= 2 && nF <= 4) ? "папки" : "папок"} · ${nT} ${nT === 1 ? "тест" : (nT >= 2 && nT <= 4) ? "тести" : "тестів"}`;
    }
  }

  // ─── ВИГЛЯД ПАПКИ: [breadcrumb] + [toolbar] + [тести grid/list] ─────────
  if (inFolder || inOrphan){
    const folder = inFolder ? folders.find(f => f.id === _fFilter) : null;
    const folderName = inFolder ? (folder?.name || "Папка") : "Без папки";
    const folderColor = inFolder ? _folderColor(folder) : "#8691AC";
    let fTests = inFolder ? lst.filter(t => t.folderId === _fFilter) : noFolderTests;
    if (window._testsStatus) fTests = fTests.filter(t => t.status === window._testsStatus);

    const allCnt = inFolder ? lst.filter(t => t.folderId === _fFilter).length : noFolderTests.length;
    const activeCnt = inFolder
      ? lst.filter(t => t.folderId === _fFilter && t.status === "active").length
      : noFolderTests.filter(t => t.status === "active").length;
    const draftCnt = inFolder
      ? lst.filter(t => t.folderId === _fFilter && t.status === "draft").length
      : noFolderTests.filter(t => t.status === "draft").length;
    const closedCnt = inFolder
      ? lst.filter(t => t.folderId === _fFilter && t.status === "closed").length
      : noFolderTests.filter(t => t.status === "closed").length;

    c.innerHTML = `
      <div class="t-card">
        <!-- Breadcrumb -->
        <div class="t-path-nav">
          <button class="t-crumb" onclick="G.setFF('all')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>
            Всі папки
          </button>
          <span class="t-sep">/</span>
          <span class="t-crumb active">
            <span style="width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,${_lightenHex(folderColor,0.4)},${folderColor})"></span>
            ${esc(folderName)}
          </span>
          ${inFolder ? `<div style="margin-left:auto;display:flex;gap:6px">
            <button class="t-btn" onclick="G.openTestInFolder('${_fFilter}')" style="height:30px;padding:0 11px;font-size:12px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Додати тест
            </button>
            <button class="t-btn ghost" onclick="G.confDelFolder('${_fFilter}','${esc(folderName)}')" style="height:30px;padding:0 11px;font-size:12px;color:#B91C1C">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              Видалити папку
            </button>
          </div>` : `<span class="t-path-right">/folders/none</span>`}
        </div>

        <!-- Toolbar -->
        ${_renderStatusBar(allCnt, activeCnt, draftCnt, closedCnt, true, q)}

        <!-- Content -->
        ${_renderTestsContent(fTests, allCnt)}
      </div>`;
    return;
  }

  // ─── ROOT VIEW: тільки папки (тести всередині них) ─────────────────────
  const folderGrid = folders.map(f => {
    const fTests = lst.filter(t => t.folderId === f.id);
    const cnt = fTests.length;
    const col = _folderColor(f);
    const colLight = _lightenHex(col, 0.35);
    const colDark = _darkenHex(col, 0.15);

    // Превью — до 4 тестів у вигляді плиток з абревіатурою
    const preview = fTests.slice(0, 4);
    const more = fTests.length - preview.length;
    const updatedStr = f.createdAt
      ? new Date(f.createdAt).toLocaleDateString("uk-UA", { day:"numeric", month:"short" })
      : "—";

    const thumbsHtml = preview.length
      ? preview.map((t,i) => {
          const tc = _lightenHex(col, 0.25);
          return `<div class="t-fc-thumb" style="background:linear-gradient(135deg,${_lightenHex(col,0.55)},${tc});color:${colDark}" title="${esc(t.title)}">${esc(_testAbbr(t.title))}</div>`;
        }).join("") + (more > 0 ? `<span class="t-fc-more">+${more}</span>` : "")
      : `<span class="t-muted" style="font-size:11.5px;font-style:italic">Порожня</span>`;

    return `<div class="t-folder-card" onclick="G.setFF('${f.id}')">
      <div class="t-fc-actions">
        <button title="Додати тест" onclick="event.stopPropagation();G.openTestInFolder('${f.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button title="Видалити" class="d" onclick="event.stopPropagation();G.confDelFolder('${f.id}','${esc(f.name)}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </div>
      <div class="t-fc-head">
        <div class="t-fc-ico" style="background:linear-gradient(135deg,${colLight},${col})">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <div class="t-fc-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</div>
          <div class="t-fc-meta">${cnt === 0 ? "Порожня" : cnt === 1 ? "1 тест" : cnt < 5 ? `${cnt} тести` : `${cnt} тестів`}</div>
        </div>
      </div>
      <div class="t-fc-meta-row">
        <span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${cnt} ${cnt === 1 ? "тест" : cnt < 5 ? "тести" : "тестів"}
        </span>
        <span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${updatedStr}
        </span>
      </div>
      <div class="t-fc-foot">
        <div class="t-fc-thumbs">${thumbsHtml}</div>
        <span class="t-fc-cta" style="color:${colDark}">
          Відкрити
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
        </span>
      </div>
    </div>`;
  }).join("");

  // Картка "Без папки" для orphan-тестів
  const noFolderCard = hasNoFolder ? `<div class="t-folder-card" onclick="G.setFF('none')">
    <div class="t-fc-head">
      <div class="t-fc-ico" style="background:linear-gradient(135deg,#D1D5DB,#6B7280)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div style="flex:1;min-width:0">
        <div class="t-fc-title">Без папки</div>
        <div class="t-fc-meta">${noFolderTests.length === 1 ? "1 тест" : noFolderTests.length < 5 ? `${noFolderTests.length} тести` : `${noFolderTests.length} тестів`}</div>
      </div>
    </div>
    <div class="t-fc-meta-row">
      <span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Неорганізовані
      </span>
    </div>
    <div class="t-fc-foot">
      <div class="t-fc-thumbs">${noFolderTests.slice(0,4).map(t => `<div class="t-fc-thumb" style="background:#E5EAF5;color:#5B6A8F">${esc(_testAbbr(t.title))}</div>`).join("")}${noFolderTests.length > 4 ? `<span class="t-fc-more">+${noFolderTests.length - 4}</span>` : ""}</div>
      <span class="t-fc-cta" style="color:#5B6A8F">
        Відкрити
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
      </span>
    </div>
  </div>` : "";

  // "+Нова папка" плитка
  const newFolderTile = `<div class="t-new-folder" onclick="openM('m-folder')">
    <div class="t-nf-ico">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </div>
    <div class="t-nf-title">Нова папка</div>
    <div class="t-nf-hint">Згрупувати тести в курс</div>
  </div>`;

  c.innerHTML = `<div class="t-card">
    <div class="t-section-label">
      <span>Папки</span>
      <span class="t-n">${folders.length + (hasNoFolder ? 1 : 0)}</span>
    </div>
    <div class="t-folders-grid" style="padding:0 18px 18px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
      ${folderGrid}${noFolderCard}${newFolderTile}
    </div>
  </div>`;
};
// ═══════════════════════════════════════════════════════════════════════════
// REPLACE: _renderStatusBar — новий toolbar (search + tabs + view-toggle)
// Підпис старий ЗБЕРЕЖЕНО: (total, activeCnt, draftCnt, closedCnt, showViewToggle)
// Додано 6-й аргумент `currentQuery` — опціональний, щоб showSearch зберігав значення
// ═══════════════════════════════════════════════════════════════════════════

function _renderStatusBar(total, activeCnt, draftCnt, closedCnt, showViewToggle, currentQuery = ""){
  const s = window._testsStatus || "";
  const v = window._testsView || "grid";
  const q = currentQuery || document.getElementById("srch")?.value || "";

  return `<div class="t-card-h">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;flex:1;min-width:0">
      <div class="t-search">
        <span class="t-search-ico">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </span>
        <input class="t-input" id="srch" style="padding-left:32px;width:220px" placeholder="Пошук у папці..." value="${esc(q)}" oninput="renderTests(this.value)" autocomplete="off">
      </div>
      <div class="t-tabs">
        <button class="t-tab ${!s ? "active" : ""}" onclick="window._testsStatus='';renderTests(document.getElementById('srch')?.value||'')">
          Всі <span class="t-tab-n">${total}</span>
        </button>
        <button class="t-tab ${s === "active" ? "active" : ""}" onclick="window._testsStatus='active';renderTests(document.getElementById('srch')?.value||'')">
          Активні <span class="t-tab-n">${activeCnt}</span>
        </button>
        <button class="t-tab ${s === "draft" ? "active" : ""}" onclick="window._testsStatus='draft';renderTests(document.getElementById('srch')?.value||'')">
          Чернетки <span class="t-tab-n">${draftCnt}</span>
        </button>
        <button class="t-tab ${s === "closed" ? "active" : ""}" onclick="window._testsStatus='closed';renderTests(document.getElementById('srch')?.value||'')">
          Закриті <span class="t-tab-n">${closedCnt}</span>
        </button>
      </div>
    </div>
    ${showViewToggle ? `<div class="t-view">
      <button class="${v === "grid" ? "on" : ""}" onclick="window._testsView='grid';renderTests(document.getElementById('srch')?.value||'')" title="Сітка">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </button>
      <button class="${v === "list" ? "on" : ""}" onclick="window._testsView='list';renderTests(document.getElementById('srch')?.value||'')" title="Список">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </div>` : ""}
  </div>`;
}


// ═══════════════════════════════════════════════════════════════════════════
// REPLACE: _renderTestsContent — рендерить тести (grid або list)
// ═══════════════════════════════════════════════════════════════════════════

function _renderTestsContent(lst, total){
  if (!lst.length){
    return `<div class="t-empty">
      <div class="t-empty-ico">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <div class="t-empty-title">${total === 0 ? "У папці ще немає тестів" : "Нічого не знайдено"}</div>
      <div class="t-empty-hint">${total === 0 ? "Додайте перший тест у цю папку" : "Спробуйте інший запит або скиньте фільтри"}</div>
    </div>`;
  }
  if (window._testsView === "list"){
    return `<div style="overflow-x:auto">
      <table class="t-dtable">
        <thead>
          <tr>
            <th>Назва</th>
            <th>Статус</th>
            <th>Питань</th>
            <th>Спроб</th>
            <th>Середній</th>
            <th>Дата</th>
            <th style="width:160px"></th>
          </tr>
        </thead>
        <tbody>${lst.map((t,i) => buildTestRow(t,i)).join("")}</tbody>
      </table>
    </div>`;
  }
  // Grid
  return `<div class="t-quizzes-grid" style="padding:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
    ${lst.map((t,i) => buildTestCard(t,i)).join("")}
  </div>`;
}

// ATTEMPTS
fillSelects = function(){
  // Прихований select для сумісності з renderAttempts
  const ft = $("ft");
  if (ft) ft.innerHTML=`<option value="">Всі тести</option>`+tests.filter(t=>t.status!=="archived").map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");
  // Кастомний дропдаун тестів
  const ftMenu=document.getElementById("cd-ft-menu");
  if(ftMenu){
    const curFt=$("ft")?.value||"";
    ftMenu.innerHTML=`<div class="cd-item${!curFt?" cd-active":""}" onclick="G.selectDrop('cd-ft','','Всі тести')">Всі тести</div>`+
      tests.filter(t=>t.status!=="archived").map(t=>
        `<div class="cd-item${curFt===t.id?" cd-active":""}" onclick="G.selectDrop('cd-ft','${t.id}','${esc(t.title)}')">${esc(t.title)}</div>`
      ).join("");
  }
  const nlT = $("nl-t");
  if (nlT) nlT.innerHTML=tests.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");
  // Групи з посилань
  const groups=[...new Set(links.map(l=>l.group).filter(Boolean))].sort();
  const fgrp = $("fgrp");
  if (fgrp) fgrp.innerHTML=`<option value="">Всі групи</option>`+groups.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join("");
  // Кастомний дропдаун груп
  const grpMenu=document.getElementById("cd-fgrp-menu");
  if(grpMenu){
    const curGrp=$("fgrp").value;
    grpMenu.innerHTML=`<div class="cd-item${!curGrp?" cd-active":""}" onclick="G.selectDrop('cd-fgrp','','Всі групи')">Всі групи</div>`+
      groups.map(g=>`<div class="cd-item${curGrp===g?" cd-active":""}" onclick="G.selectDrop('cd-fgrp','${esc(g)}','${esc(g)}')">${esc(g)}</div>`
      ).join("");
  }
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
        `<div class="cd-item${curAn===t.id?" cd-active":""}" data-val="${t.id}" onclick="G.selectAnalyticsDrop('test','${t.id}','${esc(t.title)}')">${esc(t.title)}</div>`
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
      groups.map(g=>`<div class="cd-item${curGrpAn===g?" cd-active":""}" data-val="${esc(g)}" onclick="G.selectAnalyticsDrop('group','${esc(g)}','${esc(g)}')">${esc(g)}</div>`
      ).join("");
  }
  // Посилання - тест у модалі
  const nlMenu=document.getElementById("cd-nl-t-menu");
  if(nlMenu){
    const curNl=$("nl-t")?.value||"";
    nlMenu.innerHTML=tests.filter(t=>t.status!=="archived").map(t=>
      `<div class="cd-item${curNl===t.id?" cd-active":""}" data-val="${t.id}" onclick="G.selectLinkTest('${t.id}','${esc(t.title)}')">${esc(t.title)}</div>`
    ).join("") || `<div class="cd-item" style="color:var(--muted)">Немає тестів</div>`;
  }
}


// ─── ATTEMPTS SORT + PAGINATION STATE ──────────────────────────────────
let _attSort = { field: "date", dir: "desc" };
window._attPage = 1;
const ATT_PER_PAGE = 20;

// ─── renderAttempts (заміна) ───────────────────────────────────────────
renderAttempts = function(resetPage = false){
  if (resetPage) window._attPage = 1;

  // Фільтри
  const tF   = $("ft")?.value || "";
  const grpF = $("fgrp")?.value || "";
  const sF   = window._attStatus || "";  // "", "completed", "in_progress", "pending_review", "flagged"
  const q    = ($("att-srch")?.value || "").toLowerCase().trim();

  // Search-clear видимість (on input уже ставить has-q, але дублюємо для consistency)
  const srchWrap = document.getElementById("att-srch-wrap");
  if (srchWrap) srchWrap.classList.toggle("has-q", !!q);

  // ── KPI stats: рахуємо завжди від ПОВНОГО списку attempts (не від filtered) ──
  const totalCount = attempts.length;
  const doneCount  = attempts.filter(a => a.status === "completed").length;
  const progCount  = attempts.filter(a => a.status === "in_progress" || a.status === "pending_review").length;
  const flagCount  = attempts.filter(a => _attViolation(a) > 0 && (a.status === "completed" || a.status === "pending_review")).length;
  const completed  = attempts.filter(a => a.status === "completed" && a.score?.percent != null);
  const avgPct     = completed.length ? Math.round(completed.reduce((s, a) => s + (a.score.percent || 0), 0) / completed.length) : null;
  const liveCount  = attempts.filter(a => a.status === "in_progress").length;

  const _setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  _setText("stat-total",   totalCount);
  _setText("stat-done",    doneCount);
  _setText("stat-inprog",  progCount);
  _setText("stat-flagged", flagCount);
  _setText("stat-avg",     avgPct != null ? avgPct + "%" : "—");

  // Live chip
  const chipEl  = document.getElementById("att-live-chip");
  const chipCnt = document.getElementById("att-live-count");
  if (chipEl){
    if (liveCount > 0){
      chipEl.style.display = "inline-flex";
      if (chipCnt) chipCnt.textContent = liveCount;
    } else {
      chipEl.style.display = "none";
    }
  }

  // ── Фільтрація ──
  let lst = attempts;
  if (tF)   lst = lst.filter(a => a.testId === tF);
  if (grpF) lst = lst.filter(a => { const l = links.find(x => x.id === a.linkId); return (l?.group || "") === grpF; });
  if (sF === "flagged")  lst = lst.filter(a => _attViolation(a) > 0);
  else if (sF)           lst = lst.filter(a => a.status === sF);
  if (q){
    lst = lst.filter(a => {
      const fullName  = `${a.name || ""} ${a.surname || ""}`.toLowerCase();
      const testTitle = (tests.find(t => t.id === a.testId)?.title || "").toLowerCase();
      const group     = (links.find(l => l.id === a.linkId)?.group || "").toLowerCase();
      return fullName.includes(q) || testTitle.includes(q) || group.includes(q);
    });
  }

  // Лейбли
  const countLabel = document.getElementById("att-count-label");
  if (countLabel){
    const isFiltered = !!(q || tF || grpF || sF);
    if (isFiltered){
      const w = lst.length;
      countLabel.textContent = `Знайдено ${w} ${w === 1 ? "спроба" : (w >= 2 && w <= 4) ? "спроби" : "спроб"} · застосовано фільтр`;
    } else {
      countLabel.textContent = "Всі проходження тестів студентами · оновлюється в реальному часі";
    }
  }
  const countRight = document.getElementById("att-count-right");
  if (countRight) countRight.textContent = `${lst.length} / ${totalCount}`;

  const tb = $("att-tbl");
  if (!tb) return;

  // ── Порожній стан ──
  if (!lst.length){
    const isFiltered = !!(q || tF || grpF || sF);
    tb.innerHTML = `<tr><td colspan="9" style="padding:0">
      <div class="empty-state">
        <div class="es-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div class="es-title">${isFiltered ? "Нічого не знайдено" : "Немає спроб"}</div>
        <div class="es-hint">${isFiltered ? "Спробуйте змінити фільтри або пошуковий запит" : "Коли студенти почнуть проходити тести, їхні спроби зʼявляться тут"}</div>
      </div>
    </td></tr>`;
    const pagEl = document.getElementById("att-pagination");
    if (pagEl) pagEl.innerHTML = "";
    return;
  }

  // ── Сортування ──
  const sf = _attSort.field, sd = _attSort.dir;
  if (sf){
    lst = [...lst].sort((a, b) => {
      let av = 0, bv = 0;
      if (sf === "name")  { av = `${a.surname || ""}${a.name || ""}`.toLowerCase(); bv = `${b.surname || ""}${b.name || ""}`.toLowerCase(); }
      if (sf === "grade") { av = a.grade12 ?? -1; bv = b.grade12 ?? -1; }
      if (sf === "time")  { av = (a.finishedAt && a.startedAt) ? (a.finishedAt - a.startedAt) : -1; bv = (b.finishedAt && b.startedAt) ? (b.finishedAt - b.startedAt) : -1; }
      if (sf === "date")  { av = a.createdAt || 0; bv = b.createdAt || 0; }
      return sd === "asc" ? (av > bv ? 1 : av < bv ? -1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
    });
  }

  // ── Пагінація ──
  const totalPages = Math.max(1, Math.ceil(lst.length / ATT_PER_PAGE));
  if (window._attPage > totalPages) window._attPage = totalPages;
  const pageStart = (window._attPage - 1) * ATT_PER_PAGE;
  const pageLst = lst.slice(pageStart, pageStart + ATT_PER_PAGE);

  let pagHtml = "";
  if (totalPages > 1){
    const pages = [];
    for (let p = 1; p <= totalPages; p++){
      if (p === 1 || p === totalPages || Math.abs(p - window._attPage) <= 1){
        pages.push(p);
      } else if (pages[pages.length - 1] !== "..."){
        pages.push("...");
      }
    }
    pagHtml = `<div class="pg">
      <button onclick="_attPage=Math.max(1,_attPage-1);renderAttempts()" ${window._attPage === 1 ? "disabled" : ""} aria-label="Попередня">‹</button>
      ${pages.map(p => p === "..."
        ? `<span class="pg-ellipsis">…</span>`
        : `<button class="${p === window._attPage ? "active" : ""}" onclick="_attPage=${p};renderAttempts()">${p}</button>`
      ).join("")}
      <button onclick="_attPage=Math.min(${totalPages},_attPage+1);renderAttempts()" ${window._attPage === totalPages ? "disabled" : ""} aria-label="Наступна">›</button>
      <span class="pg-info">${pageStart + 1}–${Math.min(pageStart + ATT_PER_PAGE, lst.length)} з ${lst.length}</span>
    </div>`;
  }

  // ── Рядки таблиці ──
  tb.innerHTML = pageLst.map(a => {
    const t = tests.find(x => x.id === a.testId);
    const l = links.find(x => x.id === a.linkId);
    const c   = a.score?.correct ?? "—";
    const tot = a.score?.total   ?? "—";
    let durStr = "—";
    if (a.finishedAt && a.startedAt && a.finishedAt > a.startedAt){
      const secs = Math.floor((a.finishedAt - a.startedAt) / 1000);
      durStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, "0")}`;
    }
    const group = l?.group || "";
    const dateStr = a.createdAt
      ? new Date(a.createdAt).toLocaleDateString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "—";
    const viol = _attViolation(a);
    const gc = _attGradeColors(a.grade12);
    const gradeHtml = a.grade12 != null
      ? `<span class="grade-chip" style="background:${gc.bg};color:${gc.fg}">${a.grade12}/12</span>`
      : `<span class="muted mono">—</span>`;
    const flagHtml = viol > 0
      ? `<span class="flag-icon" title="${viol} балів підозрілої активності">⚑</span>`
      : "";

    return `<tr class="clickable" onclick="G.viewAtt('${a.id}')">
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          ${_attAva(a.name, a.surname)}
          <div style="min-width:0">
            <div style="font-weight:600;color:var(--ink-900);white-space:nowrap">${esc(a.surname || "")} ${esc(a.name || "")}${flagHtml}</div>
          </div>
        </div>
      </td>
      <td style="max-width:240px">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-700)" title="${esc(t?.title || "")}">${esc(t?.title || "—")}</div>
      </td>
      <td>${group ? `<span class="pill info" style="text-transform:none">${esc(group)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${gradeHtml}</td>
      <td class="mono" style="color:var(--ink-700)">${c}/${tot}</td>
      <td class="mono" style="color:var(--ink-500)">${durStr}</td>
      <td class="mono" style="color:var(--ink-500);white-space:nowrap">${dateStr}</td>
      <td>${_attStatusPill(a.status)}</td>
      <td>
        <div class="row-actions" onclick="event.stopPropagation()">
          <button class="ic-btn" title="Переглянути" onclick="G.viewAtt('${a.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button class="ic-btn danger" title="Видалити" onclick="G.confDelAttempt('${a.id}','${esc(a.name)} ${esc(a.surname)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
        </div>
      </td>
    </tr>`;
  }).join("");

  const pagEl = document.getElementById("att-pagination");
  if (pagEl) pagEl.innerHTML = pagHtml;
};

renderLinks = function(){
  const tb = $("lnk-tbl");
  if (!tb) return;
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
 
  // Автоматично закриваємо прострочені посилання
  const now = Date.now();
  links.filter(l => l.closeAt && now > l.closeAt && l.status === "active").forEach(async l => {
    try { await dbUpd(`links/${l.id}`, { status:"closed" }); l.status = "closed"; } catch {}
  });
 
  // ── Лічильник активних на сторінці ──
  const activeAll = links.filter(l => l.status === "active").length;
  const closedAll = links.filter(l => l.status !== "active").length;
  const cntEl = $("lnk-active-count");
  if (cntEl) cntEl.textContent = activeAll;
  // Лічильники у tabs
  const tabAll    = $("lnk-tab-all");    if (tabAll)    tabAll.textContent    = links.length;
  const tabActive = $("lnk-tab-active"); if (tabActive) tabActive.textContent = activeAll;
  const tabClosed = $("lnk-tab-closed"); if (tabClosed) tabClosed.textContent = closedAll;
 
  // ── Фільтри ──
  const q = ($("lnk-srch")?.value || "").toLowerCase();
  const sF = window._lnkStatus || "";
  let lst = links;
  if (sF){
    if (sF === "active") lst = lst.filter(l => l.status === "active");
    else if (sF === "closed") lst = lst.filter(l => l.status !== "active");
  }
  if (q){
    lst = lst.filter(l => {
      const t = tests.find(x => x.id === l.testId);
      return (l.group || "").toLowerCase().includes(q) || (t?.title || "").toLowerCase().includes(q);
    });
  }
 
  // ── Empty state ──
  if (!lst.length){
    const isFiltered = !!(q || sF);
    tb.innerHTML = `<div class="l-empty">
      <div class="l-empty-ico">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5"/><path d="M14 11a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5"/></svg>
      </div>
      <div class="l-empty-title">${isFiltered ? "Нічого не знайдено" : "Ще немає посилань"}</div>
      <div class="l-empty-hint">${isFiltered ? "Спробуйте змінити запит або скиньте фільтри" : "Створіть перше посилання, щоб поділитися тестом зі студентами"}</div>
      ${!isFiltered ? `<button class="l-btn primary" onclick="openM('m-link')" style="margin:0 auto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Нове посилання</button>` : ""}
    </div>`;
    return;
  }
 
  // ── Картки ──
  tb.innerHTML = lst.map(l => {
    const t = tests.find(x => x.id === l.testId);
    const url = `${base}test.html?link=${l.id}&t=${_uid}`;
    const used = l.usedAttempts || 0;
    const max = l.maxAttempts || 0;
    const pct = max > 0 ? Math.min(100, Math.round(used / max * 100)) : 0;
 
    // Статус
    const expired = l.closeAt && Date.now() > l.closeAt;
    const isActive = l.status === "active" && !expired;
    let statusPill;
    if (isActive)       statusPill = `<span class="l-pill on">Активне</span>`;
    else if (expired)   statusPill = `<span class="l-pill expired">Протерміновано</span>`;
    else                statusPill = `<span class="l-pill closed">Закрите</span>`;
 
    // Дата закриття
    const closeStr = l.closeAt
      ? new Date(l.closeAt).toLocaleString("uk-UA", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })
      : null;
 
    // Дата створення
    const createdStr = l.createdAt
      ? new Date(l.createdAt).toLocaleDateString("uk-UA", { day:"numeric", month:"short" })
      : "—";
 
    // Колір для % і прогрес-бару
    const pctColor = pct >= 100 ? "#16A34A" : pct >= 80 ? "#B45309" : pct >= 40 ? "#1E40AF" : "#5B6A8F";
    const barColor = pct >= 100 ? "#16A34A" : pct >= 80 ? "#F59E0B" : "#3B82F6";
    const pctClass = pct >= 100 ? "ok" : pct >= 80 ? "warn" : pct >= 40 ? "info" : "";
 
    // Slug для URL — використовуємо короткий хеш id
    const slug = String(l.id).slice(0, 8);
 
    // Path of URL без origin для display
    const urlDisplay = url.replace(location.origin, "").replace(/^\//, "");
    const dom = location.host + "/";
 
    return `<div class="lnk-card ${isActive ? "" : "is-closed"}">
 
      <!-- Шапка: pills + title -->
      <div class="l-head">
        <div class="l-head-l">
          <div class="l-pills">
            ${statusPill}
            ${l.group ? `<span class="l-pill info">${esc(l.group)}</span>` : ""}
            <span class="l-pill off">ID: ${slug}</span>
          </div>
          <div class="l-title">${esc(t?.title || "—")}</div>
        </div>
      </div>
 
      <!-- URL -->
      <div class="l-url">
        <span class="l-url-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5"/><path d="M14 11a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5"/></svg></span>
        <span class="l-url-text"><span class="l-dom">${esc(dom)}</span><span class="l-slug">${esc(urlDisplay)}</span></span>
        <span class="l-url-actions">
          <button class="l-url-btn" onclick="G.copyUrl('${url}');window.lnkToast&&window.lnkToast('Скопійовано')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Копіювати
          </button>
          <a class="l-url-btn icon-only" href="${url}" target="_blank" rel="noopener" title="Відкрити в новій вкладці">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>
          </a>
        </span>
      </div>
 
      <!-- Stats -->
      <div class="l-stats">
        <div>
          <div class="l-stat-v">${used}${max > 0 ? `/${max}` : ""}</div>
          <div class="l-stat-l">Використань</div>
        </div>
        <div>
          <div class="l-stat-v ${pctClass}">${pct}%</div>
          <div class="l-stat-l">Заповненість</div>
        </div>
        <div>
          <div class="l-stat-v small">${closeStr || (createdStr !== "—" ? "Без терміну" : "—")}</div>
          <div class="l-stat-l">${closeStr ? "Діє до" : "Термін"}</div>
        </div>
      </div>
 
      <!-- Прогрес -->
      <div class="l-bar"><i style="width:${pct}%;background:${barColor}"></i></div>
 
      <!-- Footer -->
      <div class="l-foot">
        <div class="l-foot-meta">Створено ${createdStr}</div>
        <div class="l-foot-actions">
          <button class="l-icon-btn" title="QR-код" onclick="G.showQR('${l.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M17 14v3M14 17h3"/></svg>
          </button>
          <button class="l-icon-btn" title="Студенти" onclick="G.showStudents('${l.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </button>
          <button class="l-icon-btn" title="Редагувати" onclick="G.editLink('${l.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="l-icon-btn" title="${isActive ? "Закрити" : "Відкрити"}" onclick="G.togLink('${l.id}','${l.status}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${isActive ? '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>' : '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0114 0"/>'}</svg>
          </button>
          <button class="l-icon-btn danger" title="Видалити" onclick="G.delLink('${l.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join("");
}
 
  // ── Генерація QR-кодів для активних посилань ──
  // Використовуємо існуючу бібліотеку qrcodejs (підключена з cdn в links.html)
  if (window.QRCode){
    lst.filter(l => l.status === "active" && (!l.closeAt || Date.now() <= l.closeAt)).forEach(l => {
      const wrap = document.getElementById(`lnk-qr-${l.id}`);
      if (!wrap || wrap.firstChild) return; // вже є
      try {
        new QRCode(wrap, {
          text: `${base}test.html?link=${l.id}&t=${_uid}`,
          width: 100,
          height: 100,
          colorDark: "#0B1437",
          colorLight: "#FFFFFF",
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch(e){}
    });
  }
}
 

// G — global actions
// ─── GROQ для AI аналізу ──────────────────────────────────────────────────────
// ─── AI виклик: підтримує Groq і Google AI Studio ──────────────────────────

async function callGroq(messages, maxTokens=800, temp=0.5){
  const UA = "Ти — розумний асистент викладача. ОБОВ\'ЯЗКОВО відповідай ВИКЛЮЧНО українською мовою. Жодних інших мов. Якщо щось не знаєш українською — все одно пиши по-українськи.";
  try{
    const snap = await get(ref(db,"settings/ai"));
    const s = snap.exists() ? snap.val() : {};
    const provider = s.provider || "groq";

    if(provider === "gemini"){
      const key   = s.geminiApiKey || s.apiKey || "";
      const model = s.geminiModel  || s.model  || "gemini-2.0-flash";
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
          generationConfig:{maxOutputTokens:maxTokens, temperature:temp}
        })
      });
      const raw = await res.text();
      let d;
      try{ d = JSON.parse(raw); }
      catch(e){ throw new Error("Gemini: невалідна відповідь — " + raw.substring(0,200)); }
      if(d.error) throw new Error("Gemini: " + (d.error.message||JSON.stringify(d.error)));
      return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      const key   = s.groqApiKey || s.apiKey || "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";
      const model = s.groqModel  || s.model  || "llama-3.3-70b-versatile";
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
  setFF(v){ _fFilter=v; renderTests(document.getElementById("srch")?.value||""); },
  _toggleTestMenu(id){
    const menu=document.getElementById("tmenu-"+id);
    if(!menu) return;
    const isOpen=menu.style.display!=="none";
    document.querySelectorAll("[id^='tmenu-']").forEach(m=>m.style.display="none");
    if(!isOpen){
      menu.style.display="block";
      setTimeout(()=>{ const h=e=>{ if(!menu.contains(e.target)){menu.style.display="none";} document.removeEventListener("click",h); }; document.addEventListener("click",h); },0);
    }
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
    G.renderAnalytics();
  },

  selectLinkTest(testId, title){
    document.getElementById("cd-nl-t-label").textContent=title;
    document.getElementById("nl-t").value=testId;
    const menu=document.getElementById("cd-nl-t-menu");
    menu?.querySelectorAll(".cd-item").forEach(el=>{
      el.classList.toggle("cd-active", el.dataset.val===testId);
    });
    const btn=document.querySelector("#cd-nl-t .cd-btn");
    btn?.classList.toggle("active", !!testId);
    menu?.classList.remove("open");
  },
  toggleArchive(){
    const list=document.getElementById("archive-list");
    const chev=document.getElementById("archive-chevron");
    if(!list)return;
    const isHidden=list.style.display==="none";
    list.style.display=isHidden?"block":"none";
    if(chev) chev.style.transform=isHidden?"rotate(180deg)":"";
    if(isHidden) G.renderArchive();
  },
  renderArchive(){
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
        <button class="btn bd btn-sm" onclick="G.permDeleteTest('${t.id}','${esc(t.title)}')" style="font-size:12px">🗑</button>
      </div>`;
    }).join("");
  },
  async restoreTest(id){
    try{
      await dbUpd(`tests/${id}`,{status:"draft",archivedAt:null});
      tests=tests.map(t=>t.id===id?{...t,status:"draft",archivedAt:null}:t);
      renderAll(); G.renderArchive(); toast("Тест відновлено як чернетка");
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
  async submitFolder(){
    const n=$("nf-n").value.trim();
    if(!n){$("nf-n").classList.add("er");return;}
    if(folders.some(f=>f.name===n)){toast(`Папка «${n}» вже існує`,"err");return;}
    try{
      const color=$("nf-color")?.value||"#2d5be3";
      const id=await dbPush("folders",{name:n,color,createdAt:ts()});
      folders.push({id,name:n,color,createdAt:ts()});
      closeM("m-folder"); $("nf-n").value="";
      $("nf-color").value="#2d5be3";
      document.querySelectorAll("#m-folder [data-color]").forEach(el=>el.style.borderColor="transparent");
      document.querySelector('#m-folder [data-color="#2d5be3"]')?.style && (document.querySelector('#m-folder [data-color="#2d5be3"]').style.borderColor="white");
      renderTests(); updateBadges(); toast(`Папку «${n}» створено`);
    }catch(e){toast("Помилка: "+e.message,"err");}
  },
  selectFolderColor(color){
    $("nf-color").value = color;
    document.querySelectorAll("#m-folder [data-color]").forEach(el=>{
      el.style.borderColor = el.dataset.color===color ? "white" : "transparent";
      el.style.transform = el.dataset.color===color ? "scale(1.2)" : "";
      el.style.boxShadow = el.dataset.color===color ? `0 2px 12px ${color}88` : "";
    });
  },

  confDelFolder(id,name){_pid=id;$("del-fn").textContent=name;openM("m-del-folder");},
  async doDelFolder(){
    const id=_pid;_pid=null;closeM("m-del-folder");
    try{
      // Видаляємо папку — тести залишаються (просто без папки)
      const ops=[dbDel(`folders/${id}`)];
      tests.filter(t=>t.folderId===id).forEach(t=>ops.push(dbUpd(`tests/${t.id}`,{folderId:null})));
      await Promise.all(ops);
      folders=folders.filter(f=>f.id!==id);
      tests=tests.map(t=>t.folderId===id?{...t,folderId:null}:t);
      renderTests(); toast("Папку видалено. Тести переміщено в «Без папки»");
    }catch(e){toast("Помилка: "+e.message,"err");}
  },
  // Tests
  openTestInFolder(fid){_fid=fid||null;openM("m-test");buildChips();},
  async submitTest(){
    const n=$("nt-n").value.trim();
    if(!n){$("nt-n").classList.add("er");$("nt-n").focus();return;}
    const desc=$("nt-d").value.trim(),tags=$("nt-tg").value.split(",").map(s=>s.trim()).filter(Boolean),tl=(parseInt($("nt-tm").value)||10)*60;
    ldr(true);closeM("m-test");
    try{
      const id=await dbPush("tests",{title:n,description:desc,folderId:_fid||null,tags,timeLimit:tl,status:"draft",questions:[],createdAt:ts()});
      location.href=`constructor.html?id=${id}`;
    }catch(e){toast("Помилка: "+e.message,"err");ldr(false);}
  },
  confDelTest(id,name){_pid=id;$("del-tn").textContent=name;openM("m-del-test");},
  async doDelTest(mode="archive"){
    const id=_pid;_pid=null;closeM("m-del-test");ldr(true);
    try{
      if(mode==="archive"){
        // Архівуємо тест — зберігаємо спроби, закриваємо посилання
        await dbUpd(`tests/${id}`,{status:"archived",archivedAt:ts()});
        const rl=links.filter(l=>l.testId===id);
        await Promise.all(rl.map(l=>dbUpd(`links/${l.id}`,{status:"closed"})));
        tests=tests.map(t=>t.id===id?{...t,status:"archived"}:t);
        links=links.map(l=>l.testId===id?{...l,status:"closed"}:l);
        renderAll();toast("Тест переміщено в архів");
      } else {
        // Повне видалення
        const rl=links.filter(l=>l.testId===id),ra=attempts.filter(a=>a.testId===id);
        await Promise.all([dbDel(`tests/${id}`),...rl.map(l=>dbDel(`links/${l.id}`)),...ra.map(a=>dbDel(`attempts/${a.id}`))]);
        tests=tests.filter(t=>t.id!==id);links=links.filter(l=>l.testId!==id);attempts=attempts.filter(a=>a.testId!==id);
        renderAll();toast("Тест та всі спроби видалено");
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

  qLink(tid){
    window._editLinkId=null;
    $("m-link-title").textContent="Нове посилання";
    $("m-link-sub").textContent="Для студентів на тест";
    $("m-link-test-wrap").style.display="";
    $("cd-nl-t").style.display="block";
    $("nl-submit-btn").textContent="Створити →";
    $("nl-t").value=tid; $("nl-m").value="30"; $("nl-g").value="";
    // Оновлюємо label кастомного дропдауну
    const selT=tests.find(x=>x.id===tid);
    if(selT&&$("cd-nl-t-label")) $("cd-nl-t-label").textContent=selT.title;
    else if($("cd-nl-t-label")) $("cd-nl-t-label").textContent="Оберіть тест...";
    $("nl-sq").checked=false; $("nl-sa").checked=false;
    // Оновлюємо кастомний дропдаун
    const selTest=tests.find(t=>t.id===tid);
    if(selTest){ G.selectLinkTest(tid,selTest.title); }
    else {
      const lbl=document.getElementById("cd-nl-t-label");
      if(lbl) lbl.textContent="Оберіть тест...";
    }
    openM("m-link");
  },
  editLink(id){
    const l=links.find(x=>x.id===id); if(!l)return;
    window._editLinkId=id;
    $("m-link-title").textContent="Редагувати посилання";
    $("m-link-sub").textContent="Змінити налаштування";
    $("m-link-test-wrap").style.display="none";
    $("cd-nl-t").style.display="none";
    $("nl-submit-btn").textContent="Зберегти →";
    $("nl-m").value=l.maxAttempts||30; $("nl-g").value=l.group||"";
    $("nl-sq").checked=l.shuffleQuestions||false;
    $("nl-sa").checked=l.shuffleAnswers||false;
    if($("nl-close")){if(l.closeAt){const d=new Date(l.closeAt),pad=n=>String(n).padStart(2,"0");$("nl-close").value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;} else{$("nl-close").value="";}}
    openM("m-link");
  },
  async submitLink(){
    const editId=window._editLinkId, group=$("nl-g").value.trim(), mx=parseInt($("nl-m").value)||30;
    const shuffleQuestions=$("nl-sq")?.checked||false;
    const shuffleAnswers  =$("nl-sa")?.checked||false;
    if(editId){
      try{
        const closeAtVal2 = $("nl-close")?.value;
        const closeAt2 = closeAtVal2 ? new Date(closeAtVal2).getTime() : null;
        await dbUpd(`links/${editId}`,{maxAttempts:mx,group,shuffleQuestions,shuffleAnswers,closeAt:closeAt2});
        links=links.map(l=>l.id===editId?{...l,maxAttempts:mx,group,shuffleQuestions,shuffleAnswers,closeAt:closeAt2}:l);
        closeM("m-link");renderLinks();toast("Збережено");
      }catch(e){toast("Помилка: "+e.message,"err");}
      return;
    }
    const tid=$("nl-t").value;
    if(!tid){toast("Оберіть тест","err");return;}
    try{
      const closeAtVal = $("nl-close")?.value;
      const closeAt = closeAtVal ? new Date(closeAtVal).getTime() : null;
      await dbPush("links",{testId:tid,maxAttempts:mx,usedAttempts:0,status:"active",group,shuffleQuestions,shuffleAnswers,closeAt,createdAt:ts()});
      // onValue сам оновить links[] — не додаємо вручну
      closeM("m-link");toast("Посилання створено");
    }catch(e){toast("Помилка: "+e.message,"err");}
  },
  async togLink(id,st){
    const ns=st==="active"?"closed":"active";
    try{
      await dbUpd(`links/${id}`,{status:ns});
      links=links.map(l=>l.id===id?{...l,status:ns}:l);
      renderLinks();renderDashLinks();updateBadges();toast(ns==="active"?"Посилання відкрито":"Посилання закрито");
    }catch(e){toast("Помилка: "+e.message,"err");}
  },
  async delLink(id){
    try{
      await dbDel(`links/${id}`);
      links=links.filter(l=>l.id!==id);
      renderLinks();renderDashLinks();updateBadges();renderStats();toast("Посилання видалено");
    }catch(e){toast("Помилка: "+e.message,"err");}
  },
  showQR(linkId){
    const l=links.find(x=>x.id===linkId),t=tests.find(x=>x.id===l?.testId);
    if(!l)return;
    const base=location.origin+location.pathname.replace(/[^/]*$/, "");
    const url=`${base}test.html?link=${linkId}&t=${_uid}`;
    window._qrUrl=url;
    $("qr-title").textContent=t?.title||"—";
    $("qr-group").textContent=l.group?`Група: ${l.group}`:"";
    $("qr-url-text").textContent=url;
    // Генеруємо QR через QRCode.js CDN
    const canvas=$("qr-canvas");
    canvas.innerHTML="";
    if(window.QRCode){
      new QRCode(canvas,{text:url,width:200,height:200,colorDark:"#0d1340",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
    } else {
      canvas.innerHTML=`<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&color=0d1340" style="width:200px;height:200px;border-radius:8px">`;
    }
    openM("m-qr");
  },
  downloadQR(){
    const canvas=$("qr-canvas")?.querySelector("canvas");
    const img=$("qr-canvas")?.querySelector("img");
    const t=$("qr-title")?.textContent||"qr";
    if(canvas){
      const a=document.createElement("a");a.download=`QR_${t}.png`;a.href=canvas.toDataURL("image/png");a.click();
    } else if(img){
      // Завантажуємо через blob
      fetch(img.src).then(r=>r.blob()).then(blob=>{
        const a=document.createElement("a");a.download=`QR_${t}.png`;a.href=URL.createObjectURL(blob);a.click();
      });
    }
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
    markAllNotifsRead();

    const fVal=$("notif-filter")?.value||"";
    let filtered=_notifications;
    if(fVal==="warn")      filtered=filtered.filter(n=>n.isWarning);
    if(fVal==="completed") filtered=filtered.filter(n=>n.type==="completed");
    if(fVal==="started")   filtered=filtered.filter(n=>n.type==="started");

    if(!filtered.length){
      list.innerHTML=`<div class="empty" style="padding:60px 20px"><div class="ei">🔔</div><div class="et">${fVal?"Немає сповіщень за фільтром":"Немає сповіщень"}</div></div>`;
      return;
    }
    const today=new Date().toDateString(),yest=new Date(Date.now()-86400000).toDateString();
    let lastGroup=null;
    list.innerHTML=filtered.map(n=>{
      const d=new Date(n.ts),dStr=d.toDateString();
      const groupLabel=dStr===today?"Сьогодні":dStr===yest?"Вчора":d.toLocaleDateString("uk-UA",{day:"numeric",month:"long"});
      let groupHtml="";
      if(groupLabel!==lastGroup){lastGroup=groupLabel;
        groupHtml=`<div style="display:flex;align-items:center;gap:10px;margin:14px 0 8px"><div style="flex:1;height:1px;background:var(--border)"></div><span style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--light);font-weight:600;white-space:nowrap;padding:0 4px">${groupLabel}</span><div style="flex:1;height:1px;background:var(--border)"></div></div>`;}
      const time=d.toLocaleTimeString("uk-UA",{hour:"2-digit",minute:"2-digit"});
      const isWarn=n.isWarning;
      const nid=n.id||"";
      const aid=n.attemptId||"";
      return groupHtml+`
      <div class="notif-item${isWarn?" unread-warn":""}" style="background:${isWarn?"rgba(244,63,94,.04)":"#fff"}">
        <div class="notif-icon" style="background:${isWarn?"rgba(244,63,94,.1)":"rgba(45,91,227,.07)"}">${n.icon||"🔔"}</div>
        <div class="notif-body" style="flex:1;min-width:0">
          <div class="notif-title">${n.title?n.title:""}</div>
          <div class="notif-desc">${n.msg||n.desc||""}</div>
          ${n.sharedTestId?`<div onclick="G.openSharedTest('${n.sharedTestId}')" style="display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-size:12px;font-weight:600;color:var(--primary);cursor:pointer">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Відкрити тест
          </div>`:""}
          <div class="notif-time">${time}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          ${aid?`<div class="ib" title="Деталі" onclick="G.viewAtt('${aid}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>`:""}
          <div class="ib d" title="Видалити" onclick="G.delNotif('${nid}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></div>
        </div>
      </div>`;
    }).join("");
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

  toggleNotifSound(){
    _soundEnabled = !_soundEnabled;
    localStorage.setItem("qf_sound", _soundEnabled ? "1" : "0");
    const btn = document.getElementById("notif-sound-btn");
    if(btn){
      btn.textContent = _soundEnabled ? "🔔" : "🔕";
      btn.title = _soundEnabled ? "Звук увімкнено" : "Звук вимкнено";
      btn.style.opacity = _soundEnabled ? "1" : "0.5";
    }
    toast(_soundEnabled ? "Звук сповіщень увімкнено" : "Звук сповіщень вимкнено");
  },

  async clearAllNotifs(){
    const ids=[..._notifications.map(n=>n.id)];
    _notifications=[];
    updateNotifBadge();
    G.renderNotifications();
    toast("Сповіщення очищено");
    await Promise.all(ids.map(id=>dbDel(`notifications/${id}`).catch(()=>{})));
  },


  // ─── STUDENTS ────────────────────────────────────────────────────────────
  async initStudents(){
    // Завантажуємо студентів з Firebase
    try{
      const snap = await dbGet("students");
      _students = snap.exists()
        ? Object.entries(snap.val()).map(([id,v])=>({id,...v})).sort((a,b)=>
            (a.surname||"").localeCompare(b.surname||"","uk"))
        : [];
    }catch(e){ _students=[]; }

    // Оновлюємо бейдж
    const badge=$("nb-students");
    if(badge){ badge.textContent=_students.length; badge.style.display=_students.length?"":"none"; }

    // Фільтр груп
    const groups=[...new Set(_students.flatMap(s=>s.groups||[]).filter(Boolean))].sort();
    const menu=document.getElementById("cd-st-group-menu");
    if(menu){
      menu.innerHTML=`<div class="cd-item cd-active" data-val="" onclick="G.selectStFilter('','Всі групи')">Всі групи</div>`+
        groups.map(g=>`<div class="cd-item" data-val="${esc(g)}" onclick="G.selectStFilter('${esc(g)}','${esc(g)}')">${esc(g)}</div>`).join("");
    }
    G.renderStudents();
  },

  selectStFilter(value, label){
    document.getElementById("cd-st-group-label").textContent=label;
    document.getElementById("st-group").value=value;
    const menu=document.getElementById("cd-st-group-menu");
    menu?.querySelectorAll(".cd-item").forEach(el=>el.classList.toggle("cd-active",el.dataset.val===value));
    menu?.classList.remove("open");
    document.querySelector("#cd-st-group .cd-btn")?.classList.toggle("active",!!value);
    G.renderStudents();
  },

  renderStudents(){
    const body=document.getElementById("students-body");
    if(!body) return;
    const q=(document.getElementById("student-srch")?.value||"").toLowerCase().trim();
    const grp=document.getElementById("st-group")?.value||"";

    let list=[..._students];
    if(q) list=list.filter(s=>(s.name+" "+s.surname).toLowerCase().includes(q)||(s.surname+" "+s.name).toLowerCase().includes(q));
    if(grp) list=list.filter(s=>(s.groups||[]).includes(grp));

    if(!list.length){
      body.innerHTML=`<div class="empty" style="padding:80px 20px"><div class="ei">🎓</div><div class="et">${q||grp?"Нічого не знайдено":"Ще немає студентів"}</div><div class="es">Студенти з'являться після першого проходження тесту</div></div>`;
      return;
    }

    body.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
      ${list.map(s=>{
        const att=Array.isArray(s.attempts)?s.attempts:[];
        const groups=(s.groups||[]).filter(Boolean);
        const gc=s.avgGrade>=10?"#0d9e85":s.avgGrade>=7?"#2d5be3":s.avgGrade>=4?"#f59e0b":"#f43f5e";
        const gcLight=s.avgGrade>=10?"rgba(13,158,133,.1)":s.avgGrade>=7?"rgba(45,91,227,.1)":s.avgGrade>=4?"rgba(245,158,11,.1)":"rgba(244,63,94,.1)";
        const initials=(s.name||"?").slice(0,1)+(s.surname||"").slice(0,1);
        const lastDate=att.length?new Date(att[att.length-1].date).toLocaleDateString("uk-UA",{day:"numeric",month:"short"}):null;
        const passRate=att.length?Math.round(att.filter(a=>(a.grade||0)>=4).length/att.length*100):0;

        const bars=att.slice(-6).map(a=>{
          const pct=Math.max(4,Math.round((a.grade||0)/12*100));
          const c=a.grade>=10?"#0d9e85":a.grade>=7?"#2d5be3":a.grade>=4?"#f59e0b":"#f43f5e";
          return `<div style="flex:1;background:rgba(45,91,227,.06);border-radius:3px;height:32px;display:flex;align-items:flex-end;overflow:hidden"><div style="width:100%;background:${c};height:${pct}%;border-radius:3px;transition:height .4s"></div></div>`;
        }).join("");

        return `<div onclick="G.openStudentCard('${s.id}')" style="background:#fff;border:1.5px solid var(--border);border-radius:20px;overflow:hidden;cursor:pointer;transition:all .2s;display:flex;flex-direction:column"
          onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 12px 36px rgba(45,91,227,.12)';this.style.borderColor='rgba(45,91,227,.25)'"
          onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor='var(--border)'">
          <div style="padding:20px 20px 16px;display:flex;align-items:flex-start;gap:14px;flex:1">
            <div style="width:46px;height:46px;border-radius:13px;background:${gcLight};display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-weight:800;font-size:15px;color:${gc};flex-shrink:0;border:1.5px solid ${gc}22">${initials}</div>
            <div style="flex:1;min-width:0">
              <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.surname)} ${esc(s.name)}</div>
              <div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">
                ${groups.length?groups.map(g=>`<span style="background:rgba(45,91,227,.07);color:var(--primary);padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600">${esc(g)}</span>`).join(""):`<span style="color:var(--light);font-size:12px;font-style:italic">Без групи</span>`}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:28px;color:${gc};line-height:1;letter-spacing:-1px">${s.avgGrade||"—"}</div>
              <div style="font-size:10px;color:var(--muted);letter-spacing:.5px;margin-top:1px">/ 12</div>
            </div>
          </div>
          ${att.length>=2?`<div style="display:flex;gap:3px;padding:0 20px;height:32px;margin-bottom:14px">${bars}</div>`:""}
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--border);background:rgba(45,91,227,.015);margin-top:auto">
            <div style="display:flex;align-items:center;gap:14px">
              <span style="font-size:12px;color:var(--muted)"><strong style="color:var(--text)">${att.length}</strong> спроб</span>
              ${att.length?`<span style="font-size:12px;color:var(--muted)"><strong style="color:${passRate>=70?"#0d9e85":"var(--text)"}">${passRate}%</strong> здав</span>`:""}
            </div>
            ${lastDate?`<span style="font-size:11px;color:var(--light)">${lastDate}</span>`:""}
          </div>
        </div>`;
      }).join("")}
    </div>`;
  },

  viewAtt(id){
    const a = attempts.find(x => x.id === id);
    if (!a){ toast("Спробу не знайдено","err"); return; }
    const t = tests.find(x => x.id === a.testId);
    const l = links.find(x => x.id === a.linkId);
    const qs = Array.isArray(a.questionsSnapshot) ? a.questionsSnapshot : (t?.questions || []);
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
      const qs=Array.isArray(a.questionsSnapshot)?a.questionsSnapshot:(t?.questions||[]);
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
      const res=await callGroq([{role:"user",content:prompt}],600,0.5);
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
            <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:21px;line-height:1.2">${esc(s.surname)} ${esc(s.name)}</div>
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
        return `<div class="merge-item" id="mi-${s.id}" onclick="G.selectMergeTarget('${s.id}')"
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
    openM("m-merge");
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

  deleteStudent(id){
    const s=_students.find(x=>x.id===id);
    if(!s) return;
    const nameEl=document.getElementById("del-student-name");
    if(nameEl) nameEl.textContent=`${s.surname} ${s.name}`;
    document.getElementById("del-student-confirm-btn").onclick = async () => {
      closeM("m-del-student");
      await dbDel(`students/${id}`);
      _students=_students.filter(x=>x.id!==id);
      closeM("m-student");
      G.renderStudents();
      toast("Картку видалено");
    };
    closeM("m-student");
    openM("m-del-student");
  },



  renderArchive(){
    const body = document.getElementById("archive-body");
    if(!body) return;
    const archived = tests.filter(t=>t.status==="archived").sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    // Оновлюємо лічильник
    const nb = document.getElementById("nb-archive");
    if(nb) nb.textContent = archived.length;
    if(!archived.length){
      body.innerHTML=`<div class="empty" style="padding:60px 20px"><div class="ei">📦</div><div class="et">Архів порожній</div><p style="margin-top:6px;font-size:14px;color:var(--muted)">Сюди потрапляють тести зі статусом "Архівовано"</p></div>`;
      return;
    }
    body.innerHTML=`<div class="card" style="padding:0;overflow:hidden">
      <table class="tbl">
        <thead><tr>
          <th style="padding:13px 16px">Назва</th>
          <th>Питань</th>
          <th>Спроб</th>
          <th>Архівовано</th>
          <th></th>
        </tr></thead>
        <tbody>${archived.map(t=>{
          const attCount=attempts.filter(a=>a.testId===t.id).length;
          const dateStr=t.updatedAt?new Date(t.updatedAt).toLocaleDateString("uk-UA",{day:"numeric",month:"short",year:"numeric"}):"—";
          return`<tr>
            <td style="padding:12px 16px">
              <div style="font-weight:600;font-size:14px">${esc(t.title)}</div>
              ${(t.tags||[]).length?`<div style="margin-top:3px">${t.tags.map(g=>`<span style="font-size:11px;background:rgba(45,91,227,.07);color:var(--primary);padding:1px 7px;border-radius:10px;margin-right:3px">${esc(g)}</span>`).join("")}</div>`:""}
            </td>
            <td style="color:var(--muted);font-size:13px">${t.questions?.length||0}</td>
            <td style="color:var(--muted);font-size:13px">${attCount}</td>
            <td style="font-size:12px;color:var(--muted)">${dateStr}</td>
            <td><div class="ra">
              <div class="ib" title="Відновити тест" onclick="G.restoreTest('${t.id}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
              </div>
              <div class="ib d" title="Видалити назавжди" onclick="G.confDelTest('${t.id}','${esc(t.title)}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              </div>
            </div></td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
  },

  toggleSuspDrop(type){
    const testMenu=document.getElementById("susp-test-menu");
    const dateMenu=document.getElementById("susp-date-menu");
    if(type==="test"){
      const isOpen=testMenu.style.display!=="none";
      testMenu.style.display=isOpen?"none":"block";
      if(dateMenu) dateMenu.style.display="none";
    } else {
      const isOpen=dateMenu.style.display!=="none";
      dateMenu.style.display=isOpen?"none":"block";
      if(testMenu) testMenu.style.display="none";
    }
  },
  setSuspTest(id, label){
    const inp=document.getElementById("susp-filter-test");
    if(inp) inp.value=id;
    const lbl=document.getElementById("susp-test-label");
    if(lbl) lbl.textContent=label;
    const menu=document.getElementById("susp-test-menu");
    if(menu) menu.style.display="none";
    const btn=document.getElementById("susp-test-btn");
    if(btn) btn.style.borderColor=id?"var(--primary)":"var(--border)";
    if(btn) btn.style.color=id?"var(--primary)":"var(--text)";
    const rst=document.getElementById("susp-reset-btn");
    const dateVal=document.getElementById("susp-filter-date")?.value||"";
    if(rst) rst.style.display=(id||dateVal)?"":"none";
    G.renderSuspicious();
  },
  setSuspDate(val){
    const lbl=document.getElementById("susp-date-label");
    if(lbl) lbl.textContent=val?new Date(val+"T00:00:00").toLocaleDateString("uk-UA",{day:"numeric",month:"short",year:"numeric"}):"Будь-яка дата";
    const btn=document.getElementById("susp-date-btn");
    if(btn) btn.style.borderColor=val?"var(--primary)":"var(--border)";
    if(btn) btn.style.color=val?"var(--primary)":"var(--text)";
    const menu=document.getElementById("susp-date-menu");
    if(menu) menu.style.display="none";
    const rst=document.getElementById("susp-reset-btn");
    const testVal=document.getElementById("susp-filter-test")?.value||"";
    if(rst) rst.style.display=(val||testVal)?"":"none";
    G.renderSuspicious();
  },
  resetSuspFilters(){
    const inp=document.getElementById("susp-filter-test");
    if(inp) inp.value="";
    const dateInp=document.getElementById("susp-filter-date");
    if(dateInp) dateInp.value="";
    G.setSuspTest("","Всі тести");
    const lbl=document.getElementById("susp-date-label");
    if(lbl) lbl.textContent="Будь-яка дата";
    const btn=document.getElementById("susp-date-btn");
    if(btn){ btn.style.borderColor="var(--border)"; btn.style.color="var(--text)"; }
    const rst=document.getElementById("susp-reset-btn");
    if(rst) rst.style.display="none";
    G.renderSuspicious();
  },

    renderSuspicious(filterTest, filterDate){
    const body = document.getElementById("suspicious-body");
    if(!body) return;

    // Скидаємо каунтер — помічаємо скільки є зараз "прочитано"
    const allScored = attempts
      .filter(a => a.status === "completed" || a.status === "pending_review")
      .map(a => { const score=(a.tabSwitches||0)*2+(a.copyAttempts||0)*3+(a.screenshots||0)*5; return{...a,suspScore:score}; })
      .filter(a => a.suspScore > 0);
    // Зберігаємо в Firebase — синхронізується між пристроями
    dbUpd("meta", { suspReadCount: allScored.length }).catch(()=>{});
    const badge=$("nb-suspicious");
    if(badge){ badge.textContent="0"; badge.style.display="none"; }

    // Фільтри
    const fTest = filterTest || document.getElementById("susp-filter-test")?.value || "";
    const fDate = filterDate || document.getElementById("susp-filter-date")?.value || "";
    let scored = [...allScored];
    if(fTest) scored = scored.filter(a=>a.testId===fTest);
    if(fDate){
      const d=new Date(fDate); d.setHours(0,0,0,0);
      const d2=new Date(fDate); d2.setHours(23,59,59,999);
      scored=scored.filter(a=>a.createdAt>=d.getTime()&&a.createdAt<=d2.getTime());
    }
    scored.sort((a,b)=>b.suspScore-a.suspScore);

    // Заголовок з фільтрами
    const secHead = document.querySelector("#sec-suspicious .ph");
    if(secHead && !document.getElementById("susp-filters")){
      const filtersDiv=document.createElement("div");
      filtersDiv.id="susp-filters";
      filtersDiv.style.cssText="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:20px";
      filtersDiv.innerHTML=`
        <!-- Кастомний дропдаун тесту -->
        <div style="position:relative" id="susp-test-wrap">
          <button onclick="G.toggleSuspDrop('test')"
            style="display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;border:1.5px solid var(--border);background:#fff;font-size:13px;font-weight:500;color:var(--text);cursor:pointer;transition:all .15s;min-width:180px;justify-content:space-between"
            onmouseover="this.style.borderColor='rgba(45,91,227,.35)'" onmouseout="this.style.borderColor='var(--border)'" id="susp-test-btn">
            <span id="susp-test-label">Всі тести</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div id="susp-test-menu" style="display:none;position:absolute;top:calc(100% + 6px);left:0;min-width:240px;background:#fff;border:1.5px solid var(--border);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.1);z-index:100;padding:6px;max-height:240px;overflow-y:auto">
            <div onclick="G.setSuspTest('','Всі тести')" style="padding:9px 12px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:500;transition:background .1s"
              onmouseover="this.style.background='rgba(45,91,227,.05)'" onmouseout="this.style.background=''">Всі тести</div>
            ${tests.filter(t=>t.status!=="archived").map(t=>`
              <div onclick="G.setSuspTest('${t.id}','${esc(t.title)}')" style="padding:9px 12px;border-radius:9px;cursor:pointer;font-size:13px;transition:background .1s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                onmouseover="this.style.background='rgba(45,91,227,.05)'" onmouseout="this.style.background=''">${esc(t.title)}</div>`).join("")}
          </div>
        </div>

        <!-- Кастомний вибір дати -->
        <div style="position:relative" id="susp-date-wrap">
          <button onclick="G.toggleSuspDrop('date')"
            style="display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;border:1.5px solid var(--border);background:#fff;font-size:13px;font-weight:500;color:var(--text);cursor:pointer;transition:all .15s"
            onmouseover="this.style.borderColor='rgba(45,91,227,.35)'" onmouseout="this.style.borderColor='var(--border)'" id="susp-date-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span id="susp-date-label">Будь-яка дата</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div id="susp-date-menu" style="display:none;position:absolute;top:calc(100% + 6px);left:0;background:#fff;border:1.5px solid var(--border);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.1);z-index:100;padding:12px">
            <input type="date" id="susp-filter-date"
              style="padding:9px 14px;border-radius:10px;border:1.5px solid var(--border);font-size:14px;color:var(--text);outline:none;background:#fff;font-family:'DM Sans',sans-serif;cursor:pointer;width:180px"
              onchange="G.setSuspDate(this.value)"
              onfocus="this.style.borderColor='var(--primary)';this.style.boxShadow='0 0 0 3px rgba(45,91,227,.08)'"
              onblur="this.style.borderColor='var(--border)';this.style.boxShadow=''">
          </div>
        </div>

        <!-- Кнопка скинути (показується тільки якщо є фільтри) -->
        <button id="susp-reset-btn" onclick="G.resetSuspFilters()" style="display:none;padding:9px 14px;border-radius:12px;border:1.5px solid rgba(244,63,94,.25);background:rgba(244,63,94,.05);color:#be123c;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s"
          onmouseover="this.style.background='rgba(244,63,94,.1)'" onmouseout="this.style.background='rgba(244,63,94,.05)'">
          ✕ Скинути фільтри
        </button>

        <!-- Лічильник результатів -->
        <div id="susp-count-label" style="margin-left:auto;font-size:13px;color:var(--muted)"></div>
      `;
      // Ховаємо меню при кліку поза (тільки один раз)
      if(!window._suspClickListenerAdded){
        window._suspClickListenerAdded=true;
        document.addEventListener("click", e=>{
          const tm=document.getElementById("susp-test-menu");
          const dm=document.getElementById("susp-date-menu");
          if(tm && !e.target.closest("#susp-test-wrap")) tm.style.display="none";
          if(dm && !e.target.closest("#susp-date-wrap")) dm.style.display="none";
        });
      }
      // Прихована input для збереження значення
      const hiddenTest=document.createElement("input");
      hiddenTest.type="hidden"; hiddenTest.id="susp-filter-test"; hiddenTest.value="";
      filtersDiv.appendChild(hiddenTest);
      body.parentNode.insertBefore(filtersDiv, body);
    } else if(document.getElementById("susp-filters")){
      // Оновлюємо список тестів в меню
      const menu=document.getElementById("susp-test-menu");
      if(menu){
        const curVal=document.getElementById("susp-filter-test")?.value||"";
        menu.innerHTML=`<div onclick="G.setSuspTest('','Всі тести')" style="padding:9px 12px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:500;transition:background .1s" onmouseover="this.style.background='rgba(45,91,227,.05)'" onmouseout="this.style.background=''">Всі тести</div>`
          +tests.filter(t=>t.status!=="archived").map(t=>`<div onclick="G.setSuspTest('${t.id}','${esc(t.title)}')" style="padding:9px 12px;border-radius:9px;cursor:pointer;font-size:13px;transition:background .1s" onmouseover="this.style.background='rgba(45,91,227,.05)'" onmouseout="this.style.background=''">${esc(t.title)}</div>`).join("");
      }
    }

    if(!scored.length){
      body.innerHTML=`<div class="empty" style="padding:80px 20px"><div class="ei">✅</div><div class="et">${fTest||fDate?"Нічого не знайдено":"Підозрілих спроб немає"}</div><div class="es">Студенти проходили тест без порушень</div></div>`;
      return;
    }

    // Компактна таблиця
    body.innerHTML=`<div style="background:#fff;border:1.5px solid var(--border);border-radius:18px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:rgba(244,63,94,.03)">
            <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">Студент</th>
            <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">Тест / Група</th>
            <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:center;border-bottom:1.5px solid var(--border)">Активність</th>
            <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:center;border-bottom:1.5px solid var(--border)">Ризик</th>
            <th style="padding:11px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">Дата</th>
            <th style="border-bottom:1.5px solid var(--border)"></th>
          </tr>
        </thead>
        <tbody>${scored.map(a=>{
          const t=tests.find(x=>x.id===a.testId);
          const l=links.find(x=>x.id===a.linkId);
          const score=a.suspScore;
          const lvlC=score>=10?"#be123c":score>=5?"#b45309":"#1d4ed8";
          const lvlBg=score>=10?"rgba(244,63,94,.08)":score>=5?"rgba(245,158,11,.07)":"rgba(45,91,227,.06)";
          const lvlL=score>=10?"Висока":score>=5?"Середня":"Низька";
          const dateStr=a.createdAt?new Date(a.createdAt).toLocaleDateString("uk-UA",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
          const tags=[];
          if(a.tabSwitches>0)  tags.push(`<span title="Переключень між вкладками: ${a.tabSwitches}" style="background:rgba(245,158,11,.1);color:#b45309;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;cursor:default">🔄 ${a.tabSwitches}</span>`);
          if(a.copyAttempts>0) tags.push(`<span title="Спроб скопіювати текст: ${a.copyAttempts}" style="background:rgba(244,63,94,.09);color:#be123c;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;cursor:default">📋 ${a.copyAttempts}</span>`);
          if(a.screenshots>0)  tags.push(`<span title="Спроб зробити скріншот: ${a.screenshots}" style="background:rgba(147,51,234,.09);color:#7e22ce;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;cursor:default">📸 ${a.screenshots}</span>`);
          return `<tr style="border-top:1px solid rgba(229,232,240,.5);transition:background .1s" onmouseover="this.style.background='rgba(244,63,94,.02)'" onmouseout="this.style.background=''">
            <td style="padding:11px 16px">
              <div style="font-weight:600;font-size:14px">${esc(a.surname)} ${esc(a.name)}</div>
            </td>
            <td style="padding:11px 16px;max-width:180px">
              <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t?.title||"—")}</div>
              ${l?.group?`<div style="font-size:11px;color:var(--muted)">${esc(l.group)}</div>`:""}
            </td>
            <td style="padding:11px 16px;text-align:center">
              <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">${tags.join("")}</div>
            </td>
            <td style="padding:11px 16px;text-align:center">
              <span style="display:inline-flex;align-items:center;gap:5px;background:${lvlBg};color:${lvlC};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">${lvlL}</span>
            </td>
            <td style="padding:11px 16px;font-size:12px;color:var(--muted);white-space:nowrap">${dateStr}</td>
            <td style="padding:11px 16px">
              <button class="ib" onclick="G.viewAtt('${a.id}')" title="Переглянути">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
  },

  renderOnline(){
    const body = document.getElementById("online-body");
    if(!body) return;

    // "Онлайн" = спроби зі статусом in_progress
    const online = attempts
      .filter(a => a.status === "in_progress")
      .sort((a,b) => (b.startedAt||0)-(a.startedAt||0));

    const badge = $("nb-online");
    if(badge){ badge.textContent = online.length; badge.style.display = online.length ? "" : "none"; }

    if(!online.length){
      body.innerHTML=`<div class="empty" style="padding:60px 20px"><div class="ei">📡</div><div class="et">Ніхто не проходить тест зараз</div></div>`;
      return;
    }

    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <div style="width:10px;height:10px;border-radius:50%;background:#0d9e85;animation:pulse 1.5s ease infinite"></div>
        <span style="font-size:14px;color:var(--muted)">${online.length} студент${online.length===1?"":"ів"} зараз в тесті</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
      ${online.map(a => {
        const t = tests.find(x=>x.id===a.testId);
        const l = links.find(x=>x.id===a.linkId);
        const elapsed = a.startedAt ? Math.round((Date.now()-a.startedAt)/60000) : 0;
        const elStr = elapsed < 1 ? "щойно" : `${elapsed} хв`;
        return `<div style="background:white;border:1.5px solid var(--border);border-radius:14px;padding:16px 18px;display:flex;align-items:center;gap:14px">
          <div style="width:10px;height:10px;border-radius:50%;background:#0d9e85;flex-shrink:0;box-shadow:0 0 0 3px rgba(13,158,133,.2)"></div>
          <div style="flex:1;min-width:0">
            <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:14px">${esc(a.name)} ${esc(a.surname)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:3px">
              ${esc(t?.title||"—")}${l?.group?` · ${esc(l.group)}`:""} · почав ${elStr} тому
            </div>
            ${a.currentQ?(()=>{const pct=a.totalQ?Math.round(a.currentQ/a.totalQ*100):0;return '<div style="margin-top:6px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;color:var(--muted)">Питання '+a.currentQ+' з '+(a.totalQ||'?')+'</span><span style="font-size:11px;color:var(--muted)">'+pct+'%</span></div><div style="background:var(--border);border-radius:4px;height:5px;overflow:hidden"><div style="background:linear-gradient(90deg,#0d9e85,#2d5be3);height:100%;border-radius:4px;width:'+pct+'%;transition:width .5s"></div></div></div>';})():""}
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${(a.tabSwitches||0)>0||((a.copyAttempts||0)>0)||((a.screenshots||0)>0)?`<span title="Підозріла активність" style="font-size:16px">⚠️</span>`:""}
            <button class="ib" onclick="G.viewAtt('${a.id}')" title="Переглянути">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>`;
      }).join("")}
      </div>`;
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
          `<div class="cd-item${curTestF===t.id?" cd-active":""}" data-val="${t.id}" onclick="G.selectGbFilter('test','${t.id}','${esc(t.title)}')">${esc(t.title)}</div>`
        ).join("");
      const lbl=document.getElementById("cd-gb-test-label");
      if(lbl&&curTestF){const t=tests.find(x=>x.id===curTestF);if(t)lbl.textContent=t.title;}
    }
    // Заповнюємо групи
    const groups=[...new Set(links.map(l=>l.group).filter(Boolean))].sort();
    const gbGrpMenu=document.getElementById("cd-gb-group-menu");
    if(gbGrpMenu){
      gbGrpMenu.innerHTML=`<div class="cd-item${!curGrpF?" cd-active":""}" data-val="" onclick="G.selectGbFilter('group','','Всі групи')">Всі групи</div>`+
        groups.map(g=>`<div class="cd-item${curGrpF===g?" cd-active":""}" data-val="${esc(g)}" onclick="G.selectGbFilter('group','${esc(g)}','${esc(g)}')">${esc(g)}</div>`
        ).join("");
      const lbl2=document.getElementById("cd-gb-group-label");
      if(lbl2&&curGrpF)lbl2.textContent=curGrpF;
    }
    G.renderGradebook();
  },

  selectGbFilter(field, value, label){
    const wrap = field==="test" ? "cd-gb-test" : "cd-gb-group";
    const selId = field==="test" ? "gb-test" : "gb-group";
    const lbl = document.getElementById(wrap+"-label");
    if(lbl) lbl.textContent=label;
    const menu=document.getElementById(wrap+"-menu");
    menu?.querySelectorAll(".cd-item").forEach(el=>{
      el.classList.toggle("cd-active", el.dataset.val===value||(!value&&el.dataset.val===""));
    });
    menu?.classList.remove("open");
    const btn=document.querySelector(`#${wrap} .cd-btn`);
    btn?.classList.toggle("active", !!value);
    // Зберігаємо в select і в window змінній
    const sel=document.getElementById(selId);
    if(sel) sel.value=value;
    if(field==="test") window._gbTestF=value;
    else window._gbGrpF=value;
    G.renderGradebook();
  },

  renderGradebook(){
    const body=document.getElementById("gradebook-body");
    if(!body) return;
    // Читаємо активний елемент з меню (найнадійніший спосіб)
    const activeTestEl=document.querySelector("#cd-gb-test-menu .cd-item.cd-active");
    const activeGrpEl=document.querySelector("#cd-gb-group-menu .cd-item.cd-active");
    const testF=activeTestEl?.dataset?.val||"";
    const groupF=activeGrpEl?.dataset?.val||"";

    let att=attempts.filter(a=>a.status==="completed"||a.status==="pending_review");
    if(groupF) att=att.filter(a=>{const l=links.find(x=>x.id===a.linkId);return (l?.group||"")===groupF;});
    if(testF)  att=att.filter(a=>a.testId===testF);

    if(!att.length){
      body.innerHTML=`<div class="empty" style="padding:80px 20px"><div class="ei">📋</div><div class="et">Немає завершених спроб</div><div class="es">Оберіть групу або тест для перегляду</div></div>`;
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
    let att=attempts.filter(a=>a.status==="completed"||a.status==="pending_review");
    if(groupF) att=att.filter(a=>{const l=links.find(x=>x.id===a.linkId);return (l?.group||"")===groupF;});
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

    // Фільтруємо спроби
    let att = attempts.filter(a => a.status === "completed" || a.status === "pending_review");
    if(testId)  att = att.filter(a => a.testId === testId);
    if(groupF){ att = att.filter(a => { const l=links.find(x=>x.id===a.linkId); return (l?.group||"") === groupF; }); }

    if(!att.length){
      body.innerHTML = `<div class="empty" style="padding:80px 20px"><div class="ei">📊</div><div class="et">Немає даних для відображення</div><div class="es">Оберіть тест або змініть фільтри</div></div>`;
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
    const gradeColor = g => g>=10?"#0d9e85":g>=7?"#2d5be3":g>=4?"#f59e0b":"#f43f5e";

    body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px">
      <div style="background:#fff;border:1.5px solid var(--border);border-radius:18px;padding:20px 22px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:600;margin-bottom:10px">Всього спроб</div>
        <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:38px;line-height:1;letter-spacing:-1px;color:var(--primary)">${att.length}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">${completed.length} завершено · ${att.length-completed.length} на перевірці</div>
      </div>
      <div style="background:#fff;border:1.5px solid var(--border);border-radius:18px;padding:20px 22px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:600;margin-bottom:10px">Середня оцінка</div>
        <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:38px;line-height:1;letter-spacing:-1px;color:${avgGrade!=="—"?gradeColor(parseFloat(avgGrade)):"var(--muted)"}">${avgGrade}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">мін: ${minGrade} · макс: ${maxGrade}</div>
      </div>
      <div style="background:#fff;border:1.5px solid var(--border);border-radius:18px;padding:20px 22px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:600;margin-bottom:10px">Здали (≥4)</div>
        <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:38px;line-height:1;letter-spacing:-1px;color:#0d9e85">${passCount}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">${passRate}% від завершених</div>
      </div>
      <div style="background:#fff;border:1.5px solid var(--border);border-radius:18px;padding:20px 22px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:600;margin-bottom:10px">Не здали (&lt;4)</div>
        <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:38px;line-height:1;letter-spacing:-1px;color:#f43f5e">${failCount}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:6px">${grades.length?100-passRate:0}% від завершених</div>
      </div>
    </div>

    <!-- Розподіл оцінок -->
    <div style="background:#fff;border:1.5px solid var(--border);border-radius:18px;padding:24px;margin-bottom:20px">
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:15px;margin-bottom:20px">Розподіл оцінок</div>
      <div style="display:flex;align-items:flex-end;gap:6px;height:140px">
        ${dist.map(d=>{
          const h = d.count ? Math.max(8, Math.round(d.count/maxCount*120)) : 0;
          const col = gradeColor(d.grade);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px">
            <div style="font-size:11px;font-weight:700;color:${d.count?col:"var(--muted)"}">${d.count||""}</div>
            <div style="width:100%;background:${d.count?"rgba(45,91,227,.06)":"var(--border)"};border-radius:6px 6px 0 0;height:120px;display:flex;align-items:flex-end">
              <div style="width:100%;background:${col};border-radius:6px 6px 0 0;height:${h}px;transition:height .4s ease;opacity:${d.count?1:0}"></div>
            </div>
            <div style="font-size:11px;color:var(--muted);font-weight:600">${d.grade}</div>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:16px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border);flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)"><div style="width:10px;height:10px;border-radius:3px;background:#0d9e85"></div>Відмінно (10-12)</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)"><div style="width:10px;height:10px;border-radius:3px;background:#2d5be3"></div>Добре (7-9)</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)"><div style="width:10px;height:10px;border-radius:3px;background:#f59e0b"></div>Задовільно (4-6)</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)"><div style="width:10px;height:10px;border-radius:3px;background:#f43f5e"></div>Незадовільно (1-3)</div>
      </div>
    </div>

    <!-- Топ студентів -->
    ${completed.length ? `
    <div style="background:#fff;border:1.5px solid var(--border);border-radius:18px;overflow:hidden">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);font-family:'Syne',sans-serif;font-weight:700;font-size:15px">Результати студентів</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:rgba(45,91,227,.02)">
          <th style="padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">#</th>
          <th style="padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">Студент</th>
          <th style="padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">Оцінка</th>
          <th style="padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">%</th>
          <th style="padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">Група</th>
          <th style="padding:10px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;text-align:left;border-bottom:1.5px solid var(--border)">Дата</th>
        </tr></thead>
        <tbody>
          ${[...completed].sort((a,b)=>(b.grade12||0)-(a.grade12||0)).map((a,i)=>{
            const g=a.grade12||0;
            const l=links.find(x=>x.id===a.linkId);
            const dateStr=a.createdAt?new Date(a.createdAt).toLocaleDateString("uk-UA",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
            const bdgClass=g>=10?"bg-g":g>=7?"bg-b":g>=4?"bg-a":"bg-r";
            return `<tr style="border-bottom:1px solid rgba(229,232,240,.5)">
              <td style="padding:12px 16px;font-size:13px;color:var(--muted);font-weight:600">${i+1}</td>
              <td style="padding:12px 16px">
                <div style="font-weight:600;font-size:14px">${esc(a.surname)} ${esc(a.name)}</div>
              </td>
              <td style="padding:12px 16px"><span class="bdg ${bdgClass}">${g}/12</span></td>
              <td style="padding:12px 16px;font-size:14px;font-weight:600">${a.score?.percent??0}%</td>
              <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${esc(l?.group||"—")}</td>
              <td style="padding:12px 16px;font-size:12px;color:var(--muted)">${dateStr}</td>
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

  showStudents(linkId){
    showSec("students");
    // Фільтруємо студентів по групі посилання
    const l=links.find(x=>x.id===linkId);
    if(l?.group){
      const sel=document.getElementById("st-group");
      if(sel) sel.value=l.group;
      const lbl=document.getElementById("cd-st-group-label");
      if(lbl) lbl.textContent=l.group;
    }
    window.G.initStudents&&window.G.initStudents();
  },

  // ── Attempt deletion ──────────────────────────────────────────────────────
  confDelAttempt(id, name){
    window._delAttId = id;
    const el = document.getElementById("del-att-name");
    if(el) el.textContent = name;
    openM("m-del-attempt");
  },

  async doDelAttempt(){
    const id = window._delAttId;
    if(!id) return;
    window._delAttId = null;
    closeM("m-del-attempt");
    ldr(true);
    try{
      await dbDel(`attempts/${id}`);
      attempts = attempts.filter(a => a.id !== id);
      renderAll();
      toast("Спробу видалено");
    }catch(e){ toast("Помилка: "+e.message,"err"); }
    finally{ ldr(false); }
  },

  // ── Gradebook filter ──────────────────────────────────────────────────────
  selectGbFilter(field, value, label){
    const wrap = field==="test" ? "cd-gb-test" : "cd-gb-group";
    const selId = field==="test" ? "gb-test" : "gb-group";
    const lbl = document.getElementById(wrap+"-label");
    if(lbl) lbl.textContent = label;
    const menu = document.getElementById(wrap+"-menu");
    menu?.querySelectorAll(".cd-item").forEach(el=>{
      el.classList.toggle("cd-active", el.dataset.val===value);
    });
    menu?.classList.remove("open");
    const btn = document.querySelector(`#${wrap} .cd-btn`);
    btn?.classList.toggle("active", !!value);
    const sel = document.getElementById(selId);
    if(sel) sel.value = value;
    G.renderGradebook && G.renderGradebook();
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

window.openOnboarding = () => {
  _obStep = 0;
  const el = document.getElementById("m-onboarding");
  if (!el) {
    console.warn("[onboarding] m-onboarding не знайдено в DOM");
    return;
  }
  el.style.display = "flex";
  renderObStep();
};
const OB_STEPS = [
  {icon:"👋",title:"Ласкаво просимо до QuizFlow!",text:"QuizFlow — платформа для створення тестів та відстеження результатів студентів. За кілька хвилин ви дізнаєтесь як нею користуватись.",color:"#2d5be3"},
  {icon:"📁",title:"Папки та тести",text:"Спочатку створіть <b>папку</b> для організації тестів по темах або групах. Перейдіть у вкладку <b>Тести</b> → кнопка «Нова папка».",color:"#9333ea"},
  {icon:"✏️",title:"Конструктор тестів",text:"Натисніть на тест щоб відкрити <b>конструктор</b>. Є типи питань: одна відповідь, кілька, текстова, розгорнута, числова та впорядкування.",color:"#0d9e85"},
  {icon:"⚡",title:"AI Генерація питань",text:"В конструкторі натисніть <b>AI Генерація</b> — вкажіть тему, складність і кількість. ШІ згенерує питання з варіантами відповідей.",color:"#f59e0b"},
  {icon:"🔗",title:"Посилання для студентів",text:"Щоб відправити тест — створіть <b>посилання</b>. Вкажіть групу і ліміт спроб. Скопіюйте та відправте — студенти відкриють без реєстрації.",color:"#2d5be3"},
  {icon:"📊",title:"Результати та оцінки",text:"Всі спроби у вкладці <b>Спроби</b>. Натисніть «Переглянути» щоб побачити відповіді, оцінку від ШІ та персональний розбір помилок.",color:"#0d9e85"},
  {icon:"👥",title:"Картки студентів",text:"Вкладка <b>Студенти</b> накопичує картки з усіма спробами. Можна об'єднати картки якщо студент вводив різні написання імені.",color:"#9333ea"},
  {icon:"⚠️",title:"Моніторинг та безпека",text:"<b>Онлайн зараз</b> — хто проходить тест і на якому питанні. <b>Підозрілі</b> — спроби де були переключення вкладок або копіювання.",color:"#f43f5e"},
  {icon:"📓",title:"Журнал оцінок",text:"Вкладка <b>Журнал</b> — таблиця всіх оцінок по групах та тестах. Можна експортувати в CSV або HTML для звітності.",color:"#0ea5e9"},
  {icon:"🎉",title:"Все готово!",text:"Ви знаєте основи QuizFlow. Натисніть <b>Інструкція</b> в меню щоб переглянути цей гайд ще раз. Успіхів!",color:"#0d9e85"}
];
let _obStep = 0;

function renderObStep(){
  const step = OB_STEPS[_obStep];
  const total = OB_STEPS.length;
  const isLast = _obStep === total - 1;
  document.getElementById("ob-progress").style.width = (((_obStep+1)/total)*100)+"%";
  document.getElementById("ob-dots").innerHTML = OB_STEPS.map((_,i) =>
    '<div style="width:'+(i===_obStep?20:7)+'px;height:7px;border-radius:4px;background:'+(i===_obStep?'var(--primary)':'var(--border)')+';transition:all .3s"></div>'
  ).join("");
  document.getElementById("ob-content").innerHTML =
    '<div style="width:64px;height:64px;border-radius:18px;background:'+step.color+'18;display:flex;align-items:center;justify-content:center;font-size:30px;margin-bottom:22px">'+step.icon+'</div>'
    +'<div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);font-weight:600;margin-bottom:8px">Крок '+(_obStep+1)+' з '+total+'</div>'
    +'<div style="font-family:Syne,sans-serif;font-weight:800;font-size:22px;color:var(--text);margin-bottom:14px;line-height:1.25">'+step.title+'</div>'
    +'<div style="font-size:15px;color:var(--muted);line-height:1.7">'+step.text+'</div>';
  const prev = document.getElementById("ob-prev");
  const next = document.getElementById("ob-next");
  if(prev) prev.style.display = _obStep === 0 ? "none" : "";
  if(next){
    if(isLast){
      next.textContent = "Розпочати роботу ✓";
      next.style.background = "linear-gradient(135deg,#0d9e85,#077a67)";
      next.onclick = () => { document.getElementById("m-onboarding").style.display = "none"; };
    } else {
      next.textContent = "Далі →";
      next.style.background = "var(--grad)";
      next.onclick = () => window.obNav(1);
    }
  }
}

async function checkOnboarding(){
  try{
    const snap = await dbGet("meta/onboardingDone");
    if(!snap.exists() || snap.val() !== true) setTimeout(() => window.openOnboarding(), 1200);
  }catch{}
}

const _obEl = document.getElementById("m-onboarding");
if (_obEl) _obEl.addEventListener("click", function(e){
  if(e.target === this) this.style.display = "none";
});

// ─── NEWS ────────────────────────────────────────────────────────────────────
let _newsItems = [];
let _readNews = new Set();

async function loadTeacherNews(){
  try{
    const {get:_g,ref:_r}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const readRaw=await _g(_r(db,"teachers/"+_uid+"/meta/readNews")).catch(()=>null);
    if(readRaw&&readRaw.exists()){
      const rv=readRaw.val();
      _readNews=new Set(Array.isArray(rv)?rv:Object.values(rv));
    }
    const newsSnap=await _g(_r(db,"news"));
    if(!newsSnap.exists()){ _newsItems=[]; renderNews(); updateNewsBadge(); return; }
    _newsItems=Object.entries(newsSnap.val())
      .map(([id,v])=>({id,...v}))
      .sort((a,b)=>{ if(a.pinned&&!b.pinned)return -1; if(!a.pinned&&b.pinned)return 1; return (b.createdAt||0)-(a.createdAt||0); });
    renderNews();
    updateNewsBadge();
  }catch(e){ console.warn("loadTeacherNews:",e.message); }
}

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
    const dateStr=n.createdAt?new Date(n.createdAt).toLocaleDateString("uk-UA",{day:"numeric",month:"short"}):"";
    const preview=(n.text||"").slice(0,90)+((n.text||"").length>90?"...":"");
    return `<div onclick="openNews('${n.id}')" style="padding:10px 12px;border-radius:12px;border:1.5px solid ${isRead?"var(--border)":"rgba(45,91,227,.2)"};background:${isRead?"transparent":"rgba(45,91,227,.02)"};cursor:pointer;transition:all .15s"
      onmouseover="this.style.background='rgba(45,91,227,.04)'" onmouseout="this.style.background='${isRead?"transparent":"rgba(45,91,227,.02)"}'">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${!isRead?`<div style="width:7px;height:7px;border-radius:50%;background:var(--primary);flex-shrink:0"></div>`:""}
        <div style="font-weight:600;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title||"")}</div>
        <div style="font-size:11px;color:var(--muted);flex-shrink:0">${dateStr}</div>
      </div>
      <div style="font-size:12px;color:var(--muted);font-style:italic;${!isRead?"padding-left:15px":""}">Натисніть щоб прочитати →</div>
    </div>`;
  }).join("");
}

function renderNews(){
  const list=$("news-teacher-list");
  if(!list) return;
  if(!_newsItems.length){
    list.innerHTML=`<div class="empty" style="padding:80px 20px"><div class="ei">📰</div><div class="et">Новин ще немає</div></div>`;
    return;
  }
  list.innerHTML=_newsItems.map(n=>{
    const isRead=_readNews.has(n.id);
    const dateStr=n.createdAt?new Date(n.createdAt).toLocaleDateString("uk-UA",{day:"numeric",month:"long",year:"numeric"}):"";
    const preview=(n.text||"").slice(0,200)+((n.text||"").length>200?"...":"");
    return `<div onclick="openNews('${n.id}')" style="background:#fff;border:1.5px solid ${isRead?"var(--border)":"rgba(45,91,227,.25)"};${!isRead?"border-left:4px solid var(--primary);":""}border-radius:18px;padding:20px 22px;margin-bottom:14px;cursor:pointer;transition:all .2s"
      onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 8px 24px rgba(45,91,227,.1)'"
      onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
        <div style="flex:1;min-width:0">
          ${n.pinned?`<span style="background:rgba(245,158,11,.1);color:#b45309;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;display:inline-block;margin-bottom:6px">📌 Закріплено</span><br>`:""}
          <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px;display:flex;align-items:center;gap:8px">
            ${!isRead?`<span style="width:8px;height:8px;border-radius:50%;background:var(--primary);flex-shrink:0;display:inline-block"></span>`:""}
            ${esc(n.title||"")}
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted);flex-shrink:0">${dateStr}</div>
      </div>
      <div style="font-size:13px;color:var(--muted);font-style:italic">Натисніть щоб прочитати повністю →</div>
    </div>`;
  }).join("");
}

window.openNews = async (id) => {
  const n=_newsItems.find(x=>x.id===id);
  if(!n) return;
  $("news-view-title").textContent=n.title||"";
  // Якщо текст містить HTML теги — рендеримо як HTML
  const newsTextEl=$("news-view-text");
  if((n.text||"").includes("<")) newsTextEl.innerHTML=n.text||"";
  else newsTextEl.textContent=n.text||"";
  const dateStr=n.createdAt?new Date(n.createdAt).toLocaleDateString("uk-UA",{day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}):"";
  $("news-view-date").textContent=dateStr?"Опубліковано: "+dateStr:"";
  openM("m-news-view");
  if(!_readNews.has(id)){
    _readNews.add(id);
    updateNewsBadge();
    renderNews();
    try{
      const {ref:_r,set:_s}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      await _s(_r(db,"teachers/"+_uid+"/meta/readNews"),Array.from(_readNews));
    }catch(e){ console.warn(e); }
  }
};

// ─── ІНІЦІАЛІЗАЦІЯ ───────────────────────────────────────────────────────────



// ─── Sync declared functions to window (для inline handlers і старого коду) ────
window.renderTests = renderTests;
window.fillSelects = fillSelects;
window.renderAttempts = renderAttempts;
window.renderLinks = renderLinks;

// ─── Real-time listeners (адаптовано з index.html) ───────────────────────
function startRealtimeListeners(){
  if (_realtimeActive) return;
  _realtimeActive = true;

  onValue(ref(db, tp("attempts")), (snap) => {
    const newAttempts = toArr(snap).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

    if(attempts.length > 0){
      newAttempts.forEach(na => {
        const old = attempts.find(a=>a.id===na.id);
        if(!old && na.status==="completed") showNotification(na, "new");
        else if(old && old.status==="in_progress" && na.status==="completed") showNotification(na, "completed");
        else if(!old && na.status==="in_progress") showNotification(na, "started");
      });
    }

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
  });

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

  onValue(ref(db, tp("links")), (snap) => {
    links = toArr(snap).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    window.links = links;
    _bust();
    if (typeof renderLinks === "function") try { renderLinks(); } catch {}
    if (typeof renderDashLinks === "function") try { renderDashLinks(); } catch {}
    if (typeof updateBadges === "function") try { updateBadges(); } catch {}
    if (typeof fillSelects === "function") try { fillSelects(); } catch {}
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

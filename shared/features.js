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
let _students = [], _fid = null, _pid = null, _stGroupFilter = "";

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

// DASHBOARD
function renderDashAtt(){
  // Привітання і дата
  const now=new Date();
  const h=now.getHours();
  const greeting=h<6?"Добрий вечір":h<12?"Доброго ранку":h<18?"Добрий день":"Добрий вечір";
  const teacherFirstName=(_user.name||"").split(" ")[0]||_user.login||"";
  const el=$("dash-greeting"); if(el) el.textContent=greeting+(teacherFirstName?", "+teacherFirstName:"")+(" 👋");
  const dateEl=$("dash-date");
  if(dateEl) dateEl.textContent=now.toLocaleDateString("uk-UA",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

  // Додаткові метрики
  const completedCount=attempts.filter(a=>a.status==="completed").length;
  const lbl=$("dash-completed-lbl"); if(lbl) lbl.textContent=`Завершено: ${completedCount}`;
  const totalUsed=links.reduce((s,l)=>s+(l.usedAttempts||0),0);
  const usedLbl=$("dash-used-lbl"); if(usedLbl) usedLbl.textContent=totalUsed;

  // Колір середньої оцінки
  // Онлайн банер
  const online=attempts.filter(a=>a.status==="in_progress");
  const banner=document.getElementById("dash-online-banner");
  if(banner){
    if(online.length){
      banner.style.display="flex";
      const txt=document.getElementById("dash-online-text");
      if(txt) txt.textContent=`${online.length} студент${online.length===1?"":"ів"} проходить тест прямо зараз`;
    } else { banner.style.display="none"; }
  }

  // Блок підозрілих — показуємо тільки нові (не прочитані)
  const suspBlock=document.getElementById("dash-suspicious-block");
  if(suspBlock){
    dbGet("meta/suspReadCount").then(snap=>{
      const suspRead=snap.exists()?(snap.val()||0):0;
      const suspAll=attempts.filter(a=>(a.tabSwitches||0)*2+(a.copyAttempts||0)*3+(a.screenshots||0)*5>0&&(a.status==="completed"||a.status==="pending_review")).length;
      const suspNew=Math.max(0,suspAll-suspRead);
      if(suspNew>0){
        suspBlock.style.display="block";
        const txt=document.getElementById("dash-suspicious-text");
        if(txt) txt.textContent=`${suspNew} нов${suspNew===1?"а":"их"} підозріл${suspNew===1?"а":"их"} спроб${suspNew===1?"а":""}`;
      } else { suspBlock.style.display="none"; }
    }).catch(()=>{ suspBlock.style.display="none"; });
  }

  const tb=$("d-att"), r=attempts.slice(0,8);
  if(!tb) return;
  if(!r.length){tb.innerHTML=`<tr><td colspan="5"><div class="empty"><div class="ei">📭</div><div class="et">Ще немає спроб</div></div></td></tr>`;return;}
  tb.innerHTML=r.map(a=>{
    const t=tests.find(x=>x.id===a.testId);
    const gc=a.grade12!=null?(a.grade12>=10?"#0d9e85":a.grade12>=7?"#2d5be3":a.grade12>=4?"#f59e0b":"#f43f5e"):"var(--muted)";
    const gbg=a.grade12!=null?(a.grade12>=10?"rgba(13,158,133,.1)":a.grade12>=7?"rgba(45,91,227,.1)":a.grade12>=4?"rgba(245,158,11,.1)":"rgba(244,63,94,.1)"):"var(--bg)";
    const gradeCell=a.status==="pending_review"
      ?`<span class="bdg bg-a" style="font-size:11px">⏳</span>`
      :a.grade12!=null?`<div style="display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:26px;border-radius:8px;background:${gbg};color:${gc};font-weight:700;font-size:13px;padding:0 6px">${a.grade12}/12</div>`:"<span style='color:var(--muted)'>—</span>";
    const statusClass=a.status==="completed"?"bg-g":a.status==="pending_review"?"bg-a":"bg-o";
    const statusText=a.status==="completed"?"Завершено":a.status==="pending_review"?"Перевіряється":"В процесі";
    return`<tr style="border-top:1px solid rgba(229,232,240,.5)" onmouseover="this.style.background='rgba(45,91,227,.02)'" onmouseout="this.style.background=''">
      <td style="padding:11px 16px"><div style="font-weight:600;font-size:14px">${esc(a.surname)} ${esc(a.name)}</div></td>
      <td style="padding:11px 16px;max-width:160px"><div style="font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t?.title||"—")}</div></td>
      <td style="padding:11px 16px">${gradeCell}</td>
      <td style="padding:11px 16px"><span class="bdg ${statusClass}" style="font-size:11px">${statusText}</span></td>
      <td style="padding:11px 16px;font-size:12px;color:var(--muted);white-space:nowrap">${timeAgo(a.createdAt)}</td>
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


function buildTestRow(t){
  const cnt=attempts.filter(a=>a.testId===t.id).length;
  const statusMap={
    active: {dot:"sa", label:"Активний", badge:"bg-g"},
    draft:  {dot:"sdr",label:"Чернетка", badge:""},
    closed: {dot:"sdc",label:"Закрито",  badge:"bg-r"}
  };
  const s=statusMap[t.status]||statusMap.draft;
  const qCnt=(t.questions||[]).length;

  return`<tr style="transition:background .15s">
    <td style="padding:14px 16px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(45,91,227,.07);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px">📄</div>
        <div style="min-width:0">
          <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px">${esc(t.title)}</div>
          ${t.description?`<div style="font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${esc(t.description.substring(0,60))}${t.description.length>60?"…":""}</div>`:""}
          ${(t.tags||[]).length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${t.tags.map(g=>`<span class="tag tb" style="font-size:11px;padding:2px 8px">${esc(g)}</span>`).join("")}</div>`:""}
        </div>
      </div>
    </td>
    <td style="padding:14px 16px;white-space:nowrap">
      <div style="position:relative;display:inline-block">
        <button onclick="G.toggleTestStatus('${t.id}','${t.status}')"
          style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:20px;border:1.5px solid ${t.status==="active"?"rgba(13,158,133,.2)":t.status==="closed"?"rgba(244,63,94,.15)":"rgba(107,114,128,.15)"};background:${t.status==="active"?"rgba(13,158,133,.07)":t.status==="closed"?"rgba(244,63,94,.05)":"rgba(107,114,128,.05)"};cursor:pointer;transition:all .15s"
          title="Змінити статус"
          onmouseover="this.style.opacity='.75'"
          onmouseout="this.style.opacity='1'">
          <span class="sd ${s.dot}" style="flex-shrink:0"></span>
          <span style="font-size:13px;font-weight:500;color:${t.status==="active"?"#0d9e85":t.status==="closed"?"#be123c":"var(--muted)"}">${s.label}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:${t.status==="active"?"#0d9e85":t.status==="closed"?"#be123c":"var(--muted)"}"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    </td>
    <td style="padding:14px 16px;white-space:nowrap">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:14px;font-weight:600;color:var(--text)">${qCnt}</span>
        <span style="font-size:12px;color:var(--muted)">${qCnt===1?"питання":qCnt<5?"питань":"питань"}</span>
      </div>
    </td>
    <td style="padding:14px 16px;white-space:nowrap">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:14px;font-weight:600;color:${cnt>0?"var(--primary)":"var(--muted)"}">${cnt}</span>
        <span style="font-size:12px;color:var(--muted)">${cnt===1?"спроба":cnt<5?"спроби":"спроб"}</span>
      </div>
    </td>
    <td style="padding:14px 16px">
      <div class="ra">
        <div class="ib" title="Редагувати" onclick="location.href='constructor.html?id=${t.id}'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </div>
        <div class="ib" title="Нове посилання" onclick="G.qLink('${t.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        </div>
        <div class="ib" title="Статистика" onclick="G.showStats('${t.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </div>
        <div class="ib" title="Спроби" onclick="showSec('attempts');$('ft').value='${t.id}';G.rAttempts()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div class="ib" title="Поділитись" onclick="G.openShareModal('${t.id}','${esc(t.title)}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </div>
        <div class="ib d" title="Видалити" onclick="G.confDelTest('${t.id}','${esc(t.title)}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </div>
      </div>
    </td>
  </tr>`;
}

renderTests = function(q=""){
  const c=$("tc");
  if(!tests.length&&!folders.length){
    c.innerHTML=`<div class="empty"><div class="ei">📋</div><div class="et">Ще немає тестів</div><p style="margin-top:6px">Створіть папку або одразу новий тест</p></div>`;
    return;
  }

  let lst=tests.filter(t=>t.status!=="archived");
  if(q) lst=lst.filter(t=>t.title.toLowerCase().includes(q.toLowerCase())||(t.tags||[]).some(g=>g.toLowerCase().includes(q.toLowerCase())));

  const hasNoFolder=lst.some(t=>!t.folderId||!folders.find(f=>f.id===t.folderId));
  const noFolderTests=lst.filter(t=>!t.folderId||!folders.find(f=>f.id===t.folderId));

  // Якщо обрана конкретна папка — показуємо тести всередині неї
  if(_fFilter && _fFilter!=="all" && _fFilter!=="none"){
    const folder = folders.find(f=>f.id===_fFilter);
    const fTests = lst.filter(t=>t.folderId===_fFilter);
    c.innerHTML=`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <button onclick="G.setFF('all')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:10px;border:1.5px solid var(--border);background:white;font-size:13px;font-weight:500;cursor:pointer;color:var(--muted);transition:all .15s"
          onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Назад
        </button>
        <div style="width:36px;height:36px;border-radius:10px;background:var(--grad);display:flex;align-items:center;justify-content:center">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
        <div>
          <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:17px">${esc(folder?.name||"Папка")}</div>
          <div style="font-size:12px;color:var(--muted)">${fTests.length} тест${fTests.length===1?"":fTests.length<5?"и":"ів"}</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button onclick="G.openTestInFolder('${_fFilter}')" class="btn bp btn-sm" style="font-size:13px">+ Додати тест</button>
          <button onclick="G.confDelFolder('${_fFilter}','${esc(folder?.name||"")}')" class="btn bd btn-sm" style="font-size:13px">Видалити папку</button>
        </div>
      </div>
      ${fTests.length
        ? `<div class="card" style="padding:0;overflow:hidden">
            <table class="tbl">
              <thead><tr><th style="padding:13px 16px">Назва</th><th>Статус</th><th>Питань</th><th>Спроб</th><th></th></tr></thead>
              <tbody>${fTests.map(t=>buildTestRow(t)).join("")}</tbody>
            </table>
          </div>`
        : `<div class="empty" style="padding:60px 20px">
            <div class="ei">📂</div>
            <div class="et">Папка порожня</div>
            <p style="margin-top:8px;font-size:14px;color:var(--muted)">
              <span style="color:var(--primary);cursor:pointer" onclick="G.openTestInFolder('${_fFilter}')">Додати перший тест →</span>
            </p>
          </div>`
      }`;
    return;
  }

  if(_fFilter==="none"){
    c.innerHTML=`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <button onclick="G.setFF('all')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:10px;border:1.5px solid var(--border);background:white;font-size:13px;font-weight:500;cursor:pointer;color:var(--muted);transition:all .15s"
          onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Назад
        </button>
        <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:17px">Без папки</div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table class="tbl">
          <thead><tr><th style="padding:13px 16px">Назва</th><th>Статус</th><th>Питань</th><th>Спроб</th><th></th></tr></thead>
          <tbody>${noFolderTests.map(t=>buildTestRow(t)).join("")}</tbody>
        </table>
      </div>`;
    return;
  }

  // ─── Головний вид: сітка папок ───────────────────────────────────────────
  const folderGrid = folders.map(f=>{
    const fTests = lst.filter(t=>t.folderId===f.id);
    const cnt = fTests.length;
    const fallbacks = ["#2d5be3","#0d9e85","#9333ea","#f59e0b","#f43f5e","#0ea5e9"];
    const col = f.color || fallbacks[folders.indexOf(f)%fallbacks.length];
    return `<div style="background:white;border:1.5px solid var(--border);border-radius:18px;overflow:hidden;cursor:pointer;transition:all .2s;position:relative"
      onclick="G.setFF('${f.id}')"
      onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,.1)';this.style.borderColor='${col}44'"
      onmouseout="this.style.transform='';this.style.boxShadow='';this.style.borderColor='var(--border)'">
      <!-- Кольоровий верх -->
      <div style="height:80px;background:linear-gradient(135deg,${col}22,${col}0a);display:flex;align-items:center;justify-content:center;position:relative">
        <div style="width:48px;height:48px;border-radius:14px;background:${col};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px ${col}44">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
        <!-- Кнопки дій -->
        <div style="position:absolute;top:8px;right:8px;display:flex;gap:4px;opacity:0;transition:opacity .2s" class="folder-actions">
          <button onclick="event.stopPropagation();G.openTestInFolder('${f.id}')" title="Додати тест"
            style="width:26px;height:26px;border-radius:8px;border:none;background:rgba(255,255,255,.9);color:${col};cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:600;backdrop-filter:blur(4px)">+</button>
          <button onclick="event.stopPropagation();G.confDelFolder('${f.id}','${esc(f.name)}')" title="Видалити"
            style="width:26px;height:26px;border-radius:8px;border:none;background:rgba(255,255,255,.9);color:#be123c;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>
      </div>
      <!-- Інфо -->
      <div style="padding:14px 16px">
        <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px">${esc(f.name)}</div>
        <div style="font-size:12px;color:var(--muted)">${cnt===0?"Порожня":cnt===1?"1 тест":cnt<5?`${cnt} тести`:`${cnt} тестів`}</div>
      </div>
    </div>`;
  }).join("");

  const noFolderCard = hasNoFolder?`<div style="background:white;border:1.5px solid var(--border);border-radius:18px;overflow:hidden;cursor:pointer;transition:all .2s"
    onclick="G.setFF('none')"
    onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 12px 36px rgba(0,0,0,.1)'"
    onmouseout="this.style.transform='';this.style.boxShadow=''">
    <div style="height:80px;background:rgba(107,114,128,.05);display:flex;align-items:center;justify-content:center">
      <div style="width:48px;height:48px;border-radius:14px;background:rgba(107,114,128,.12);display:flex;align-items:center;justify-content:center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
    </div>
    <div style="padding:14px 16px">
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:14px;margin-bottom:3px">Без папки</div>
      <div style="font-size:12px;color:var(--muted)">${noFolderTests.length} тест${noFolderTests.length===1?"":noFolderTests.length<5?"и":"ів"}</div>
    </div>
  </div>`:"";

  if(!lst.length && !folders.length){
    c.innerHTML=`<div class="empty"><div class="ei">🔍</div><div class="et">Нічого не знайдено</div></div>`;
    return;
  }

  c.innerHTML=`
    <style>
      .folder-card:hover .folder-actions { opacity:1 !important; }
    </style>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">
      ${folderGrid}
      ${noFolderCard}
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


// ─── ATTEMPTS SORT + SELECT ──────────────────────────────────────────────────
let _attSort = { field: "date", dir: "desc" };
window._attPage = 1;
const ATT_PER_PAGE = 20;

renderAttempts = function(resetPage=false){
  if(resetPage) window._attPage=1;
  const tF=$("ft")?.value||"",sF=$("fst")?.value||"",gF=$("fg")?.value||"",grpF=$("fgrp")?.value||"";
  const q=($("att-srch")?.value||"").toLowerCase().trim();
  // Показуємо/ховаємо кнопку очистки
  const clr=$("att-srch-clear");
  if(clr) clr.style.display=q?"inline":"none";
  let lst=attempts;
  if(tF) lst=lst.filter(a=>a.testId===tF);
  if(sF) lst=lst.filter(a=>a.status===sF);
  if(gF==="high") lst=lst.filter(a=>(a.grade12||0)>=10);
  if(gF==="mid")  lst=lst.filter(a=>(a.grade12||0)>=6&&(a.grade12||0)<10);
  if(gF==="low")  lst=lst.filter(a=>(a.grade12||0)>0&&(a.grade12||0)<6);
  if(grpF) lst=lst.filter(a=>{ const l=links.find(x=>x.id===a.linkId); return (l?.group||"")===grpF; });
  if(q){
    lst=lst.filter(a=>{
      const fullName=`${a.name} ${a.surname}`.toLowerCase();
      const testTitle=(tests.find(t=>t.id===a.testId)?.title||"").toLowerCase();
      const group=(links.find(l=>l.id===a.linkId)?.group||"").toLowerCase();
      return fullName.includes(q)||testTitle.includes(q)||group.includes(q)||
             a.name.toLowerCase().includes(q)||a.surname.toLowerCase().includes(q);
    });
  }
  const tb=$("att-tbl");
  if(!tb) return;
  const countLabel=document.getElementById("att-count-label");
  if(countLabel) countLabel.textContent=`${lst.length} спроб${lst.length===1?"а":lst.length<5?"и":""}`;
  if(!lst.length){
    if(countLabel) countLabel.textContent="Всі проходження тестів студентами";
    tb.innerHTML=`<tr><td colspan="9"><div class="empty"><div class="ei">📭</div><div class="et">Немає спроб</div></div></td></tr>`;
    return;
  }
  // Застосовуємо сортування
  const sf=_attSort.field, sd=_attSort.dir;
  if(sf) lst=[...lst].sort((a,b)=>{
    let av,bv;
    if(sf==="name")  { av=`${a.surname}${a.name}`.toLowerCase(); bv=`${b.surname}${b.name}`.toLowerCase(); }
    if(sf==="grade") { av=a.grade12||0; bv=b.grade12||0; }
    if(sf==="time")  { av=(a.finishedAt&&a.startedAt)?(a.finishedAt-a.startedAt):0; bv=(b.finishedAt&&b.startedAt)?(b.finishedAt-b.startedAt):0; }
    if(sf==="date")  { av=a.createdAt||0; bv=b.createdAt||0; }
    return sd==="asc"?(av>bv?1:av<bv?-1:0):(av<bv?1:av>bv?-1:0);
  });

  // Пагінація
  const totalPages = Math.max(1, Math.ceil(lst.length / ATT_PER_PAGE));
  if(window._attPage > totalPages) window._attPage = totalPages;
  const pageStart = (window._attPage - 1) * ATT_PER_PAGE;
  const pageLst = lst.slice(pageStart, pageStart + ATT_PER_PAGE);

  // Рендер пагінації
  let paginationHtml = "";
  if(totalPages > 1){
    const pages = [];
    for(let p = 1; p <= totalPages; p++){
      if(p === 1 || p === totalPages || Math.abs(p - window._attPage) <= 1){
        pages.push(p);
      } else if(pages[pages.length-1] !== "..."){
        pages.push("...");
      }
    }
    paginationHtml = `<div style="display:flex;align-items:center;gap:6px;padding:12px 16px;justify-content:center;border-top:1px solid var(--border)">
      <button class="btn bs btn-sm" onclick="_attPage=Math.max(1,_attPage-1);renderAttempts()" style="font-size:12px;padding:5px 10px" ${_attPage===1?"disabled":""}>‹</button>
      ${pages.map(p => p === "..." 
        ? `<span style="color:var(--muted);font-size:13px;padding:0 4px">...</span>`
        : `<button onclick="_attPage=${p};renderAttempts()" style="min-width:30px;height:30px;border-radius:8px;border:1.5px solid ${p===window._attPage?"var(--primary)":"var(--border)"};background:${p===window._attPage?"var(--primary)":"white"};color:${p===window._attPage?"white":"var(--text)"};font-size:13px;font-weight:${p===window._attPage?"600":"400"};cursor:pointer">${p}</button>`
      ).join("")}
      <button class="btn bs btn-sm" onclick="_attPage=Math.min(${totalPages},_attPage+1);renderAttempts()" style="font-size:12px;padding:5px 10px" ${_attPage===totalPages?"disabled":""}>›</button>
      <span style="font-size:12px;color:var(--muted);margin-left:4px">${pageStart+1}–${Math.min(pageStart+ATT_PER_PAGE,lst.length)} з ${lst.length}</span>
    </div>`;
  }

  tb.innerHTML=pageLst.map(a=>{
    const t=tests.find(x=>x.id===a.testId),l=links.find(x=>x.id===a.linkId);
    const c=a.score?.correct??"—",tot=a.score?.total??"—";
    let el2="—";
    if(a.finishedAt&&a.startedAt&&a.finishedAt>a.startedAt) el2=fmtTime((a.finishedAt-a.startedAt)/1000);
    const group=l?.group||"";
    const dateStr=a.createdAt?new Date(a.createdAt).toLocaleDateString("uk-UA",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
    const gradeColor=a.grade12>=10?"#0d9e85":a.grade12>=7?"#2d5be3":a.grade12>=4?"#f59e0b":a.grade12!=null?"#f43f5e":"var(--muted)";
    const gradeBg=a.grade12>=10?"rgba(13,158,133,.1)":a.grade12>=7?"rgba(45,91,227,.1)":a.grade12>=4?"rgba(245,158,11,.1)":a.grade12!=null?"rgba(244,63,94,.1)":"var(--bg)";
    return`<tr style="border-top:1px solid rgba(229,232,240,.5);transition:background .1s"
      onmouseover="this.style.background='rgba(45,91,227,.02)'" onmouseout="this.style.background=''">
      <td style="padding:12px 16px">
        <div style="font-weight:600;font-size:14px">${esc(a.surname)} ${esc(a.name)}</div>
      </td>
      <td style="padding:12px 16px;max-width:180px">
        <div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t?.title||'')}">${esc(t?.title||"—")}</div>
      </td>
      <td style="padding:12px 16px">${group?`<span class="bdg bg-b" style="font-size:11px">${esc(group)}</span>`:'<span style="color:var(--light);font-size:12px">—</span>'}</td>
      <td style="padding:12px 16px">
        ${a.grade12!=null?`<div style="display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:28px;border-radius:9px;background:${gradeBg};color:${gradeColor};font-weight:700;font-size:14px;padding:0 8px">${a.grade12}/12</div>`:'<span style="color:var(--muted)">—</span>'}
      </td>
      <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${c}/${tot}</td>
      <td style="padding:12px 16px;font-size:13px;color:var(--muted)">${el2}</td>
      <td style="padding:12px 16px"><span class="bdg ${a.status==="completed"?"bg-g":a.status==="pending_review"?"bg-a":"bg-o"}" style="font-size:11px">${a.status==="completed"?"Завершено":a.status==="pending_review"?"⏳ Перевіряється":"В процесі"}</span></td>
      <td style="padding:12px 16px;font-size:12px;color:var(--muted);white-space:nowrap">${dateStr}</td>
      <td style="padding:12px 16px"><div class="ra">
        <div class="ib" title="Переглянути" onclick="G.viewAtt('${a.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
        <div class="ib d" title="Видалити" onclick="G.confDelAttempt('${a.id}','${esc(a.name)} ${esc(a.surname)}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></div>
      </div></td>
    </tr>`;
  }).join("");

  // Додаємо пагінацію після таблиці
  const paginationEl = document.getElementById("att-pagination");
  if(paginationEl) paginationEl.innerHTML = paginationHtml;

}


// LINKS
renderLinks = function(){
  const tb=$("lnk-tbl");
  if(!tb) return;
  const base=location.origin+location.pathname.replace(/[^/]*$/, "");
  // Автоматично закриваємо прострочені посилання
  const now=Date.now();
  links.filter(l=>l.closeAt && now>l.closeAt && l.status==="active").forEach(async l=>{
    try{ await dbUpd(`links/${l.id}`,{status:"closed"}); l.status="closed"; }catch{}
  });

  // Фільтр пошуку
  const q = $("lnk-srch")?.value?.toLowerCase() || "";
  let lst = links;
  if(q) lst = lst.filter(l=>{
    const t = tests.find(x=>x.id===l.testId);
    return (l.group||"").toLowerCase().includes(q) || (t?.title||"").toLowerCase().includes(q);
  });

  if(!lst.length){
    tb.innerHTML=`<tr><td colspan="6"><div class="empty"><div class="ei">🔗</div><div class="et">${links.length?"Нічого не знайдено":"Немає посилань"}</div></div></td></tr>`;
    return;
  }
  tb.innerHTML=lst.map(l=>{
    const t=tests.find(x=>x.id===l.testId),url=`${base}test.html?link=${l.id}&t=${_uid}`,pct=l.maxAttempts?Math.round(l.usedAttempts/l.maxAttempts*100):0,ia=l.status==="active";
    return`<tr>
      <td>
        <div style="font-weight:500">${esc(t?.title||"—")}</div>
        ${l.group?`<div style="font-size:12px;color:var(--primary);margin-top:2px;font-weight:500">👥 ${esc(l.group)}</div>`:""}
      </td>
      <td><div style="display:flex;align-items:center;gap:7px">
        <code style="font-size:11px;color:var(--primary);background:rgba(45,91,227,.06);padding:3px 8px;border-radius:6px">${url.replace(location.origin,"")}</code>
        <div class="ib" style="width:28px;height:28px" title="Копіювати" onclick="G.copyUrl('${url}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></div>
      </div></td>
      <td>
        <div style="font-size:13px;margin-bottom:3px">${l.usedAttempts} / ${l.maxAttempts}</div>
        <div class="pb" style="width:90px"><div class="pf" style="width:${pct}%"></div></div>
      </td>
      <td>
        ${(()=>{
          const now=Date.now();
          const expired = l.closeAt && now > l.closeAt;
          const statusLabel = expired ? "⏰ Закрите (авто)" : ia ? "Активне" : "Закрите";
          const statusClass = (expired || !ia) ? "bg-r" : "bg-g";
          const closeStr = l.closeAt ? new Date(l.closeAt).toLocaleDateString("uk-UA",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "";
          const _sl = "<span class=\"bdg "+statusClass+"\">"+statusLabel+"</span>"+(closeStr?"<div style=\"font-size:11px;color:var(--muted);margin-top:3px\">⏱ до "+closeStr+"</div>":"");
          return _sl;
        })()}
      </td>
      <td><div class="ra">
        <div class="ib" title="QR-код" onclick="G.showQR('${l.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M17 14v3M14 17h3"/></svg></div>
        <div class="ib" title="Студенти" onclick="G.showStudents('${l.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <div class="ib" title="Редагувати" onclick="G.editLink('${l.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
        <div class="ib" title="${ia?"Закрити":"Відкрити"}" onclick="G.togLink('${l.id}','${l.status}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ia?'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>':'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0114 0"/>'}</svg></div>
        <div class="ib d" title="Видалити" onclick="G.delLink('${l.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></div>
      </div></td>
    </tr>`;
  }).join("");
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
    if(_attSort.field===field){
      _attSort.dir=_attSort.dir==="asc"?"desc":"asc";
    } else {
      _attSort.field=field;
      _attSort.dir=field==="date"?"desc":"asc";
    }
    // Оновлюємо стрілки
    ["name","grade","time","date"].forEach(f=>{
      const el=$(`sort-${f}`);
      if(!el) return;
      el.className="sort-arrow";
      if(f===_attSort.field) el.classList.add(_attSort.dir);
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
    _stGroupFilter = value;
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
    const grp=_stGroupFilter||"";

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
    const a=attempts.find(x=>x.id===id);
    if(!a){ toast("Спробу не знайдено","err"); return; }
    const t=tests.find(x=>x.id===a.testId);
    const l=links.find(x=>x.id===a.linkId);
    const qs=Array.isArray(a.questionsSnapshot)?a.questionsSnapshot:(t?.questions||[]);
    const ans=Array.isArray(a.answers)?a.answers:[];
    const dateStr=a.createdAt?new Date(a.createdAt).toLocaleString("uk-UA",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
    const gc=a.grade12>=10?"bg-g":a.grade12>=7?"bg-b":a.grade12>=4?"bg-a":"bg-r";

    const qHtml=qs.map((q,i)=>{
      // Підтримка обох форматів: {questionId, value} і просто value
      const rawAns=ans[i];
      const userAns=(rawAns!==null&&rawAns!==undefined&&typeof rawAns==="object"&&!Array.isArray(rawAns)&&"value" in rawAns)
        ? rawAns.value : rawAns;
      let ansHtml="";
      if(q.type==="single"||q.type==="multi"){
        ansHtml=(q.options||[]).map((o,j)=>{
          const correct=Array.isArray(q.correct)?q.correct.includes(j):q.correct===j;
          const chosen=Array.isArray(userAns)?userAns.includes(j):userAns===j;
          const bg=chosen&&correct?"rgba(13,158,133,.08)":chosen&&!correct?"rgba(244,63,94,.07)":correct?"rgba(13,158,133,.04)":"";
          const border=chosen&&correct?"1.5px solid rgba(13,158,133,.3)":chosen&&!correct?"1.5px solid rgba(244,63,94,.25)":correct?"1.5px solid rgba(13,158,133,.2)":"1.5px solid var(--border)";
          const icon=chosen&&correct?"✅":chosen&&!correct?"❌":correct?"☑️":"";
          return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:${bg};border:${border};margin-bottom:6px">
            <span style="font-size:13px;flex:1">${esc(o)}</span>
            ${icon?`<span style="font-size:13px">${icon}</span>`:""}
          </div>`;
        }).join("");
      } else if(q.type==="text"||q.type==="number"){
        const raw=userAns;
        const ua=(raw!=null&&raw!==""&&typeof raw!=="object")?String(raw):null;
        ansHtml=`<div style="padding:10px 14px;background:${ua?"rgba(45,91,227,.04)":"rgba(107,114,128,.05)"};border:1.5px solid ${ua?"rgba(45,91,227,.15)":"var(--border)"};border-radius:10px;font-size:14px;color:${ua?"var(--text)":"var(--muted)"}${ua?"":";font-style:italic"}">${ua?esc(ua):"Немає відповіді"}</div>`;
      } else if(q.type==="long"){
        const raw=userAns;
        const ua=(raw!=null&&raw!==""&&typeof raw!=="object")?String(raw).trim():null;
        const det=a.score?.details?.[i];
        const lr=det?.longResult||"";
        const locked=a.grade12!=null; // заблоковано якщо є загальна оцінка
        const badge=lr==="correct"
          ?`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#0d9e85;background:rgba(13,158,133,.08);padding:2px 8px;border-radius:20px;margin-bottom:6px">✓ Правильно · 1б</span>`
          :lr==="partial"
          ?`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#b45309;background:rgba(245,158,11,.08);padding:2px 8px;border-radius:20px;margin-bottom:6px">~ Частково · 0.5б</span>`
          :lr==="wrong"
          ?`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#be123c;background:rgba(244,63,94,.07);padding:2px 8px;border-radius:20px;margin-bottom:6px">✗ Неправильно · 0б</span>`
          :`<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#b45309;background:rgba(245,158,11,.06);padding:2px 8px;border-radius:20px;margin-bottom:6px">⏳ Очікує оцінки</span>`;
        const cC=lr==="correct"?"#0d9e85":"rgba(13,158,133,.3)";
        const bgC=lr==="correct"?"rgba(13,158,133,.15)":"rgba(13,158,133,.06)";
        const cP=lr==="partial"?"#b45309":"rgba(245,158,11,.3)";
        const bgP=lr==="partial"?"rgba(245,158,11,.15)":"rgba(245,158,11,.06)";
        const cW=lr==="wrong"?"#be123c":"rgba(244,63,94,.2)";
        const bgW=lr==="wrong"?"rgba(244,63,94,.14)":"rgba(244,63,94,.05)";
        const gradeAttr=`data-aid="${a.id}" data-qi="${i}"`;
        const btns=locked
          ?""
          :`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            <button ${gradeAttr} data-res="correct" onclick="G.setLongAnswer(this.dataset.aid,+this.dataset.qi,this.dataset.res)" style="padding:5px 11px;border-radius:8px;border:1.5px solid ${cC};background:${bgC};color:#0d9e85;font-size:12px;font-weight:600;cursor:pointer">✓ Правильно</button>
            <button ${gradeAttr} data-res="partial" onclick="G.setLongAnswer(this.dataset.aid,+this.dataset.qi,this.dataset.res)" style="padding:5px 11px;border-radius:8px;border:1.5px solid ${cP};background:${bgP};color:#b45309;font-size:12px;font-weight:600;cursor:pointer">~ Частково</button>
            <button ${gradeAttr} data-res="wrong" onclick="G.setLongAnswer(this.dataset.aid,+this.dataset.qi,this.dataset.res)" style="padding:5px 11px;border-radius:8px;border:1.5px solid ${cW};background:${bgW};color:#be123c;font-size:12px;font-weight:600;cursor:pointer">✗ Неправильно</button>
          </div>`;
        ansHtml=`${badge}<div style="padding:12px 14px;background:${ua?"rgba(45,91,227,.04)":"rgba(107,114,128,.05)"};border:1.5px solid ${ua?"rgba(45,91,227,.15)":"var(--border)"};border-radius:10px;font-size:14px;color:${ua?"var(--text)":"var(--muted)"};white-space:pre-wrap;line-height:1.6${ua?"":";font-style:italic"}">${ua?esc(ua):"Немає відповіді"}</div>${btns}`;
      } else if(q.type==="order"){
        const ua=Array.isArray(userAns)?userAns:[];
        ansHtml=ua.map((item,j)=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;border:1.5px solid var(--border);margin-bottom:5px">
          <span style="width:22px;height:22px;border-radius:6px;background:rgba(45,91,227,.1);color:var(--primary);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">${j+1}</span>
          <span style="font-size:13px">${esc(String(item))}</span>
        </div>`).join("");
      }
      const correct=a.score?.details?.[i];
      const pts=correct?.points!=null?correct.points:null;
      const ptsColor=pts>0?"#0d9e85":pts===0?"#f43f5e":"var(--muted)";
      return `<div style="background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:18px 20px;margin-bottom:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
          <div style="display:flex;align-items:flex-start;gap:10px;flex:1">
            <div style="width:26px;height:26px;border-radius:8px;background:rgba(45,91,227,.08);color:var(--primary);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
            <div style="font-size:14px;font-weight:600;line-height:1.5;flex:1" class="qf-rich">${q.text||q.question||""}</div>
          </div>
          ${pts!=null?`<div style="font-size:13px;font-weight:700;color:${ptsColor};flex-shrink:0">${pts>0?"+"+pts:pts} б</div>`:""}
        </div>
        ${ansHtml}
      </div>`;
    }).join("");

    document.getElementById("att-det").innerHTML=`
      <!-- Шапка -->
      <div style="background:linear-gradient(135deg,#1e2d6b,#0d1340);padding:24px 28px;color:#fff;position:relative;overflow:hidden">
        <div style="position:absolute;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,.04);top:-60px;right:-40px"></div>
        <div style="font-size:10px;opacity:.5;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">Деталі спроби</div>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:20px;margin-bottom:4px">${esc(a.surname||"")} ${esc(a.name||"")}</div>
        <div style="font-size:14px;opacity:.65;margin-bottom:16px">${esc(t?.title||"—")} · ${esc(l?.group||"—")} · ${dateStr}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div style="background:rgba(255,255,255,.1);border-radius:12px;padding:10px 16px;text-align:center">
            <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:28px;line-height:1">${a.status==="pending_review"?"⏳":a.grade12!=null?a.grade12:"—"}</div>
            <div style="font-size:10px;opacity:.6;margin-top:2px">${a.status==="pending_review"?"ПЕРЕВІРЯЄТЬСЯ":"/ 12 ОЦІНКА"}</div>
          </div>
          <div style="background:rgba(255,255,255,.07);border-radius:12px;padding:10px 16px;text-align:center">
            <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:28px;line-height:1">${a.score?.percent||0}%</div>
            <div style="font-size:10px;opacity:.6;margin-top:2px">ВІДСОТОК</div>
          </div>
          <div style="background:rgba(255,255,255,.07);border-radius:12px;padding:10px 16px;text-align:center">
            <div style="font-family:'DM Sans',sans-serif;font-weight:900;font-size:28px;line-height:1">${a.score?.correct||0}/${qs.length}</div>
            <div style="font-size:10px;opacity:.6;margin-top:2px">ПРАВИЛЬНО</div>
          </div>
        </div>
      </div>

      <!-- Ручне виставлення оцінки — одразу після шапки -->
      ${(()=>{
        const longIdxs=qs.map((q,qi)=>qi).filter(qi=>qs[qi].type==="long");
        const allLongGraded=longIdxs.length===0||longIdxs.every(qi=>a.score?.details?.[qi]?.longResult);
        const hasGrade=a.grade12!=null;
        const canAnalyse=allLongGraded&&hasGrade;
        let out="";

        // Загальна оцінка — показується тільки для pending_review і якщо всі відкриті оцінені
        if(a.status==="pending_review"){
          if(allLongGraded){
            out+='<div style="margin:16px 20px 0;padding:14px 18px;background:rgba(45,91,227,.04);border:1.5px solid rgba(45,91,227,.18);border-radius:14px">';
            out+='<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--primary);font-weight:700;margin-bottom:8px">Загальна оцінка</div>';
            out+='<div style="display:flex;gap:5px;flex-wrap:wrap">';
            for(let g=1;g<=12;g++){
              const col=g>=10?"#0d9e85":g>=7?"#2d5be3":g>=4?"#f59e0b":"#f43f5e";
              const bg=g>=10?"rgba(13,158,133,.08)":g>=7?"rgba(45,91,227,.08)":g>=4?"rgba(245,158,11,.08)":"rgba(244,63,94,.08)";
              const sel=a.grade12===g?'outline:2px solid '+col+';outline-offset:2px;':'';
              out+='<button data-aid="'+a.id+'" data-g="'+g+'" onclick="G.setManualGrade(this.dataset.aid,+this.dataset.g)" style="width:36px;height:36px;border-radius:9px;border:1.5px solid '+col+'44;background:'+bg+';color:'+col+';font-weight:800;font-size:14px;cursor:pointer;'+sel+'">'+g+'</button>';
            }
            out+="</div></div>";
          } else {
            out+='<div style="margin:16px 20px 0;padding:12px 16px;background:rgba(245,158,11,.05);border:1.5px solid rgba(245,158,11,.2);border-radius:14px;font-size:13px;color:#b45309">';
            out+='⏳ Оцініть всі відкриті відповіді нижче, щоб виставити загальну оцінку</div>';
          }
        }

        // AI секція
        const aiColor=canAnalyse?'var(--primary)':'var(--muted)';
        const hasBorder=a.aiComment||a.personalAnalysis?';border-bottom:1px solid rgba(45,91,227,.08)':'';
        out+='<div style="margin:16px 20px 0;background:rgba(45,91,227,.02);border:1.5px solid rgba(45,91,227,.1);border-radius:14px;overflow:hidden">';
        out+='<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 15px'+hasBorder+'">';
        out+='<div style="display:flex;align-items:center;gap:7px">';
        out+='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="'+aiColor+'" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
        out+='<span style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:'+aiColor+';font-weight:700">ШІ Аналіз</span></div>';
        if(canAnalyse){
          out+='<button data-aid="'+a.id+'" onclick="G.personalAnalysis(this.dataset.aid)" style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:8px;border:1.5px solid rgba(45,91,227,.2);background:#fff;font-size:12px;font-weight:600;color:var(--primary);cursor:pointer">✦ Розбір</button>';
        } else {
          out+='<span style="font-size:11px;color:var(--muted);font-style:italic">'+(hasGrade?'оцініть відповіді':'виставте оцінку')+'</span>';
        }
        out+='</div>';
        if(a.aiComment) out+='<div style="padding:12px 15px;font-size:13px;color:var(--text);line-height:1.7">'+esc(a.aiComment)+'</div>';
        else if(a.personalAnalysis) out+='<div style="padding:12px 15px;font-size:13px;color:var(--text);line-height:1.7">'+esc(a.personalAnalysis)+'</div>';
        out+='</div>';

        return out;
      })()}

      <!-- Питання -->
      <div style="padding:16px 20px 24px">
        <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">Відповіді</div>
        ${qHtml||`<div style="text-align:center;padding:32px;color:var(--muted);font-size:14px">Немає даних про відповіді</div>`}
      </div>`;

    openM("m-attempt");
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
      _stGroupFilter = l.group;
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

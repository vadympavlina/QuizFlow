// ═══════════════════════════════════════════════════════════════════════
// shared/online.js — сторінка «Онлайн»: усе, що відбувається зараз.
// Ігри наживо (shared/rooms.js) і студенти в тестах (window.attempts з
// heartbeat-полями currentQ / totalQ / lastSeen), плюс «щойно завершили».
// ═══════════════════════════════════════════════════════════════════════
import { watchRooms, liveRooms, roomTarget, roomState, IN_GAME } from "./rooms.js?v=1";
const uid = window._uid;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const qf = () => window._qf || {};
const plural = (n, f) => (qf().plural ? qf().plural(n, f) : f[2]);
const svg = (d, w = 16, sw = 2) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  play:   '<polygon points="6 4 20 12 6 20 6 4"/>',
  file:   '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  swap:   '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
  copy:   '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  clock:  '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  chev:   '<polyline points="9 18 15 12 9 6"/>',
  down:   '<polyline points="6 9 12 15 18 9"/>',
  tv:     '<rect x="2" y="7" width="20" height="14" rx="2"/><polyline points="17 2 12 7 7 2"/>',
  send:   '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  check:  '<polyline points="20 6 9 17 4 12"/>',
};
const PAL = ["#2563EB", "#7C3AED", "#0D9488", "#EA580C", "#DB2777", "#0891B2", "#4F46E5", "#16A34A"];
const colorFor = s => { let h = 0; for (const ch of String(s || "")) h = (h * 31 + ch.codePointAt(0)) >>> 0; return PAL[h % PAL.length]; };
const initials = s => String(s || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const gradeTone = g => g == null ? "" : g >= 10 ? "ok" : g >= 7 ? "info" : g >= 4 ? "warn" : "bad";

const S = { rooms: new Map(), showIdle: false };
S.rooms = watchRooms(uid, () => schedule());

let raf = 0;
function schedule(){ if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
window.G = window.G || {};
window.G.renderOnline = schedule;
document.addEventListener("qf:live", schedule);
setInterval(tick, 1000);

// Щосекунди — лише таймери й «востаннє активний», без перемальовування списку
function tick(){
  const now = Date.now();
  document.querySelectorAll("#on-body [data-since]").forEach(el => { el.textContent = mmss(now - Number(el.dataset.since)); });
  // Раз на 15 с — повний рендер: студент міг стати неактивним
  if (now % 15000 < 1000) schedule();
}

function render(){
  const body = $("on-body"); if (!body) return;
  const now = Date.now();
  const A = window.attempts || [], T = window.tests || [];
  const isOn = qf().isOnline || (a => a.status === "in_progress");
  const seen = qf().lastSeen || (a => a.lastSeen || a.createdAt || 0);
  const rooms = liveRooms(S.rooms);
  const online = A.filter(a => isOn(a, now));
  const active = online.filter(a => now - seen(a) < 60e3);
  const idle = online.filter(a => now - seen(a) >= 60e3);
  const recent = A.filter(a => (a.status === "completed" || a.status === "pending_review") && now - (a.finishedAt || a.createdAt || 0) < 60 * 60e3)
    .sort((a, b) => (b.finishedAt || b.createdAt || 0) - (a.finishedAt || a.createdAt || 0));

  const players = rooms.reduce((s, r) => s + r.players.length, 0);
  const sub = $("on-sub");
  if (sub) sub.textContent = [
    rooms.length ? `${rooms.length} ${plural(rooms.length, ["гра", "гри", "ігор"])} наживо · ${players} ${plural(players, ["гравець", "гравці", "гравців"])}` : "",
    online.length ? `${online.length} ${plural(online.length, ["студент", "студенти", "студентів"])} у тестах` : "",
  ].filter(Boolean).join(" · ") || "Зараз ніхто не проходить тести й не грає";

  if (!rooms.length && !online.length){
    body.innerHTML = `<div class="on-empty">
        <span class="on-empty-ic">${svg('<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 010 8.49M7.76 16.24a6 6 0 010-8.49M19.07 4.93a10 10 0 010 14.14M4.93 19.07a10 10 0 010-14.14"/>', 26, 1.8)}</span>
        <b>Зараз тихо</b>
        <span>Щойно учні зайдуть у гру чи почнуть тест, вони з'являться тут — без оновлення сторінки.</span>
        <span class="on-empty-a"><a class="on-btn g" href="./?game=1">${svg(IC.play, 13)}Запустити гру</a><a class="on-btn" href="links">${svg(IC.send, 13)}Надіслати тест</a></span>
      </div>` + recentHtml(recent, T);
    return;
  }

  let html = "";
  if (rooms.length){
    html += `<section class="on-sec"><div class="on-sec-h"><h2>${svg(IC.play, 14)}Ігри наживо</h2><span>${rooms.length}</span></div><div class="on-games">`;
    html += rooms.map(r => {
      const inGame = IN_GAME.includes(r.status);
      const pct = r.qCount ? Math.round(Math.min(r.q + (r.status === "reveal" ? 1 : 0), r.qCount) / r.qCount * 100) : 0;
      const shown = r.players.slice(0, 8);
      return `<article class="on-game${inGame ? " live" : ""}">
        <div class="on-game-top">
          <div><span class="on-code">${esc(r.code)}</span><b>${esc(r.title || "Гра наживо")}</b></div>
          <span class="on-state ${r.status}">${inGame ? '<i class="on-dot"></i>' : ""}${esc(roomState(r))}</span>
        </div>
        ${r.qCount ? `<div class="on-bar"><i style="width:${pct}%"></i></div>` : ""}
        <div class="on-game-foot">
          <span class="on-ppl">${shown.map(n => `<i style="background:${colorFor(n)}" title="${esc(n)}">${esc(initials(n))}</i>`).join("")}${r.players.length > shown.length ? `<em>+${r.players.length - shown.length}</em>` : ""}
            <small>${r.players.length ? `${r.players.length} ${plural(r.players.length, ["гравець", "гравці", "гравців"])}` : "Чекаємо гравців"}</small></span>
          <a class="on-btn g" href="live/${roomTarget(r)}?code=${encodeURIComponent(r.code)}" target="_blank" rel="noopener">Відкрити гру${svg(IC.chev, 13, 2.5)}</a>
        </div>
      </article>`;
    }).join("");
    html += `</div></section>`;
  }

  if (online.length){
    // Групи за тестом: так видно весь клас однією карткою
    const byTest = new Map();
    active.forEach(a => { if (!byTest.has(a.testId)) byTest.set(a.testId, []); byTest.get(a.testId).push(a); });
    html += `<section class="on-sec"><div class="on-sec-h"><h2>${svg(IC.file, 14)}Проходять тест</h2><span>${active.length}</span></div>`;
    if (!active.length) html += `<div class="on-mini">Активних зараз немає — усі нижче давно не відповідали.</div>`;
    [...byTest.entries()].sort((x, y) => y[1].length - x[1].length).forEach(([tid, list]) => {
      const t = T.find(x => x.id === tid);
      const groups = [...new Set(list.map(a => a.group).filter(Boolean))];
      const prog = list.map(a => a.totalQ ? (a.currentQ || 0) / a.totalQ : 0);
      const avg = Math.round(prog.reduce((s, x) => s + x, 0) / list.length * 100);
      html += `<article class="on-test">
        <div class="on-test-h">
          <div><b>${esc(t?.title || "Тест")}</b><small>${groups.map(esc).join(", ") || "без групи"} · ${list.length} ${plural(list.length, ["студент", "студенти", "студентів"])}</small></div>
          <span class="on-avg" title="Середній прогрес групи"><span class="on-bar sm"><i style="width:${avg}%"></i></span>${avg}%</span>
        </div>
        <div class="on-rows">${list.sort((x, y) => (y.currentQ || 0) / (y.totalQ || 1) - (x.currentQ || 0) / (x.totalQ || 1)).map(a => rowHtml(a, now, seen)).join("")}</div>
      </article>`;
    });
    if (idle.length){
      html += `<button type="button" class="on-idle-t" data-on="idle" aria-expanded="${S.showIdle}">${svg(IC.clock, 13)}Неактивні більше хвилини · ${idle.length}<span class="${S.showIdle ? "up" : ""}">${svg(IC.down, 13, 2.5)}</span></button>`;
      if (S.showIdle) html += `<div class="on-test idle"><div class="on-rows">${idle.sort((x, y) => seen(y) - seen(x)).map(a => rowHtml(a, now, seen)).join("")}</div></div>`;
    }
    html += `</section>`;
  }
  body.innerHTML = html + recentHtml(recent, T);
}

function rowHtml(a, now, seen){
  const who = `${a.surname || ""} ${a.name || ""}`.trim() || "Студент";
  const pct = a.totalQ ? Math.round((a.currentQ || 0) / a.totalQ * 100) : 0;
  const ago = now - seen(a);
  const flags = [
    a.tabSwitches  ? `<span class="on-flag" title="Виходи з тесту">${svg(IC.swap, 11)}${a.tabSwitches}</span>` : "",
    a.copyAttempts ? `<span class="on-flag" title="Спроби копіювання">${svg(IC.copy, 11)}${a.copyAttempts}</span>` : "",
    a.screenshots  ? `<span class="on-flag" title="Спроби скріншоту">${svg(IC.camera, 11)}${a.screenshots}</span>` : "",
  ].join("");
  const start = a.startedAt || a.createdAt || now;
  return `<button type="button" class="on-row${ago >= 60e3 ? " idle" : ""}" data-att="${esc(a.id)}">
    <span class="on-ava" style="background:${colorFor(who)}">${esc(initials(who))}<i class="${ago < 60e3 ? "on" : ""}"></i></span>
    <span class="on-who"><b>${esc(who)}</b><small>${ago < 60e3 ? "активний" : `востаннє ${Math.round(ago / 60e3)} хв тому`}${a.group ? ` · ${esc(a.group)}` : ""}</small></span>
    <span class="on-prog"><span class="on-bar"><i style="width:${pct}%"></i></span><small>${a.totalQ ? `${a.currentQ || 0} з ${a.totalQ}` : "почав"}</small></span>
    <span class="on-flags">${flags}</span>
    <span class="on-time" title="Час у тесті">${svg(IC.clock, 12)}<span data-since="${start}">${mmss(now - start)}</span></span>
  </button>`;
}

function recentHtml(list, T){
  if (!list.length) return "";
  return `<section class="on-sec"><div class="on-sec-h"><h2>${svg(IC.check, 14, 2.4)}Щойно завершили</h2><span>за годину · ${list.length}</span></div>
    <div class="on-recent">${list.slice(0, 12).map(a => {
      const who = `${a.surname || ""} ${a.name || ""}`.trim() || "Студент";
      const t = T.find(x => x.id === a.testId);
      const b = a.status === "pending_review" ? `<span class="on-g warn">перевірити</span>` : a.grade12 != null ? `<span class="on-g ${gradeTone(+a.grade12)}"><b>${+a.grade12}</b>/12</span>` : "";
      return `<button type="button" class="on-rc" data-att="${esc(a.id)}"><span class="on-who"><b>${esc(who)}</b><small>${esc(t?.title || "Тест")}${a.group ? ` · ${esc(a.group)}` : ""} · ${esc(qf().timeAgo ? qf().timeAgo(a.finishedAt || a.createdAt) : "")}</small></span>${b}</button>`;
    }).join("")}</div></section>`;
}

document.addEventListener("click", e => {
  if (e.target.closest('[data-on="idle"]')){ S.showIdle = !S.showIdle; return render(); }
  const att = e.target.closest("#on-body [data-att]"); if (att) window.G?.viewAtt?.(att.dataset.att);
});

schedule();

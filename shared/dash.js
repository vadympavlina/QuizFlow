// ═══════════════════════════════════════════════════════════════════════
// shared/dash.js — дашборд викладача (лише index.html).
// Два рівноправні режими: ігри наживо (rooms + gameHistory) і тести за
// посиланнями (links + attempts). Дані тестів — з app.js/features.js
// (window.attempts / links / tests), ігри — власні слухачі тут.
// ═══════════════════════════════════════════════════════════════════════
import { watchRooms, liveRooms, roomTarget, roomState, IN_GAME } from "./rooms.js?v=1";
const { db, ref, onValue } = window._fb;
const uid = window._uid;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const qf = () => window._qf || {};
const plural = (n, f) => (qf().plural ? qf().plural(n, f) : f[2]);
const DAY = 864e5;
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const toMs = v => typeof v === "number" ? v : Number(v) || 0;
const fmtDay = t => {
  if (!t) return "";
  const ds = dayStart(t), today = dayStart(Date.now());
  const time = new Date(t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  if (ds === today) return `сьогодні, ${time}`;
  if (ds === today - DAY) return `вчора, ${time}`;
  return new Date(t).toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
};
const svg = (d, w = 16, sw = 2) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  play:   '<polygon points="6 4 20 12 6 20 6 4"/>',
  send:   '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  users:  '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  file:   '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  pulse:  '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  chart:  '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>',
  clock:  '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  flag:   '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  link:   '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',
  chev:   '<polyline points="9 18 15 12 9 6"/>',
  plus:   '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  check:  '<polyline points="20 6 9 17 4 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x:      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
};
const PAL = ["#2563EB", "#7C3AED", "#0D9488", "#EA580C", "#DB2777", "#0891B2", "#4F46E5", "#16A34A"];
const colorFor = s => { let h = 0; for (const ch of String(s || "")) h = (h * 31 + ch.codePointAt(0)) >>> 0; return PAL[h % PAL.length]; };
const abbr = t => { const w = String(t || "").match(/[\p{L}\p{N}]+/gu) || ["?"]; return (w.length === 1 ? w[0].slice(0, 2) : w.slice(0, 2).map(x => x[0]).join("")).toUpperCase(); };
const gradeTone = g => g == null ? "" : g >= 10 ? "ok" : g >= 7 ? "info" : g >= 4 ? "warn" : "bad";

// ─── Ігри: історія та кімнати, що зараз ідуть ─────────────────────────
const D = { games: null, rooms: new Map() };

function prepGame(code, g){
  const res = (Array.isArray(g.results) ? g.results : Object.values(g.results || {})).filter(Boolean)
    .map(r => ({ nick: r.nickname || "—", score: Number(r.score) || 0, correct: r.correct == null ? null : Number(r.correct) }))
    .sort((a, b) => b.score - a.score);
  const qc = Number(g.questionCount) || 0;
  const wc = res.filter(r => r.correct != null);
  return {
    code, title: g.testTitle || "Без назви", testId: g.testId || "", at: toMs(g.playedAt),
    n: res.length || Number(g.playerCount) || 0, qc, top: res[0] || null,
    acc: qc && wc.length ? Math.round(wc.reduce((s, r) => s + r.correct, 0) / (wc.length * qc) * 100) : null,
  };
}
onValue(ref(db, `teachers/${uid}/gameHistory`), snap => {
  D.games = Object.entries(snap.val() || {}).map(([c, g]) => prepGame(c, g || {})).sort((a, b) => b.at - a.at);
  schedule();
}, () => { D.games = []; schedule(); });

D.rooms = watchRooms(uid, () => schedule());

// ─── Рендер (з дебаунсом: дані тестів і ігор приходять хвилями) ───────
let raf = 0;
function schedule(){ if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
window.renderDash = schedule;
document.addEventListener("qf:live", schedule);

function render(){
  if (!$("sec-dashboard")) return;
  const A = window.attempts || [], L = window.links || [], T = window.tests || [];
  const now = Date.now(), wk = now - 7 * DAY, pwk = now - 14 * DAY;
  const games = D.games || [];

  // Шапка
  const h = new Date().getHours();
  const name = (window._user?.name || "").trim().split(/\s+/)[0] || window._user?.login || "";
  $("dx-hello").textContent = (h < 5 ? "Доброї ночі" : h < 12 ? "Доброго ранку" : h < 18 ? "Добрий день" : "Добрий вечір") + (name ? `, ${name}` : "");
  const td = dayStart(now);
  const gToday = games.filter(g => g.at >= td).length, aToday = A.filter(a => (a.createdAt || 0) >= td).length;
  const date = new Date().toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" });
  $("dx-sub").textContent = [date.charAt(0).toUpperCase() + date.slice(1),
    gToday ? `${gToday} ${plural(gToday, ["гра", "гри", "ігор"])} сьогодні` : "",
    aToday ? `${aToday} ${plural(aToday, ["спроба", "спроби", "спроб"])} сьогодні` : ""].filter(Boolean).join(" · ");

  // Герой: дві дії
  const lastG = games[0];
  $("dx-game-meta").innerHTML = lastG
    ? `Остання гра: <b>${esc(lastG.title)}</b> · ${esc(fmtDay(lastG.at))}`
    : "Ви ще не проводили ігор — спробуйте на наступному уроці";
  const openLinks = L.filter(l => qf().isOpenState?.(qf().linkState?.(l, now)));
  const pend = A.filter(a => a.status === "pending_review").length;
  $("dx-test-meta").innerHTML = openLinks.length
    ? `<b>${openLinks.length}</b> ${plural(openLinks.length, ["активне посилання", "активні посилання", "активних посилань"])}${pend ? ` · <b>${pend}</b> на перевірці` : ""}`
    : "Активних посилань немає";

  renderNow(A, L, now);
  renderKpis(A, games, now, wk, pwk);
  renderGames(games);
  renderTests(A, L, T, now);
  renderStart(A, L, T, games);
}

// «Зараз»: ігри, що йдуть, студенти в тестах, і що потребує уваги
function renderNow(A, L, now){
  const box = $("dx-now"); if (!box) return;
  const items = [];
  liveRooms(D.rooms).forEach(r => {
    const inGame = IN_GAME.includes(r.status);
    const target = roomTarget(r), state = roomState(r);
    items.push(`<a class="dx-now-it game" href="live/${target}?code=${encodeURIComponent(r.code)}" target="_blank" rel="noopener">
      <span class="dx-now-ic">${inGame ? '<i class="dx-pulse"></i>' : ""}${svg(IC.play, 15)}</span>
      <span class="dx-now-b" title="${esc(r.title)}"><b>Гра ${esc(r.code)} · ${r.players.length} ${plural(r.players.length, ["гравець", "гравці", "гравців"])}</b><small>${esc(state)}${r.title ? ` · ${esc(r.title)}` : ""}</small></span>
      <span class="dx-now-go">${svg(IC.chev, 14, 2.5)}</span></a>`);
  });
  const online = A.filter(a => qf().isOnline ? qf().isOnline(a, now) : a.status === "in_progress");
  if (online.length){
    const tIds = [...new Set(online.map(a => a.testId))];
    const tt = tIds.length === 1 ? (window.tests || []).find(t => t.id === tIds[0])?.title : "";
    items.push(`<a class="dx-now-it live" href="online">
      <span class="dx-now-ic"><i class="dx-pulse"></i>${svg(IC.users, 15)}</span>
      <span class="dx-now-b"><b>${online.length} ${plural(online.length, ["проходить", "проходять", "проходять"])} тест зараз</b><small>${tt ? esc(tt) : `${tIds.length} ${plural(tIds.length, ["тест", "тести", "тестів"])}`}</small></span>
      <span class="dx-now-go">${svg(IC.chev, 14, 2.5)}</span></a>`);
  }
  const pend = A.filter(a => a.status === "pending_review").length;
  if (pend) items.push(`<a class="dx-now-it warn" href="attempts?status=pending_review">
      <span class="dx-now-ic">${svg(IC.clock, 15)}</span>
      <span class="dx-now-b"><b>${pend} на перевірці</b><small>Оцініть відкриті питання</small></span>
      <span class="dx-now-go">${svg(IC.chev, 14, 2.5)}</span></a>`);
  const susp = qf().suspNewCount?.() || 0;
  if (susp) items.push(`<a class="dx-now-it bad" href="suspicious">
      <span class="dx-now-ic">${svg(IC.flag, 15)}</span>
      <span class="dx-now-b"><b>${susp} ${plural(susp, ["нова підозріла", "нові підозрілі", "нових підозрілих"])}</b><small>Виходи, копіювання, скріншоти</small></span>
      <span class="dx-now-go">${svg(IC.chev, 14, 2.5)}</span></a>`);
  box.hidden = !items.length;
  box.innerHTML = items.length ? `<div class="dx-sec-l">Зараз</div><div class="dx-now-list">${items.join("")}</div>` : "";
}

// Тиждень: і ігри, і тести
function renderKpis(A, games, now, wk, pwk){
  const box = $("dx-kpis"); if (!box) return;
  // Новий викладач без жодних даних — рядок нулів лише заважає
  box.hidden = !games.length && !A.length;
  if (box.hidden) return;
  const inWk = (t, from, to = now) => t >= from && t < to;
  const gW = games.filter(g => inWk(g.at, wk)), gP = games.filter(g => inWk(g.at, pwk, wk));
  const players = gW.reduce((s, g) => s + g.n, 0), playersP = gP.reduce((s, g) => s + g.n, 0);
  const accs = gW.map(g => g.acc).filter(x => x != null);
  const acc = accs.length ? Math.round(accs.reduce((s, x) => s + x, 0) / accs.length) : null;
  const aW = A.filter(a => inWk(a.createdAt || 0, wk)), aP = A.filter(a => inWk(a.createdAt || 0, pwk, wk));
  const gr = aW.filter(a => a.status === "completed" && a.grade12 != null).map(a => +a.grade12);
  const avg = gr.length ? gr.reduce((s, x) => s + x, 0) / gr.length : null;
  const delta = (c, p) => {
    if (!c && !p) return "";
    const d = c - p;
    return `<span class="dx-d ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" + d : d < 0 ? "−" + Math.abs(d) : "="}</span>`;
  };
  const tile = (cls, ic, label, v, sub, href) => `<a class="dx-kpi ${cls}" href="${href}">
      <span class="dx-kpi-ic">${svg(ic, 16)}</span>
      <span class="dx-kpi-l">${label}</span>
      <span class="dx-kpi-v">${v}</span>
      <span class="dx-kpi-s">${sub}</span></a>`;
  box.innerHTML = `<div class="dx-sec-l">Останні 7 днів</div><div class="dx-kpi-row">` +
    tile("g", IC.play, "Ігор проведено", gW.length, `${delta(gW.length, gP.length)} проти минулого тижня`, "game-history") +
    tile("g", IC.users, "Гравців", players, `${delta(players, playersP)} ${gW.length ? `≈ ${Math.round(players / gW.length)} на гру` : "у іграх"}`, "game-history") +
    tile("g", IC.target, "Точність у іграх", acc != null ? acc + "<small>%</small>" : "—", acc != null ? "правильних відповідей" : "ще немає даних", "game-history") +
    tile("t", IC.pulse, "Спроб тестів", aW.length, `${delta(aW.length, aP.length)} проти минулого тижня`, "attempts") +
    tile("t", IC.chart, "Середня оцінка", avg != null ? avg.toFixed(1) + "<small>/12</small>" : "—", gr.length ? `${gr.length} ${plural(gr.length, ["оцінка", "оцінки", "оцінок"])}` : "ще немає оцінок", "analytics") +
  `</div>`;
}

function renderGames(games){
  const box = $("dx-games"); if (!box) return;
  if (D.games === null){ box.innerHTML = `<div class="dx-skel"></div><div class="dx-skel"></div><div class="dx-skel"></div>`; return; }
  const cnt = $("dx-games-cnt"); if (cnt) cnt.textContent = games.length ? `${games.length} ${plural(games.length, ["гра", "гри", "ігор"])} усього` : "";
  if (!games.length){
    box.innerHTML = `<div class="dx-empty">
      <span class="dx-empty-ic g">${svg(IC.play, 22)}</span>
      <b>Ще не було жодної гри</b>
      <span>Гра наживо — це вікторина на час для всього класу. Учні заходять з телефонів за кодом, а ви показуєте питання на екрані.</span>
      <button type="button" class="dx-btn g" data-dx="game">${svg(IC.play, 13)}Провести першу гру</button></div>`;
    return;
  }
  box.innerHTML = games.slice(0, 5).map(g => {
    const c = colorFor(g.testId || g.title);
    return `<a class="dx-row" href="game-history">
      <span class="dx-tile" style="background:${c}1A;color:${c}">${esc(abbr(g.title))}</span>
      <span class="dx-row-b"><b>${esc(g.title)}</b><small>${esc(fmtDay(g.at))} · ${g.n} ${plural(g.n, ["гравець", "гравці", "гравців"])}${g.qc ? ` · ${g.qc} ${plural(g.qc, ["питання", "питання", "питань"])}` : ""}</small></span>
      ${g.top ? `<span class="dx-win" title="Переможець">${svg(IC.trophy, 13)}<b>${esc(g.top.nick)}</b><small>${g.top.score.toLocaleString("uk-UA")}</small></span>` : ""}
      ${g.acc != null ? `<span class="dx-acc" title="Точність відповідей"><span class="tr"><i style="width:${g.acc}%;background:${g.acc >= 70 ? "#16A34A" : g.acc >= 40 ? "#F59E0B" : "#DC2626"}"></i></span><small>${g.acc}%</small></span>` : `<span class="dx-acc"></span>`}
    </a>`;
  }).join("");
}

function renderTests(A, L, T, now){
  const box = $("dx-tests"); if (!box) return;
  const st = qf().linkState || (() => "active");
  const cntBy = new Map(); A.forEach(a => { if (a.linkId) cntBy.set(a.linkId, (cntBy.get(a.linkId) || 0) + 1); });
  const open = L.filter(l => qf().isOpenState?.(st(l, now)))
    .sort((a, b) => (a.closeAt || Infinity) - (b.closeAt || Infinity) || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3);
  const lnk = open.map(l => {
    const t = T.find(x => x.id === l.testId), n = cntBy.get(l.id) || 0, max = qf().lnkMax?.(l) || 0;
    const s = st(l, now);
    const when = s === "scheduled" ? `відкриється ${fmtDay(l.openAt)}` : l.closeAt ? `до ${fmtDay(l.closeAt)}` : "без терміну";
    const soon = l.closeAt && l.closeAt - now < DAY && s !== "scheduled";
    return `<a class="dx-lnk" href="links">
      <span class="dx-row-b"><b>${esc(t?.title || "Тест видалено")}</b><small>${l.group ? `${esc(l.group)} · ` : ""}<span class="${soon ? "soon" : ""}">${esc(when)}</span></small></span>
      <span class="dx-lnk-n"><b>${n}</b>${max ? `<small>/${max}</small>` : ""}<small> ${plural(n, ["спроба", "спроби", "спроб"])}</small></span>
      ${max ? `<span class="dx-bar"><i style="width:${Math.min(100, Math.round(n / max * 100))}%"></i></span>` : ""}
    </a>`;
  }).join("");
  const recent = A.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
  const act = recent.map(a => {
    const t = T.find(x => x.id === a.testId);
    const who = `${a.surname || ""} ${a.name || ""}`.trim() || "Студент";
    const badge = a.status === "in_progress" ? `<span class="dx-b live"><i></i>проходить</span>`
      : a.status === "pending_review" ? `<span class="dx-b warn">перевірити</span>`
      : a.grade12 != null ? `<span class="dx-b ${gradeTone(+a.grade12)}"><b>${+a.grade12}</b>/12</span>` : `<span class="dx-b">—</span>`;
    const flag = qf().isSusp?.(a) ? `<span class="dx-flag" title="Підозріла активність">${svg(IC.flag, 12)}</span>` : "";
    return `<button type="button" class="dx-act" data-att="${esc(a.id)}">
      <span class="dx-ava" style="background:${colorFor(who)}">${esc(abbr(who))}</span>
      <span class="dx-row-b"><b>${esc(who)}${flag}</b><small>${esc(t?.title || "Тест видалено")}${a.group ? ` · ${esc(a.group)}` : ""} · ${esc(qf().timeAgo ? qf().timeAgo(a.createdAt) : "")}</small></span>
      ${badge}</button>`;
  }).join("");
  box.innerHTML = `
    <div class="dx-sub-h"><span>Активні посилання</span><a href="links">Усі${svg(IC.chev, 12, 2.5)}</a></div>
    ${lnk || `<div class="dx-mini-empty">Немає активних посилань · <button type="button" data-dx="test">створити</button></div>`}
    <div class="dx-sub-h"><span>Остання активність</span><a href="attempts">Усі спроби${svg(IC.chev, 12, 2.5)}</a></div>
    ${act || `<div class="dx-mini-empty">Щойно студенти пройдуть тест, результати з'являться тут</div>`}`;
}

// «Почніть роботу» — поки новий викладач не спробував обидва режими
function renderStart(A, L, T, games){
  const box = $("dx-start"); if (!box) return;
  const steps = [
    { done: T.some(t => t.status !== "archived" && (t.questions || []).length), t: "Створіть тест", s: "Питання для гри й для тесту — одні й ті самі", act: "new", btn: "Створити" },
    { done: games.length > 0 || D.rooms.size > 0, t: "Проведіть гру наживо", s: "Вікторина на уроці: учні заходять за кодом", act: "game", btn: "Запустити" },
    { done: L.length > 0, t: "Надішліть тест за посиланням", s: "Самостійна чи контрольна у зручний час", act: "test", btn: "Надіслати" },
  ];
  const n = steps.filter(x => x.done).length;
  if (D.games === null || n === steps.length){ box.hidden = true; return; }
  const next = steps.findIndex(x => !x.done);
  box.hidden = false;
  box.innerHTML = `<div class="dx-start-h"><b>Почніть роботу з QuizFlow</b><span>${n} з ${steps.length}</span><span class="dx-bar"><i style="width:${Math.round(n / steps.length * 100)}%"></i></span></div>
    <ol>${steps.map((x, i) => `<li class="${x.done ? "done" : i === next ? "next" : ""}">
      <span class="n">${x.done ? svg(IC.check, 12, 3) : i + 1}</span><span class="dx-row-b"><b>${x.t}</b><small>${x.s}</small></span>
      ${x.done ? "" : `<button type="button" class="dx-btn ${i === next ? "p" : ""}" data-dx="${x.act}">${x.btn}</button>`}</li>`).join("")}</ol>`;
}

// ─── Вибір тесту для гри (власний список з пошуком, без <select>) ──────
function openPicker(){
  const T = (window.tests || []).filter(t => t.status !== "archived" && (t.questions || []).length);
  const played = new Map(); (D.games || []).forEach(g => { if (!played.has(g.testId)) played.set(g.testId, { n: 0, at: g.at }); played.get(g.testId).n++; });
  const list = T.map(t => ({ t, p: played.get(t.id) })).sort((a, b) => (b.p?.at || 0) - (a.p?.at || 0) || (b.t.updatedAt || b.t.createdAt || 0) - (a.t.updatedAt || a.t.createdAt || 0));
  const dlg = $("dx-pick"), inp = $("dx-pick-q"), box = $("dx-pick-list");
  let kb = 0;
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const rows = q ? list.filter(x => (x.t.title || "").toLowerCase().includes(q)) : list;
    kb = Math.min(kb, Math.max(0, rows.length - 1));
    box.innerHTML = rows.length ? rows.map((x, i) => {
      const qn = (x.t.questions || []).length, c = colorFor(x.t.id);
      return `<button type="button" class="dx-pick-it${i === kb ? " kb" : ""}" data-tid="${esc(x.t.id)}">
        <span class="dx-tile" style="background:${c}1A;color:${c}">${esc(abbr(x.t.title))}</span>
        <span class="dx-row-b"><b>${esc(x.t.title || "Без назви")}</b><small>${qn} ${plural(qn, ["питання", "питання", "питань"])}${x.p ? ` · грали ${x.p.n} ${plural(x.p.n, ["раз", "рази", "разів"])}, ост. ${esc(fmtDay(x.p.at))}` : ""}</small></span>
        <span class="dx-pick-go">${svg(IC.play, 12)}</span></button>`;
    }).join("") : `<div class="dx-mini-empty">${list.length ? "Нічого не знайдено" : `Немає тестів з питаннями · <button type="button" data-dx="new">створити тест</button>`}</div>`;
    box.querySelector(".kb")?.scrollIntoView({ block: "nearest" });
    return rows;
  };
  let rows = [];
  inp.value = ""; rows = draw();
  dlg.hidden = false; requestAnimationFrame(() => dlg.classList.add("on"));
  setTimeout(() => inp.focus(), 30);
  inp.oninput = () => { kb = 0; rows = draw(); };
  inp.onkeydown = e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); kb = (kb + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % Math.max(1, rows.length); rows = draw(); }
    else if (e.key === "Enter" && rows[kb]){ e.preventDefault(); launch(rows[kb].t.id); }
  };
}
function closePicker(){ const d = $("dx-pick"); if (!d || d.hidden) return; d.classList.remove("on"); setTimeout(() => { d.hidden = true; }, 160); }
function launch(tid){ closePicker(); window.open(`live/setup?testId=${encodeURIComponent(tid)}`, "_blank", "noopener"); }

// ─── Делеговані дії ───────────────────────────────────────────────────
document.addEventListener("click", e => {
  const act = e.target.closest("[data-dx]")?.dataset.dx;
  if (act === "game") return openPicker();
  if (act === "test") return window.G?.newLink?.();
  if (act === "new") { closePicker(); return window.G?.openTestInFolder?.(null); }
  if (act === "pick-close" || e.target.id === "dx-pick") return closePicker();
  const it = e.target.closest(".dx-pick-it"); if (it) return launch(it.dataset.tid);
  const att = e.target.closest(".dx-act[data-att]"); if (att) return window.G?.viewAtt?.(att.dataset.att);
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("dx-pick")?.hidden) { e.stopPropagation(); closePicker(); } }, true);

schedule();
// ./?game=1 (напр. зі сторінки «Онлайн») — одразу вибір тесту для гри
if (new URLSearchParams(location.search).get("game") === "1"){
  history.replaceState(null, "", location.pathname);
  setTimeout(openPicker, 400);
}

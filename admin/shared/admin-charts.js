// ═══════════════════════════════════════════════════════════════════════
// admin/shared/admin-charts.js — графіки адмінки (без бібліотек)
//
// Один стиль для всіх: тонкі стовпчики з заокругленим верхом, приглушена сітка
// з підписами осі, легенда для ≥2 серій, підказка при наведенні на весь стовпець.
// Кольори серій (перевірено на дальтонізм): тести — синій, ігри — маджента.
// ═══════════════════════════════════════════════════════════════════════
export const C = { tests: "#2563EB", games: "#E11D8F", violet: "#7C3AED" };

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// «Кругла» верхня межа осі й 4 поділки
// Верх осі = 4 × «кругла» ціла поділка (1, 2, 5, 10, 20, 25, 50…): 4 → 8 → 20 → 40…
export function niceMax(v){
  const raw = Math.max(1, v) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 && p >= 10 ? 2.5 : n <= 5 ? 5 : 10;
  return Math.max(1, m * p) * 4;
}
const fmt = n => Number(n).toLocaleString("uk-UA");
// Які підписи осі X показувати: стільки, скільки вміщується, і завжди останній
function xShow(el, n){
  const slots = Math.max(3, Math.floor((el.clientWidth || 600) / 56));
  const every = Math.max(1, Math.ceil(n / slots));
  return i => i === n - 1 || (i % every === 0 && n - 1 - i >= every * .7);
}

// ─── Підказка (одна на сторінку) ───
let tip;
function tipEl(){
  if (!tip){ tip = document.createElement("div"); tip.className = "ch-tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
  return tip;
}
export function bindTips(root){
  if (!root || root._chTips) return;
  root._chTips = true;
  const show = el => {
    const t = tipEl(); t.innerHTML = el.dataset.tip; t.classList.add("on");
    const r = el.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2; x = Math.max(8, Math.min(innerWidth - tw - 8, x));
    let y = r.top - th - 8; if (y < 8) y = r.bottom + 8;
    t.style.left = x + "px"; t.style.top = y + "px";
  };
  const hide = () => tip?.classList.remove("on");
  root.addEventListener("mouseover", e => { const el = e.target.closest("[data-tip]"); el ? show(el) : hide(); });
  root.addEventListener("mouseleave", hide);
  root.addEventListener("focusin", e => { const el = e.target.closest("[data-tip]"); if (el) show(el); });
  root.addEventListener("focusout", hide);
  addEventListener("scroll", hide, { passive: true });
}

// ─── Стовпчики по днях: одна або кілька серій поруч ───
// opts: { labels:[], full:[], series:[{name,color,values:[]}], unit:(n)=>"спроб", height, highlightLast }
export function bars(el, o){
  if (!el) return;
  const n = o.labels.length, S = o.series;
  if (o.compact) return compactBars(el, o);
  const max = niceMax(Math.max(1, ...S.flatMap(s => s.values)));
  const ticks = [0, .25, .5, .75, 1].map(k => Math.round(max * k));
  const show = xShow(el, n);
  const legend = S.length > 1 ? `<div class="ch-legend">${S.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
  const cols = o.labels.map((lb, i) => {
    const tipRows = S.map(s => `<div class="r"><i style="background:${s.color}"></i>${esc(s.name)}<b>${fmt(s.values[i])}</b></div>`).join("");
    const tipHtml = `<div class="h">${esc(o.full?.[i] || lb)}</div>${tipRows}`;
    const sum = S.reduce((a, s) => a + s.values[i], 0);
    return `<div class="ch-col${o.highlightLast && i === n - 1 ? " last" : ""}${sum ? "" : " zero"}" tabindex="0" data-tip="${esc(tipHtml)}" aria-label="${esc((o.full?.[i] || lb) + ": " + S.map(s => s.name + " " + s.values[i]).join(", "))}">
      ${S.map(s => `<i style="height:${s.values[i] ? Math.max(2, s.values[i] / max * 100) : 0}%;background:${s.color}"></i>`).join("")}
    </div>`;
  }).join("");
  const labels = o.labels.map((lb, i) => `<span class="${o.highlightLast && i === n - 1 ? "last" : ""}">${show(i) ? esc(lb) : ""}</span>`).join("");
  el.innerHTML = `${legend}<div class="ch" style="--h:${o.height || 200}px">
      <div class="ch-y">${ticks.slice().reverse().map(t => `<span>${fmt(t)}</span>`).join("")}</div>
      <div class="ch-plot">
        <div class="ch-grid">${ticks.map(() => "<i></i>").join("")}</div>
        <div class="ch-cols${S.length > 1 ? " multi" : ""}" style="--n:${n}">${cols}</div>
      </div>
      <div></div><div class="ch-x" style="--n:${n}">${labels}</div>
    </div>`;
  bindTips(el);
}

// Міні-версія для карток: без осі Y, підписи лише першого й останнього дня
function compactBars(el, o){
  const s = o.series[0], n = o.labels.length, max = Math.max(1, ...s.values);
  el.innerHTML = `<div class="ch-mini" style="--h:${o.height || 72}px;--n:${n}">
      <div class="ch-cols">${s.values.map((v, i) => `<div class="ch-col${i === n - 1 ? " last" : ""}${v ? "" : " zero"}" tabindex="0" data-tip="${esc(`<div class="h">${esc(o.full?.[i] || o.labels[i])}</div><div class="r"><i style="background:${s.color}"></i>${esc(s.name)}<b>${fmt(v)}</b></div>`)}"><i style="height:${v ? Math.max(4, v / max * 100) : 0}%;background:${s.color}"></i></div>`).join("")}</div>
    </div>
    <div class="ch-mini-x"><span>${esc(o.labels[0])}</span><span>${esc(o.labels[n - 1])}</span></div>`;
  bindTips(el);
}

// ─── Лінія з заливкою + перехрестя (стовпці-«зони» для наведення) ───
export function area(el, o){
  if (!el) return;
  const v = o.values, n = v.length, max = niceMax(Math.max(1, ...v));
  const ticks = [0, .25, .5, .75, 1].map(k => Math.round(max * k));
  const W = 1000, H = 300;
  // Точки — по центрах колонок, як і підписи осі X та зони наведення
  const x = i => (i + .5) / n * W, y = val => H - val / max * H;
  const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`);
  const line = "M" + pts.join(" L");
  const show = xShow(el, n);
  const color = o.color || C.violet;
  el.innerHTML = `<div class="ch" style="--h:${o.height || 220}px">
      <div class="ch-y">${ticks.slice().reverse().map(t => `<span>${fmt(t)}</span>`).join("")}</div>
      <div class="ch-plot">
        <div class="ch-grid">${ticks.map(() => "<i></i>").join("")}</div>
        <svg class="ch-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="chg-${o.id || "a"}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".2"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
          <path d="${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z" fill="url(#chg-${o.id || "a"})"/>
          <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="ch-hits" style="--n:${n}">${v.map((val, i) => `<div tabindex="0" data-tip="${esc(`<div class="h">${esc(o.full?.[i] || o.labels[i])}</div><div class="r"><i style="background:${color}"></i>${esc(o.name || "")}<b>${fmt(val)}</b></div>`)}"><b style="bottom:${val / max * 100}%;border-color:${color}"></b></div>`).join("")}</div>
      </div>
      <div></div><div class="ch-x" style="--n:${n}">${o.labels.map((lb, i) => `<span>${show(i) ? esc(lb) : ""}</span>`).join("")}</div>
    </div>`;
  bindTips(el);
}

// ─── Горизонтальні смуги-рейтинг (замість «бублика») ───
// rows: [{label, sub, value, color?}]
export function rank(el, rows, o = {}){
  if (!el) return;
  const max = Math.max(1, ...rows.map(r => r.value));
  el.innerHTML = rows.length ? `<div class="ch-rank">${rows.map(r => `<div class="ch-rk" tabindex="0" data-tip="${esc(`<div class="h">${esc(r.label)}</div><div class="r">${esc(o.unit || "")}<b>${fmt(r.value)}</b></div>`)}">
      <div class="t"><b>${esc(r.label)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</div>
      <div class="bar"><i style="width:${Math.max(1.5, r.value / max * 100)}%;background:${r.color || o.color || C.violet}"></i></div>
      <div class="v">${fmt(r.value)}</div>
    </div>`).join("")}</div>` : `<div class="ch-empty">${esc(o.empty || "Даних поки немає")}</div>`;
  bindTips(el);
}

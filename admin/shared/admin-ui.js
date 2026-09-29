// ═══════════════════════════════════════════════════════════════════════
// admin/shared/admin-ui.js — власні дропдаун і календар замість системних
// <select> та <input type="date"> (правило з CLAUDE.md).
//
// Працює автоматично: усі select / input[type=date] в адмінці, включно з тими,
// що з'являються пізніше (MutationObserver), отримують кнопку й поповер.
// Сам елемент лишається в DOM прихованим: код сторінок і далі читає/пише
// .value і слухає "change" — нічого переписувати не треба.
// ═══════════════════════════════════════════════════════════════════════
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CHEV = '<svg class="ad-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const CAL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

let openPop = null;
function closePop(){ if (openPop){ openPop.close(); openPop = null; } }
document.addEventListener("mousedown", e => { if (openPop && !openPop.el.contains(e.target) && !openPop.btn.contains(e.target)) closePop(); }, true);
addEventListener("resize", closePop);
document.addEventListener("scroll", e => { if (openPop && !openPop.el.contains(e.target)) closePop(); }, true);

// Поповер позиціонується fixed під кнопкою (або над нею, якщо знизу мало місця)
function place(pop, btn, minW){
  const r = btn.getBoundingClientRect();
  pop.style.minWidth = Math.max(minW || 0, r.width) + "px";
  pop.style.left = "0px"; pop.style.top = "0px";
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(r.left, innerWidth - pw - 8); x = Math.max(8, x);
  let y = r.bottom + 6; if (y + ph > innerHeight - 8 && r.top - ph - 6 > 8) y = r.top - ph - 6;
  pop.style.left = x + "px"; pop.style.top = Math.max(8, y) + "px";
}
function hookValue(el, paint){
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, "value");
  if (!d) return;
  Object.defineProperty(el, "value", { configurable: true, get(){ return d.get.call(this); }, set(v){ d.set.call(this, v); paint(); } });
  if (el instanceof HTMLSelectElement){
    const si = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
    Object.defineProperty(el, "selectedIndex", { configurable: true, get(){ return si.get.call(this); }, set(v){ si.set.call(this, v); paint(); } });
  }
}
const fire = el => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };

// ─── Дропдаун ───────────────────────────────────────────────────────────
function enhanceSelect(sel){
  if (sel._ad || sel.multiple || sel.closest("[data-native]")) return;
  sel._ad = true;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ad-sel " + (sel.className || "").replace(/\bfield-input\b/, "is-field");
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const lab = sel.getAttribute("aria-label") || (sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`)?.textContent) || "";
  if (lab) btn.setAttribute("aria-label", lab.trim());
  sel.after(btn);
  sel.classList.add("ad-hidden"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");
  const paint = () => {
    const o = sel.options[sel.selectedIndex];
    const txt = o ? o.textContent : "";
    btn.innerHTML = `<span class="ad-sel-t${!o || !o.value ? " ph" : ""}">${esc(txt || "Оберіть…")}</span>${CHEV}`;
    btn.disabled = sel.disabled;
  };
  hookValue(sel, paint);
  paint();
  new MutationObserver(paint).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
  sel.addEventListener("change", paint);

  function open(){
    closePop();
    const opts = [...sel.options].filter(o => !o.hidden);
    const pop = document.createElement("div");
    pop.className = "ad-pop"; pop.setAttribute("role", "listbox"); pop.dataset.open = "1";
    const search = opts.length > 8;
    pop.innerHTML = (search ? `<div class="ad-pop-s"><input type="text" placeholder="Пошук…" aria-label="Пошук у списку"></div>` : "") + `<div class="ad-pop-l"></div>`;
    const list = pop.querySelector(".ad-pop-l");
    let kb = Math.max(0, opts.indexOf(sel.options[sel.selectedIndex]));
    let shown = opts;
    const render = () => {
      list.innerHTML = shown.length ? shown.map((o, i) => {
        const grp = o.parentElement?.tagName === "OPTGROUP" && (i === 0 || shown[i - 1].parentElement !== o.parentElement) ? `<div class="ad-grp">${esc(o.parentElement.label)}</div>` : "";
        return `${grp}<div class="ad-opt${o.selected ? " on" : ""}${i === kb ? " kb" : ""}${o.disabled ? " dis" : ""}" role="option" aria-selected="${o.selected}" data-i="${i}"><span>${esc(o.textContent)}</span>${o.selected ? CHECK : ""}</div>`;
      }).join("") : `<div class="ad-none">Нічого не знайдено</div>`;
      list.querySelector(".kb")?.scrollIntoView({ block: "nearest" });
    };
    const pick = i => {
      const o = shown[i]; if (!o || o.disabled) return;
      const changed = !o.selected;
      o.selected = true; paint(); close(); btn.focus();
      if (changed) fire(sel);
    };
    const close = () => { pop.remove(); btn.setAttribute("aria-expanded", "false"); btn.classList.remove("open"); };
    list.addEventListener("click", e => { const it = e.target.closest(".ad-opt"); if (it) pick(+it.dataset.i); });
    pop.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); kb = Math.max(0, Math.min(shown.length - 1, kb + (e.key === "ArrowDown" ? 1 : -1))); render(); }
      else if (e.key === "Enter"){ e.preventDefault(); pick(kb); }
      else if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); closePop(); btn.focus(); }
      else if (e.key === "Tab"){ closePop(); }
    });
    const si = pop.querySelector(".ad-pop-s input");
    si?.addEventListener("input", () => { const q = si.value.trim().toLowerCase(); shown = q ? opts.filter(o => o.textContent.toLowerCase().includes(q)) : opts; kb = 0; render(); });
    document.body.appendChild(pop);
    render(); place(pop, btn, 200);
    btn.setAttribute("aria-expanded", "true"); btn.classList.add("open");
    openPop = { el: pop, btn, close };
    (si || pop).focus?.();
    if (!si){ pop.tabIndex = -1; pop.focus(); }
  }
  btn.addEventListener("click", () => openPop?.btn === btn ? closePop() : open());
  btn.addEventListener("keydown", e => { if (e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); open(); } });
}

// ─── Календар (лише дата, значення YYYY-MM-DD) ─────────────────────────
const MON = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
const p2 = n => String(n).padStart(2, "0");
const parse = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fmt = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
function enhanceDate(inp){
  if (inp._ad) return;
  inp._ad = true;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ad-sel ad-date " + (inp.className || "").replace(/\bfield-input\b/, "is-field");
  btn.setAttribute("aria-haspopup", "dialog");
  const lab = inp.getAttribute("aria-label") || (inp.id && document.querySelector(`label[for="${CSS.escape(inp.id)}"]`)?.textContent) || "Дата";
  btn.setAttribute("aria-label", lab.trim());
  inp.after(btn);
  inp.type = "hidden";
  const paint = () => {
    const d = parse(inp.value);
    btn.innerHTML = `${CAL}<span class="ad-sel-t${d ? "" : " ph"}">${d ? esc(d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" })) : esc(inp.placeholder || "Без дати")}</span>`;
  };
  hookValue(inp, paint); paint();
  const set = d => { inp.value = d ? fmt(d) : ""; fire(inp); };

  function open(){
    closePop();
    const pop = document.createElement("div");
    pop.className = "ad-pop ad-cal"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Вибір дати"); pop.dataset.open = "1";
    let view = parse(inp.value) || new Date(); view = new Date(view.getFullYear(), view.getMonth(), 1);
    const render = () => {
      const cur = parse(inp.value), today = new Date(); today.setHours(0, 0, 0, 0);
      const y = view.getFullYear(), m = view.getMonth();
      const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      let cells = "";
      for (let i = 0; i < first; i++) cells += "<span></span>";
      for (let d = 1; d <= days; d++){
        const dt = new Date(y, m, d);
        const on = cur && +cur === +dt;
        cells += `<button type="button" class="ad-d${on ? " on" : ""}${+dt === +today ? " today" : ""}" data-d="${d}">${d}</button>`;
      }
      pop.innerHTML = `<div class="ad-cal-h"><button type="button" class="ad-nav" data-nav="-1" aria-label="Попередній місяць">‹</button><b>${MON[m]} ${y}</b><button type="button" class="ad-nav" data-nav="1" aria-label="Наступний місяць">›</button></div>
        <div class="ad-cal-w"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Нд</span></div>
        <div class="ad-cal-g">${cells}</div>
        <div class="ad-cal-q"><button type="button" data-q="0">Сьогодні</button><button type="button" data-q="1">Завтра</button><button type="button" data-q="7">Через тиждень</button></div>
        <div class="ad-cal-f"><button type="button" data-clear>Очистити</button></div>`;
    };
    const close = () => { pop.remove(); btn.classList.remove("open"); };
    pop.addEventListener("click", e => {
      const nav = e.target.closest("[data-nav]"); if (nav){ view = new Date(view.getFullYear(), view.getMonth() + +nav.dataset.nav, 1); render(); return; }
      const d = e.target.closest("[data-d]"); if (d){ set(new Date(view.getFullYear(), view.getMonth(), +d.dataset.d)); closePop(); btn.focus(); return; }
      const q = e.target.closest("[data-q]"); if (q){ const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + +q.dataset.q); set(t); closePop(); btn.focus(); return; }
      if (e.target.closest("[data-clear]")){ set(null); closePop(); btn.focus(); }
    });
    pop.addEventListener("keydown", e => { if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); closePop(); btn.focus(); } });
    document.body.appendChild(pop); render(); place(pop, btn, 280);
    btn.classList.add("open");
    openPop = { el: pop, btn, close };
    (pop.querySelector(".ad-d.on") || pop.querySelector(".ad-d.today") || pop.querySelector(".ad-d"))?.focus();
  }
  btn.addEventListener("click", () => openPop?.btn === btn ? closePop() : open());
}

// ─── Автоматичне підключення ────────────────────────────────────────────
function scan(root){
  if (!root.querySelectorAll) return;
  if (root.matches?.("select")) enhanceSelect(root);
  if (root.matches?.('input[type="date"]')) enhanceDate(root);
  root.querySelectorAll("select").forEach(enhanceSelect);
  root.querySelectorAll('input[type="date"]').forEach(enhanceDate);
}
scan(document);
new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && scan(n)))).observe(document.documentElement, { childList: true, subtree: true });

export { enhanceSelect, enhanceDate };

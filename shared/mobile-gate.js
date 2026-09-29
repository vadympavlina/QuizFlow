// ═══════════════════════════════════════════════════════════════════════
// shared/mobile-gate.js — плашка «Мобільна версія недоступна» для сторінок
// панелі викладача, у яких немає вбудованого #mobile-overlay (конструктор,
// гра наживо з боку вчителя, онбординг). Звичайний скрипт, підключається
// першим у <body>. Сторінки учнів (тест, гра) його не підключають.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  if (document.getElementById("mobile-overlay") || document.getElementById("qf-mgate")) return;
  var css = "#qf-mgate{display:none;position:fixed;inset:0;z-index:2147483000;flex-direction:column;align-items:center;justify-content:center;" +
    "padding:40px 24px;text-align:center;color:#fff;background:linear-gradient(160deg,#1a2b5e 0%,#0d1340 100%);font-family:'Manrope',system-ui,sans-serif}" +
    "#qf-mgate .i{width:80px;height:80px;border-radius:22px;display:flex;align-items:center;justify-content:center;margin-bottom:28px;" +
    "background:linear-gradient(135deg,#2d5be3,#4d78ff);box-shadow:0 20px 50px rgba(45,91,227,.4)}" +
    "#qf-mgate h2{font-weight:800;font-size:22px;line-height:1.3;margin:0 0 12px;max-width:320px}" +
    "#qf-mgate p{font-size:15px;opacity:.75;line-height:1.5;margin:0 0 28px;max-width:340px}" +
    "#qf-mgate .m{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);padding:10px 18px;border-radius:14px;font-size:13px;opacity:.65}" +
    "@media (max-width:1023px){#qf-mgate{display:flex}html.qf-mgate-on body{overflow:hidden}}";
  var st = document.createElement("style"); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  function mount() {
    if (document.getElementById("qf-mgate")) return;
    var el = document.createElement("div");
    el.id = "qf-mgate"; el.setAttribute("role", "alert");
    el.innerHTML =
      '<div class="i"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="3"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="17" x2="12" y2="17"/></svg></div>' +
      "<h2>Мобільна версія недоступна</h2>" +
      "<p>Панель викладача оптимізована для планшетів та комп'ютерів. Відкрийте з ширшого екрану</p>" +
      '<div class="m"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>Мінімальна ширина: 1024px</div>';
    document.body.appendChild(el);
  }
  var mq = window.matchMedia("(max-width:1023px)");
  function sync() { document.documentElement.classList.toggle("qf-mgate-on", mq.matches); }
  sync();
  if (mq.addEventListener) mq.addEventListener("change", sync);
  function start() {
    mount();
    // Сторінка може повністю перемалювати body (напр. екран помилки) — повертаємо плашку
    new MutationObserver(function () { if (!document.getElementById("qf-mgate")) mount(); }).observe(document.body, { childList: true });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();

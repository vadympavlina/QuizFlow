// ═══════════════════════════════════════════════════════════════════════
// admin/shared/admin-nav.js — бокова навігація адмінки
//
// Звичайний (не module) скрипт, який сторінка підключає прямо перед
// <div id="admin-root">. Малює меню синхронно (ім'я адміна — з кешу), ще до
// Firebase, тож під час переходів між сторінками меню не зникає.
// admin-shell.js після авторизації лише оновлює користувача й підсвітку.
// Стан «згорнуто» спільний з панеллю викладача (qf_sb_collapsed).
// ═══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  if (window.AdminNav) return;

  var COLLAPSED_KEY = "qf_sb_collapsed";
  var USER_KEY = "qf_admin_user";
  var root = document.documentElement;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var collapsed = lsGet(COLLAPSED_KEY) === "1";
  root.classList.add("has-asb", "asb-boot");
  root.classList.toggle("asb-c", collapsed);

  var ICONS = {
    overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    stats: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>',
    problems: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
    teachers: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2.6 2-4.8 4.5-5"/>',
    roles: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    news: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 9h6M7 13h6M7 17h4"/><path d="M17 8h3v9a2 2 0 0 1-2 2"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    audit: '<path d="M12 8v4l3 2"/><path d="M3.05 11a9 9 0 1 1 .5 4"/><polyline points="3 20 3 15 8 15"/>',
    invite: '<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    mail: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    ann: '<path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/>',
    menu: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d="M13 9h4M13 13h4"/>',
    ai: '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
    telegram: '<path d="M21.5 4.5L2.5 11.8l6.2 2.1 2.3 6.6 3.5-4.3 5 3.7z"/><path d="M8.7 13.9l9.8-7.4"/>',
    dashboard: '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    live: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  };
  function icon(id, sw) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[id] || "") + "</svg>";
  }

  // П'ять розділів у меню; сторінки розділу — вкладки під верхньою панеллю (admin-shell)
  var NAV = [
    { id: "overview", label: "Огляд", icon: "overview", pages: [
      { id: "overview", label: "Огляд", href: "overview" },
      { id: "stats", label: "Статистика", href: "stats" },
    ] },
    { id: "problems", label: "Проблеми", icon: "problems", badge: "admin-problems-badge", pages: [
      { id: "problems", label: "Проблеми", href: "problems" },
      { id: "audit", label: "Журнал дій", href: "audit" },
    ] },
    { id: "people", label: "Викладачі", icon: "teachers", pages: [
      { id: "teachers", label: "Список", title: "Викладачі", href: "teachers" },
      { id: "roles", label: "Ролі", href: "roles" },
      { id: "features", label: "Можливості", href: "features" },
      { id: "invites", label: "Запрошення", href: "invites" },
    ] },
    { id: "comms", label: "Комунікації", icon: "mail", pages: [
      { id: "announcements", label: "Оголошення", href: "announcements" },
      { id: "mail", label: "Розсилки", href: "mail" },
      { id: "news", label: "Новини", href: "news" },
    ] },
    { id: "settings", label: "Налаштування", icon: "gear", pages: [
      { id: "ai", label: "AI", title: "AI налаштування", href: "ai-settings" },
      { id: "telegram", label: "Telegram", href: "telegram" },
      { id: "navigation", label: "Навігація панелі", href: "navigation" },
      { id: "cleanup", label: "Обслуговування", href: "cleanup" },
    ] },
  ];
  function sectionOf(id) {
    for (var i = 0; i < NAV.length; i++) for (var j = 0; j < NAV[i].pages.length; j++) if (NAV[i].pages[j].id === id) return NAV[i];
    return null;
  }

  function readUser() { try { return JSON.parse(lsGet(USER_KEY) || "null") || {}; } catch (e) { return {}; } }
  var user = readUser();
  function fullName(u) { return [u.name, u.surname].filter(Boolean).join(" ") || u.email || "Адміністратор"; }
  function initials(u) {
    var n = (u.name || "").trim(), s = (u.surname || "").trim();
    if (n && s) return (n[0] + s[0]).toUpperCase();
    return (n || u.email || "A").slice(0, 2).toUpperCase();
  }
  function pageKey() {
    var seg = location.pathname.replace(/\/+$/, "").split("/").pop().replace(/\.html$/, "");
    return seg === "ai-settings" ? "ai" : seg;
  }

  function buildHtml() {
    var cur = sectionOf(pageKey());
    var sections = '<div class="asb-section">' + NAV.map(function (sec) {
      var on = cur && cur.id === sec.id;
      return '<a class="asb-item' + (on ? " on" : "") + '" data-id="' + sec.id + '" data-tip="' + esc(sec.label) + '" href="' + sec.pages[0].href + '"' + (on ? ' aria-current="page"' : "") + ">" +
        '<span class="asb-ico">' + icon(sec.icon) + "</span>" +
        '<span class="asb-lbl">' + esc(sec.label) + "</span>" +
        (sec.badge ? '<span class="asb-badge" id="' + sec.badge + '" hidden></span>' : "") +
        "</a>";
    }).join("") + "</div>";

    return '<aside class="asb' + (collapsed ? " collapsed" : "") + '" id="admin-sidebar" aria-label="Навігація адмінки">' +
      '<div class="asb-head">' +
        '<a class="asb-logo" href="overview" aria-label="QuizFlow Admin — огляд" data-tip="QuizFlow Admin">' +
          '<span class="asb-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h11a4 4 0 0 1 4 4v1"/><path d="M20 17H9a4 4 0 0 1-4-4v-1"/><circle cx="5" cy="7" r="1.3" fill="#fff"/><circle cx="19" cy="17" r="1.3" fill="#fff"/></svg></span>' +
          '<span class="asb-brand"><span class="asb-name">quiz<em>flow</em></span><span class="asb-tag">Admin</span></span>' +
        "</a>" +
      "</div>" +
      '<button type="button" id="asb-toggle" class="asb-toggle" onclick="AdminNav.toggle()" aria-controls="admin-sidebar" aria-expanded="' + (!collapsed) + '" aria-label="' + (collapsed ? "Розгорнути меню" : "Згорнути меню") + '" title="' + (collapsed ? "Розгорнути меню" : "Згорнути меню") + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>' +
      "</button>" +
      '<nav class="asb-scroll">' + sections + "</nav>" +
      '<div class="asb-bottom">' +
        '<div class="asb-strip">' +
          '<a class="asb-item asb-q" href="../" data-tip="Панель викладача" aria-label="Панель викладача"><span class="asb-ico">' + icon("dashboard") + "</span></a>" +
          '<a class="asb-item asb-q asb-q-live" href="../live" target="_blank" rel="noopener" data-tip="Live-моніторинг (нова вкладка)" aria-label="Live-моніторинг (нова вкладка)"><span class="asb-ico">' + icon("live") + "</span></a>" +
        "</div>" +
        '<div class="asb-user">' +
          '<div class="asb-ava" id="asb-ava" aria-hidden="true">' + esc(initials(user)) + "</div>" +
          '<div class="asb-texts"><div class="asb-uname" id="asb-uname">' + esc(fullName(user)) + '</div><div class="asb-urole">Адміністратор</div></div>' +
          '<button type="button" class="asb-logout" data-tip="Вийти" aria-label="Вийти" onclick="window.doLogout && window.doLogout()">' + icon("logout", 2) + "</button>" +
        "</div>" +
      "</div>" +
    "</aside>";
  }

  function mount() {
    var wrap = document.createElement("div");
    wrap.innerHTML = buildHtml();
    var sb = wrap.firstChild;
    var anchor = document.getElementById("admin-root") || document.currentScript;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sb, anchor);
    else document.body.insertBefore(sb, document.body.firstChild);
    var ov = document.createElement("div");
    ov.className = "asb-ov"; ov.setAttribute("aria-hidden", "true");
    sb.parentNode.insertBefore(ov, sb.nextSibling);
    return sb;
  }

  function setActive(id) {
    var sb = document.getElementById("admin-sidebar"), sec = sectionOf(id);
    if (!sb || !sec) return;
    var el = sb.querySelector('.asb-scroll .asb-item[data-id="' + sec.id + '"]');
    if (!el) return;
    sb.querySelectorAll(".asb-scroll .asb-item.on").forEach(function (a) { a.classList.remove("on"); a.removeAttribute("aria-current"); });
    el.classList.add("on"); el.setAttribute("aria-current", "page");
  }

  function setUser(u) {
    user = { name: u.name || "", surname: u.surname || "", email: u.email || "" };
    lsSet(USER_KEY, JSON.stringify(user));
    var n = document.getElementById("asb-uname"); if (n) n.textContent = fullName(user);
    var a = document.getElementById("asb-ava"); if (a) a.textContent = initials(user);
  }

  function setBadge(count) {
    var b = document.getElementById("admin-problems-badge");
    if (b) { b.textContent = count ? String(count) : ""; b.hidden = !count; }
    var t = document.getElementById("tb-bell-n");
    if (t) { t.textContent = count > 99 ? "99+" : String(count || ""); t.hidden = !count; }
    var tb = document.getElementById("tb-bell");
    if (tb) tb.setAttribute("aria-label", count ? "Нові проблеми: " + count : "Проблеми");
  }

  // Розділ, назва сторінки, іконка й вкладки розділу — для верхньої панелі (admin-shell)
  function info(id) {
    var sec = sectionOf(id);
    if (!sec) return null;
    var pg = sec.pages.filter(function (p) { return p.id === id; })[0];
    return { section: sec.label, label: pg.title || pg.label, icon: icon(sec.icon, 2),
      tabs: sec.pages.map(function (p) { return { id: p.id, label: p.label, href: p.href, on: p.id === id }; }) };
  }

  // ─── Телефон / планшет: меню висувається збоку ───
  var mq = window.matchMedia("(max-width:1023px)");
  function isDrawer() { return mq.matches; }
  function setOpen(o) {
    root.classList.toggle("asb-open", !!o);
    var b = document.getElementById("tb-menu");
    if (b) b.setAttribute("aria-expanded", String(!!o));
    if (o) {
      var f = document.querySelector("#admin-sidebar .asb-item.on") || document.querySelector("#admin-sidebar .asb-item");
      try { if (f) f.focus({ preventScroll: true }); } catch (e) {}
    }
  }
  document.addEventListener("click", function (e) {
    if (!root.classList.contains("asb-open") || !e.target.closest) return;
    if (e.target.closest(".asb-ov") || e.target.closest("#admin-sidebar a")) setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !root.classList.contains("asb-open")) return;
    e.stopPropagation(); setOpen(false);
    var b = document.getElementById("tb-menu"); if (b) b.focus();
  }, true);
  if (mq.addEventListener) mq.addEventListener("change", function () { setOpen(false); });

  function setCollapsed(c) {
    collapsed = !!c;
    root.classList.toggle("asb-c", collapsed);
    lsSet(COLLAPSED_KEY, collapsed ? "1" : "0");
    var sb = document.getElementById("admin-sidebar");
    if (sb) sb.classList.toggle("collapsed", collapsed);
    var t = document.getElementById("asb-toggle");
    if (t) {
      var label = collapsed ? "Розгорнути меню" : "Згорнути меню";
      t.setAttribute("aria-expanded", String(!collapsed));
      t.setAttribute("aria-label", label);
      t.title = label;
    }
    hideTip();
  }

  // ─── Плаваючі підказки (у згорнутому меню та для іконок-кнопок) ───
  var tipEl = null, tipFor = null;
  function tipNeeded(el) {
    if (!el || !el.getAttribute("data-tip") || isDrawer()) return false;
    return collapsed || !!el.closest(".asb-strip, .asb-logout");
  }
  function showTip(el) {
    if (!tipNeeded(el)) return;
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "asb-tip";
      tipEl.setAttribute("role", "tooltip");
      document.body.appendChild(tipEl);
    }
    tipFor = el;
    var badge = el.querySelector(".asb-badge:not([hidden])");
    tipEl.innerHTML = esc(el.getAttribute("data-tip")) + (collapsed && badge ? "<b>" + esc(badge.textContent) + "</b>" : "");
    var r = el.getBoundingClientRect();
    var sbr = document.getElementById("admin-sidebar").getBoundingClientRect();
    var up = !collapsed;
    tipEl.classList.toggle("up", up);
    if (up) { tipEl.style.left = (r.left + r.width / 2) + "px"; tipEl.style.top = (r.top - 8) + "px"; }
    else { tipEl.style.left = (sbr.right + 10) + "px"; tipEl.style.top = (r.top + r.height / 2) + "px"; }
    tipEl.classList.add("on");
  }
  function hideTip() { tipFor = null; if (tipEl) tipEl.classList.remove("on"); }
  document.addEventListener("mouseover", function (e) {
    var el = e.target.closest && e.target.closest("#admin-sidebar [data-tip]");
    if (el === tipFor) return;
    if (el) showTip(el); else hideTip();
  });
  document.addEventListener("focusin", function (e) {
    var el = e.target.closest && e.target.closest("#admin-sidebar [data-tip]");
    if (el) showTip(el); else hideTip();
  });
  document.addEventListener("scroll", hideTip, true);
  window.addEventListener("blur", hideTip);

  window.AdminNav = {
    setActive: setActive, setUser: setUser, setBadge: setBadge,
    setCollapsed: setCollapsed, toggle: function () { setCollapsed(!collapsed); },
    info: info, open: function () { setOpen(true); }, close: function () { setOpen(false); },
    ensure: function () { if (!document.getElementById("admin-sidebar")) mount(); },
  };

  function start() {
    if (!document.getElementById("admin-sidebar")) mount();
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove("asb-boot"); }); });
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();

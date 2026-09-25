// ═══════════════════════════════════════════════════════════════════════
// shared/nav.js — бокова навігація QuizFlow
//
// Звичайний (не module) скрипт, який сторінка підключає прямо перед
// <main class="main">. Він синхронно малює sidebar з кешу localStorage
// (конфіг навігації + дані користувача) ще до завантаження Firebase —
// тож під час переходу між сторінками меню не зникає і не «блимає».
// app.js потім лише звіряє конфіг з базою у фоні та оновлює користувача.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  if (window.QFNav) return;

  var NAV_CACHE_KEY = "qf_nav_cache";
  var USER_CACHE_KEY = "qf_user_cache";
  var COLLAPSED_KEY = "qf_sb_collapsed";
  var root = document.documentElement;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function readJson(k) { try { return JSON.parse(lsGet(k) || "null"); } catch (e) { return null; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Стан «згорнуто» ставимо на <html> до першого кадру — без стрибка ширини
  var collapsed = lsGet(COLLAPSED_KEY) === "1";
  root.classList.add("has-sb", "sb-boot");
  root.classList.toggle("sb-c", collapsed);

  var ICONS = {
    dashboard:  '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    home:       '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    files:      '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    clock:      '<path d="M12 3v3"/><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/>',
    link:       '<path d="M10 13a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1.5 1.5"/><path d="M14 11a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1.5-1.5"/>',
    "chart-bar":'<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>',
    book:       '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
    users:      '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2.6 2-4.8 4.5-5"/>',
    bell:       '<path d="M6 15V11a6 6 0 1112 0v4l1.5 3h-15z"/><path d="M10 20a2 2 0 004 0"/>',
    shield:     '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    live:       '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
    news:       '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 9h6M7 13h6M7 17h4"/><path d="M17 8h3v9a2 2 0 01-2 2"/>',
    analytics:  '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M3 20h18"/>',
    star:       '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    activity:   '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    settings:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    file:       '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    search:     '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    zap:        '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    graduation: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5"/>',
    user:       '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    target:     '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    refresh:    '<path d="M4 12a8 8 0 0113.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 01-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>',
    trending:   '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    inbox:      '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
    percent:    '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    award:      '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>',
    "chart-line":'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    pie:        '<path d="M21.21 15.89A10 10 0 118 2.83"/><path d="M22 12A10 10 0 0012 2v10z"/>',
    grid:       '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    key:        '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    lock:       '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    filter:     '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    edit:       '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    clipboard:  '<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    "arrow-r":  '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    external:   '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    alert:      '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
    logout:     '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    panel:      '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
    "menu":     '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    "chevron-r":  '<polyline points="9 18 15 12 9 6"/>',
    "user-plus":  '<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    "id-card":  '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.5"/><path d="M14 10h4M14 14h4"/>',
  };
  function icon(id, sw) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[id] || ICONS.file) + "</svg>";
  }

  // Типова навігація (та сама, що в admin/navigation) — поки конфіг з бази не закешовано
  var DEFAULT_NAV = [
    { label: "Головне", items: [
      { id: "dashboard", label: "Дашборд", file: "./", icon: "dashboard" },
      { id: "tests", label: "Тести", file: "tests", icon: "files" },
      { id: "attempts", label: "Спроби", file: "attempts", icon: "clock" },
      { id: "links", label: "Посилання", file: "links", icon: "link" },
    ] },
    { label: "Аналіз", items: [
      { id: "analytics", label: "Аналітика", file: "analytics", icon: "chart-bar" },
      { id: "gradebook", label: "Журнал", file: "gradebook", icon: "book" },
      { id: "students", label: "Студенти", file: "students", icon: "users" },
    ] },
    { label: "Активність", items: [
      { id: "notifications", label: "Сповіщення", file: "notifications", icon: "bell" },
      { id: "suspicious", label: "Підозрілі", file: "suspicious", icon: "shield" },
      { id: "online", label: "Онлайн", file: "online", icon: "live" },
      { id: "news", label: "Новини", file: "news", icon: "news" },
    ] },
  ];

  var BADGE_IDS = {
    tests: "nb-t", attempts: "nb-a", links: "nb-l",
    students: "nb-students", notifications: "nb-notif",
    suspicious: "nb-suspicious", online: "nb-online", news: "nb-news"
  };

  function cleanHref(f) {
    if (!f) return "#";
    if (f === "index.html" || f === "index" || f === "/") return "./";
    return f.replace(/\.html(?=$|[?#])/, "");
  }
  function isExternal(f) { return /^https?:\/\//.test(f || ""); }
  // "tests" / "./" — ключ поточної сторінки для підсвітки, коли data-page невідомий
  function pathKey(href) {
    var p = String(href || "").split(/[?#]/)[0].replace(/\/+$/, "");
    var seg = p.split("/").pop().replace(/\.html$/, "");
    return (!seg || seg === "." || seg === "index") ? "" : seg;
  }

  var state = {
    nav: null,           // масив секцій, з якого намальовано меню
    user: readJson(USER_CACHE_KEY) || {},
    active: null,
  };

  function visibleItems(sec, user) {
    var items = Array.isArray(sec.items) ? sec.items : [];
    return items.filter(function (it) {
      if (!it || it.enabled === false) return false;
      if (Array.isArray(it.roleIds) && it.roleIds.length > 0) {
        if (user.role === "admin") return true;
        var mine = user.customRoleIds || [];
        return it.roleIds.some(function (r) { return mine.indexOf(r) >= 0; });
      }
      return true;
    });
  }

  function initials(u) {
    var n = (u.name || "").trim(), s = (u.surname || "").trim();
    if (n && s) return (n[0] + s[0]).toUpperCase();
    return (n || u.login || u.email || "?").slice(0, 2).toUpperCase();
  }

  function buildHtml(nav, user) {
    var sections = "";
    nav.forEach(function (sec) {
      var items = visibleItems(sec, user);
      if (!items.length) return;
      sections += '<div class="sb-section">' +
        (sec.label ? '<div class="nav-sec"><span>' + esc(sec.label) + "</span></div>" : "") +
        items.map(function (it) {
          var ext = isExternal(it.file);
          var href = ext ? it.file : cleanHref(it.file);
          var badgeId = BADGE_IDS[it.id] || ("nb-" + it.id);
          return '<a class="ni" data-page="' + esc(it.id) + '" data-key="' + esc(ext ? "" : pathKey(href)) + '" data-tip="' + esc(it.label) +
            '" href="' + esc(href) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" +
            '<span class="sb-ico">' + icon(it.icon) + "</span>" +
            '<span class="ni-label">' + esc(it.label) + "</span>" +
            (ext ? '<span class="ni-ext">' + icon("external", 2) + "</span>" : "") +
            '<span class="nb" id="' + esc(badgeId) + '" hidden>0</span>' +
            "</a>";
        }).join("") +
        "</div>";
    });

    var isAdmin = user.role === "admin";
    var name = [user.name, user.surname].filter(Boolean).join(" ") || user.login || user.email || "Викладач";
    return '<aside class="sb' + (collapsed ? " collapsed" : "") + '" id="sidebar" aria-label="Головна навігація">' +
      '<div class="sb-head">' +
        '<a class="logo" href="./" aria-label="QuizFlow — на головну" data-tip="QuizFlow">' +
          '<span class="logo-i"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h11a4 4 0 0 1 4 4v1"/><path d="M20 17H9a4 4 0 0 1-4-4v-1"/><circle cx="5" cy="7" r="1.3" fill="#fff"/><circle cx="19" cy="17" r="1.3" fill="#fff"/></svg></span>' +
          '<span class="logo-t">quiz<em>flow</em></span>' +
        "</a>" +
      "</div>" +
      '<button type="button" id="sb-toggle" class="sb-toggle" onclick="toggleSidebar()" aria-controls="sidebar" aria-expanded="' + (!collapsed) + '" aria-label="' + (collapsed ? "Розгорнути меню" : "Згорнути меню") + '" title="' + (collapsed ? "Розгорнути меню" : "Згорнути меню") + '">' +
        '<svg id="sb-toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>' +
      "</button>" +
      '<nav class="sb-scroll">' + sections + "</nav>" +
      '<div class="sb-bottom">' +
        '<div class="sb-icon-strip">' +
          '<a href="live" target="_blank" rel="noopener" data-tip="Live-моніторинг (нова вкладка)" aria-label="Live-моніторинг (нова вкладка)" class="ni ni-live">' +
            '<span class="sb-ico">' + icon("zap") + '</span><span class="ni-label">Live</span></a>' +
          '<a href="/admin/overview" id="admin-panel-btn" target="_blank" rel="noopener" data-tip="Адмін-панель (нова вкладка)" aria-label="Адмін-панель (нова вкладка)" class="ni ni-admin"' + (isAdmin ? "" : " hidden") + ">" +
            '<span class="sb-ico">' + icon("shield") + '</span><span class="ni-label">Адмін</span></a>' +
          '<button type="button" class="ni ni-report" data-tip="Повідомити про помилку" aria-label="Повідомити про помилку" onclick="window.openBugReport && window.openBugReport()">' +
            '<span class="sb-ico">' + icon("alert") + '</span><span class="ni-label">Помилка</span></button>' +
        "</div>" +
        '<div class="sb-foot-inner">' +
          '<div class="ava" id="sb-ava" aria-hidden="true">' + esc(initials(user)) + "</div>" +
          '<div class="sb-texts">' +
            '<div class="sb-name" id="sb-teacher-name">' + esc(name) + "</div>" +
            '<div class="sb-role" id="sb-role">' + (isAdmin ? "Адміністратор" : "Викладач") + "</div>" +
          "</div>" +
          '<button type="button" onclick="doLogout()" data-tip="Вийти" aria-label="Вийти" class="sb-logout">' + icon("logout", 2) + "</button>" +
        "</div>" +
      "</div>" +
    "</aside>";
  }

  // Бейдж видно, лише коли в ньому є ненульове число (features.js пише лише textContent)
  function syncBadge(el) {
    var t = (el.textContent || "").trim();
    el.hidden = !t || t === "0";
  }
  var badgeObserver = null;
  function watchBadges(sb) {
    if (badgeObserver) badgeObserver.disconnect();
    if (!window.MutationObserver) return;
    badgeObserver = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        var el = m.target.nodeType === 3 ? m.target.parentNode : m.target;
        if (el && el.classList && el.classList.contains("nb")) syncBadge(el);
      });
    });
    sb.querySelectorAll(".nb").forEach(function (el) {
      badgeObserver.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  function setActive(page) {
    var sb = document.getElementById("sidebar");
    if (!sb) return;
    var el = page ? sb.querySelector('.ni[data-page="' + page.replace(/"/g, "") + '"]') : null;
    if (!el) {
      var key = pathKey(location.pathname);
      el = sb.querySelector('.sb-scroll .ni[data-key="' + key.replace(/"/g, "") + '"]');
    }
    sb.querySelectorAll(".ni.active").forEach(function (a) { a.classList.remove("active"); a.removeAttribute("aria-current"); });
    if (el) { el.classList.add("active"); el.setAttribute("aria-current", "page"); }
    if (page) state.active = page;
  }

  // Малює (або перемальовує) меню. Лічильники й скрол переносяться зі старого.
  function render(nav, opts) {
    opts = opts || {};
    nav = Array.isArray(nav) && nav.length ? nav : DEFAULT_NAV;
    state.nav = nav;
    var old = document.getElementById("sidebar");
    var badges = {}, scroll = 0;
    if (old) {
      old.querySelectorAll(".nb[id]").forEach(function (b) { badges[b.id] = b.textContent; });
      var sc = old.querySelector(".sb-scroll");
      if (sc) scroll = sc.scrollTop;
    }
    var wrap = document.createElement("div");
    wrap.innerHTML = buildHtml(nav, state.user);
    var sb = wrap.firstChild;
    Object.keys(badges).forEach(function (id) {
      var b = sb.querySelector("#" + CSS.escape(id));
      if (b) b.textContent = badges[id];
    });
    sb.querySelectorAll(".nb").forEach(syncBadge);
    if (old) old.replaceWith(sb);
    else if (opts.before) opts.before.parentNode.insertBefore(sb, opts.before);
    else {
      var main = document.querySelector(".main");
      if (main) main.parentNode.insertBefore(sb, main);
      else if (document.currentScript) document.currentScript.parentNode.insertBefore(sb, document.currentScript);
      else document.body.insertBefore(sb, document.body.firstChild);
    }
    var sc2 = sb.querySelector(".sb-scroll");
    if (sc2 && scroll) sc2.scrollTop = scroll;
    setActive(state.active);
    watchBadges(sb);
    return sb;
  }

  function roleSig(u) { return (u.role || "") + "|" + (u.customRoleIds || []).slice().sort().join(","); }

  // Дані користувача після авторизації: оновлюємо підвал і, якщо змінились ролі, пункти меню
  function setUser(u) {
    var next = {
      name: u.name || "", surname: u.surname || "", login: u.login || "", email: u.email || "",
      role: u.role || "teacher", customRoleIds: u.customRoleIds || [],
    };
    var changedRoles = roleSig(next) !== roleSig(state.user);
    state.user = next;
    lsSet(USER_CACHE_KEY, JSON.stringify(next));
    if (changedRoles || !document.getElementById("sidebar")) { render(state.nav); return; }
    var name = [next.name, next.surname].filter(Boolean).join(" ") || next.login || next.email || "Викладач";
    var n = document.getElementById("sb-teacher-name"); if (n) n.textContent = name;
    var a = document.getElementById("sb-ava"); if (a) a.textContent = initials(next);
    var r = document.getElementById("sb-role"); if (r) r.textContent = next.role === "admin" ? "Адміністратор" : "Викладач";
    var ab = document.getElementById("admin-panel-btn"); if (ab) ab.hidden = next.role !== "admin";
  }

  // Новий конфіг з бази — перемальовуємо, лише якщо він справді інший
  function setNav(nav) {
    if (!Array.isArray(nav) || !nav.length) return;
    if (JSON.stringify(nav) === JSON.stringify(state.nav)) return;
    render(nav);
  }

  function setCollapsed(c) {
    collapsed = !!c;
    root.classList.toggle("sb-c", collapsed);
    lsSet(COLLAPSED_KEY, collapsed ? "1" : "0");
    var sb = document.getElementById("sidebar");
    if (sb) sb.classList.toggle("collapsed", collapsed);
    var main = document.querySelector(".main");
    if (main) main.classList.toggle("sb-collapsed-main", collapsed);
    var t = document.getElementById("sb-toggle");
    if (t) {
      var label = collapsed ? "Розгорнути меню" : "Згорнути меню";
      t.setAttribute("aria-expanded", String(!collapsed));
      t.setAttribute("aria-label", label);
      t.title = label;
    }
    hideTip();
  }
  window.toggleSidebar = function () { setCollapsed(!collapsed); };

  // ─── Підказки: один плаваючий елемент у <body>, не обрізається скролом ───
  var tipEl = null, tipFor = null;
  function tipNeeded(el) {
    if (!el || !el.getAttribute("data-tip")) return false;
    if (collapsed) return true;
    // У розгорнутому меню підписи й так видно — підказки лише для іконок-кнопок
    return !!el.closest(".sb-icon-strip, .sb-logout");
  }
  function showTip(el) {
    if (!tipNeeded(el)) return;
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "sb-tip";
      tipEl.setAttribute("role", "tooltip");
      document.body.appendChild(tipEl);
    }
    tipFor = el;
    var badge = el.querySelector(".nb:not([hidden])");
    tipEl.innerHTML = esc(el.getAttribute("data-tip")) + (collapsed && badge ? '<b>' + esc(badge.textContent) + "</b>" : "");
    var r = el.getBoundingClientRect();
    var sbr = document.getElementById("sidebar").getBoundingClientRect();
    var inStrip = !collapsed && el.closest(".sb-icon-strip, .sb-logout");
    tipEl.classList.toggle("up", !!inStrip);
    if (inStrip) {
      tipEl.style.left = (r.left + r.width / 2) + "px";
      tipEl.style.top = (r.top - 8) + "px";
    } else {
      tipEl.style.left = (sbr.right + 10) + "px";
      tipEl.style.top = (r.top + r.height / 2) + "px";
    }
    tipEl.classList.add("on");
  }
  function hideTip() { tipFor = null; if (tipEl) tipEl.classList.remove("on"); }
  document.addEventListener("mouseover", function (e) {
    var el = e.target.closest && e.target.closest("#sidebar [data-tip]");
    if (el === tipFor) return;
    if (el) showTip(el); else hideTip();
  });
  document.addEventListener("focusin", function (e) {
    var el = e.target.closest && e.target.closest("#sidebar [data-tip]");
    if (el) showTip(el); else hideTip();
  });
  document.addEventListener("scroll", hideTip, true);
  window.addEventListener("blur", hideTip);

  // Перший кадр — без анімацій ширини (щоб згорнуте меню не «виїжджало»)
  function endBoot() {
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove("sb-boot"); }); });
  }

  window.QFNav = {
    render: render, setUser: setUser, setNav: setNav, setActive: setActive,
    setCollapsed: setCollapsed, isCollapsed: function () { return collapsed; },
    DEFAULT_NAV: DEFAULT_NAV,
  };

  // Синхронний старт: меню з кешу одразу, ще до Firebase
  if (document.body) {
    render(readJson(NAV_CACHE_KEY));
    endBoot();
  } else {
    document.addEventListener("DOMContentLoaded", function () { if (!document.getElementById("sidebar")) render(readJson(NAV_CACHE_KEY)); endBoot(); });
  }
})();

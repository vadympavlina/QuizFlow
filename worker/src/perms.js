// Копія shared/perms.js з quizflow-app (воркер не імпортує чужі репозиторії). Змінюйте там, потім копіюйте сюди.
// ═══════════════════════════════════════════════════════════════════════
// shared/perms.js — дозволи викладача. Чиста логіка без імпортів (її ж перевіряють юніт-тести).
//
// Роль = набір дозволів. Кожна сторінка, кнопка й функція питає один модуль («чи можна?»).
//
// Де що зберігається
//   (ключі дозволів у базі без крапки: tests.view → tests_view)
//   settings/features = { v:2, perms:{ ключ:false }, limits:{…}, roles:{ roleId:{ perms:{…}, limits:{…} } } }
//   users/{uid}       = { features:{ perms:{…}, limits:{…} }, readOnly:true, customRoleIds:{…} }
//
// Пріоритет: особисто (так чи ні) → ролі викладача (лише додають: дозволено, якщо дає хоч одна) → для всіх («Усі викладачі»).
// Якщо в базі ще старий формат (без v:2) — він читається «на льоту»: прапорці games/import/export
// і обмеження пунктів меню за ролями (navigation.roleIds) перетворюються на ті самі дозволи.
// Адміністратор (role === "admin") може все, режим «лише перегляд» його не стосується.
// ═══════════════════════════════════════════════════════════════════════

export const GROUPS = [
  { id: "tests", label: "Тести" },
  { id: "links", label: "Посилання та спроби" },
  { id: "games", label: "Ігри наживо" },
  { id: "analysis", label: "Аналіз" },
  { id: "other", label: "Інше" },
];

// write: дія змінює дані — у режимі «лише перегляд» вимикається
export const PERMS = {
  "tests.use":         { group: "tests", label: "Вибирати тест",           desc: "Бачити свої тести, щоб запускати з них ігри й посилання (без сторінки «Тести»)" },
  "tests.view":        { group: "tests", label: "Сторінка «Тести»",        desc: "Бібліотека тестів і папки" },
  "tests.edit":        { group: "tests", label: "Створювати й редагувати", desc: "Новий тест, конструктор, копії, папки, видалення", write: true },
  "tests.import":      { group: "tests", label: "Імпорт з Excel і CSV",    desc: "Завантаження питань у конструкторі", write: true },
  "tests.share":       { group: "tests", label: "Ділитися з колегами",     desc: "Надсилати копію тесту іншому викладачу", write: true },
  "links.view":        { group: "links", label: "Сторінка «Посилання»",    desc: "Список посилань для студентів" },
  "links.manage":      { group: "links", label: "Створювати посилання",    desc: "Нові посилання, відкриття й закриття", write: true },
  "attempts.view":     { group: "links", label: "Сторінка «Спроби»",       desc: "Результати студентів" },
  "attempts.review":   { group: "links", label: "Перевіряти роботи",       desc: "Оцінювати відкриті відповіді, видаляти спроби", write: true },
  "games.run":         { group: "games", label: "Проводити ігри",          desc: "Запуск гри з телефонами учнів", write: true },
  "games.history":     { group: "games", label: "Історія ігор",            desc: "Результати проведених ігор" },
  "students.view":     { group: "analysis", label: "Студенти",             desc: "Картки студентів" },
  "gradebook.view":    { group: "analysis", label: "Журнал",               desc: "Оцінки за групами" },
  "analytics.view":    { group: "analysis", label: "Аналітика",            desc: "Статистика за тестами" },
  "suspicious.view":   { group: "analysis", label: "Підозрілі",            desc: "Спроби з ознаками списування" },
  "online.view":       { group: "other", label: "Онлайн і Live-моніторинг", desc: "Хто зараз проходить тест" },
  "notifications.view":{ group: "other", label: "Сповіщення",              desc: "Стрічка подій" },
  "news.view":         { group: "other", label: "Новини",                  desc: "Новини сервісу" },
  "export":            { group: "other", label: "Експорт результатів",     desc: "CSV і звіти" },
  "ai":                { group: "other", label: "AI-функції",              desc: "Генерація питань, коментарі, перевірка відповідей", write: true },
};
export const PERM_KEYS = Object.keys(PERMS);

// У базі ключ не може містити крапку, тож «tests.view» зберігається як «tests_view».
// Читання приймає обидва записи, запис завжди у вигляді без крапки.
export const storeKey = k => String(k).replace(/\./g, "_");
const FROM_STORE = Object.fromEntries(PERM_KEYS.map(k => [storeKey(k), k]));
export const permFromStore = k => PERMS[k] ? k : FROM_STORE[k] || null;
export const encodePerms = map => Object.fromEntries(Object.entries(map || {}).filter(([k]) => PERMS[k] || FROM_STORE[k]).map(([k, v]) => [storeKey(k), v]));
export const WRITE_KEYS = PERM_KEYS.filter(k => PERMS[k].write);

// Вмикаючи ключ, автоматично вмикаємо залежності («редагувати» без «бачити» не має сенсу)
export const IMPLIES = {
  "tests.view":      ["tests.use"],
  "tests.edit":      ["tests.view"],
  "tests.import":    ["tests.edit"],
  "tests.share":     ["tests.view"],
  "links.manage":    ["links.view", "tests.use"],
  "attempts.review": ["attempts.view"],
  "games.run":       ["tests.use"],
};

// Сторінка → дозвіл (id пункту меню або службової сторінки)
export const PAGE_PERMS = {
  tests: "tests.view", constructor: "tests.edit", links: "links.view", attempts: "attempts.view",
  history: "games.history", students: "students.view", gradebook: "gradebook.view",
  analytics: "analytics.view", suspicious: "suspicious.view", online: "online.view",
  notifications: "notifications.view", news: "news.view",
  "live-setup": "games.run", "live-game": "games.run", "live-monitor": "online.view",
};

// Пункт меню має довільний id, тож дозвіл шукаємо ще й за файлом сторінки (game-history → history)
const FILE_ALIASES = { "game-history": "history" };
export const pagePerm = it => {
  if (!it) return null;
  if (PAGE_PERMS[it.id]) return PAGE_PERMS[it.id];
  const f = String(it.file || "").split(/[?#]/)[0].replace(/^\.?\//, "").replace(/\.html$/, "");
  return PAGE_PERMS[FILE_ALIASES[f] || f] || null;
};

// Старі прапорці з «Можливостей»
export const LEGACY_FLAG_PERM = { games: "games.run", import: "tests.import", export: "export" };

const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const bool = v => typeof v === "boolean";
const roleIdsOf = p => {
  const v = p?.customRoleIds;
  if (Array.isArray(v)) return v;
  const ids = isObj(v) ? Object.keys(v).filter(k => v[k]) : [];
  return p?.customRoleId && !ids.includes(p.customRoleId) ? ids.concat(p.customRoleId) : ids;
};

// Шар налаштувань → мапа {ключ:boolean}; старі прапорці — лише там, де нового ключа немає
export function layerPerms(layer) {
  const out = {};
  if (!isObj(layer)) return out;
  Object.entries(layer.flags || {}).forEach(([f, v]) => { const k = LEGACY_FLAG_PERM[f]; if (k && bool(v)) out[k] = v; });
  Object.entries(layer.perms || {}).forEach(([k, v]) => { const key = permFromStore(k); if (key && bool(v)) out[key] = v; });
  return out;
}

// Конфіг (settings/features) у новому вигляді. Старий формат (без v:2) добудовується з navigation.
export function normalizeCfg(cfg, nav) {
  const c = isObj(cfg) ? cfg : {};
  const out = { v: 2, perms: layerPerms(c), limits: c.limits || {}, roles: {} };
  Object.entries(c.roles || {}).forEach(([rid, r]) => { out.roles[rid] = { perms: layerPerms(r), limits: r?.limits || {} }; });
  if (c.v === 2) return out;
  // Пункт меню, обмежений ролями: для всіх вимкнено, обраним ролям увімкнено
  const sections = Array.isArray(nav) ? nav : isObj(nav) ? Object.values(nav) : [];
  sections.forEach(sec => {
    const items = Array.isArray(sec?.items) ? sec.items : isObj(sec?.items) ? Object.values(sec.items) : [];
    items.forEach(it => {
      const key = it && !it.protected && pagePerm(it);
      const rids = Array.isArray(it?.roleIds) ? it.roleIds : isObj(it?.roleIds) ? Object.keys(it.roleIds) : [];
      if (!key || !rids.length || key === "tests.edit") return;
      out.perms[key] = false;
      rids.forEach(rid => { (out.roles[rid] ||= { perms: {}, limits: {} }).perms[key] = true; });
    });
  });
  return out;
}

// Підсумкові дозволи користувача: { perms:{ключ:bool}, src:{ключ:"user"|"role"|"all"|"implied"|"admin"|"readonly"}, admin, readOnly }
export function resolvePerms(cfg, profile = {}, nav) {
  const c = normalizeCfg(cfg, nav);
  const admin = profile.role === "admin";
  const readOnly = !admin && profile.readOnly === true;
  const own = layerPerms(profile.features);
  const roles = roleIdsOf(profile).map(r => c.roles[r]).filter(Boolean);
  const perms = {}, src = {};
  PERM_KEYS.forEach(k => {
    if (bool(own[k])) { perms[k] = own[k]; src[k] = "user"; return; }
    // Ролі лише додають: дозволено, якщо це дає хоч одна роль. Старе «Ні» в ролі більше нічого не забороняє.
    if (roles.some(r => r.perms[k] === true)) { perms[k] = true; src[k] = "role"; return; }
    perms[k] = c.perms[k] !== false; src[k] = "all";
  });
  // Залежності вмикаємо лише від явно виданих дозволів (особистих чи від ролі), а не від «за замовчуванням»:
  // інакше закритій для всіх сторінці вистачило б типового «редагувати», щоб відкритися знову.
  // Вимкнене особисто («Ні») не відновлюємо.
  for (let changed = true; changed;) {
    changed = false;
    PERM_KEYS.forEach(k => {
      if (!perms[k] || src[k] === "all") return;
      (IMPLIES[k] || []).forEach(d => { if (!perms[d] && own[d] !== false) { perms[d] = true; src[d] = "implied"; changed = true; } });
    });
  }
  // Типове («для всіх») право не працює без того, від чого воно залежить: закрили сторінку «Тести» —
  // «створювати тести» теж вимкнено. Явно видане право цього не потребує, бо саме вмикає залежності.
  for (let changed = true; changed;) {
    changed = false;
    PERM_KEYS.forEach(k => {
      if (perms[k] && src[k] === "all" && (IMPLIES[k] || []).some(d => !perms[d])) { perms[k] = false; src[k] = "implied-off"; changed = true; }
    });
  }
  if (admin) PERM_KEYS.forEach(k => { perms[k] = true; src[k] = "admin"; });
  else if (readOnly) WRITE_KEYS.forEach(k => { if (perms[k]) { perms[k] = false; src[k] = "readonly"; } });
  return { perms, src, admin, readOnly };
}

// Чи відкривається сторінка (id пункту меню). Невідома сторінка — відкрита.
export const pageAllowed = (perms, page) => { const k = PAGE_PERMS[page]; return !k || !perms || perms[k] !== false; };

// Попередження про суперечності в налаштуваннях набору дозволів (для адмінки)
export function conflicts(perms) {
  const out = [];
  if (perms["games.run"] && !perms["tests.use"]) out.push("Ігри без доступу до тестів: нема з чого запускати гру");
  if (perms["links.manage"] && !perms["tests.use"]) out.push("Посилання без доступу до тестів: нема що відкривати студентам");
  if (perms["tests.edit"] && !perms["tests.view"]) out.push("Редагування тестів без сторінки «Тести»");
  if (perms["attempts.review"] && !perms["attempts.view"]) out.push("Перевірка робіт без сторінки «Спроби»");
  if (perms["export"] && !["attempts.view", "gradebook.view", "games.history"].some(k => perms[k])) out.push("Експорт без жодної сторінки з результатами");
  return out;
}

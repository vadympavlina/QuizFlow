// ═══════════════════════════════════════════════════════════════════════
// shared/qorder.js — питання спроби без повної копії тесту в кожній спробі
//
// Раніше кожна спроба зберігала questionsSnapshot — усі питання тесту. 30
// студентів = 30 копій, і панель викладача завантажувала їх усі. Тепер набір
// питань зберігається один раз: teachers/{uid}/qVersions/{sha}, де ключ —
// SHA-256 від самих питань (його неможливо підробити під чужий вміст). Спроба
// тримає лише ключ версії й порядок, у якому студент бачив питання та варіанти.
// ═══════════════════════════════════════════════════════════════════════

// Стабільний JSON: ключі за алфавітом, порожнє (null, [], {}) відкидається —
// так само, як його відкидає сама база. Однаковий результат і в студента, і в панелі.
export function canon(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    if (!v.length) return undefined;
    return "[" + v.map(x => canon(x) ?? "null").join(",") + "]";
  }
  if (typeof v === "object") {
    const parts = Object.keys(v).sort().map(k => { const c = canon(v[k]); return c === undefined ? null : JSON.stringify(k) + ":" + c; }).filter(Boolean);
    return parts.length ? "{" + parts.join(",") + "}" : undefined;
  }
  return JSON.stringify(v);
}

// Ключ версії: перші 32 hex-символи SHA-256. null — якщо браузер не вміє (http без TLS).
export async function qVersionKey(questions) {
  try {
    if (!crypto?.subtle) return null;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon(questions) || ""));
    return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

const toArr = (v) => Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : v == null ? [] : [v];

// Детермінований генератор (для стабільного перемішування після перезавантаження)
export function seededRandom(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (const ch of String(seedStr)) { h = Math.imul(h ^ ch.codePointAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
export function shuffledIdx(n, rnd = Math.random) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Порядок для спроби: qOrder — індекси питань у показаному порядку,
// optOrder — { "q<індекс питання>": [оригінальний індекс варіанта на кожній позиції] }.
// Ключі з літерою: інакше база перетворила б об'єкт з числовими ключами на масив із дірками.
export function makeOrder(questions, { shuffleQ = false, shuffleA = false } = {}, rnd = Math.random) {
  const out = {};
  if (shuffleQ && questions.length > 1) out.qOrder = shuffledIdx(questions.length, rnd);
  if (shuffleA) {
    const oo = {};
    questions.forEach((q, i) => {
      if ((q.type === "single" || q.type === "multi") && toArr(q.options).length > 1) oo["q" + i] = shuffledIdx(toArr(q.options).length, rnd);
    });
    if (Object.keys(oo).length) out.optOrder = oo;
  }
  return out;
}

// Питання так, як їх бачив студент: у його порядку, з переставленими варіантами
// і перерахованими індексами правильних відповідей.
export function buildQuestions(base, qOrder, optOrder) {
  const qs = toArr(base);
  const order = toArr(qOrder).map(Number);
  const idx = order.length === qs.length && order.every(i => Number.isInteger(i) && qs[i]) ? order : qs.map((_, i) => i);
  return idx.map(i => {
    const q = qs[i];
    const perm = toArr(optOrder?.["q" + i]).map(Number);
    const opts = toArr(q?.options);
    if (!perm.length || perm.length !== opts.length) return q;
    const correct = toArr(q.correct).map(Number).map(c => perm.indexOf(c)).filter(x => x >= 0).sort((a, b) => a - b);
    return { ...q, options: perm.map(o => opts[o]), correct };
  });
}

// Текст питання — HTML з конструктора. Конструктор очищає його при збереженні,
// але тести з імпорту або старих версій могли зберегтися без очищення.
const RICH_OK = new Set(["B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI", "CODE", "PRE", "MARK", "SMALL", "IMG"]);
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/i;
const escT = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function richHtml(html) {
  const src = String(html ?? "");
  if (!/[<&]/.test(src)) return escT(src).replace(/\r?\n/g, "<br>");
  const doc = new DOMParser().parseFromString(`<div>${src}</div>`, "text/html");
  const walk = (from, to) => {
    for (const n of [...from.childNodes]) {
      if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.textContent)); continue; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|TEMPLATE|FORM|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(n.tagName)) continue;
      if (!RICH_OK.has(n.tagName)) { walk(n, to); continue; }
      const el = document.createElement(n.tagName);
      if (n.tagName === "IMG") {
        const s = n.getAttribute("src") || "";
        if (!/^(https:\/\/|data:image\/(png|jpe?g|gif|webp);)/i.test(s)) continue;
        el.src = s; el.alt = n.getAttribute("alt") || ""; el.loading = "lazy";
      }
      const col = (n.style?.color || "").trim();
      if (col && COLOR_RE.test(col)) el.style.color = col;
      walk(n, el);
      to.appendChild(el);
    }
  };
  const out = document.createElement("div");
  walk(doc.body.firstChild, out);
  return out.innerHTML;
}
// Лише текст (для списків і підказок). DOMParser — інертний документ, картинки не вантажаться.
export const plainText = (html) => new DOMParser().parseFromString(String(html ?? ""), "text/html").body.textContent.replace(/\s+/g, " ").trim();

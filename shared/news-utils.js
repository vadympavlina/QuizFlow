// ═══════════════════════════════════════════════════════════════════════
// shared/news-utils.js — спільне для новин (admin/news і панель викладача)
//
// Текст новини — HTML з редактора. Перед збереженням і перед показом його
// очищаємо білим списком тегів: жодних скриптів, обробників подій, стилів.
// DOMParser не виконує скрипти й не завантажує зображення, тож розбір безпечний.
// ═══════════════════════════════════════════════════════════════════════

export const NEWS_CATS = {
  update:    { label: "Оновлення",     color: "#2563EB", bg: "#DBEAFE" },
  feature:   { label: "Нова функція",  color: "#7C3AED", bg: "#EDE9FE" },
  important: { label: "Важливо",       color: "#DC2626", bg: "#FEE2E2" },
  tip:       { label: "Порада",        color: "#059669", bg: "#D1FAE5" },
};
export const catOf = n => NEWS_CATS[n?.category] || null;

const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "S", "H3", "P", "BR", "UL", "OL", "LI", "A", "BLOCKQUOTE"]);
const RENAME = { H1: "H3", H2: "H3", H4: "H3", DIV: "P", DEL: "S", STRIKE: "S" };

export function sanitizeNewsHtml(html){
  const src = String(html || "");
  // Старі новини без тегів — звичайний текст з переносами рядків
  if (!/[<>]/.test(src)) return src.split(/\n{2,}/).map(p => p.trim() ? `<p>${escHtml(p).replace(/\n/g, "<br>")}</p>` : "").join("");
  const doc = new DOMParser().parseFromString(`<div>${src}</div>`, "text/html");
  const out = document.createElement("div");
  const walk = (from, to) => {
    from.childNodes.forEach(n => {
      if (n.nodeType === 3){ to.appendChild(document.createTextNode(n.textContent)); return; }
      if (n.nodeType !== 1) return;
      const tag = RENAME[n.tagName] || n.tagName;
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE", "NOSCRIPT", "META", "LINK"].includes(n.tagName)) return;
      if (!ALLOWED.has(tag)){ walk(n, to); return; }          // невідомий тег — лишаємо лише вміст
      const el = document.createElement(tag);
      if (tag === "A"){
        const href = (n.getAttribute("href") || "").trim();
        if (!/^(https?:|mailto:)/i.test(href)){ walk(n, to); return; }
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      walk(n, el);
      if (tag !== "BR" && !el.textContent.trim() && !el.querySelector("br")) return; // порожні блоки
      to.appendChild(el);
    });
  };
  walk(doc.body.firstChild, out);
  return out.innerHTML.replace(/(<br>\s*){3,}/g, "<br><br>").trim();
}

export function newsPlainText(html){
  const src = String(html || "");
  if (!/[<>]/.test(src)) return src.trim();
  const doc = new DOMParser().parseFromString(`<div>${src.replace(/<\/(p|h3|li|blockquote)>|<br\s*\/?>/gi, "$& ")}</div>`, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

export const newsExcerpt = (n, max = 160) => {
  const t = newsPlainText(n?.text);
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
};

// ≈ 180 слів за хвилину
export const readMinutes = html => Math.max(1, Math.round(newsPlainText(html).split(/\s+/).filter(Boolean).length / 180));

export const isPublished = n => n && n.draft !== true;

function escHtml(s){ return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

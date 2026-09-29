// Шаблони листів. Пошта не розуміє зовнішніх CSS і SVG, тож тільки таблиці
// й inline-стилі; шрифт Manrope з запасними системними (більшість клієнтів
// веб-шрифти не вантажить). Без емодзі — як і весь інтерфейс QuizFlow.

export const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FONT = "Manrope,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const C = { ink: "#0F172A", text: "#334155", muted: "#64748B", line: "#E2E8F0", bg: "#F1F4FA", brand: "#4F46E5", brand2: "#7C3AED" };

// Інлайн-розмітка тексту, який пише адмін: **жирний**, посилання http(s)
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink}">$1</strong>`)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, `<a href="$1" style="color:${C.brand};font-weight:700;text-decoration:none">$1</a>`);
}

// Простий формат тексту розсилки:
//   порожній рядок — новий абзац; «## » — підзаголовок; «- » — пункт списку
export function renderBody(text) {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    // У межах абзацу рядки групуються: підзаголовок, список, звичайний текст
    let para = [], list = [];
    const flushP = () => { if (para.length) out.push(`<p style="margin:0 0 16px">${para.map(inline).join("<br>")}</p>`); para = []; };
    const flushL = () => { if (list.length) out.push(`<ul style="margin:0 0 16px;padding-left:20px">${list.map(l => `<li style="margin:0 0 6px">${inline(l)}</li>`).join("")}</ul>`); list = []; };
    for (const l of b.split("\n")) {
      if (/^##\s+/.test(l)) { flushP(); flushL(); out.push(`<h2 style="margin:24px 0 10px;font-size:17px;line-height:1.35;color:${C.ink};font-weight:800">${inline(l.replace(/^##\s+/, ""))}</h2>`); }
      else if (/^\s*[-•]\s+/.test(l)) { flushP(); list.push(l.replace(/^\s*[-•]\s+/, "")); }
      else { flushL(); para.push(l); }
    }
    flushP(); flushL();
  }
  return out.join("");
}

export function plainBody(text) {
  return String(text || "").replace(/\r/g, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^##\s+/gm, "").trim();
}

export function layout({ preheader = "", title = "", bodyHtml = "", button = null, footer = "" }) {
  const btn = button?.url ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:12px;background:${C.brand}">
      <a href="${esc(button.url)}" style="display:inline-block;padding:13px 24px;font:800 15px ${FONT};color:#ffffff;text-decoration:none;border-radius:12px">${esc(button.label || "Відкрити")}</a>
    </td></tr></table>` : "";
  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title || "QuizFlow")}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 4px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:30px;height:30px;border-radius:9px;background:${C.brand};background-image:linear-gradient(135deg,${C.brand},${C.brand2})"></td>
        <td style="padding-left:10px;font:800 18px ${FONT};color:${C.ink};letter-spacing:-.2px">QuizFlow</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${C.line};border-radius:18px;padding:32px 32px 12px;font:400 15px/1.65 ${FONT};color:${C.text}">
      ${title ? `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${C.ink};font-weight:800;letter-spacing:-.3px">${esc(title)}</h1>` : ""}
      ${bodyHtml}
      ${btn}
    </td></tr>
    <tr><td style="padding:18px 8px 0;font:400 12px/1.6 ${FONT};color:${C.muted};text-align:center">
      ${footer}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// ─── Запрошення викладача ───────────────────────────────────────────────
export function inviteEmail({ link, name, fromName, expiresAt, message }) {
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kyiv" }) : "";
  const hello = name ? `Вітаємо, ${name}!` : "Вітаємо!";
  const lead = `${fromName ? `${fromName} запрошує вас` : "Вас запрошено"} приєднатися до QuizFlow — платформи для тестів, журналу оцінок та ігор наживо зі студентами.`;
  const bodyHtml = `
    <p style="margin:0 0 16px">${esc(lead)}</p>
    ${message ? `<p style="margin:0 0 16px;padding:12px 14px;border-left:3px solid ${C.brand};background:#F5F3FF;border-radius:0 10px 10px 0;color:${C.ink}">${esc(message).replace(/\n/g, "<br>")}</p>` : ""}
    <p style="margin:0 0 20px">Щоб створити акаунт, перейдіть за посиланням і заповніть коротку форму.</p>`;
  const tail = `Посилання одноразове${until ? ` і діє до ${esc(until)}` : ""}. Якщо кнопка не працює, скопіюйте адресу в браузер:<br><a href="${esc(link)}" style="color:${C.brand};word-break:break-all">${esc(link)}</a>`;
  return {
    subject: "Запрошення до QuizFlow",
    html: layout({
      preheader: "Створіть акаунт викладача в QuizFlow",
      title: hello,
      bodyHtml: bodyHtml,
      button: { label: "Створити акаунт", url: link },
      footer: `${tail}<br><br>Ви отримали цей лист, бо адміністратор QuizFlow надіслав вам запрошення. Якщо ви його не чекали — просто проігноруйте.`,
    }),
    text: `${hello}\n\n${lead}\n\n${message ? message + "\n\n" : ""}Створити акаунт: ${link}\n\nПосилання одноразове${until ? ` і діє до ${until}` : ""}.\n\nQuizFlow`,
  };
}

// ─── Розсилка ───────────────────────────────────────────────────────────
export function broadcastEmail({ subject, body, button, name, unsubUrl }) {
  const hello = name ? `Вітаємо, ${name}!` : "";
  return {
    subject,
    html: layout({
      preheader: plainBody(body).slice(0, 120),
      title: subject,
      bodyHtml: (hello ? `<p style="margin:0 0 16px">${esc(hello)}</p>` : "") + renderBody(body),
      button,
      footer: `Ви отримали цей лист як користувач QuizFlow.${unsubUrl ? `<br><a href="${esc(unsubUrl)}" style="color:${C.muted};text-decoration:underline">Відписатися від розсилок</a>` : ""}`,
    }),
    text: `${hello ? hello + "\n\n" : ""}${plainBody(body)}${button?.url ? `\n\n${button.label || "Відкрити"}: ${button.url}` : ""}${unsubUrl ? `\n\n—\nВідписатися від розсилок: ${unsubUrl}` : ""}`,
  };
}

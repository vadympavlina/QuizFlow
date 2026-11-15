// Шаблони листів — «чистий мінімал»: біла картка із заокругленими кутами на світло-сірому тлі,
// логотип зліва, великий заголовок, один яскравий блок дії і підпис команди. Без картинок-талісманів:
// лист виглядає добре й тоді, коли пошта блокує зображення. Пошта не розуміє
// зовнішніх CSS і SVG, тож лише таблиці, inline-стилі й PNG-логотип із сайту
// (assets/email). Шрифт Manrope із запасними системними. Без емодзі.

export const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FONT = "Manrope,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const C = { ink: "#0D1340", text: "#2B3552", muted: "#6B7593", faint: "#7A84A3", line: "#E2E7F3", brand: "#2D5BE3", bg: "#EEF1F9", tint: "#F4F6FC", amber: "#E5A100" };
const DEFAULT_SITE = "https://app.quizflow.space";
// Логотип віддає сам воркер (/logo.png, див. index.js): поштові проксі можуть не
// отримати картинку з домену сайту. Версія в адресі — бо Gmail кешує картинки
// (разом з помилками); після зміни логотипа підніміть номер.
export const LOGO_V = 3;

// Інлайн-розмітка тексту, який пише адмін: **жирний**, посилання http(s)
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink}">$1</strong>`)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, `<a href="$1" style="color:${C.brand};text-decoration:underline">$1</a>`);
}

// Простий формат тексту розсилки:
//   порожній рядок — новий абзац; «## » — підзаголовок; «- » — пункт списку
export function renderBody(text) {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    // У межах абзацу рядки групуються: підзаголовок, список, звичайний текст
    let para = [], list = [];
    const flushP = () => { if (para.length) out.push(`<p style="margin:0 0 18px">${para.map(inline).join("<br>")}</p>`); para = []; };
    const flushL = () => { if (list.length) out.push(`<ul style="margin:0 0 18px;padding-left:22px">${list.map(l => `<li style="margin:0 0 8px">${inline(l)}</li>`).join("")}</ul>`); list = []; };
    for (const l of b.split("\n")) {
      if (/^##\s+/.test(l)) { flushP(); flushL(); out.push(`<h2 style="margin:28px 0 10px;font:800 19px/1.35 ${FONT};color:${C.ink};letter-spacing:-.2px">${inline(l.replace(/^##\s+/, ""))}</h2>`); }
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

function button({ label, url }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="qf-btn" style="margin:8px 0 6px"><tr><td style="border-radius:10px;background:${C.brand}">
      <a href="${esc(url)}" style="display:inline-block;padding:14px 28px;font:800 15px ${FONT};color:#ffffff;text-decoration:none;border-radius:10px">${esc(label || "Відкрити")}</a>
    </td></tr></table>`;
}

export function layout({ site = DEFAULT_SITE, logoUrl = "", preheader = "", title = "", bodyHtml = "", button: btn = null, after = "", footer = "" }) {
  const logo = logoUrl || `${String(site || DEFAULT_SITE).replace(/\/+$/, "")}/assets/email/logo-light.png?v=${LOGO_V}`;
  // Gmail ховає під «•••» блоки, однакові з попередніми листами ланки (підпис, футер).
  // Невидимий унікальний маркер робить кожен лист відмінним
  const uniq = `<span style="display:none!important;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}</span>`;
  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(title || "QuizFlow")}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&display=swap" rel="stylesheet">
<style>
  @media (max-width:600px){ .qf-out{padding:16px 10px 20px!important} .qf-pad{padding:26px 22px!important} .qf-h1{font-size:25px!important} .qf-btn, .qf-btn a{display:block!important;width:100%!important;text-align:center!important;box-sizing:border-box} }
</style></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td class="qf-out" align="center" style="padding:36px 12px 32px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
    <tr><td class="qf-pad" style="background:#ffffff;border:1px solid ${C.line};border-radius:16px;padding:38px 40px;font:400 16px/1.7 ${FONT};color:${C.text}">
      <a href="${esc(site)}" style="text-decoration:none"><img src="${esc(logo)}" width="125" height="36" alt="QuizFlow" style="display:block;border:0;margin:0 0 30px;font:800 20px ${FONT};color:${C.ink}"></a>
      ${title ? `<h1 class="qf-h1" style="margin:0 0 20px;font:800 28px/1.2 ${FONT};color:${C.ink};letter-spacing:-.5px">${esc(title)}</h1>` : ""}
      ${bodyHtml}
      ${btn?.url ? button(btn) : ""}
      ${after}
      <p style="margin:28px 0 0">${uniq}З повагою,<br><strong style="color:${C.ink}">Команда QuizFlow</strong></p>
    </td></tr>
    <tr><td align="center" style="padding:18px 20px 0;font:400 12.5px/1.6 ${FONT};color:${C.faint};text-align:center">${uniq}${footer}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// ─── Запрошення викладача ───────────────────────────────────────────────
const FEATURES = [
  ["Тести й опитування", "конструктор із 7 типами питань, AI-перевірка розгорнутих відповідей"],
  ["Журнал і аналітика", "оцінки за 12-бальною шкалою, звіти по групах і студентах"],
  ["Ігри наживо", "вікторини на уроці з телефонів студентів"],
];
export function inviteEmail({ link, name, fromName, expiresAt, message, site, logoUrl }) {
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kyiv" }) : "";
  const hello = name ? `Вітаємо, ${name}!` : "Вітаємо!";
  const lead = `${fromName ? `${fromName} запрошує вас` : "Вас запрошено"} приєднатися до QuizFlow — платформи для тестів, журналу оцінок та ігор наживо зі студентами.`;
  const note = `Посилання одноразове${until ? ` і діє до ${until}` : ""}.`;
  const bodyHtml = `
    <p style="margin:0 0 18px">${esc(hello)}</p>
    <p style="margin:0 0 18px">${esc(lead)}</p>
    ${message ? `<p style="margin:0 0 18px;padding:2px 0 2px 16px;border-left:3px solid ${C.brand};color:${C.ink}">${esc(message).replace(/\n/g, "<br>")}</p>` : ""}
    <p style="margin:0 0 12px">Що вас чекає:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;width:100%">${FEATURES.map(([t, d], i) => `<tr><td valign="top" style="width:30px;padding:0 12px 12px 0"><div style="width:30px;height:30px;line-height:30px;border-radius:9px;background:#E8EEFF;color:${C.brand};font:800 13px/30px ${FONT};text-align:center">${i + 1}</div></td><td valign="top" style="padding:0 0 12px;font-size:15px;line-height:1.55"><strong style="color:${C.ink}">${t}</strong><br><span style="color:${C.muted};font-size:14px">${d}</span></td></tr>`).join("")}</table>`;
  return {
    subject: "Вас запрошено до QuizFlow",
    html: layout({
      site, logoUrl,
      preheader: "Створіть акаунт викладача — це займе хвилину",
      title: "Вас запрошено до QuizFlow",
      bodyHtml,
      button: { label: "Створити акаунт", url: link },
      after: `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${C.muted}">${esc(note)} Якщо кнопка не працює, скопіюйте адресу в браузер:<br><a href="${esc(link)}" style="color:${C.brand};word-break:break-all">${esc(link)}</a></p>`,
      footer: "Ви отримали цей лист, бо адміністратор QuizFlow надіслав вам запрошення. Якщо ви його не чекали — просто проігноруйте.",
    }),
    text: `${hello}\n\n${lead}\n\n${message ? message + "\n\n" : ""}Що вас чекає:\n${FEATURES.map(([t, d]) => `- ${t} — ${d}`).join("\n")}\n\nСтворити акаунт: ${link}\n\n${note}\n\nЗ повагою,\nКоманда QuizFlow`,
  };
}

// ─── Зміна пароля (замість стандартного листа Firebase) ────────────────
export function resetEmail({ email, link, byAdmin, site, logoUrl }) {
  const lead = byAdmin
    ? `Адміністратор QuizFlow надіслав вам посилання, щоб задати новий пароль для акаунта ${email}.`
    : `Ми отримали запит на зміну пароля для акаунта ${email} у QuizFlow.`;
  const note = "Посилання діє 1 годину і спрацює лише один раз.";
  return {
    subject: "Зміна пароля QuizFlow",
    html: layout({
      site, logoUrl,
      preheader: "Посилання, щоб задати новий пароль",
      title: "Зміна пароля",
      bodyHtml: `<p style="margin:0 0 18px">Вітаємо!</p><p style="margin:0 0 24px">${esc(lead)}</p>`,
      button: { label: "Задати новий пароль", url: link },
      after: `<div style="margin:16px 0 16px;padding:2px 0 2px 14px;border-left:3px solid ${C.amber};font-size:14px;line-height:1.6;color:${C.text}">${note} Якщо ви не надсилали запит — просто проігноруйте лист, пароль не зміниться.</div>
        <p style="margin:0;font-size:13.5px;line-height:1.6;color:${C.muted}">Якщо кнопка не працює, скопіюйте адресу в браузер:<br><a href="${esc(link)}" style="color:${C.brand};word-break:break-all">${esc(link)}</a></p>`,
      footer: "Ви отримали цей лист, бо для вашого акаунта QuizFlow запросили зміну пароля.",
    }),
    text: `Вітаємо!\n\n${lead}\n\nЗадати новий пароль: ${link}\n\n${note} Якщо ви не надсилали запит — просто проігноруйте лист.\n\nЗ повагою,\nКоманда QuizFlow`,
  };
}

// ─── Новий акаунт, створений адміністратором ───────────────────────────
export function welcomeEmail({ name, email, password, setPasswordUrl, loginUrl, fromName, site, logoUrl }) {
  const hello = name ? `Вітаємо, ${name}!` : "Вітаємо!";
  const lead = `Для вас створено акаунт викладача в QuizFlow — платформі для тестів, журналу оцінок та ігор наживо зі студентами.${fromName ? ` Адміністратор: ${fromName}.` : ""}`;
  const row = (k, v) => `<tr><td style="padding:6px 16px 6px 0;color:${C.muted};font-size:14px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font:700 15px 'Geist Mono',ui-monospace,Menlo,Consolas,monospace;color:${C.ink};word-break:break-all">${esc(v)}</td></tr>`;
  const bodyHtml = `
    <p style="margin:0 0 18px">${esc(hello)}</p>
    <p style="margin:0 0 18px">${esc(lead)}</p>
    <p style="margin:0 0 8px">Дані для входу:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;padding:10px 16px;background:${C.tint};border-radius:14px;width:100%">${row("Email", email)}${password ? row("Пароль", password) : ""}</table>`;
  const after = `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${C.muted}">${setPasswordUrl
    ? "Пароль у листі не надсилаємо: кнопка вище веде на сторінку, де ви задасте власний. Посилання одноразове; якщо воно застаріло, на сторінці входу натисніть «Забули пароль?»."
    : password
    ? "Це тимчасовий пароль. Щоб задати власний, на сторінці входу натисніть «Забули пароль?» — прийде лист із посиланням."
    : "Пароль вам повідомить адміністратор. Або задайте власний: на сторінці входу натисніть «Забули пароль?»."}</p>`;
  return {
    subject: "Ваш акаунт у QuizFlow",
    html: layout({ site, logoUrl, preheader: "Дані для входу в QuizFlow", title: "Ваш акаунт у QuizFlow", bodyHtml, button: setPasswordUrl ? { label: "Задати пароль", url: setPasswordUrl } : { label: "Увійти", url: loginUrl }, after,
      footer: "Ви отримали цей лист, бо адміністратор QuizFlow створив для вас акаунт. Якщо це помилка — просто проігноруйте лист." }),
    text: `${hello}\n\n${lead}\n\nДані для входу:\nEmail: ${email}${password ? `\nПароль: ${password}` : ""}\n\n${setPasswordUrl ? `Задати пароль: ${setPasswordUrl}` : `Увійти: ${loginUrl}`}\n\n${setPasswordUrl ? "Пароль у листі не надсилаємо — посилання вище веде на сторінку, де ви задасте власний." : password ? "Це тимчасовий пароль. Щоб задати власний, на сторінці входу натисніть «Забули пароль?»." : "Пароль вам повідомить адміністратор або задайте власний через «Забули пароль?» на сторінці входу."}\n\nЗ повагою,\nКоманда QuizFlow`,
  };
}

// ─── Розсилка ───────────────────────────────────────────────────────────
export function broadcastEmail({ subject, body, button: btn, name, unsubUrl, site, logoUrl }) {
  const hello = name ? `Вітаємо, ${name}!` : "";
  return {
    subject,
    html: layout({
      site, logoUrl,
      preheader: plainBody(body).slice(0, 120),
      title: subject,
      bodyHtml: (hello ? `<p style="margin:0 0 18px">${esc(hello)}</p>` : "") + renderBody(body),
      button: btn,
      footer: `Ви отримали цей лист як користувач QuizFlow.${unsubUrl ? ` <a href="${esc(unsubUrl)}" style="color:${C.faint};text-decoration:underline">Відписатися від розсилок</a>` : ""}`,
    }),
    text: `${hello ? hello + "\n\n" : ""}${plainBody(body)}${btn?.url ? `\n\n${btn.label || "Відкрити"}: ${btn.url}` : ""}\n\nЗ повагою,\nКоманда QuizFlow${unsubUrl ? `\n\n—\nВідписатися від розсилок: ${unsubUrl}` : ""}`,
  };
}

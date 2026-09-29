// QuizFlow Mail — один файл для редактора Cloudflare (Workers → Edit code). Не редагуйте вручну: збирається з worker/src командою  cd tests && npm run worker:bundle

// ../worker/src/auth.js
var JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
var _keys = null;
var _keysAt = 0;
async function googleKeys(force = false) {
  if (!force && _keys && Date.now() - _keysAt < 36e5) return _keys;
  const r = await fetch(JWK_URL);
  if (!r.ok) throw new HttpError(503, "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u043E\u0442\u0440\u0438\u043C\u0430\u0442\u0438 \u043A\u043B\u044E\u0447\u0456 Google");
  _keys = (await r.json()).keys || [];
  _keysAt = Date.now();
  return _keys;
}
var HttpError = class extends Error {
  constructor(status2, message) {
    super(message);
    this.status = status2;
  }
};
var b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
var jsonPart = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));
async function verifyIdToken(token, projectId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new HttpError(401, "\u041F\u043E\u0442\u0440\u0456\u0431\u0435\u043D \u0432\u0445\u0456\u0434");
  let header, claims;
  try {
    header = jsonPart(parts[0]);
    claims = jsonPart(parts[1]);
  } catch {
    throw new HttpError(401, "\u041D\u0435\u0434\u0456\u0439\u0441\u043D\u0438\u0439 \u0442\u043E\u043A\u0435\u043D");
  }
  if (header.alg !== "RS256" || !header.kid) throw new HttpError(401, "\u041D\u0435\u0434\u0456\u0439\u0441\u043D\u0438\u0439 \u0442\u043E\u043A\u0435\u043D");
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, "\u041D\u0435\u0434\u0456\u0439\u0441\u043D\u0438\u0439 \u0442\u043E\u043A\u0435\u043D");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) throw new HttpError(401, "\u041D\u0435\u0434\u0456\u0439\u0441\u043D\u0438\u0439 \u0442\u043E\u043A\u0435\u043D");
  const now = Math.floor(Date.now() / 1e3);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw new HttpError(401, "\u0422\u043E\u043A\u0435\u043D \u0456\u043D\u0448\u043E\u0433\u043E \u043F\u0440\u043E\u0454\u043A\u0442\u0443");
  if (!claims.sub || claims.exp <= now || claims.iat > now + 300) throw new HttpError(401, "\u0421\u0435\u0441\u0456\u044F \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0430, \u0443\u0432\u0456\u0439\u0434\u0456\u0442\u044C \u0437\u043D\u043E\u0432\u0443");
  return claims;
}
async function dbRead(env, path, idToken) {
  const r = await fetch(`${env.FIREBASE_DB_URL}/${path}.json?auth=${encodeURIComponent(idToken)}`);
  if (r.status === 401 || r.status === 403) throw new HttpError(403, "\u041D\u0435\u043C\u0430\u0454 \u0434\u043E\u0441\u0442\u0443\u043F\u0443");
  if (!r.ok) throw new HttpError(502, "\u0411\u0430\u0437\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430");
  return r.json();
}
async function requireAdmin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const claims = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
  const me = await dbRead(env, `users/${claims.sub}`, token);
  if (!me || me.role !== "admin" || me.blocked === true) throw new HttpError(403, "\u041B\u0438\u0448\u0435 \u0434\u043B\u044F \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430");
  return { uid: claims.sub, token, me };
}

// ../worker/src/mail.js
var esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
var FONT = "Manrope,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
var C = { ink: "#0D1340", text: "#2B3552", muted: "#6B7593", faint: "#8A94B0", line: "#E6EAF3", brand: "#2D5BE3" };
var DEFAULT_SITE = "https://quizflow.space";
var LOGO_V = 3;
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink}">$1</strong>`).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, `<a href="$1" style="color:${C.brand};text-decoration:underline">$1</a>`);
}
function renderBody(text) {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    let para = [], list = [];
    const flushP = () => {
      if (para.length) out.push(`<p style="margin:0 0 18px">${para.map(inline).join("<br>")}</p>`);
      para = [];
    };
    const flushL = () => {
      if (list.length) out.push(`<ul style="margin:0 0 18px;padding-left:22px">${list.map((l) => `<li style="margin:0 0 8px">${inline(l)}</li>`).join("")}</ul>`);
      list = [];
    };
    for (const l of b.split("\n")) {
      if (/^##\s+/.test(l)) {
        flushP();
        flushL();
        out.push(`<h2 style="margin:28px 0 10px;font:800 19px/1.35 ${FONT};color:${C.ink};letter-spacing:-.2px">${inline(l.replace(/^##\s+/, ""))}</h2>`);
      } else if (/^\s*[-•]\s+/.test(l)) {
        flushP();
        list.push(l.replace(/^\s*[-•]\s+/, ""));
      } else {
        flushL();
        para.push(l);
      }
    }
    flushP();
    flushL();
  }
  return out.join("");
}
function plainBody(text) {
  return String(text || "").replace(/\r/g, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^##\s+/gm, "").trim();
}
function button({ label, url }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="qf-btn" style="margin:8px 0 6px"><tr><td style="border-radius:10px;background:${C.brand}">
      <a href="${esc(url)}" style="display:inline-block;padding:14px 28px;font:800 15px ${FONT};color:#ffffff;text-decoration:none;border-radius:10px">${esc(label || "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0438")}</a>
    </td></tr></table>`;
}
function layout({ site = DEFAULT_SITE, logoUrl: logoUrl2 = "", preheader = "", title = "", bodyHtml = "", button: btn = null, after = "", footer = "" }) {
  const logo = logoUrl2 || `${String(site || DEFAULT_SITE).replace(/\/+$/, "")}/assets/email/logo-light.png?v=${LOGO_V}`;
  const uniq = `<span style="display:none!important;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}</span>`;
  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(title || "QuizFlow")}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&display=swap" rel="stylesheet">
<style>
  @media (max-width:600px){ .qf-pad{padding-left:20px!important;padding-right:20px!important} .qf-h1{font-size:25px!important} .qf-btn, .qf-btn a{display:block!important;width:100%!important;text-align:center!important;box-sizing:border-box} }
</style></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:40px 12px 36px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td class="qf-pad" style="padding:0 24px;font:400 16px/1.7 ${FONT};color:${C.text}">
    <a href="${esc(site)}" style="text-decoration:none"><img src="${esc(logo)}" width="125" height="36" alt="QuizFlow" style="display:block;border:0;margin:0 0 36px;font:800 20px ${FONT};color:${C.ink}"></a>
    ${title ? `<h1 class="qf-h1" style="margin:0 0 22px;font:800 30px/1.2 ${FONT};color:${C.ink};letter-spacing:-.6px">${esc(title)}</h1>` : ""}
    ${bodyHtml}
    ${btn?.url ? button(btn) : ""}
    ${after}
    <p style="margin:32px 0 0">${uniq}\u0417 \u043F\u043E\u0432\u0430\u0433\u043E\u044E,<br><strong style="color:${C.ink}">\u041A\u043E\u043C\u0430\u043D\u0434\u0430 QuizFlow</strong></p>
    <div style="height:1px;line-height:1px;font-size:0;background:${C.line};margin:36px 0 18px">&nbsp;</div>
    <p style="margin:0;font-size:12.5px;line-height:1.6;color:${C.faint}">${uniq}${footer}</p>
  </td></tr></table>
</td></tr></table>
</body></html>`;
}
var FEATURES = [
  ["\u0422\u0435\u0441\u0442\u0438 \u0439 \u043E\u043F\u0438\u0442\u0443\u0432\u0430\u043D\u043D\u044F", "\u043A\u043E\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440 \u0456\u0437 7 \u0442\u0438\u043F\u0430\u043C\u0438 \u043F\u0438\u0442\u0430\u043D\u044C, AI-\u043F\u0435\u0440\u0435\u0432\u0456\u0440\u043A\u0430 \u0440\u043E\u0437\u0433\u043E\u0440\u043D\u0443\u0442\u0438\u0445 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0435\u0439"],
  ["\u0416\u0443\u0440\u043D\u0430\u043B \u0456 \u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0430", "\u043E\u0446\u0456\u043D\u043A\u0438 \u0437\u0430 12-\u0431\u0430\u043B\u044C\u043D\u043E\u044E \u0448\u043A\u0430\u043B\u043E\u044E, \u0437\u0432\u0456\u0442\u0438 \u043F\u043E \u0433\u0440\u0443\u043F\u0430\u0445 \u0456 \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u0430\u0445"],
  ["\u0406\u0433\u0440\u0438 \u043D\u0430\u0436\u0438\u0432\u043E", "\u0432\u0456\u043A\u0442\u043E\u0440\u0438\u043D\u0438 \u043D\u0430 \u0443\u0440\u043E\u0446\u0456 \u0437 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0456\u0432 \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u0456\u0432"]
];
function inviteEmail({ link, name, fromName, expiresAt, message, site, logoUrl: logoUrl2 }) {
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kyiv" }) : "";
  const hello = name ? `\u0412\u0456\u0442\u0430\u0454\u043C\u043E, ${name}!` : "\u0412\u0456\u0442\u0430\u0454\u043C\u043E!";
  const lead = `${fromName ? `${fromName} \u0437\u0430\u043F\u0440\u043E\u0448\u0443\u0454 \u0432\u0430\u0441` : "\u0412\u0430\u0441 \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043E"} \u043F\u0440\u0438\u0454\u0434\u043D\u0430\u0442\u0438\u0441\u044F \u0434\u043E QuizFlow \u2014 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0438 \u0434\u043B\u044F \u0442\u0435\u0441\u0442\u0456\u0432, \u0436\u0443\u0440\u043D\u0430\u043B\u0443 \u043E\u0446\u0456\u043D\u043E\u043A \u0442\u0430 \u0456\u0433\u043E\u0440 \u043D\u0430\u0436\u0438\u0432\u043E \u0437\u0456 \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u0430\u043C\u0438.`;
  const note = `\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u0435${until ? ` \u0456 \u0434\u0456\u0454 \u0434\u043E ${until}` : ""}.`;
  const bodyHtml = `
    <p style="margin:0 0 18px">${esc(hello)}</p>
    <p style="margin:0 0 18px">${esc(lead)}</p>
    ${message ? `<p style="margin:0 0 18px;padding:2px 0 2px 16px;border-left:3px solid ${C.brand};color:${C.ink}">${esc(message).replace(/\n/g, "<br>")}</p>` : ""}
    <p style="margin:0 0 10px">\u0429\u043E \u0432\u0430\u0441 \u0447\u0435\u043A\u0430\u0454:</p>
    <ul style="margin:0 0 26px;padding-left:22px">${FEATURES.map(([t, d]) => `<li style="margin:0 0 8px"><strong style="color:${C.ink}">${t}</strong> \u2014 ${d}</li>`).join("")}</ul>`;
  return {
    subject: "\u0412\u0430\u0441 \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043E \u0434\u043E QuizFlow",
    html: layout({
      site,
      logoUrl: logoUrl2,
      preheader: "\u0421\u0442\u0432\u043E\u0440\u0456\u0442\u044C \u0430\u043A\u0430\u0443\u043D\u0442 \u0432\u0438\u043A\u043B\u0430\u0434\u0430\u0447\u0430 \u2014 \u0446\u0435 \u0437\u0430\u0439\u043C\u0435 \u0445\u0432\u0438\u043B\u0438\u043D\u0443",
      title: "\u0412\u0430\u0441 \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043E \u0434\u043E QuizFlow",
      bodyHtml,
      button: { label: "\u0421\u0442\u0432\u043E\u0440\u0438\u0442\u0438 \u0430\u043A\u0430\u0443\u043D\u0442", url: link },
      after: `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${C.muted}">${esc(note)} \u042F\u043A\u0449\u043E \u043A\u043D\u043E\u043F\u043A\u0430 \u043D\u0435 \u043F\u0440\u0430\u0446\u044E\u0454, \u0441\u043A\u043E\u043F\u0456\u044E\u0439\u0442\u0435 \u0430\u0434\u0440\u0435\u0441\u0443 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440:<br><a href="${esc(link)}" style="color:${C.brand};word-break:break-all">${esc(link)}</a></p>`,
      footer: "\u0412\u0438 \u043E\u0442\u0440\u0438\u043C\u0430\u043B\u0438 \u0446\u0435\u0439 \u043B\u0438\u0441\u0442, \u0431\u043E \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440 QuizFlow \u043D\u0430\u0434\u0456\u0441\u043B\u0430\u0432 \u0432\u0430\u043C \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u044F. \u042F\u043A\u0449\u043E \u0432\u0438 \u0439\u043E\u0433\u043E \u043D\u0435 \u0447\u0435\u043A\u0430\u043B\u0438 \u2014 \u043F\u0440\u043E\u0441\u0442\u043E \u043F\u0440\u043E\u0456\u0433\u043D\u043E\u0440\u0443\u0439\u0442\u0435."
    }),
    text: `${hello}

${lead}

${message ? message + "\n\n" : ""}\u0429\u043E \u0432\u0430\u0441 \u0447\u0435\u043A\u0430\u0454:
${FEATURES.map(([t, d]) => `- ${t} \u2014 ${d}`).join("\n")}

\u0421\u0442\u0432\u043E\u0440\u0438\u0442\u0438 \u0430\u043A\u0430\u0443\u043D\u0442: ${link}

${note}

\u0417 \u043F\u043E\u0432\u0430\u0433\u043E\u044E,
\u041A\u043E\u043C\u0430\u043D\u0434\u0430 QuizFlow`
  };
}
function resetEmail({ email, link, byAdmin, site, logoUrl: logoUrl2 }) {
  const lead = byAdmin ? `\u0410\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440 QuizFlow \u043D\u0430\u0434\u0456\u0441\u043B\u0430\u0432 \u0432\u0430\u043C \u043F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F, \u0449\u043E\u0431 \u0437\u0430\u0434\u0430\u0442\u0438 \u043D\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u0434\u043B\u044F \u0430\u043A\u0430\u0443\u043D\u0442\u0430 ${email}.` : `\u041C\u0438 \u043E\u0442\u0440\u0438\u043C\u0430\u043B\u0438 \u0437\u0430\u043F\u0438\u0442 \u043D\u0430 \u0437\u043C\u0456\u043D\u0443 \u043F\u0430\u0440\u043E\u043B\u044F \u0434\u043B\u044F \u0430\u043A\u0430\u0443\u043D\u0442\u0430 ${email} \u0443 QuizFlow.`;
  const note = "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u0434\u0456\u0454 1 \u0433\u043E\u0434\u0438\u043D\u0443 \u0456 \u0441\u043F\u0440\u0430\u0446\u044E\u0454 \u043B\u0438\u0448\u0435 \u043E\u0434\u0438\u043D \u0440\u0430\u0437.";
  return {
    subject: "\u0417\u043C\u0456\u043D\u0430 \u043F\u0430\u0440\u043E\u043B\u044F QuizFlow",
    html: layout({
      site,
      logoUrl: logoUrl2,
      preheader: "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F, \u0449\u043E\u0431 \u0437\u0430\u0434\u0430\u0442\u0438 \u043D\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C",
      title: "\u0417\u043C\u0456\u043D\u0430 \u043F\u0430\u0440\u043E\u043B\u044F",
      bodyHtml: `<p style="margin:0 0 18px">\u0412\u0456\u0442\u0430\u0454\u043C\u043E!</p><p style="margin:0 0 24px">${esc(lead)}</p>`,
      button: { label: "\u0417\u0430\u0434\u0430\u0442\u0438 \u043D\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C", url: link },
      after: `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${C.muted}">${note} \u042F\u043A\u0449\u043E \u0432\u0438 \u043D\u0435 \u043D\u0430\u0434\u0441\u0438\u043B\u0430\u043B\u0438 \u0437\u0430\u043F\u0438\u0442 \u2014 \u043F\u0440\u043E\u0441\u0442\u043E \u043F\u0440\u043E\u0456\u0433\u043D\u043E\u0440\u0443\u0439\u0442\u0435 \u043B\u0438\u0441\u0442, \u043F\u0430\u0440\u043E\u043B\u044C \u043D\u0435 \u0437\u043C\u0456\u043D\u0438\u0442\u044C\u0441\u044F.<br><br>\u042F\u043A\u0449\u043E \u043A\u043D\u043E\u043F\u043A\u0430 \u043D\u0435 \u043F\u0440\u0430\u0446\u044E\u0454, \u0441\u043A\u043E\u043F\u0456\u044E\u0439\u0442\u0435 \u0430\u0434\u0440\u0435\u0441\u0443 \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440:<br><a href="${esc(link)}" style="color:${C.brand};word-break:break-all">${esc(link)}</a></p>`,
      footer: "\u0412\u0438 \u043E\u0442\u0440\u0438\u043C\u0430\u043B\u0438 \u0446\u0435\u0439 \u043B\u0438\u0441\u0442, \u0431\u043E \u0434\u043B\u044F \u0432\u0430\u0448\u043E\u0433\u043E \u0430\u043A\u0430\u0443\u043D\u0442\u0430 QuizFlow \u0437\u0430\u043F\u0440\u043E\u0441\u0438\u043B\u0438 \u0437\u043C\u0456\u043D\u0443 \u043F\u0430\u0440\u043E\u043B\u044F."
    }),
    text: `\u0412\u0456\u0442\u0430\u0454\u043C\u043E!

${lead}

\u0417\u0430\u0434\u0430\u0442\u0438 \u043D\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C: ${link}

${note} \u042F\u043A\u0449\u043E \u0432\u0438 \u043D\u0435 \u043D\u0430\u0434\u0441\u0438\u043B\u0430\u043B\u0438 \u0437\u0430\u043F\u0438\u0442 \u2014 \u043F\u0440\u043E\u0441\u0442\u043E \u043F\u0440\u043E\u0456\u0433\u043D\u043E\u0440\u0443\u0439\u0442\u0435 \u043B\u0438\u0441\u0442.

\u0417 \u043F\u043E\u0432\u0430\u0433\u043E\u044E,
\u041A\u043E\u043C\u0430\u043D\u0434\u0430 QuizFlow`
  };
}
function welcomeEmail({ name, email, password, loginUrl, fromName, site, logoUrl: logoUrl2 }) {
  const hello = name ? `\u0412\u0456\u0442\u0430\u0454\u043C\u043E, ${name}!` : "\u0412\u0456\u0442\u0430\u0454\u043C\u043E!";
  const lead = `\u0414\u043B\u044F \u0432\u0430\u0441 \u0441\u0442\u0432\u043E\u0440\u0435\u043D\u043E \u0430\u043A\u0430\u0443\u043D\u0442 \u0432\u0438\u043A\u043B\u0430\u0434\u0430\u0447\u0430 \u0432 QuizFlow \u2014 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0456 \u0434\u043B\u044F \u0442\u0435\u0441\u0442\u0456\u0432, \u0436\u0443\u0440\u043D\u0430\u043B\u0443 \u043E\u0446\u0456\u043D\u043E\u043A \u0442\u0430 \u0456\u0433\u043E\u0440 \u043D\u0430\u0436\u0438\u0432\u043E \u0437\u0456 \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u0430\u043C\u0438.${fromName ? ` \u0410\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440: ${fromName}.` : ""}`;
  const row = (k, v) => `<tr><td style="padding:6px 16px 6px 0;color:${C.muted};font-size:14px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font:700 15px 'Geist Mono',ui-monospace,Menlo,Consolas,monospace;color:${C.ink};word-break:break-all">${esc(v)}</td></tr>`;
  const bodyHtml = `
    <p style="margin:0 0 18px">${esc(hello)}</p>
    <p style="margin:0 0 18px">${esc(lead)}</p>
    <p style="margin:0 0 8px">\u0414\u0430\u043D\u0456 \u0434\u043B\u044F \u0432\u0445\u043E\u0434\u0443:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;padding:10px 16px;background:#F4F6FB;border-radius:10px;width:100%">${row("Email", email)}${password ? row("\u041F\u0430\u0440\u043E\u043B\u044C", password) : ""}</table>`;
  const after = `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${C.muted}">${password ? "\u0426\u0435 \u0442\u0438\u043C\u0447\u0430\u0441\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C. \u0429\u043E\u0431 \u0437\u0430\u0434\u0430\u0442\u0438 \u0432\u043B\u0430\u0441\u043D\u0438\u0439, \u043D\u0430 \u0441\u0442\u043E\u0440\u0456\u043D\u0446\u0456 \u0432\u0445\u043E\u0434\u0443 \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xAB\u0417\u0430\u0431\u0443\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C?\xBB \u2014 \u043F\u0440\u0438\u0439\u0434\u0435 \u043B\u0438\u0441\u0442 \u0456\u0437 \u043F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F\u043C." : "\u041F\u0430\u0440\u043E\u043B\u044C \u0432\u0430\u043C \u043F\u043E\u0432\u0456\u0434\u043E\u043C\u0438\u0442\u044C \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440. \u0410\u0431\u043E \u0437\u0430\u0434\u0430\u0439\u0442\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u0439: \u043D\u0430 \u0441\u0442\u043E\u0440\u0456\u043D\u0446\u0456 \u0432\u0445\u043E\u0434\u0443 \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xAB\u0417\u0430\u0431\u0443\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C?\xBB."}</p>`;
  return {
    subject: "\u0412\u0430\u0448 \u0430\u043A\u0430\u0443\u043D\u0442 \u0443 QuizFlow",
    html: layout({
      site,
      logoUrl: logoUrl2,
      preheader: "\u0414\u0430\u043D\u0456 \u0434\u043B\u044F \u0432\u0445\u043E\u0434\u0443 \u0432 QuizFlow",
      title: "\u0412\u0430\u0448 \u0430\u043A\u0430\u0443\u043D\u0442 \u0443 QuizFlow",
      bodyHtml,
      button: { label: "\u0423\u0432\u0456\u0439\u0442\u0438", url: loginUrl },
      after,
      footer: "\u0412\u0438 \u043E\u0442\u0440\u0438\u043C\u0430\u043B\u0438 \u0446\u0435\u0439 \u043B\u0438\u0441\u0442, \u0431\u043E \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440 QuizFlow \u0441\u0442\u0432\u043E\u0440\u0438\u0432 \u0434\u043B\u044F \u0432\u0430\u0441 \u0430\u043A\u0430\u0443\u043D\u0442. \u042F\u043A\u0449\u043E \u0446\u0435 \u043F\u043E\u043C\u0438\u043B\u043A\u0430 \u2014 \u043F\u0440\u043E\u0441\u0442\u043E \u043F\u0440\u043E\u0456\u0433\u043D\u043E\u0440\u0443\u0439\u0442\u0435 \u043B\u0438\u0441\u0442."
    }),
    text: `${hello}

${lead}

\u0414\u0430\u043D\u0456 \u0434\u043B\u044F \u0432\u0445\u043E\u0434\u0443:
Email: ${email}${password ? `
\u041F\u0430\u0440\u043E\u043B\u044C: ${password}` : ""}

\u0423\u0432\u0456\u0439\u0442\u0438: ${loginUrl}

${password ? "\u0426\u0435 \u0442\u0438\u043C\u0447\u0430\u0441\u043E\u0432\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C. \u0429\u043E\u0431 \u0437\u0430\u0434\u0430\u0442\u0438 \u0432\u043B\u0430\u0441\u043D\u0438\u0439, \u043D\u0430 \u0441\u0442\u043E\u0440\u0456\u043D\u0446\u0456 \u0432\u0445\u043E\u0434\u0443 \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C \xAB\u0417\u0430\u0431\u0443\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C?\xBB." : "\u041F\u0430\u0440\u043E\u043B\u044C \u0432\u0430\u043C \u043F\u043E\u0432\u0456\u0434\u043E\u043C\u0438\u0442\u044C \u0430\u0434\u043C\u0456\u043D\u0456\u0441\u0442\u0440\u0430\u0442\u043E\u0440 \u0430\u0431\u043E \u0437\u0430\u0434\u0430\u0439\u0442\u0435 \u0432\u043B\u0430\u0441\u043D\u0438\u0439 \u0447\u0435\u0440\u0435\u0437 \xAB\u0417\u0430\u0431\u0443\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C?\xBB \u043D\u0430 \u0441\u0442\u043E\u0440\u0456\u043D\u0446\u0456 \u0432\u0445\u043E\u0434\u0443."}

\u0417 \u043F\u043E\u0432\u0430\u0433\u043E\u044E,
\u041A\u043E\u043C\u0430\u043D\u0434\u0430 QuizFlow`
  };
}
function broadcastEmail({ subject, body, button: btn, name, unsubUrl: unsubUrl2, site, logoUrl: logoUrl2 }) {
  const hello = name ? `\u0412\u0456\u0442\u0430\u0454\u043C\u043E, ${name}!` : "";
  return {
    subject,
    html: layout({
      site,
      logoUrl: logoUrl2,
      preheader: plainBody(body).slice(0, 120),
      title: subject,
      bodyHtml: (hello ? `<p style="margin:0 0 18px">${esc(hello)}</p>` : "") + renderBody(body),
      button: btn,
      footer: `\u0412\u0438 \u043E\u0442\u0440\u0438\u043C\u0430\u043B\u0438 \u0446\u0435\u0439 \u043B\u0438\u0441\u0442 \u044F\u043A \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447 QuizFlow.${unsubUrl2 ? ` <a href="${esc(unsubUrl2)}" style="color:${C.faint};text-decoration:underline">\u0412\u0456\u0434\u043F\u0438\u0441\u0430\u0442\u0438\u0441\u044F \u0432\u0456\u0434 \u0440\u043E\u0437\u0441\u0438\u043B\u043E\u043A</a>` : ""}`
    }),
    text: `${hello ? hello + "\n\n" : ""}${plainBody(body)}${btn?.url ? `

${btn.label || "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0438"}: ${btn.url}` : ""}

\u0417 \u043F\u043E\u0432\u0430\u0433\u043E\u044E,
\u041A\u043E\u043C\u0430\u043D\u0434\u0430 QuizFlow${unsubUrl2 ? `

\u2014
\u0412\u0456\u0434\u043F\u0438\u0441\u0430\u0442\u0438\u0441\u044F \u0432\u0456\u0434 \u0440\u043E\u0437\u0441\u0438\u043B\u043E\u043A: ${unsubUrl2}` : ""}`
  };
}

// ../worker/src/google.js
var SCOPE = "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform";
var _tok = null;
var b64url2 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var b64urlStr = (s) => b64url2(new TextEncoder().encode(s));
function serviceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return null;
  try {
    const sa = typeof env.FIREBASE_SERVICE_ACCOUNT === "string" ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : env.FIREBASE_SERVICE_ACCOUNT;
    return sa?.client_email && sa?.private_key ? sa : null;
  } catch {
    return null;
  }
}
async function accessToken(env) {
  const sa = serviceAccount(env);
  if (!sa) throw new HttpError(503, "\u041D\u0430 \u0432\u043E\u0440\u043A\u0435\u0440\u0456 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E FIREBASE_SERVICE_ACCOUNT");
  const now = Math.floor(Date.now() / 1e3);
  if (_tok && _tok.key === sa.client_email && _tok.exp - 60 > now) return _tok.token;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  let key;
  try {
    key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new HttpError(503, "\u0421\u043B\u0443\u0436\u0431\u043E\u0432\u0438\u0439 \u043A\u043B\u044E\u0447 Firebase \u043F\u043E\u0448\u043A\u043E\u0434\u0436\u0435\u043D\u0438\u0439 \u2014 \u0432\u0441\u0442\u0430\u0432\u0442\u0435 JSON \u0449\u0435 \u0440\u0430\u0437");
  }
  const unsigned = `${b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlStr(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64url2(sig)}`
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new HttpError(503, "Google \u043D\u0435 \u043F\u0440\u0438\u0439\u043D\u044F\u0432 \u0441\u043B\u0443\u0436\u0431\u043E\u0432\u0438\u0439 \u043A\u043B\u044E\u0447: " + (d.error_description || d.error || r.status));
  _tok = { key: sa.client_email, token: d.access_token, exp: now + (Number(d.expires_in) || 3600) };
  return _tok.token;
}
async function passwordResetCode(env, email) {
  const sa = serviceAccount(env);
  const token = await accessToken(env);
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email, returnOobLink: true, targetProjectId: sa.project_id || env.FIREBASE_PROJECT_ID })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = String(d?.error?.message || "");
    if (/EMAIL_NOT_FOUND|USER_DISABLED|USER_NOT_FOUND/.test(m)) return null;
    if (/EXCEED|TOO_MANY/.test(m)) throw new HttpError(429, "\u0417\u0430\u0431\u0430\u0433\u0430\u0442\u043E \u0437\u0430\u043F\u0438\u0442\u0456\u0432. \u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0437\u0430 \u043A\u0456\u043B\u044C\u043A\u0430 \u0445\u0432\u0438\u043B\u0438\u043D.");
    throw new HttpError(502, "Firebase: " + (m || r.status));
  }
  const code = new URL(d.oobLink).searchParams.get("oobCode");
  if (!code) throw new HttpError(502, "Firebase \u043D\u0435 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0432 \u043F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F");
  return code;
}

// ../worker/src/logo.js
var LOGO_PNG_B64 = "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";

// ../worker/src/index.js
var logoUrl = (origin) => `${origin}/logo.png?v=${LOGO_V}`;
var LOGO_BYTES = Uint8Array.from(atob(LOGO_PNG_B64), (c) => c.charCodeAt(0));
var EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
var MAX_RECIPIENTS = 1e3;
var BATCH = 100;
var DEFAULTS = {
  FIREBASE_PROJECT_ID: "quizflow-8a978",
  FIREBASE_DB_URL: "https://quizflow-8a978-default-rtdb.europe-west1.firebasedatabase.app",
  SITE_URL: "https://quizflow.space",
  MAIL_FROM: "QuizFlow <noreply@quizflow.space>",
  ALLOWED_ORIGINS: "https://quizflow.space,https://www.quizflow.space"
};
var index_default = {
  async fetch(request, rawEnv) {
    const env = { ...DEFAULTS, ...Object.fromEntries(Object.entries(rawEnv || {}).filter(([, v]) => v !== void 0 && v !== "")) };
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/unsubscribe") return await unsubscribe(request, env, url);
      if (url.pathname === "/logo.png" && (request.method === "GET" || request.method === "HEAD"))
        return new Response(request.method === "HEAD" ? null : LOGO_BYTES, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
      if (url.pathname === "/" && request.method === "GET") return json({ ok: true, service: "quizflow-mail" }, 200, cors);
      if (url.pathname === "/reset" && request.method === "POST") return json(await reset(request, env, url), 200, cors);
      const route = `${request.method} ${url.pathname}`;
      const handler = { "GET /status": status, "POST /preview": preview, "POST /invite": invite, "POST /welcome": welcome, "POST /broadcast": broadcast }[route];
      if (!handler) throw new HttpError(404, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0430 \u0430\u0434\u0440\u0435\u0441\u0430");
      const admin = await requireAdmin(request, env);
      const body = request.method === "POST" ? await readJson(request) : null;
      return json(await handler({ env, admin, body, url }), 200, cors);
    } catch (e) {
      const status2 = e instanceof HttpError ? e.status : 500;
      if (status2 === 500) console.error(e);
      return json({ ok: false, error: status2 === 500 ? "\u0412\u043D\u0443\u0442\u0440\u0456\u0448\u043D\u044F \u043F\u043E\u043C\u0438\u043B\u043A\u0430 \u0432\u043E\u0440\u043A\u0435\u0440\u0430" : e.message, ...e.code ? { code: e.code } : {} }, status2, cors);
    }
  }
};
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
var json = (data, status2 = 200, headers = {}) => new Response(JSON.stringify(data), { status: status2, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
async function readJson(request) {
  const text = await request.text();
  if (text.length > 1e5) throw new HttpError(413, "\u0417\u0430\u0432\u0435\u043B\u0438\u043A\u0438\u0439 \u0437\u0430\u043F\u0438\u0442");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 JSON");
  }
}
async function resend(env, path, payload) {
  if (!env.RESEND_API_KEY) throw new HttpError(503, "\u041D\u0430 \u0432\u043E\u0440\u043A\u0435\u0440\u0456 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E RESEND_API_KEY");
  const r = await fetch(`https://api.resend.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = r.status === 429 ? "\u041F\u0435\u0440\u0435\u0432\u0438\u0449\u0435\u043D\u043E \u043B\u0456\u043C\u0456\u0442 Resend \u2014 \u0441\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u0456\u0437\u043D\u0456\u0448\u0435" : data?.message ? `Resend: ${data.message}` : `Resend \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0432 ${r.status}`;
    throw new HttpError(r.status === 429 ? 429 : 502, msg);
  }
  return data;
}
async function sign(env, uid) {
  if (!env.UNSUB_SECRET) throw new HttpError(503, "\u041D\u0430 \u0432\u043E\u0440\u043A\u0435\u0440\u0456 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E UNSUB_SECRET");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.UNSUB_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsub:${uid}`)));
  return btoa(String.fromCharCode(...sig.slice(0, 18))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function unsubUrl(origin, env, uid) {
  return `${origin}/unsubscribe?u=${encodeURIComponent(uid)}&s=${await sign(env, uid)}`;
}
var safeEq = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
async function status({ env }) {
  const unsubscribed = [];
  if (env.MAIL_KV) {
    let cursor;
    do {
      const page2 = await env.MAIL_KV.list({ prefix: "unsub:", cursor });
      page2.keys.forEach((k) => unsubscribed.push(k.name.slice(6)));
      cursor = page2.list_complete ? null : page2.cursor;
    } while (cursor);
  }
  return { ok: true, from: env.MAIL_FROM || "", configured: { resend: !!env.RESEND_API_KEY, unsubscribe: !!env.UNSUB_SECRET, kv: !!env.MAIL_KV, serviceAccount: !!serviceAccount(env) }, unsubscribed };
}
function checkMessage(b) {
  const subject = String(b?.subject || "").trim();
  const body = String(b?.body || "").trim();
  if (!subject) throw new HttpError(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u0442\u0435\u043C\u0443 \u043B\u0438\u0441\u0442\u0430");
  if (subject.length > 150) throw new HttpError(400, "\u0422\u0435\u043C\u0430 \u0437\u0430\u0434\u043E\u0432\u0433\u0430 (\u0434\u043E 150 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432)");
  if (!body) throw new HttpError(400, "\u041B\u0438\u0441\u0442 \u043F\u043E\u0440\u043E\u0436\u043D\u0456\u0439");
  if (body.length > 2e4) throw new HttpError(400, "\u0422\u0435\u043A\u0441\u0442 \u0437\u0430\u0434\u043E\u0432\u0433\u0438\u0439 (\u0434\u043E 20 000 \u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432)");
  let button2 = null;
  if (b?.button?.url) {
    const u = String(b.button.url).trim();
    if (!/^https:\/\/[^\s]+$/.test(u)) throw new HttpError(400, "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u043A\u043D\u043E\u043F\u043A\u0438 \u043C\u0430\u0454 \u043F\u043E\u0447\u0438\u043D\u0430\u0442\u0438\u0441\u044F \u0437 https://");
    button2 = { url: u, label: String(b.button.label || "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0438").trim().slice(0, 40) || "\u0412\u0456\u0434\u043A\u0440\u0438\u0442\u0438" };
  }
  return { subject, body, button: button2 };
}
async function preview({ env, body, url }) {
  const m = checkMessage(body);
  return { ok: true, html: broadcastEmail({ ...m, name: "\u041E\u043B\u0435\u043D\u0430", unsubUrl: "#", site: env.SITE_URL, logoUrl: logoUrl(url.origin) }).html };
}
async function invite({ env, admin, body, url }) {
  const to = String(body?.to || "").trim().toLowerCase();
  const token = String(body?.token || "");
  if (!EMAIL_RE.test(to) || to.length > 200) throw new HttpError(400, "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0430 \u0430\u0434\u0440\u0435\u0441\u0430 email");
  if (!/^[a-z0-9]{8,64}$/i.test(token)) throw new HttpError(400, "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0435 \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u044F");
  const inv = await dbRead(env, `invite_tokens/${token}`, admin.token);
  if (!inv) throw new HttpError(404, "\u0417\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u044F \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E");
  if (inv.used === true) throw new HttpError(409, "\u0417\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u044F \u0432\u0436\u0435 \u0432\u0438\u043A\u043E\u0440\u0438\u0441\u0442\u0430\u043D\u043E");
  if (inv.expiresAt && inv.expiresAt < Date.now()) throw new HttpError(409, "\u0422\u0435\u0440\u043C\u0456\u043D \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u044F \u043C\u0438\u043D\u0443\u0432");
  const fromName = [admin.me.name, admin.me.surname].filter(Boolean).join(" ");
  const mail = inviteEmail({
    link: `${env.SITE_URL}/register?token=${token}`,
    name: String(body?.name || "").trim().slice(0, 80),
    message: String(body?.message || "").trim().slice(0, 600),
    fromName,
    expiresAt: inv.expiresAt,
    site: env.SITE_URL,
    logoUrl: logoUrl(url.origin)
  });
  const res = await resend(env, "/emails", { from: env.MAIL_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text, ...admin.me.email ? { reply_to: admin.me.email } : {} });
  return { ok: true, id: res.id || null, to };
}
async function sha256hex(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function reset(request, env, url) {
  const byAdmin = !!request.headers.get("Authorization");
  if (byAdmin) await requireAdmin(request, env);
  else {
    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(origin)) throw new HttpError(403, "\u0417\u0430\u043F\u0438\u0442 \u043D\u0435 \u0437 \u0441\u0430\u0439\u0442\u0443 QuizFlow");
  }
  if (!serviceAccount(env)) throw Object.assign(new HttpError(503, "\u041D\u0430 \u0432\u043E\u0440\u043A\u0435\u0440\u0456 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E FIREBASE_SERVICE_ACCOUNT"), { code: "not_configured" });
  const body = await readJson(request);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, "\u0412\u043A\u0430\u0436\u0456\u0442\u044C \u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 email");
  if (!byAdmin && env.MAIL_KV) {
    const eKey = `rl:e:${await sha256hex(email)}`;
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const iKey = `rl:ip:${await sha256hex(ip)}`;
    const [eHit, iHits] = await Promise.all([env.MAIL_KV.get(eKey), env.MAIL_KV.get(iKey)]);
    if (eHit || Number(iHits || 0) >= 10) throw new HttpError(429, "\u0417\u0430\u0431\u0430\u0433\u0430\u0442\u043E \u0437\u0430\u043F\u0438\u0442\u0456\u0432. \u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0437\u0430 \u043A\u0456\u043B\u044C\u043A\u0430 \u0445\u0432\u0438\u043B\u0438\u043D.");
    await Promise.all([env.MAIL_KV.put(eKey, "1", { expirationTtl: 60 }), env.MAIL_KV.put(iKey, String(Number(iHits || 0) + 1), { expirationTtl: 3600 })]);
  }
  const code = await passwordResetCode(env, email);
  if (!code) return { ok: true };
  const link = `${env.SITE_URL}/auth-action?mode=resetPassword&oobCode=${encodeURIComponent(code)}&lang=uk`;
  const mail = resetEmail({ email, link, byAdmin, site: env.SITE_URL, logoUrl: logoUrl(url.origin) });
  await resend(env, "/emails", { from: env.MAIL_FROM, to: [email], subject: mail.subject, html: mail.html, text: mail.text });
  return { ok: true };
}
async function welcome({ env, admin, body, url }) {
  const uid = String(body?.uid || "");
  if (!/^[\w-]{6,128}$/.test(uid)) throw new HttpError(400, "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 \u0430\u043A\u0430\u0443\u043D\u0442");
  const password = body?.password == null ? "" : String(body.password);
  if (password && (password.length < 6 || password.length > 64)) throw new HttpError(400, "\u041D\u0435\u043A\u043E\u0440\u0435\u043A\u0442\u043D\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C");
  const u = await dbRead(env, `users/${uid}`, admin.token);
  if (!u) throw new HttpError(404, "\u0410\u043A\u0430\u0443\u043D\u0442 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E");
  if (u.blocked === true) throw new HttpError(409, "\u0410\u043A\u0430\u0443\u043D\u0442 \u0437\u0430\u0431\u043B\u043E\u043A\u043E\u0432\u0430\u043D\u043E");
  const email = String(u.email || "").trim();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "\u0412 \u0430\u043A\u0430\u0443\u043D\u0442\u0430 \u043D\u0435\u043C\u0430\u0454 \u043A\u043E\u0440\u0435\u043A\u0442\u043D\u043E\u0433\u043E email");
  const mail = welcomeEmail({
    name: String(u.name || "").trim().slice(0, 80),
    email,
    password,
    loginUrl: `${env.SITE_URL}/login?email=${encodeURIComponent(email)}`,
    fromName: [admin.me.name, admin.me.surname].filter(Boolean).join(" "),
    site: env.SITE_URL,
    logoUrl: logoUrl(url.origin)
  });
  const res = await resend(env, "/emails", { from: env.MAIL_FROM, to: [email], subject: mail.subject, html: mail.html, text: mail.text, ...admin.me.email ? { reply_to: admin.me.email } : {} });
  return { ok: true, id: res.id || null, to: email };
}
async function broadcast({ env, admin, body, url }) {
  const m = checkMessage(body);
  if (!env.UNSUB_SECRET) throw new HttpError(503, "\u041D\u0430 \u0432\u043E\u0440\u043A\u0435\u0440\u0456 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u043E UNSUB_SECRET");
  let list;
  const skipped = { noEmail: 0, blocked: 0, unsubscribed: 0, missing: 0 };
  if (body?.test) {
    if (!EMAIL_RE.test(admin.me.email || "")) throw new HttpError(400, "\u0423 \u0432\u0430\u0448\u043E\u043C\u0443 \u043F\u0440\u043E\u0444\u0456\u043B\u0456 \u043D\u0435\u043C\u0430\u0454 email \u0434\u043B\u044F \u0442\u0435\u0441\u0442\u043E\u0432\u043E\u0433\u043E \u043B\u0438\u0441\u0442\u0430");
    list = [{ uid: admin.uid, email: admin.me.email, name: admin.me.name || "" }];
  } else {
    const uids = [...new Set((Array.isArray(body?.uids) ? body.uids : []).map(String))];
    if (!uids.length) throw new HttpError(400, "\u041D\u0435 \u043E\u0431\u0440\u0430\u043D\u043E \u0436\u043E\u0434\u043D\u043E\u0433\u043E \u043E\u0442\u0440\u0438\u043C\u0443\u0432\u0430\u0447\u0430");
    if (uids.length > MAX_RECIPIENTS) throw new HttpError(400, `\u041D\u0435 \u0431\u0456\u043B\u044C\u0448\u0435 ${MAX_RECIPIENTS} \u043E\u0442\u0440\u0438\u043C\u0443\u0432\u0430\u0447\u0456\u0432 \u0437\u0430 \u0440\u0430\u0437`);
    const users = await dbRead(env, "users", admin.token) || {};
    list = [];
    for (const uid of uids) {
      const u = users[uid];
      if (!u) {
        skipped.missing++;
        continue;
      }
      if (u.blocked === true) {
        skipped.blocked++;
        continue;
      }
      if (!EMAIL_RE.test(String(u.email || ""))) {
        skipped.noEmail++;
        continue;
      }
      if (env.MAIL_KV && await env.MAIL_KV.get(`unsub:${uid}`)) {
        skipped.unsubscribed++;
        continue;
      }
      list.push({ uid, email: String(u.email).trim(), name: u.name || "" });
    }
  }
  let sent = 0, failed = 0;
  const errors = [];
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    const payload = await Promise.all(chunk.map(async (r) => {
      const un = await unsubUrl(url.origin, env, r.uid);
      const mail = broadcastEmail({ ...m, name: r.name, unsubUrl: un, site: env.SITE_URL, logoUrl: logoUrl(url.origin) });
      return {
        from: env.MAIL_FROM,
        to: [r.email],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: { "List-Unsubscribe": `<${un}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      };
    }));
    try {
      await resend(env, "/emails/batch", payload);
      sent += chunk.length;
    } catch (e) {
      failed += chunk.length;
      errors.push(e.message);
      if (e.status === 429 || e.status === 503) {
        failed += list.length - i - chunk.length;
        break;
      }
    }
  }
  return { ok: failed === 0, sent, failed, skipped, errors: [...new Set(errors)].slice(0, 3), recipients: list.length };
}
async function unsubscribe(request, env, url) {
  const uid = url.searchParams.get("u") || "", s = url.searchParams.get("s") || "";
  const valid = uid && s && env.UNSUB_SECRET && safeEq(await sign(env, uid), s);
  if (!valid) return page(env, "\u041F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u043D\u0435\u0434\u0456\u0439\u0441\u043D\u0435", "\u041C\u043E\u0436\u043B\u0438\u0432\u043E, \u0439\u043E\u0433\u043E \u0441\u043A\u043E\u043F\u0456\u0439\u043E\u0432\u0430\u043D\u043E \u043D\u0435 \u043F\u043E\u0432\u043D\u0456\u0441\u0442\u044E. \u0412\u0456\u0434\u043A\u0440\u0438\u0439\u0442\u0435 \u043F\u043E\u0441\u0438\u043B\u0430\u043D\u043D\u044F \u0437 \u043B\u0438\u0441\u0442\u0430 \u0449\u0435 \u0440\u0430\u0437.", 400);
  if (!env.MAIL_KV) return page(env, "\u0421\u0435\u0440\u0432\u0456\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0438\u0439", "\u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u0456\u0437\u043D\u0456\u0448\u0435.", 503);
  const key = `unsub:${uid}`;
  if (request.method === "POST") {
    const form = await request.text();
    if (/(^|&)action=resubscribe(&|$)/.test(form)) {
      await env.MAIL_KV.delete(key);
      return page(env, "\u041F\u0456\u0434\u043F\u0438\u0441\u043A\u0443 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u043E", "\u0412\u0438 \u0437\u043D\u043E\u0432\u0443 \u043E\u0442\u0440\u0438\u043C\u0443\u0432\u0430\u0442\u0438\u043C\u0435\u0442\u0435 \u0440\u043E\u0437\u0441\u0438\u043B\u043A\u0438 QuizFlow.", 200, url, false);
    }
    await env.MAIL_KV.put(key, String(Date.now()));
    return page(env, "\u0412\u0438 \u0432\u0456\u0434\u043F\u0438\u0441\u0430\u043B\u0438\u0441\u044F", "\u0420\u043E\u0437\u0441\u0438\u043B\u043A\u0438 \u0437 \u043D\u043E\u0432\u0438\u043D\u0430\u043C\u0438 QuizFlow \u0431\u0456\u043B\u044C\u0448\u0435 \u043D\u0435 \u043D\u0430\u0434\u0445\u043E\u0434\u0438\u0442\u0438\u043C\u0443\u0442\u044C. \u0421\u043B\u0443\u0436\u0431\u043E\u0432\u0456 \u043B\u0438\u0441\u0442\u0438 (\u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u044F, \u0432\u0456\u0434\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043F\u0430\u0440\u043E\u043B\u044F) \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442\u0438\u043C\u0443\u0442\u044C \u044F\u043A \u0456 \u0440\u0430\u043D\u0456\u0448\u0435.", 200, url, true);
  }
  const already = !!await env.MAIL_KV.get(key);
  return already ? page(env, "\u0412\u0438 \u0432\u0436\u0435 \u0432\u0456\u0434\u043F\u0438\u0441\u0430\u043D\u0456", "\u0420\u043E\u0437\u0441\u0438\u043B\u043A\u0438 QuizFlow \u0432\u0430\u043C \u043D\u0435 \u043D\u0430\u0434\u0445\u043E\u0434\u044F\u0442\u044C.", 200, url, true) : page(env, "\u0412\u0456\u0434\u043F\u0438\u0441\u0430\u0442\u0438\u0441\u044F \u0432\u0456\u0434 \u0440\u043E\u0437\u0441\u0438\u043B\u043E\u043A?", "\u0412\u0438 \u0431\u0456\u043B\u044C\u0448\u0435 \u043D\u0435 \u043E\u0442\u0440\u0438\u043C\u0443\u0432\u0430\u0442\u0438\u043C\u0435\u0442\u0435 \u043B\u0438\u0441\u0442\u0456\u0432 \u0456\u0437 \u043D\u043E\u0432\u0438\u043D\u0430\u043C\u0438 \u0442\u0430 \u043E\u0433\u043E\u043B\u043E\u0448\u0435\u043D\u043D\u044F\u043C\u0438 QuizFlow. \u0421\u043B\u0443\u0436\u0431\u043E\u0432\u0456 \u043B\u0438\u0441\u0442\u0438 (\u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043D\u044F, \u0432\u0456\u0434\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044F \u043F\u0430\u0440\u043E\u043B\u044F) \u0437\u0430\u043B\u0438\u0448\u0430\u0442\u044C\u0441\u044F.", 200, url, null);
}
function page(env, title, text, status2, url, state) {
  const action = url ? esc(url.pathname + url.search) : "";
  const btn = state === null ? `<form method="post" action="${action}"><button>\u0412\u0456\u0434\u043F\u0438\u0441\u0430\u0442\u0438\u0441\u044F</button></form>` : state === true ? `<form method="post" action="${action}"><input type="hidden" name="action" value="resubscribe"><button class="ghost">\u041F\u043E\u0432\u0435\u0440\u043D\u0443\u0442\u0438 \u043F\u0456\u0434\u043F\u0438\u0441\u043A\u0443</button></form>` : "";
  const site = String(env.SITE_URL || "https://quizflow.space").replace(/\/+$/, "");
  return new Response(
    `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} \u2014 QuizFlow</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#fff;font-family:Manrope,system-ui,sans-serif;color:#2B3552}
.c{max-width:560px;margin:0 auto;padding:56px 24px}
.l{display:block;margin-bottom:40px}.l img{display:block;width:125px;height:36px}
h1{font-size:30px;line-height:1.2;color:#0D1340;margin:0 0 18px;letter-spacing:-.6px}p{margin:0 0 28px;line-height:1.7;font-size:16px}
button{font:800 15px Manrope,system-ui,sans-serif;padding:14px 26px;border-radius:10px;border:0;background:#2D5BE3;color:#fff;cursor:pointer}
button:hover{background:#2447C9}button.ghost{background:#fff;color:#0D1340;box-shadow:inset 0 0 0 1.5px #E6EAF3}button.ghost:hover{box-shadow:inset 0 0 0 1.5px #C9D1E4}
button:focus-visible{outline:3px solid rgba(45,91,227,.35);outline-offset:2px}
.s{margin-top:40px;padding-top:18px;border-top:1px solid #E6EAF3;font-size:12.5px;color:#8A94B0}.s a{color:#8A94B0}
@media (max-width:600px){.c{padding:40px 20px}h1{font-size:25px}button{width:100%}}</style></head>
<body><main class="c"><a class="l" href="${esc(site)}"><img src="/logo.png?v=${LOGO_V}" alt="QuizFlow"></a><h1>${esc(title)}</h1><p>${esc(text)}</p>${btn}<div class="s">QuizFlow \xB7 <a href="${esc(site)}">${esc(site.replace(/^https?:\/\//, ""))}</a></div></main></body></html>`,
    { status: status2, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}
export {
  index_default as default
};

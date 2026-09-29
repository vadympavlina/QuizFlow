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
function layout({ site = DEFAULT_SITE, preheader = "", title = "", bodyHtml = "", button: btn = null, after = "", footer = "" }) {
  const logo = `${String(site || DEFAULT_SITE).replace(/\/+$/, "")}/assets/email/logo-light.png`;
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
    <p style="margin:32px 0 0">\u0417 \u043F\u043E\u0432\u0430\u0433\u043E\u044E,<br><strong style="color:${C.ink}">\u041A\u043E\u043C\u0430\u043D\u0434\u0430 QuizFlow</strong></p>
    <div style="height:1px;line-height:1px;font-size:0;background:${C.line};margin:36px 0 18px">&nbsp;</div>
    <p style="margin:0;font-size:12.5px;line-height:1.6;color:${C.faint}">${footer}</p>
  </td></tr></table>
</td></tr></table>
</body></html>`;
}
var FEATURES = [
  ["\u0422\u0435\u0441\u0442\u0438 \u0439 \u043E\u043F\u0438\u0442\u0443\u0432\u0430\u043D\u043D\u044F", "\u043A\u043E\u043D\u0441\u0442\u0440\u0443\u043A\u0442\u043E\u0440 \u0456\u0437 7 \u0442\u0438\u043F\u0430\u043C\u0438 \u043F\u0438\u0442\u0430\u043D\u044C, AI-\u043F\u0435\u0440\u0435\u0432\u0456\u0440\u043A\u0430 \u0440\u043E\u0437\u0433\u043E\u0440\u043D\u0443\u0442\u0438\u0445 \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0435\u0439"],
  ["\u0416\u0443\u0440\u043D\u0430\u043B \u0456 \u0430\u043D\u0430\u043B\u0456\u0442\u0438\u043A\u0430", "\u043E\u0446\u0456\u043D\u043A\u0438 \u0437\u0430 12-\u0431\u0430\u043B\u044C\u043D\u043E\u044E \u0448\u043A\u0430\u043B\u043E\u044E, \u0437\u0432\u0456\u0442\u0438 \u043F\u043E \u0433\u0440\u0443\u043F\u0430\u0445 \u0456 \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u0430\u0445"],
  ["\u0406\u0433\u0440\u0438 \u043D\u0430\u0436\u0438\u0432\u043E", "\u0432\u0456\u043A\u0442\u043E\u0440\u0438\u043D\u0438 \u043D\u0430 \u0443\u0440\u043E\u0446\u0456 \u0437 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0456\u0432 \u0441\u0442\u0443\u0434\u0435\u043D\u0442\u0456\u0432"]
];
function inviteEmail({ link, name, fromName, expiresAt, message, site }) {
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
function broadcastEmail({ subject, body, button: btn, name, unsubUrl: unsubUrl2, site }) {
  const hello = name ? `\u0412\u0456\u0442\u0430\u0454\u043C\u043E, ${name}!` : "";
  return {
    subject,
    html: layout({
      site,
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

// ../worker/src/index.js
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
      if (url.pathname === "/" && request.method === "GET") return json({ ok: true, service: "quizflow-mail" }, 200, cors);
      const route = `${request.method} ${url.pathname}`;
      const handler = { "GET /status": status, "POST /preview": preview, "POST /invite": invite, "POST /broadcast": broadcast }[route];
      if (!handler) throw new HttpError(404, "\u041D\u0435\u0432\u0456\u0434\u043E\u043C\u0430 \u0430\u0434\u0440\u0435\u0441\u0430");
      const admin = await requireAdmin(request, env);
      const body = request.method === "POST" ? await readJson(request) : null;
      return json(await handler({ env, admin, body, url }), 200, cors);
    } catch (e) {
      const status2 = e instanceof HttpError ? e.status : 500;
      if (status2 === 500) console.error(e);
      return json({ ok: false, error: status2 === 500 ? "\u0412\u043D\u0443\u0442\u0440\u0456\u0448\u043D\u044F \u043F\u043E\u043C\u0438\u043B\u043A\u0430 \u0432\u043E\u0440\u043A\u0435\u0440\u0430" : e.message }, status2, cors);
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
  return { ok: true, from: env.MAIL_FROM || "", configured: { resend: !!env.RESEND_API_KEY, unsubscribe: !!env.UNSUB_SECRET, kv: !!env.MAIL_KV }, unsubscribed };
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
async function preview({ env, body }) {
  const m = checkMessage(body);
  return { ok: true, html: broadcastEmail({ ...m, name: "\u041E\u043B\u0435\u043D\u0430", unsubUrl: "#", site: env.SITE_URL }).html };
}
async function invite({ env, admin, body }) {
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
    site: env.SITE_URL
  });
  const res = await resend(env, "/emails", { from: env.MAIL_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text, ...admin.me.email ? { reply_to: admin.me.email } : {} });
  return { ok: true, id: res.id || null, to };
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
      const mail = broadcastEmail({ ...m, name: r.name, unsubUrl: un, site: env.SITE_URL });
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
<body><main class="c"><a class="l" href="${esc(site)}"><img src="${esc(site)}/assets/email/logo-light.png" alt="QuizFlow"></a><h1>${esc(title)}</h1><p>${esc(text)}</p>${btn}<div class="s">QuizFlow \xB7 <a href="${esc(site)}">${esc(site.replace(/^https?:\/\//, ""))}</a></div></main></body></html>`,
    { status: status2, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}
export {
  index_default as default
};

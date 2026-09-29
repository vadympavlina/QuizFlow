// ═══════════════════════════════════════════════════════════════════════
// QuizFlow Mail — Cloudflare Worker
//
// Сайт статичний, тож ключ Resend не можна тримати в його коді. Воркер
// зберігає ключ у секретах і надсилає листи лише на запит адміністратора
// (перевіряє Firebase ID-токен і роль у базі).
//
//   GET  /status        — стан налаштувань і список відписаних (адмін)
//   POST /preview       — HTML розсилки для попереднього перегляду (адмін)
//   POST /invite        — лист із запрошенням викладачу (адмін)
//   POST /broadcast     — розсилка викладачам або тестовий лист собі (адмін)
//   GET|POST /unsubscribe?u=&s= — відписка за підписаним посиланням з листа
// ═══════════════════════════════════════════════════════════════════════
import { HttpError, requireAdmin, dbRead } from "./auth.js";
import { inviteEmail, broadcastEmail, esc } from "./mail.js";

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const MAX_RECIPIENTS = 1000;
const BATCH = 100;   // максимум Resend для /emails/batch

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/unsubscribe") return await unsubscribe(request, env, url);
      if (url.pathname === "/" && request.method === "GET") return json({ ok: true, service: "quizflow-mail" }, 200, cors);
      const route = `${request.method} ${url.pathname}`;
      const handler = { "GET /status": status, "POST /preview": preview, "POST /invite": invite, "POST /broadcast": broadcast }[route];
      if (!handler) throw new HttpError(404, "Невідома адреса");
      const admin = await requireAdmin(request, env);
      const body = request.method === "POST" ? await readJson(request) : null;
      return json(await handler({ env, admin, body, url }), 200, cors);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ ok: false, error: status === 500 ? "Внутрішня помилка воркера" : e.message }, status, cors);
    }
  },
};

// ─── Відповіді ──────────────────────────────────────────────────────────
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const h = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
async function readJson(request) {
  const text = await request.text();
  if (text.length > 100_000) throw new HttpError(413, "Завеликий запит");
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError(400, "Некоректний JSON"); }
}

// ─── Resend ─────────────────────────────────────────────────────────────
async function resend(env, path, payload) {
  if (!env.RESEND_API_KEY) throw new HttpError(503, "На воркері не задано RESEND_API_KEY");
  const r = await fetch(`https://api.resend.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = r.status === 429 ? "Перевищено ліміт Resend — спробуйте пізніше"
      : data?.message ? `Resend: ${data.message}` : `Resend відповів ${r.status}`;
    throw new HttpError(r.status === 429 ? 429 : 502, msg);
  }
  return data;
}

// ─── Підпис посилань відписки ───────────────────────────────────────────
async function sign(env, uid) {
  if (!env.UNSUB_SECRET) throw new HttpError(503, "На воркері не задано UNSUB_SECRET");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.UNSUB_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsub:${uid}`)));
  return btoa(String.fromCharCode(...sig.slice(0, 18))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function unsubUrl(origin, env, uid) {
  return `${origin}/unsubscribe?u=${encodeURIComponent(uid)}&s=${await sign(env, uid)}`;
}
const safeEq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// ─── Маршрути адміна ────────────────────────────────────────────────────
async function status({ env }) {
  const unsubscribed = [];
  if (env.MAIL_KV) {
    let cursor;
    do {
      const page = await env.MAIL_KV.list({ prefix: "unsub:", cursor });
      page.keys.forEach(k => unsubscribed.push(k.name.slice(6)));
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  }
  return { ok: true, from: env.MAIL_FROM || "", configured: { resend: !!env.RESEND_API_KEY, unsubscribe: !!env.UNSUB_SECRET, kv: !!env.MAIL_KV }, unsubscribed };
}

function checkMessage(b) {
  const subject = String(b?.subject || "").trim();
  const body = String(b?.body || "").trim();
  if (!subject) throw new HttpError(400, "Вкажіть тему листа");
  if (subject.length > 150) throw new HttpError(400, "Тема задовга (до 150 символів)");
  if (!body) throw new HttpError(400, "Лист порожній");
  if (body.length > 20000) throw new HttpError(400, "Текст задовгий (до 20 000 символів)");
  let button = null;
  if (b?.button?.url) {
    const u = String(b.button.url).trim();
    if (!/^https:\/\/[^\s]+$/.test(u)) throw new HttpError(400, "Посилання кнопки має починатися з https://");
    button = { url: u, label: String(b.button.label || "Відкрити").trim().slice(0, 40) || "Відкрити" };
  }
  return { subject, body, button };
}

async function preview({ body }) {
  const m = checkMessage(body);
  return { ok: true, html: broadcastEmail({ ...m, name: "Олена", unsubUrl: "#" }).html };
}

async function invite({ env, admin, body }) {
  const to = String(body?.to || "").trim().toLowerCase();
  const token = String(body?.token || "");
  if (!EMAIL_RE.test(to) || to.length > 200) throw new HttpError(400, "Некоректна адреса email");
  if (!/^[a-z0-9]{8,64}$/i.test(token)) throw new HttpError(400, "Некоректне запрошення");
  const inv = await dbRead(env, `invite_tokens/${token}`, admin.token);
  if (!inv) throw new HttpError(404, "Запрошення не знайдено");
  if (inv.used === true) throw new HttpError(409, "Запрошення вже використано");
  if (inv.expiresAt && inv.expiresAt < Date.now()) throw new HttpError(409, "Термін запрошення минув");
  const fromName = [admin.me.name, admin.me.surname].filter(Boolean).join(" ");
  const mail = inviteEmail({
    link: `${env.SITE_URL}/register?token=${token}`,
    name: String(body?.name || "").trim().slice(0, 80),
    message: String(body?.message || "").trim().slice(0, 600),
    fromName, expiresAt: inv.expiresAt,
  });
  const res = await resend(env, "/emails", { from: env.MAIL_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text, ...(admin.me.email ? { reply_to: admin.me.email } : {}) });
  return { ok: true, id: res.id || null, to };
}

async function broadcast({ env, admin, body, url }) {
  const m = checkMessage(body);
  if (!env.UNSUB_SECRET) throw new HttpError(503, "На воркері не задано UNSUB_SECRET");
  let list;
  const skipped = { noEmail: 0, blocked: 0, unsubscribed: 0, missing: 0 };
  if (body?.test) {
    if (!EMAIL_RE.test(admin.me.email || "")) throw new HttpError(400, "У вашому профілі немає email для тестового листа");
    list = [{ uid: admin.uid, email: admin.me.email, name: admin.me.name || "" }];
  } else {
    const uids = [...new Set((Array.isArray(body?.uids) ? body.uids : []).map(String))];
    if (!uids.length) throw new HttpError(400, "Не обрано жодного отримувача");
    if (uids.length > MAX_RECIPIENTS) throw new HttpError(400, `Не більше ${MAX_RECIPIENTS} отримувачів за раз`);
    const users = await dbRead(env, "users", admin.token) || {};
    list = [];
    for (const uid of uids) {
      const u = users[uid];
      if (!u) { skipped.missing++; continue; }
      if (u.blocked === true) { skipped.blocked++; continue; }
      if (!EMAIL_RE.test(String(u.email || ""))) { skipped.noEmail++; continue; }
      if (env.MAIL_KV && await env.MAIL_KV.get(`unsub:${uid}`)) { skipped.unsubscribed++; continue; }
      list.push({ uid, email: String(u.email).trim(), name: u.name || "" });
    }
  }
  let sent = 0, failed = 0; const errors = [];
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    const payload = await Promise.all(chunk.map(async r => {
      const un = await unsubUrl(url.origin, env, r.uid);
      const mail = broadcastEmail({ ...m, name: r.name, unsubUrl: un });
      return {
        from: env.MAIL_FROM, to: [r.email], subject: mail.subject, html: mail.html, text: mail.text,
        headers: { "List-Unsubscribe": `<${un}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    }));
    try { await resend(env, "/emails/batch", payload); sent += chunk.length; }
    catch (e) { failed += chunk.length; errors.push(e.message); if (e.status === 429 || e.status === 503) { failed += list.length - i - chunk.length; break; } }
  }
  return { ok: failed === 0, sent, failed, skipped, errors: [...new Set(errors)].slice(0, 3), recipients: list.length };
}

// ─── Відписка ───────────────────────────────────────────────────────────
async function unsubscribe(request, env, url) {
  const uid = url.searchParams.get("u") || "", s = url.searchParams.get("s") || "";
  const valid = uid && s && env.UNSUB_SECRET && safeEq(await sign(env, uid), s);
  if (!valid) return page("Посилання недійсне", "Можливо, його скопійовано не повністю. Відкрийте посилання з листа ще раз.", 400);
  if (!env.MAIL_KV) return page("Сервіс недоступний", "Спробуйте пізніше.", 503);
  const key = `unsub:${uid}`;
  if (request.method === "POST") {
    const form = await request.text();
    // Поштові клієнти для кнопки «Відписатися» шлють «List-Unsubscribe=One-Click»
    if (/(^|&)action=resubscribe(&|$)/.test(form)) {
      await env.MAIL_KV.delete(key);
      return page("Підписку повернуто", "Ви знову отримуватимете розсилки QuizFlow.", 200, url, false);
    }
    await env.MAIL_KV.put(key, String(Date.now()));
    return page("Ви відписалися", "Розсилки з новинами QuizFlow більше не надходитимуть. Службові листи (запрошення, відновлення пароля) приходитимуть як і раніше.", 200, url, true);
  }
  // GET нічого не змінює: посилання в листах відкривають антивіруси й поштові сканери
  const already = !!(await env.MAIL_KV.get(key));
  return already
    ? page("Ви вже відписані", "Розсилки QuizFlow вам не надходять.", 200, url, true)
    : page("Відписатися від розсилок?", "Ви більше не отримуватимете листів із новинами та оголошеннями QuizFlow. Службові листи (запрошення, відновлення пароля) залишаться.", 200, url, null);
}

// state: null — кнопка «Відписатися», true — відписаний (кнопка повернути), false — підписаний
function page(title, text, status, url, state) {
  const action = url ? esc(url.pathname + url.search) : "";
  const btn = state === null ? `<form method="post" action="${action}"><button>Відписатися</button></form>`
    : state === true ? `<form method="post" action="${action}"><input type="hidden" name="action" value="resubscribe"><button class="ghost">Повернути підписку</button></form>` : "";
  return new Response(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — QuizFlow</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F1F4FA;font-family:Manrope,system-ui,sans-serif;color:#334155;padding:16px;box-sizing:border-box}
.c{background:#fff;border:1px solid #E2E8F0;border-radius:18px;padding:32px;max-width:440px;width:100%;box-sizing:border-box}
.l{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;color:#0F172A;margin-bottom:22px}.l i{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#4F46E5,#7C3AED)}
h1{font-size:21px;color:#0F172A;margin:0 0 10px;letter-spacing:-.3px}p{margin:0 0 22px;line-height:1.6;font-size:14.5px}
button{font:800 14px Manrope,system-ui,sans-serif;padding:12px 20px;border-radius:12px;border:0;background:#4F46E5;color:#fff;cursor:pointer}
button.ghost{background:#fff;color:#0F172A;border:1.5px solid #E2E8F0}</style></head>
<body><div class="c"><div class="l"><i></i>QuizFlow</div><h1>${esc(title)}</h1><p>${esc(text)}</p>${btn}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

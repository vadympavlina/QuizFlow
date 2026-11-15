// ═══════════════════════════════════════════════════════════════════════
// worker/src/telegram.js — сигнали адміну в Telegram. Токен бота — секрет TELEGRAM_BOT_TOKEN
// воркера, браузер викладача його не бачить. Текст будує воркер із перевірених полів.
//
//   POST /telegram/notice  { key, type: "limit"|"aierr", uid, ... }
//     limit — лише від самого викладача (Firebase ID-токен, uid збігається з токеном);
//     aierr — ще й зі сторінки тесту студента (без токена).
// Кожен ключ сигналу — лише один раз (KV), загалом не більше 60 повідомлень на годину.
// ═══════════════════════════════════════════════════════════════════════
import { HttpError, verifyIdToken } from "./auth.js";
import { dbGet } from "./ai.js";

const KEY_RE = /^[\w-]{1,160}$/;
const ID_RE = /^[\w-]{1,128}$/;
const LIMIT_LABEL = { maxTests: "тестів", maxActiveLinks: "активних посилань", aiPerMonth: "AI-запитів на місяць" };
const FEAT_LABEL = { comments: "коментарі студентам", analysis: "розбір помилок", generation: "генерація питань", textcheck: "перевірка відповідей", mail: "листи й розсилки" };
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.floor(n) : null; };
const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function noticeText(b, who) {
  if (b.type === "limit") {
    const limit = num(b.limit), used = num(b.used);
    const what = LIMIT_LABEL[b.key2];
    if (!what || limit === null) throw new HttpError(400, "Некоректний сигнал");
    return Number(b.level) >= 100 ? `${who} досяг ліміту ${what}: ${limit}` : `${who} використав ${used ?? "?"} з ${limit} ${what} (80%)`;
  }
  const errors = num(b.errors), what = FEAT_LABEL[b.feature];
  if (!what || errors === null) throw new HttpError(400, "Некоректний сигнал");
  return `Часті помилки AI у ${who}: ${what}, ${errors} помилок цього місяця`;
}

export async function telegramNotice(request, env, body) {
  const key = String(body?.key || ""), type = String(body?.type || ""), uid = String(body?.uid || "");
  if (!KEY_RE.test(key) || !ID_RE.test(uid) || !["limit", "aierr"].includes(type)) throw new HttpError(400, "Некоректний сигнал");
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let claims = null;
  if (token) claims = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
  if (type === "limit" && (!claims || claims.sub !== uid)) throw new HttpError(403, "Сигнал можна надіслати лише про себе");
  if (claims && claims.sub !== uid && type === "aierr") throw new HttpError(403, "Сигнал можна надіслати лише про себе");
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: true, sent: false, reason: "no_token" };

  if (env.MAIL_KV) {
    if (await env.MAIL_KV.get(`tg:${key}`)) return { ok: true, sent: false, reason: "duplicate" };
    const hk = `tgrl:${Math.floor(Date.now() / 3600e3)}`;
    const n = Number(await env.MAIL_KV.get(hk) || 0);
    if (n >= 60) throw new HttpError(429, "Забагато сигналів");
    await Promise.all([env.MAIL_KV.put(hk, String(n + 1), { expirationTtl: 7200 }), env.MAIL_KV.put(`tg:${key}`, "1", { expirationTtl: 60 * 86400 })]);
  }
  const [enabled, rec] = await Promise.all([dbGet(env, "settings/telegramBot/enabled"), dbGet(env, "settings/telegramBot/recipients")]);
  const to = Object.keys(rec || {}).filter(id => rec[id] && /^-?\d{1,20}$/.test(id));
  if (enabled !== true || !to.length) return { ok: true, sent: false, reason: "disabled" };

  let who = "Викладач";
  if (token) {
    const u = await dbGet(env, `users/${uid}`, token).catch(() => null);
    who = [u?.name, u?.surname].filter(Boolean).join(" ") || u?.email || who;
  }
  const text = `<b>QuizFlow · сигнал</b>\n${esc(noticeText({ ...body, type, key2: String(body?.limitKey || "") }, esc(who).slice(0, 120)))}`;
  await Promise.all(to.map(chat_id => fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
  }).catch(() => {})));
  return { ok: true, sent: true };
}

// ─── Telegram API для адмінки ───────────────────────────────────────────
// Сторінка «Telegram» в адмінці звертається до бота лише через воркер: токен у браузер не потрапляє.
const API_METHODS = new Set(["getMe", "sendMessage", "getUpdates", "deleteMessage"]);
export async function telegramApi({ env, body }) {
  if (!env.TELEGRAM_BOT_TOKEN) throw Object.assign(new HttpError(503, "На воркері не задано TELEGRAM_BOT_TOKEN"), { code: "no_token" });
  const method = String(body?.method || "");
  if (!API_METHODS.has(method)) throw new HttpError(400, "Невідомий метод Telegram");
  const params = body?.params && typeof body.params === "object" && !Array.isArray(body.params) ? body.params : {};
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
  });
  const d = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!d.ok) throw Object.assign(new HttpError(502, d.description || "Telegram API помилка"), { code: String(d.error_code || "tg") });
  return { ok: true, result: d.result };
}

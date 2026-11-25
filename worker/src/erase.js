// Повне видалення користувача: акаунт Firebase Auth і все, що в базі пов'язане з ним
// (профіль, тести, посилання, спроби, статистика, журнали, звернення, ігри, відписка).
// Працює від імені службового ключа, бо правила бази не дають адміну стирати чужий
// Auth-акаунт і журнали. Викликає лише адміністратор (POST /users/delete).
import { HttpError } from "./auth.js";
import { accessToken, serviceAccount } from "./google.js";

const dbUrl = (env, path, token, query = "") => `${env.FIREBASE_DB_URL}/${path}.json?${query ? query + "&" : ""}access_token=${encodeURIComponent(token)}`;

async function dbGet(env, token, path, query) {
  const r = await fetch(dbUrl(env, path, token, query));
  if (!r.ok) throw new HttpError(502, `База недоступна (${path})`);
  return r.json();
}

// Вузли, де записи можуть згадувати користувача (за ідентифікатором або поштою)
const SCAN = ["adminNotices", "bugReports", "adminTasks", "invite_tokens", "adminLog", "mailLog"];

export async function eraseUser({ env, admin, body }) {
  const uid = String(body?.uid || "");
  if (!/^[\w-]{2,128}$/.test(uid)) throw new HttpError(400, "Некоректний акаунт");
  if (uid === admin.uid) throw new HttpError(400, "Власний акаунт видалити не можна");
  if (!serviceAccount(env)) throw new HttpError(503, "На воркері не задано FIREBASE_SERVICE_ACCOUNT");
  const token = await accessToken(env);

  const [u, owner] = await Promise.all([dbGet(env, token, `users/${uid}`), dbGet(env, token, "settings/ownerUid")]);
  if (uid === owner) throw new HttpError(403, "Власника видалити не можна");
  if (u?.role === "admin" && admin.uid !== owner) throw new HttpError(403, "Адміністратора може видалити лише власник");
  const email = String(u?.email || "").trim().toLowerCase();

  // 1) Акаунт Auth. Якщо його вже немає (повторний запуск) — це не помилка
  const pid = serviceAccount(env).project_id || env.FIREBASE_PROJECT_ID;
  const del = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${pid}/accounts:delete`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ localId: uid }),
  });
  if (!del.ok) {
    const m = String((await del.json().catch(() => ({})))?.error?.message || "");
    if (!/USER_NOT_FOUND|EMAIL_NOT_FOUND/.test(m)) throw new HttpError(502, "Не вдалося видалити акаунт Firebase: " + (m || del.status));
  }

  // 2) Усе в базі
  const upd = {};
  ["teachers", "nameHistory", "attemptLog", "gameLog", "teacherStats", "bugStatus"].forEach(n => { upd[`${n}/${uid}`] = null; });
  const months = (await dbGet(env, token, "aiUsage", "shallow=true")) || {};
  Object.keys(months).forEach(m => { upd[`aiUsage/${m}/${uid}`] = null; });
  const mentions = v => { const s = JSON.stringify(v).toLowerCase(); return s.includes(uid.toLowerCase()) || (!!email && s.includes(email)); };
  for (const node of SCAN) {
    const all = (await dbGet(env, token, node)) || {};
    for (const [k, v] of Object.entries(all)) if (v && typeof v === "object" && mentions(v)) upd[`${node}/${k}`] = null;
  }
  const rooms = (await dbGet(env, token, "rooms", `orderBy=${encodeURIComponent('"hostUid"')}&equalTo=${encodeURIComponent(JSON.stringify(uid))}`)) || {};
  for (const [code, room] of Object.entries(rooms)) if (room?.hostUid === uid) upd[`rooms/${code}`] = null;
  upd[`users/${uid}`] = null;   // профіль — останнім: за ним повторний запуск знайде пошту

  const paths = Object.keys(upd);
  for (let i = 0; i < paths.length; i += 200) {
    const part = Object.fromEntries(paths.slice(i, i + 200).map(p => [p, null]));
    const r = await fetch(dbUrl(env, "", token), { method: "PATCH", body: JSON.stringify(part) });
    if (!r.ok) throw new HttpError(502, "Не вдалося стерти дані в базі");
  }

  // 3) Відписка від розсилок
  if (env.MAIL_KV) await env.MAIL_KV.delete(`unsub:${uid}`);
  return { ok: true, removed: paths.length };
}

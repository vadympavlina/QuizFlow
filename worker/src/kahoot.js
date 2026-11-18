// ═══════════════════════════════════════════════════════════════════════
// worker/src/kahoot.js — імпорт питань за посиланням на публічний Kahoot.
//
//   POST /import/kahoot  { url }  — викладач (Firebase ID-токен, дозвіл «Імпорт»)
//
// Kahoot не має офіційного відкритого API для читання питань. Тут використано адресу, яку віддає
// сам сайт для публічних тестів (create.kahoot.it/rest/kahoots/<id>). Вона не задокументована й
// може змінитися, тому будь-який збій перетворюється на зрозуміле повідомлення. Приватні тести
// (потрібен вхід у Kahoot) не завантажуються.
// ═══════════════════════════════════════════════════════════════════════
import { HttpError, verifyIdToken } from "./auth.js";
import { dbGet } from "./ai.js";
import { normalizeCfg, resolvePerms } from "./perms.js";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MAX_Q = 100;
const clean = s => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

// Один запис Kahoot → наше питання або null (тип не підтримується)
export function mapQuestion(q) {
  const text = clean(q?.question);
  const ch = Array.isArray(q?.choices) ? q.choices.map(c => ({ a: clean(c?.answer), ok: c?.correct === true })) : [];
  if (!text) return null;
  const type = String(q?.type || "");
  if (type === "quiz" || type === "multiple_select_quiz") {
    const opts = ch.filter(c => c.a);
    if (opts.length < 2) return null;
    const correct = opts.map((c, i) => c.ok ? i : -1).filter(i => i >= 0);
    return { type: correct.length > 1 ? "multi" : "single", text, options: opts.slice(0, 6).map(c => c.a), correct: correct.filter(i => i < 6) };
  }
  if (type === "open_ended") {
    const answers = ch.filter(c => c.a).map(c => c.a);
    return answers.length ? { type: "text", text, correct: answers.join(" / ") } : null;
  }
  if (type === "jumble") {
    const items = ch.filter(c => c.a).map(c => c.a).slice(0, 8);
    return items.length >= 3 ? { type: "ordering", text, items } : null;
  }
  return null;   // опитування, слайдер, хмара слів, слайд з матеріалом тощо
}

export async function importKahoot(request, env, body) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Потрібен вхід");
  const claims = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
  const [profile, cfg] = await Promise.all([dbGet(env, `users/${claims.sub}`, token), dbGet(env, "settings/features")]);
  if (!profile || !profile.role || profile.blocked === true) throw new HttpError(403, "Немає доступу");
  const perms = resolvePerms(cfg || {}, profile, null);
  if (profile.role !== "admin" && perms.perms["tests.import"] === false) throw new HttpError(403, "Імпорт недоступний для цього акаунта");

  const m = UUID_RE.exec(String(body?.url || ""));
  if (!m) throw new HttpError(400, "У посиланні не знайдено ідентифікатор Kahoot. Вставте адресу тесту, наприклад create.kahoot.it/share/…/…");
  const uuid = m[0].toLowerCase();

  if (env.MAIL_KV) {
    const key = `kh:${claims.sub}:${Math.floor(Date.now() / 36e5)}`;
    const n = Number(await env.MAIL_KV.get(key)) || 0;
    if (n >= 30) throw new HttpError(429, "Забагато імпортів за годину. Спробуйте пізніше.");
    await env.MAIL_KV.put(key, String(n + 1), { expirationTtl: 3700 });
  }

  let res;
  try { res = await fetch(`https://create.kahoot.it/rest/kahoots/${uuid}`, { headers: { Accept: "application/json" } }); }
  catch { throw new HttpError(502, "Не вдалося зв'язатися з Kahoot. Спробуйте пізніше."); }
  if (res.status === 404 || res.status === 403 || res.status === 401) throw new HttpError(404, "Тест не знайдено або він приватний. Імпорт працює лише з публічними тестами Kahoot.");
  if (!res.ok) throw new HttpError(502, `Kahoot відповів помилкою ${res.status}. Спробуйте пізніше або вставте питання текстом.`);
  const d = await res.json().catch(() => null);
  if (!d || !Array.isArray(d.questions)) throw new HttpError(502, "Kahoot змінив формат відповіді. Вставте питання текстом.");

  const out = [];
  let skipped = 0;
  for (const q of d.questions.slice(0, MAX_Q)) {
    const mq = mapQuestion(q);
    if (mq) out.push(mq); else skipped++;
  }
  if (!out.length) throw new HttpError(422, "У цьому тесті немає питань, які можна імпортувати (підтримуються вибір, кілька відповідей, коротка відповідь і порядок).");
  return { ok: true, title: clean(d.title).slice(0, 200), questions: out, skipped };
}

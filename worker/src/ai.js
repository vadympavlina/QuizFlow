// ═══════════════════════════════════════════════════════════════════════
// worker/src/ai.js — AI через воркер: ключі Groq і Gemini лежать у секретах Cloudflare, а не в базі.
//
//   POST /ai         — одна відповідь AI. Хто питає:
//                        • викладач чи адмін: Firebase ID-токен в Authorization;
//                        • студент зі сторінки тесту: без токена, лише для comments і textcheck, з посиланням
//                          на тест викладача (as: { teacherUid, linkId }), AI рахується викладачу.
//   GET  /ai/status  — чи є ключі у воркері (адмін); самих ключів не віддаємо.
//   GET  /ai/models  — моделі, які зараз доступні за ключами воркера (адмін): для вибору в адмінці.
//
// Воркер сам перевіряє те, що раніше вирішував браузер: дозвіл «AI» (shared/perms.js), увімкнення функції
// в адмінці, місячний ліміт викладача, режим «лише перегляд». Облік використання пише воркер.
// ═══════════════════════════════════════════════════════════════════════
import { HttpError, verifyIdToken, requireAdmin } from "./auth.js";
import { normalizeCfg, resolvePerms } from "./perms.js";

const FEATURE_FLAG = { comments: "aiComments", analysis: "aiAnalysis", generation: "aiGeneration", textcheck: "aiTextCheck", mail: "aiMail" };
const PUBLIC_FEATURES = new Set(["comments", "textcheck"]);          // їх викликає сторінка студента
const ID_RE = /^[\w-]{1,128}$/;
const UA = "Ти — розумний асистент викладача. ОБОВ'ЯЗКОВО відповідай ВИКЛЮЧНО українською мовою.";
const monthKey = (d = new Date()) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };

// Читання бази через REST: з токеном користувача або без нього (лише публічні шляхи)
export async function dbGet(env, path, token) {
  const r = await fetch(`${env.FIREBASE_DB_URL}/${path}.json${token ? `?auth=${encodeURIComponent(token)}` : ""}`);
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new HttpError(502, "База недоступна");
  return r.json();
}

// Місячний ліміт AI: особисто → ролі (найбільший, 0 = без обмежень) → для всіх. Дзеркало caps.js
function aiLimit(cfg, profile) {
  const own = num(profile.features?.limits?.aiPerMonth);
  if (own !== null) return own;
  const c = normalizeCfg(cfg, null);
  const ids = Array.isArray(profile.customRoleIds) ? profile.customRoleIds : Object.keys(profile.customRoleIds || {}).filter(k => profile.customRoleIds[k]);
  const rv = ids.map(id => num(c.roles[id]?.limits?.aiPerMonth)).filter(v => v !== null);
  if (rv.length) return rv.includes(0) ? 0 : Math.max(...rv);
  return num(c.limits?.aiPerMonth) || 0;
}

function readBody(b) {
  const feature = String(b?.feature || "");
  if (!FEATURE_FLAG[feature]) throw new HttpError(400, "Невідома функція AI");
  const messages = Array.isArray(b?.messages) ? b.messages : [];
  if (!messages.length || messages.length > 20) throw new HttpError(400, "Потрібно від 1 до 20 повідомлень");
  const clean = messages.map(m => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "").slice(0, 24000) }));
  if (clean.reduce((n, m) => n + m.content.length, 0) > 60000) throw new HttpError(413, "Завеликий запит");
  return {
    feature, messages: clean,
    maxTokens: Math.min(4000, Math.max(50, Number(b.maxTokens) || 800)),
    temp: Math.min(1, Math.max(0, b.temp === undefined ? 0.5 : Number(b.temp) || 0)),
    json: b.json === true,
    system: typeof b.system === "string" && b.system.trim() ? b.system.slice(0, 4000) : UA,
    as: b.as,
  };
}

// Хто питає і кому рахувати: { billed, profile, token, isAdmin }
async function whoIs(request, env, req) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (token) {
    const claims = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
    const profile = await dbGet(env, `users/${claims.sub}`, token);
    if (!profile || !profile.role || profile.blocked === true) throw new HttpError(403, "Немає доступу");
    const isAdmin = profile.role === "admin";
    if (req.feature === "mail" && !isAdmin) throw new HttpError(403, "Лише для адміністратора");
    return { billed: claims.sub, profile, token, isAdmin };
  }
  if (!PUBLIC_FEATURES.has(req.feature)) throw new HttpError(401, "Потрібен вхід");
  const t = String(req.as?.teacherUid || ""), l = String(req.as?.linkId || "");
  if (!ID_RE.test(t) || !ID_RE.test(l)) throw new HttpError(400, "Не вказано тест");
  if (!(await dbGet(env, `teachers/${t}/links/${l}`))) throw new HttpError(404, "Посилання не знайдено");
  // Профіль викладача для студента закритий; читаємо лише публічні поля
  const [features, customRoleIds] = await Promise.all([dbGet(env, `users/${t}/features`), dbGet(env, `users/${t}/customRoleIds`)]);
  return { billed: t, profile: { role: "teacher", features: features || undefined, customRoleIds: customRoleIds || {} }, token: "", isAdmin: false };
}

async function throttle(env, request) {
  if (!env.MAIL_KV) return;
  const ip = request.headers.get("CF-Connecting-IP") || "?";
  const key = `ai:${ip}:${Math.floor(Date.now() / 36e5)}`;
  const n = Number(await env.MAIL_KV.get(key)) || 0;
  if (n >= (Number(env.AI_ANON_PER_HOUR) || 120)) throw new HttpError(429, "Забагато запитів. Спробуйте за годину.");
  await env.MAIL_KV.put(key, String(n + 1), { expirationTtl: 3700 });
}

// Облік: ті самі лічильники aiUsage/{місяць}/{викладач}/{функція}, що й раніше писав браузер
async function track(env, uid, feature, { tokens = 0, ok = true }, token) {
  try {
    const base = `aiUsage/${monthKey()}/${uid}/${feature}`;
    const cur = (await dbGet(env, base, token)) || {};
    const put = (k, v) => fetch(`${env.FIREBASE_DB_URL}/${base}/${k}.json${token ? `?auth=${encodeURIComponent(token)}` : ""}`, { method: "PUT", body: JSON.stringify(v) });
    if (ok) {
      await put("calls", (Number(cur.calls) || 0) + 1);
      if (tokens > 0) await put("tokens", (Number(cur.tokens) || 0) + Math.min(tokens, 100000));
    } else await put("errors", (Number(cur.errors) || 0) + 1);
    await put("last", { ".sv": "timestamp" });
  } catch { /* облік не повинен ламати відповідь */ }
}

// Основний провайдер — з адмінки (для функції окремо); якщо він не відповів чи повернув помилку,
// автоматично пробуємо інший, коли для нього є ключ. Помилки самого запиту (400/403/413) не повторюємо.
async function callProvider(env, s, req) {
  const keys = {
    gemini: env.GEMINI_API_KEY || s.geminiApiKey || (s.provider === "gemini" ? s.apiKey : "") || "",
    groq: env.GROQ_API_KEY || s.groqApiKey || (s.provider !== "gemini" ? s.apiKey : "") || "",
  };
  const want = (s.featProviders && s.featProviders[req.feature]) || s.provider || "groq";
  const first = want === "gemini" ? (keys.gemini || !keys.groq ? "gemini" : "groq") : (keys.groq || !keys.gemini ? "groq" : "gemini");
  const second = first === "gemini" ? "groq" : "gemini";
  try {
    return await callOne(env, s, req, first, keys[first]);
  } catch (e) {
    const retriable = !(e instanceof HttpError) || e.status >= 500;
    if (!retriable || !keys[second]) throw e;
    const out = await callOne(env, s, req, second, keys[second]);
    return { ...out, fallback: true, failed: first };
  }
}

async function callOne(env, s, req, provider, key) {
  if (provider === "gemini") {
    if (!key) throw new HttpError(503, "AI не налаштовано: на воркері немає ключа Gemini");
    const model = s.geminiModel || "gemini-2.5-flash";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: req.maxTokens, temperature: req.temp, ...(req.json ? { responseMimeType: "application/json" } : {}), ...(/flash/i.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (d.error || !res.ok) throw new HttpError(502, "Gemini: " + (d.error?.message || `помилка ${res.status}`));
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text.trim()) throw new HttpError(502, "Gemini повернув порожню відповідь");
    return { text, tokens: Number(d.usageMetadata?.totalTokenCount) || 0, provider };
  }
  if (!key) throw new HttpError(503, "AI не налаштовано: на воркері немає ключа Groq");
  const model = s.groqModel || (s.provider !== "gemini" && s.model) || "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model, messages: [{ role: "system", content: req.system }, ...req.messages], max_tokens: req.maxTokens, temperature: req.temp, ...(req.json ? { response_format: { type: "json_object" } } : {}) }),
  });
  const d = await res.json().catch(() => ({}));
  if (d.error || !res.ok) throw new HttpError(502, "Groq: " + (d.error?.message || `помилка ${res.status}`));
  const text = d.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new HttpError(502, "Groq повернув порожню відповідь");
  return { text, tokens: Number(d.usage?.total_tokens) || 0, provider };
}

export async function aiChat(request, env, body) {
  const req = readBody(body);
  const who = await whoIs(request, env, req);
  if (!who.token) await throttle(env, request);
  const [cfg, s, own] = await Promise.all([dbGet(env, "settings/features"), dbGet(env, "settings/ai"), dbGet(env, `users/${who.billed}/aiSettings`)]);
  const nav = who.token && (cfg || {}).v !== 2 ? await dbGet(env, "settings/navigation", who.token) : null;
  const perms = resolvePerms(cfg || {}, who.profile, nav);
  if (!who.isAdmin && perms.perms.ai === false) throw new HttpError(403, "AI-функції недоступні для цього акаунта");
  const st = s || {}, flag = FEATURE_FLAG[req.feature];
  if (st.enabled === false || st[flag] === false || (own && own[flag] === false)) throw new HttpError(403, "Цю AI-функцію вимкнено адміністратором");
  if (!who.isAdmin) {
    const limit = aiLimit(cfg || {}, who.profile);
    if (limit) {
      const used = Object.values((await dbGet(env, `aiUsage/${monthKey()}/${who.billed}`)) || {}).reduce((n, f) => n + (Number(f?.calls) || 0), 0);
      if (used >= limit) throw Object.assign(new HttpError(429, `Ліміт AI-запитів на цей місяць вичерпано (${limit}). Зверніться до адміністратора.`), { code: "qf/ai-quota" });
    }
  }
  try {
    const out = await callProvider(env, st, req);
    await track(env, who.billed, req.feature, { tokens: out.tokens }, who.token);
    return { ok: true, text: out.text, tokens: out.tokens, provider: out.provider, ...(out.fallback ? { fallback: true } : {}) };
  } catch (e) {
    await track(env, who.billed, req.feature, { ok: false }, who.token);
    throw e;
  }
}

export async function aiStatus({ env }) {
  const s = (await dbGet(env, "settings/ai")) || {};
  return {
    ok: true,
    configured: { groq: !!env.GROQ_API_KEY, gemini: !!env.GEMINI_API_KEY },
    legacyKeysInDb: { groq: !!(s.groqApiKey || s.apiKey), gemini: !!s.geminiApiKey },
  };
}

// Списки моделей у провайдерів. Лишаємо лише текстові моделі для чату: без мовлення, ембедингів, картинок тощо.
const SKIP_GROQ = /whisper|tts|guard|distil|playai|orpheus|compound|embed|vision-preview/i;
const SKIP_GEMINI = /embedding|aqa|imagen|veo|tts|image|live|native-audio|learnlm|robotics|computer-use/i;
async function groqModels(key) {
  const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + key } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `помилка ${r.status}`);
  return (d.data || []).filter(m => m && m.id && m.active !== false && !SKIP_GROQ.test(m.id))
    .map(m => ({ id: String(m.id), ctx: Number(m.context_window) || 0, by: String(m.owned_by || "") }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
async function geminiModels(key) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `помилка ${r.status}`);
  return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => ({ id: String(m.name || "").replace(/^models\//, ""), name: String(m.displayName || ""), ctx: Number(m.inputTokenLimit) || 0 }))
    .filter(m => /^gemini-/.test(m.id) && !SKIP_GEMINI.test(m.id))
    .sort((a, b) => b.id.localeCompare(a.id));
}
export async function aiModels({ env }) {
  const one = async (key, fn) => {
    if (!key) return { ok: false, error: "Немає ключа у воркері", models: [] };
    try { return { ok: true, models: await fn(key) }; }
    catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200), models: [] }; }
  };
  const [groq, gemini] = await Promise.all([one(env.GROQ_API_KEY, groqModels), one(env.GEMINI_API_KEY, geminiModels)]);
  return { ok: true, groq, gemini };
}
export { requireAdmin };

// Ліміти безкоштовних планів в одному місці: Firebase (Cloud Monitoring), Cloudflare (GraphQL Analytics) і AI-провайдери.
//   GET /limits  (лише адмін) → { ok, at, sections: [{ id, title, state: "ok"|"unconfigured"|"error", hint?, error?, items: [...] }] }
// item = { key, label, used, limit|null, unit: "bytes"|"count", period: "день"|"місяць"|"хвилина"|"зараз", note?, stale? }
// Кожен розділ збирається окремо: помилка одного не ховає решту. Секретів назовні не віддаємо.
import { HttpError } from "./auth.js";
import { accessToken, serviceAccount } from "./google.js";

const GiB = 1024 ** 3;
// Безкоштовна квота Firebase Realtime Database (план Spark) і воркерів/KV Cloudflare (план Free)
const FB = { storage: 1 * GiB, download: 10 * GiB, connections: 100 };
const CF = { requests: 100_000, kvRead: 100_000, kvWrite: 1000, kvDelete: 1000, kvList: 1000 };

const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const monthStart = (t = Date.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const dayStart = (t = Date.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const iso = t => new Date(t).toISOString();

// ─── Firebase: Cloud Monitoring ─────────────────────────────────────────
async function monitoring(token, project, metric, { aligner, period, from, to }) {
  const q = new URLSearchParams({
    filter: `metric.type="${metric}"`, "interval.startTime": iso(from), "interval.endTime": iso(to),
    "aggregation.alignmentPeriod": `${period}s`, "aggregation.perSeriesAligner": aligner, "aggregation.crossSeriesReducer": "REDUCE_SUM", view: "FULL",
  });
  const r = await fetch(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(d?.error?.message || r.status);
    const e = new HttpError(r.status === 403 ? 403 : 502, msg);
    e.perm = r.status === 403 || /permission|not enabled|disabled/i.test(msg);
    throw e;
  }
  // Точки приходять від нових до старих; серій після REDUCE_SUM одна
  return (d.timeSeries?.[0]?.points || []).map(p => ({ t: Date.parse(p.interval?.endTime), v: num(p.value?.int64Value ?? p.value?.doubleValue) }));
}

async function firebaseSection(env) {
  const base = { id: "firebase", title: "Firebase · Realtime Database" };
  if (!serviceAccount(env)) return { ...base, state: "unconfigured", hint: "На воркері немає секрету FIREBASE_SERVICE_ACCOUNT (службовий ключ Firebase)." };
  const project = env.FIREBASE_PROJECT_ID, now = Date.now();
  try {
    const token = await accessToken(env);
    const [storage, sent, conns] = await Promise.all([
      monitoring(token, project, "firebasedatabase.googleapis.com/storage/total_bytes", { aligner: "ALIGN_MAX", period: 3600, from: now - 36e5 * 6, to: now }),
      monitoring(token, project, "firebasedatabase.googleapis.com/network/sent_bytes_count", { aligner: "ALIGN_SUM", period: 86400, from: monthStart(now), to: now }),
      monitoring(token, project, "firebasedatabase.googleapis.com/network/active_connections", { aligner: "ALIGN_MAX", period: 3600, from: now - 864e5, to: now }),
    ]);
    return {
      ...base, state: "ok", plan: "Безкоштовна квота (Spark)",
      items: [
        { key: "fb-storage", label: "Сховище бази", used: storage[0]?.v ?? 0, limit: FB.storage, unit: "bytes", period: "зараз" },
        { key: "fb-download", label: "Завантажено з бази", used: sent.reduce((s, p) => s + p.v, 0), limit: FB.download, unit: "bytes", period: "місяць" },
        { key: "fb-conns", label: "Одночасні підключення (пік)", used: Math.max(0, ...conns.map(p => p.v)), limit: FB.connections, unit: "count", period: "24 години" },
      ],
    };
  } catch (e) {
    if (e.perm) return { ...base, state: "unconfigured", hint: "Службовому акаунту потрібна роль «Monitoring Viewer» у Google Cloud, а також увімкнений Cloud Monitoring API.", error: String(e.message).slice(0, 200) };
    return { ...base, state: "error", error: String(e.message || e).slice(0, 200) };
  }
}

// ─── Cloudflare: GraphQL Analytics ──────────────────────────────────────
const CF_QUERY = `query($acc:String!,$from:Time!,$to:Time!,$script:String!){viewer{accounts(filter:{accountTag:$acc}){
  w:workersInvocationsAdaptive(limit:1000,filter:{scriptName:$script,datetime_geq:$from,datetime_leq:$to}){sum{requests errors}}
  kv:kvOperationsAdaptiveGroups(limit:100,filter:{datetime_geq:$from,datetime_leq:$to}){sum{requests} dimensions{actionType}}
}}}`;

async function cloudflareSection(env) {
  const base = { id: "cloudflare", title: "Cloudflare · Worker і KV" };
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { ...base, state: "unconfigured", hint: "На воркері немає секретів CF_API_TOKEN (токен з правом читати Analytics) і CF_ACCOUNT_ID." };
  const now = Date.now();
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: CF_QUERY, variables: { acc: env.CF_ACCOUNT_ID, from: iso(dayStart(now)), to: iso(now), script: env.CF_SCRIPT_NAME || "quizflow-mail" } }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) return { ...base, state: "unconfigured", hint: "Cloudflare не прийняв токен: потрібне право Account → Account Analytics → Read.", error: `HTTP ${r.status}` };
    if (!r.ok || d.errors?.length) return { ...base, state: "error", error: String(d.errors?.[0]?.message || `HTTP ${r.status}`).slice(0, 200) };
    const acc = d.data?.viewer?.accounts?.[0] || {};
    const requests = (acc.w || []).reduce((s, g) => s + num(g.sum?.requests), 0), errors = (acc.w || []).reduce((s, g) => s + num(g.sum?.errors), 0);
    const kv = { read: 0, write: 0, delete: 0, list: 0 };
    (acc.kv || []).forEach(g => { const k = String(g.dimensions?.actionType || "").toLowerCase(); if (k in kv) kv[k] += num(g.sum?.requests); });
    return {
      ...base, state: "ok", plan: "Безкоштовний план (Free), дні рахуються за UTC",
      items: [
        { key: "cf-requests", label: "Запити до воркера", used: requests, limit: CF.requests, unit: "count", period: "день", note: errors ? `з помилками: ${errors}` : "" },
        { key: "cf-kv-read", label: "KV: читання", used: kv.read, limit: CF.kvRead, unit: "count", period: "день" },
        { key: "cf-kv-write", label: "KV: запис", used: kv.write, limit: CF.kvWrite, unit: "count", period: "день" },
        { key: "cf-kv-delete", label: "KV: видалення", used: kv.delete, limit: CF.kvDelete, unit: "count", period: "день" },
        { key: "cf-kv-list", label: "KV: списки", used: kv.list, limit: CF.kvList, unit: "count", period: "день" },
      ],
    };
  } catch (e) {
    return { ...base, state: "error", error: String(e.message || e).slice(0, 200) };
  }
}

// ─── AI: облік запитів воркера і ліміти, які повідомляє Groq ────────────
// Воркер сам пише в базу (службовим ключем, правила їх не відкривають): aiProv/{день UTC}/{провайдер} = { calls, ok, err, r429, tokens }
// та aiProv/limits/{провайдер} = останні заголовки ліміту. Без службового ключа облік мовчки вимкнений.
const DUR = /(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?/;
export function parseDuration(s) {
  const m = DUR.exec(String(s || "").trim());
  if (!m || !m[0]) return null;
  return num(m[1]) * 3600 + num(m[2]) * 60 + num(m[3]) + num(m[4]) / 1000;
}
export function pickRateLimit(headers) {
  if (!headers?.get) return null;
  const g = k => headers.get(k);
  const rl = { limitReq: num(g("x-ratelimit-limit-requests")), remReq: g("x-ratelimit-remaining-requests"), limitTok: num(g("x-ratelimit-limit-tokens")), remTok: g("x-ratelimit-remaining-tokens"), resetReq: parseDuration(g("x-ratelimit-reset-requests")), resetTok: parseDuration(g("x-ratelimit-reset-tokens")) };
  return rl.limitReq || rl.limitTok ? rl : null;
}

const dbUrl = (env, path, token) => `${env.FIREBASE_DB_URL}/${path}.json?access_token=${encodeURIComponent(token)}`;

export async function recordAi(env, provider, { ok, status, tokens = 0, rl = null }) {
  if (!serviceAccount(env) || !/^(groq|gemini)$/.test(provider)) return;
  try {
    const token = await accessToken(env);
    const inc = n => ({ ".sv": { increment: n } });
    const body = { calls: inc(1), [ok ? "ok" : "err"]: inc(1), ...(status === 429 ? { r429: inc(1) } : {}), ...(ok && tokens > 0 ? { tokens: inc(Math.min(tokens, 100000)) } : {}) };
    const writes = [fetch(dbUrl(env, `aiProv/${dayKey()}/${provider}`, token), { method: "PATCH", body: JSON.stringify(body) })];
    if (rl) writes.push(fetch(dbUrl(env, `aiProv/limits/${provider}`, token), { method: "PUT", body: JSON.stringify({ ...rl, at: Date.now() }) }));
    await Promise.all(writes);
  } catch { /* облік не повинен ламати відповідь AI */ }
}

async function aiSection(env) {
  const base = { id: "ai", title: "AI · Groq і Gemini" };
  const have = { groq: !!env.GROQ_API_KEY, gemini: !!env.GEMINI_API_KEY };
  if (!serviceAccount(env)) return { ...base, state: "unconfigured", hint: "Для обліку запитів до AI воркеру потрібен секрет FIREBASE_SERVICE_ACCOUNT.", providers: have };
  try {
    const token = await accessToken(env), now = Date.now();
    const get = async p => { const r = await fetch(dbUrl(env, p, token)); if (!r.ok) throw new HttpError(502, `База: ${r.status}`); return r.json(); };
    const [today, lim] = await Promise.all([get(`aiProv/${dayKey(now)}`), get("aiProv/limits")]);
    const items = [];
    for (const prov of ["groq", "gemini"]) {
      if (!have[prov]) continue;
      const name = prov === "groq" ? "Groq" : "Gemini", d = today?.[prov] || {};
      const L = lim?.[prov];
      if (prov === "groq" && L) {
        const age = (now - num(L.at)) / 1000;
        const rem = x => (x === null || x === undefined || x === "" ? null : num(x));
        if (L.limitReq && rem(L.remReq) !== null) items.push({ key: "groq-day", label: "Groq: запити", used: Math.max(0, L.limitReq - rem(L.remReq)), limit: L.limitReq, unit: "count", period: "день", note: L.resetReq ? `оновиться через ${fmtDur(Math.max(0, L.resetReq - age))}` : "", asOf: L.at });
        if (L.limitTok && rem(L.remTok) !== null) {
          const stale = L.resetTok !== null && age > num(L.resetTok);
          items.push({ key: "groq-tpm", label: "Groq: токени за хвилину", used: stale ? 0 : Math.max(0, L.limitTok - rem(L.remTok)), limit: L.limitTok, unit: "count", period: "хвилина", stale, asOf: L.at });
        }
      }
      items.push({ key: `${prov}-calls`, label: `${name}: запити воркера`, used: num(d.calls), limit: prov === "gemini" ? (num(env.GEMINI_DAILY_LIMIT) || null) : null, unit: "count", period: "день", note: [num(d.err) ? `помилок: ${num(d.err)}` : "", num(d.r429) ? `ліміт перевищено (429): ${num(d.r429)}` : ""].filter(Boolean).join(" · ") });
    }
    return { ...base, state: "ok", providers: have, items, hint: have.gemini && !num(env.GEMINI_DAILY_LIMIT) ? "Gemini не повідомляє залишок у відповідях. Щоб бачити смугу, задайте змінну воркера GEMINI_DAILY_LIMIT (запитів на день для вашої моделі)." : "" };
  } catch (e) {
    return { ...base, state: "error", error: String(e.message || e).slice(0, 200), providers: have };
  }
}
const fmtDur = s => s >= 3600 ? `${Math.round(s / 3600)} год` : s >= 60 ? `${Math.round(s / 60)} хв` : `${Math.max(1, Math.round(s))} с`;

export async function limitsReport({ env }) {
  const sections = await Promise.all([firebaseSection(env), cloudflareSection(env), aiSection(env)]);
  return { ok: true, at: Date.now(), sections };
}

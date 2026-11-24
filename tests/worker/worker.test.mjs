// Юніт-тести воркера пошти (worker/src): справжня перевірка підпису RS256,
// а Google, база Firebase, Resend і KV — підмінені.  npm run worker
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const KAHOOT = JSON.parse(readFileSync(new URL("./fixtures/kahoot-sample.json", import.meta.url), "utf8"));
// WORKER_DIST=1 — ті самі тести на зібраному файлі worker/dist/worker.js (його вставляють у редактор Cloudflare)
const worker = (await import(process.env.WORKER_DIST ? "../../worker/dist/worker.js" : "../../worker/src/index.js")).default;

const PROJECT = "quizflow-test", DB = "https://db.test";
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const b64u = b => Buffer.from(b).toString("base64url");
async function idToken(uid, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, iat: now, exp: now + 3600, ...over }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

// Службовий ключ для /reset: окрема пара ключів, публічна — щоб перевірити підпис JWT
const saKeys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const saPem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey("pkcs8", saKeys.privateKey)).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
const SA = JSON.stringify({ type: "service_account", project_id: PROJECT, client_email: "mail@quizflow-test.iam.gserviceaccount.com", private_key: saPem });
let google;   // { tokenCalls, oob: [], jwtOk }

let kahootStatus = 200, tg, db, sent, kv, resendStatus, aiCalls, aiWrites, aiFail, modelsFail, envOver = {}, mon, cfGql, svcWrites, groqHeaders, aiStatus429;
const baseEnv = () => ({
  FIREBASE_PROJECT_ID: PROJECT, FIREBASE_DB_URL: DB, SITE_URL: "https://quizflow.space", MAIL_FROM: "QuizFlow <noreply@quizflow.space>",
  ALLOWED_ORIGINS: "https://quizflow.space", RESEND_API_KEY: "re_test", TELEGRAM_BOT_TOKEN: "123:tgsecret", UNSUB_SECRET: "s3cret", FIREBASE_SERVICE_ACCOUNT: SA, GROQ_API_KEY: "gsk_env", GEMINI_API_KEY: "gem_env",
  MAIL_KV: { get: async k => kv.get(k) ?? null, put: async (k, v, opts) => void kv.set(k, v), delete: async k => void kv.delete(k),
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) },
});
const env = () => ({ ...baseEnv(), ...envOver });
beforeEach(() => {
  envOver = {}; mon = { fail: 0 }; cfGql = { status: 200 }; svcWrites = []; groqHeaders = null; aiStatus429 = false;
  kv = new Map(); kahootStatus = 200; tg = []; sent = []; resendStatus = 200; aiCalls = []; aiWrites = []; aiFail = false; modelsFail = false; google = { tokenCalls: 0, oob: [], jwtOk: null };
  db = {
    users: {
      adm: { role: "admin", name: "Адмін", email: "admin@quizflow.space" },
      t1: { role: "teacher", name: "Олена", email: "olena@example.com" },
      t2: { role: "teacher", name: "Іван", email: "ivan@example.com" },
      t3: { role: "teacher", name: "Блок", email: "b@example.com", blocked: true },
      t4: { role: "teacher", name: "Без пошти" },
    },
    settings: { ai: { enabled: true, groqModel: "llama-test" }, features: { v: 2 }, telegramBot: { enabled: true, recipients: { "111": true, "222": false } } },
    teachers: { t1: { links: { L1: { testId: "T1", status: "open" } } } },
    aiUsage: {},
    invite_tokens: { tok12345: { used: false, expiresAt: Date.now() + 864e5 }, used1234: { used: true }, old12345: { expiresAt: Date.now() - 1 } },
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === "www.googleapis.com") return Response.json({ keys: [jwk] });
    if (u.hostname === "oauth2.googleapis.com") {
      google.tokenCalls++;
      const jwt = new URLSearchParams(init.body).get("assertion").split(".");
      google.jwtOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", saKeys.publicKey, Buffer.from(jwt[2], "base64url"), new TextEncoder().encode(jwt[0] + "." + jwt[1]))
        && JSON.parse(Buffer.from(jwt[1], "base64url")).iss === "mail@quizflow-test.iam.gserviceaccount.com";
      return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (u.hostname === "identitytoolkit.googleapis.com") {
      const b = JSON.parse(init.body); google.oob.push({ ...b, auth: init.headers.Authorization });
      if (b.email === "ghost@example.com") return Response.json({ error: { message: "EMAIL_NOT_FOUND" } }, { status: 400 });
      return Response.json({ email: b.email, oobLink: `https://${PROJECT}.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=CODE-${b.email.split("@")[0]}&apiKey=x&lang=uk` });
    }
    if (u.hostname === "monitoring.googleapis.com") {
      if (mon.fail) return Response.json({ error: { message: mon.fail === 403 ? "Permission monitoring.timeSeries.list denied" : "boom" } }, { status: mon.fail });
      const metric = u.searchParams.get("filter");
      const pts = /storage\/total_bytes/.test(metric) ? [500 * 1024 * 1024, 400 * 1024 * 1024] : /sent_bytes/.test(metric) ? [2 * 1024 ** 3, 1024 ** 3] : [7, 42, 3];
      return Response.json({ timeSeries: [{ points: pts.map((v, i) => ({ interval: { endTime: new Date(Date.now() - i * 36e5).toISOString() }, value: { int64Value: String(v) } })) }] });
    }
    if (u.hostname === "api.cloudflare.com") {
      if (cfGql.status !== 200) return Response.json({ errors: [{ message: "denied" }] }, { status: cfGql.status });
      return Response.json({ data: { viewer: { accounts: [{ w: [{ sum: { requests: 6000, errors: 12 } }, { sum: { requests: 4000, errors: 0 } }], kv: [{ sum: { requests: 800 }, dimensions: { actionType: "read" } }, { sum: { requests: 950 }, dimensions: { actionType: "write" } }, { sum: { requests: 3 }, dimensions: { actionType: "list" } }] }] } } });
    }
    if (u.origin === DB && u.searchParams.get("access_token")) {
      // службовий ключ: правила бази не діють
      const path = u.pathname.replace(/^\/|\.json$/g, ""), keys = path.split("/");
      if (init.method === "PATCH" || init.method === "PUT") {
        const body = JSON.parse(init.body); let n = db; keys.slice(0, -1).forEach(k => { n = n[k] ??= {}; });
        const last = keys.at(-1), apply = (o, v) => { for (const [k, x] of Object.entries(v)) o[k] = x && x[".sv"]?.increment ? (Number(o[k]) || 0) + x[".sv"].increment : x; };
        if (init.method === "PUT") n[last] = body; else apply(n[last] ??= {}, body);
        svcWrites.push([init.method, path, body]);
        return Response.json(n[last]);
      }
      return Response.json(keys.reduce((n, k) => n?.[k], db) ?? null);
    }
    if (u.origin === DB) {
      // Мінімальні «правила»: публічні шляхи читає будь-хто, решту (профілі, адмін) — лише з токеном
      const path = u.pathname.replace(/^\/|\.json$/g, ""), token = u.searchParams.get("auth");
      const PUBLIC = [/^settings\/(features|ai)(\/|$)/, /^settings\/telegramBot\/(enabled|recipients)(\/|$)/, /^aiUsage\//, /^teachers\/[^/]+\/links\/[^/]+/, /^users\/[^/]+\/(features|customRoleIds|aiSettings)(\/|$)/];
      const isPublic = PUBLIC.some(r => r.test(path));
      if (init.method === "PUT") {
        // запис лічильників aiUsage дозволено всім (як у правилах бази)
        if (!/^aiUsage\//.test(path)) return new Response('{"error":"Permission denied"}', { status: 401 });
        const keys = path.split("/"); let n = db; keys.slice(0, -1).forEach(k => { n = n[k] ??= {}; });
        n[keys.at(-1)] = JSON.parse(init.body); aiWrites.push([path, n[keys.at(-1)]]);
        return Response.json(n[keys.at(-1)]);
      }
      if (!isPublic) {
        if (!token) return new Response('{"error":"Permission denied"}', { status: 401 });
        const uid = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
        const isAdmin = db.users[uid]?.role === "admin";
        if (!isAdmin && path !== `users/${uid}` && !/^settings\//.test(path) && !path.startsWith(`bugStatus/${uid}/`)) return new Response('{"error":"Permission denied"}', { status: 401 });
      }
      return Response.json(path.split("/").reduce((n, k) => n?.[k], db) ?? null);
    }
    if (u.pathname.endsWith("/models") && (u.hostname === "api.groq.com" || u.hostname === "generativelanguage.googleapis.com")) {
      if (modelsFail) return Response.json({ error: { message: "bad key" } }, { status: 401 });
      return u.hostname === "api.groq.com"
        ? Response.json({ data: [{ id: "llama-3.3-70b-versatile", active: true, context_window: 131072, owned_by: "Meta" }, { id: "whisper-large-v3", active: true }, { id: "qwen/qwen3-32b", active: true, context_window: 131072 }, { id: "old-model", active: false }] })
        : Response.json({ models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent"] }, { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }, { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] }] });
    }
    if (u.hostname === "api.groq.com" || u.hostname === "generativelanguage.googleapis.com") {
      aiCalls.push({ host: u.hostname, headers: init.headers, body: JSON.parse(init.body), url: String(url) });
      if (aiStatus429 && u.hostname === "api.groq.com") return Response.json({ error: { message: "rate" } }, { status: 429, headers: groqHeaders || {} });
      if (aiFail === true || (aiFail === "groq" && u.hostname === "api.groq.com") || (aiFail === "gemini" && u.hostname !== "api.groq.com")) return Response.json({ error: { message: "boom" } }, { status: 500 });
      return u.hostname === "api.groq.com"
        ? Response.json({ choices: [{ message: { content: "Відповідь Groq" } }], usage: { total_tokens: 42 } }, { headers: groqHeaders || {} })
        : Response.json({ candidates: [{ content: { parts: [{ text: "Відповідь Gemini" }] } }], usageMetadata: { totalTokenCount: 17 } });
    }
    if (u.hostname === "create.kahoot.it") return kahootStatus === 200 ? Response.json(KAHOOT) : new Response("{}", { status: kahootStatus });
    if (u.hostname === "api.telegram.org") { if (/getMe$/.test(u.pathname)) return Response.json({ ok: true, result: { username: "qf_bot", first_name: "QuizFlow" } }); if (/getUpdates$/.test(u.pathname)) return Response.json({ ok: false, error_code: 409, description: "conflict" }); tg.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ ok: true }); }
    if (u.hostname === "api.resend.com") {
      if (resendStatus !== 200) return Response.json({ message: "rate" }, { status: resendStatus });
      const body = JSON.parse(init.body);
      sent.push(...(Array.isArray(body) ? body : [body]));
      return Response.json(Array.isArray(body) ? { data: body.map((_, i) => ({ id: "e" + i })) } : { id: "e1" });
    }
    throw new Error("unexpected fetch " + url);
  };
});
const call = async (method, path, { uid = "adm", body, token, origin = "https://quizflow.space" } = {}) => {
  const headers = { Origin: origin, "Content-Type": "application/json" };
  const t = token ?? (uid ? await idToken(uid) : "");
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await worker.fetch(new Request(`https://mail.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env());
  const type = res.headers.get("Content-Type") || "";
  return { status: res.status, headers: res.headers, data: type.includes("json") ? await res.json() : await res.text() };
};
const msg = { subject: "Оновлення QuizFlow", body: "Привіт!\n\n- пункт **один**\n- пункт два\n\nДеталі: https://quizflow.space/news" };

test("CORS: дозволене джерело отримує заголовок, чуже — ні", async () => {
  const ok = await worker.fetch(new Request("https://mail.test/status", { method: "OPTIONS", headers: { Origin: "https://quizflow.space" } }), env());
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://quizflow.space");
  const bad = await worker.fetch(new Request("https://mail.test/status", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env());
  assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
});

test("доступ: без токена, з підробленим токеном і не-адміну — відмова", async () => {
  assert.equal((await call("GET", "/status", { uid: "" })).status, 401);
  const forged = (await idToken("adm")).replace(/\.[^.]+$/, ".AAAA");
  assert.equal((await call("GET", "/status", { token: forged })).status, 401);
  assert.equal((await call("GET", "/status", { token: await idToken("adm", { aud: "other" }) })).status, 401);
  assert.equal((await call("GET", "/status", { token: await idToken("adm", { exp: 1 }) })).status, 401);
  assert.equal((await call("GET", "/status", { uid: "t1" })).status, 403);
  const r = await call("GET", "/status");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.configured, { resend: true, unsubscribe: true, kv: true, serviceAccount: true });
});

test("запрошення: надсилає лист з посиланням на реєстрацію", async () => {
  const r = await call("POST", "/invite", { body: { to: "New@Example.com", token: "tok12345", name: "Оксано", message: "Чекаємо <b>вас</b>" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["new@example.com"]);
  assert.equal(sent[0].reply_to, "admin@quizflow.space");
  assert.match(sent[0].html, /https:\/\/quizflow\.space\/register\?token=tok12345/);
  assert.match(sent[0].html, /Чекаємо &lt;b&gt;вас&lt;\/b&gt;/, "текст адміна екранується");
  assert.match(sent[0].text, /register\?token=tok12345/);
});

test("запрошення: використане, прострочене, чуже або з кривою адресою — відмова", async () => {
  assert.equal((await call("POST", "/invite", { body: { to: "a@b.co", token: "used1234" } })).status, 409);
  assert.equal((await call("POST", "/invite", { body: { to: "a@b.co", token: "old12345" } })).status, 409);
  assert.equal((await call("POST", "/invite", { body: { to: "a@b.co", token: "nope1234" } })).status, 404);
  assert.equal((await call("POST", "/invite", { body: { to: "not-an-email", token: "tok12345" } })).status, 400);
  assert.equal((await call("POST", "/invite", { uid: "t1", body: { to: "a@b.co", token: "tok12345" } })).status, 403);
  assert.equal(sent.length, 0);
});

test("розсилка: пропускає заблокованих, без пошти й відписаних; кладе посилання відписки", async () => {
  kv.set("unsub:t2", "1");
  const r = await call("POST", "/broadcast", { body: { ...msg, uids: ["t1", "t2", "t3", "t4", "ghost"], button: { label: "Відкрити", url: "https://quizflow.space/news" } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sent, 1);
  assert.deepEqual(r.data.skipped, { noEmail: 1, blocked: 1, unsubscribed: 1, missing: 1 });
  assert.deepEqual(sent.map(m => m.to[0]), ["olena@example.com"]);
  const m = sent[0];
  assert.match(m.headers["List-Unsubscribe"], /^<https:\/\/mail\.test\/unsubscribe\?u=t1&s=[\w-]+>$/);
  assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(m.html, /<ul/); assert.match(m.html, /<strong[^>]*>один<\/strong>/); assert.match(m.html, /Вітаємо, Олена!/);
  assert.match(m.text, /Відписатися від розсилок: https:\/\/mail\.test\/unsubscribe/);
});

test("розсилка: тестовий лист іде лише адміну; помилка Resend повертається", async () => {
  const r = await call("POST", "/broadcast", { body: { ...msg, test: true, uids: ["t1"] } });
  assert.equal(r.data.sent, 1);
  assert.deepEqual(sent.map(m => m.to[0]), ["admin@quizflow.space"]);
  resendStatus = 429;
  const f = await call("POST", "/broadcast", { body: { ...msg, uids: ["t1"] } });
  assert.equal(f.data.ok, false); assert.equal(f.data.failed, 1); assert.match(f.data.errors[0], /ліміт/);
});

test("розсилка: перевірка теми, тексту й кнопки", async () => {
  assert.equal((await call("POST", "/broadcast", { body: { body: "x", uids: ["t1"] } })).status, 400);
  assert.equal((await call("POST", "/broadcast", { body: { subject: "x", body: "", uids: ["t1"] } })).status, 400);
  assert.equal((await call("POST", "/broadcast", { body: { ...msg, uids: ["t1"], button: { url: "javascript:alert(1)" } } })).status, 400);
  assert.equal((await call("POST", "/broadcast", { body: { ...msg, uids: [] } })).status, 400);
  const p = await call("POST", "/preview", { body: { ...msg, body: "<script>alert(1)</script>" } });
  assert.doesNotMatch(p.data.html, /<script>/);
});

test("новий акаунт: лист з даними для входу на адресу з бази", async () => {
  const r = await call("POST", "/welcome", { body: { uid: "t1ab12", password: "Tmp-Pass-2026" } });
  assert.equal(r.status, 404);
  db.users.t1ab12 = { role: "teacher", name: "Оксана", email: "oksana@example.com" };
  const ok = await call("POST", "/welcome", { body: { uid: "t1ab12", password: "Tmp-Pass-2026" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(sent[0].to, ["oksana@example.com"]);
  // воркер має службовий ключ — пароль у листі не надсилається, замість нього посилання «Задати пароль»
  assert.doesNotMatch(sent[0].html, /Tmp-Pass-2026/);
  assert.doesNotMatch(sent[0].text, /Tmp-Pass-2026/);
  assert.match(sent[0].html, /Задати пароль/);
  assert.match(sent[0].html, /auth-action\?mode=resetPassword&amp;oobCode=CODE-oksana|auth-action\?mode=resetPassword&oobCode=CODE-oksana/);
  const nopass = await call("POST", "/welcome", { body: { uid: "t1ab12" } });
  assert.equal(nopass.status, 200);
  assert.doesNotMatch(sent[1].html, /Пароль<\/td>/);
  // без службового ключа лист лишається як раніше: з тимчасовим паролем
  const noSa = { ...env(), FIREBASE_SERVICE_ACCOUNT: undefined };
  const r2 = await worker.fetch(new Request("https://mail.test/welcome", { method: "POST", headers: { Origin: "https://quizflow.space", Authorization: `Bearer ${await idToken("adm")}`, "Content-Type": "application/json" }, body: JSON.stringify({ uid: "t1ab12", password: "Tmp-Pass-2026" }) }), noSa);
  assert.equal(r2.status, 200);
  assert.match(sent.at(-1).html, /Tmp-Pass-2026/);
  db.users.t1ab12.blocked = true;
  assert.equal((await call("POST", "/welcome", { body: { uid: "t1ab12" } })).status, 409);
  assert.equal((await call("POST", "/welcome", { uid: "t1", body: { uid: "t1ab12" } })).status, 403);
  assert.equal((await call("POST", "/welcome", { body: { uid: "../x" } })).status, 400);
});

test("зміна пароля: лист у нашому дизайні з посиланням на auth-action", async () => {
  const r = await call("POST", "/reset", { uid: "", body: { email: "Olena@Example.com" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.notEqual(google.jwtOk, false, "JWT підписано службовим ключем (токен воркер кешує між запитами)");
  assert.deepEqual({ ...google.oob[0], auth: undefined }, { requestType: "PASSWORD_RESET", email: "olena@example.com", returnOobLink: true, targetProjectId: PROJECT, auth: undefined });
  assert.equal(google.oob[0].auth, "Bearer ya29.test");
  assert.deepEqual(sent[0].to, ["olena@example.com"]);
  assert.equal(sent[0].subject, "Зміна пароля QuizFlow");
  assert.match(sent[0].html, /https:\/\/quizflow\.space\/auth-action\?mode=resetPassword&amp;oobCode=CODE-olena&amp;lang=uk/);
  assert.match(sent[0].html, /Ми отримали запит/);
  // Та сама адреса одразу — обмеження частоти; інша адреса — можна
  assert.equal((await call("POST", "/reset", { uid: "", body: { email: "olena@example.com" } })).status, 429);
  assert.equal((await call("POST", "/reset", { uid: "", body: { email: "ivan@example.com" } })).status, 200);
  assert.ok(google.tokenCalls <= 1, "токен Google кешується");
});

test("зміна пароля: невідомий акаунт — та сама відповідь, лист не йде; чужий сайт — відмова", async () => {
  const r = await call("POST", "/reset", { uid: "", body: { email: "ghost@example.com" } });
  assert.equal(r.status, 200); assert.deepEqual(r.data, { ok: true }); assert.equal(sent.length, 0);
  assert.equal((await call("POST", "/reset", { uid: "", origin: "https://evil.example", body: { email: "olena@example.com" } })).status, 403);
  assert.equal((await call("POST", "/reset", { uid: "", body: { email: "bad" } })).status, 400);
});

test("зміна пароля: адмін — без обмеження частоти, інший текст; без ключа — not_configured", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/reset", { body: { email: "olena@example.com" } })).status, 200);
  assert.equal(sent.length, 3);
  assert.match(sent[0].html, /Адміністратор QuizFlow надіслав вам посилання/);
  assert.equal((await call("POST", "/reset", { uid: "t1", body: { email: "olena@example.com" } })).status, 403);
  const e = env(); delete e.FIREBASE_SERVICE_ACCOUNT;
  const res = await worker.fetch(new Request("https://mail.test/reset", { method: "POST", headers: { Origin: "https://quizflow.space" }, body: JSON.stringify({ email: "olena@example.com" }) }), e);
  assert.equal(res.status, 503); assert.equal((await res.json()).code, "not_configured");
});

test("логотип: воркер віддає PNG, лист посилається на нього", async () => {
  const r = await worker.fetch(new Request("https://mail.test/logo.png?v=3"), env());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Type"), "image/png");
  const b = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...b.slice(1, 4)].map(c => String.fromCharCode(c)).join(""), "PNG");
  await call("POST", "/broadcast", { body: { ...msg, uids: ["t1"] } });
  assert.match(sent[0].html, /<img src="https:\/\/mail\.test\/logo\.png\?v=\d+"/);
});

test("відписка: GET нічого не змінює, POST відписує, можна повернути; підробка — 400", async () => {
  const r = await call("POST", "/broadcast", { body: { ...msg, uids: ["t1"] } });
  assert.equal(r.status, 200);
  const link = sent[0].headers["List-Unsubscribe"].slice(1, -1).replace("https://mail.test", "");
  const get = await call("GET", link, { uid: "" });
  assert.equal(get.status, 200); assert.match(get.data, /Відписатися від розсилок\?/); assert.equal(kv.size, 0);
  const oneClick = await worker.fetch(new Request("https://mail.test" + link, { method: "POST", body: "List-Unsubscribe=One-Click" }), env());
  assert.equal(oneClick.status, 200); assert.ok(kv.get("unsub:t1"));
  assert.deepEqual((await call("GET", "/status")).data.unsubscribed, ["t1"]);
  await worker.fetch(new Request("https://mail.test" + link, { method: "POST", body: "action=resubscribe" }), env());
  assert.equal(kv.size, 0);
  const bad = await call("GET", "/unsubscribe?u=t2&s=" + link.split("s=")[1], { uid: "" });
  assert.equal(bad.status, 400);
});

// ─── AI через воркер ───────────────────────────────────────────────────
const ask = (over = {}, opts = {}) => call("POST", "/ai", { uid: "t1", origin: "https://app.quizflow.space", ...opts, body: { feature: "analysis", messages: [{ role: "user", content: "Привіт" }], ...over } });
const month = () => { const d = new Date(); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

test("AI: викладач отримує відповідь, ключ береться з секретів, використання рахує воркер", async () => {
  const r = await ask();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.text, "Відповідь Groq");
  assert.equal(r.data.provider, "groq");
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].headers.Authorization, "Bearer gsk_env");
  assert.equal(aiCalls[0].body.model, "llama-test");
  assert.equal(aiCalls[0].body.messages[0].role, "system");
  const u = db.aiUsage[month()].t1.analysis;
  assert.equal(u.calls, 1); assert.equal(u.tokens, 42);
  await ask();
  assert.equal(db.aiUsage[month()].t1.analysis.calls, 2);
});

test("AI: Gemini обирається для функції й ключ іде в заголовку, а не в адресі", async () => {
  db.settings.ai.featProviders = { comments: "gemini" };
  const r = await ask({ feature: "comments", json: true, maxTokens: 300 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.text, "Відповідь Gemini");
  assert.equal(aiCalls[0].headers["x-goog-api-key"], "gem_env");
  assert.ok(!aiCalls[0].url.includes("gem_env"));
  assert.equal(aiCalls[0].body.generationConfig.responseMimeType, "application/json");
});

test("AI: без ключа на воркері береться старий ключ з бази, а без жодного — 503", async () => {
  const e = { ...env(), GROQ_API_KEY: undefined, GEMINI_API_KEY: undefined };
  const go = () => worker.fetch(new Request("https://mail.test/ai", { method: "POST", headers: { Origin: "https://app.quizflow.space", Authorization: `Bearer ${tk}` }, body: JSON.stringify({ feature: "analysis", messages: [{ role: "user", content: "x" }] }) }), e);
  const tk = await idToken("t1");
  assert.equal((await go()).status, 503);
  db.settings.ai.groqApiKey = "gsk_db";
  assert.equal((await go()).status, 200);
  assert.equal(aiCalls[0].headers.Authorization, "Bearer gsk_db");
});

test("AI: дозвіл «AI»: вимкнено для всіх, роль і особисте налаштування його повертають, «лише перегляд» вимикає", async () => {
  db.settings.features = { v: 2, perms: { ai: false }, roles: { r1: { perms: { ai: true } } } };
  assert.equal((await ask()).status, 403);
  db.users.t1.customRoleIds = { r1: true };
  assert.equal((await ask()).status, 200);
  db.users.t1.readOnly = true;
  assert.equal((await ask()).status, 403);
  db.users.t1.readOnly = false;
  db.users.t1.features = { perms: { ai: false } };
  assert.equal((await ask()).status, 403);
  assert.equal((await ask({}, { uid: "adm" })).status, 200);          // адмін може завжди
});

test("AI: функцію вимкнено в адмінці або в налаштуваннях викладача", async () => {
  db.settings.ai.aiAnalysis = false;
  assert.equal((await ask()).status, 403);
  assert.equal((await ask({ feature: "comments" })).status, 200);
  db.settings.ai.aiAnalysis = true;
  db.users.t1.aiSettings = { aiAnalysis: false };
  assert.equal((await ask()).status, 403);
  db.settings.ai.enabled = false;
  assert.equal((await ask({ feature: "comments" })).status, 403);
});

test("AI: місячний ліміт викладача (особистий, ролі, для всіх), 0 = без обмежень", async () => {
  db.settings.features = { v: 2, limits: { aiPerMonth: 2 } };
  assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 200);
  const r = await ask();
  assert.equal(r.status, 429); assert.equal(r.data.code, "qf/ai-quota");
  db.users.t1.features = { limits: { aiPerMonth: 0 } };               // особисто без обмежень
  assert.equal((await ask()).status, 200);
  db.users.t1.features = {};
  db.users.t1.customRoleIds = { r1: true };
  db.settings.features.roles = { r1: { limits: { aiPerMonth: 100 } } };
  assert.equal((await ask()).status, 200);                             // ліміт ролі більший
  assert.equal((await ask({}, { uid: "adm" })).status, 200);          // адміністратор без обмежень
});

test("AI: сторінка студента: лише comments і textcheck, лише з чинним посиланням, рахується викладачу", async () => {
  const stud = (over = {}) => call("POST", "/ai", { uid: "", origin: "https://test.quizflow.space", body: { feature: "textcheck", messages: [{ role: "user", content: "Відповідь студента" }], as: { teacherUid: "t1", linkId: "L1" }, ...over } });
  const r = await stud();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://test.quizflow.space");
  assert.equal(db.aiUsage[month()].t1.textcheck.calls, 1);
  assert.equal((await stud({ feature: "analysis" })).status, 401);
  assert.equal((await stud({ feature: "mail" })).status, 401);
  assert.equal((await stud({ as: { teacherUid: "t1", linkId: "NOPE" } })).status, 404);
  assert.equal((await stud({ as: { teacherUid: "../x", linkId: "L1" } })).status, 400);
  assert.equal((await stud({ as: undefined })).status, 400);
  // для викладача, якому AI вимкнено, студенти теж не користуються
  db.users.t1.features = { perms: { ai: false } };
  assert.equal((await stud()).status, 403);
});

test("AI: студентів обмежено за IP, викладачів ні", async () => {
  const e = { ...env(), AI_ANON_PER_HOUR: "2" };
  const go = () => worker.fetch(new Request("https://mail.test/ai", { method: "POST", headers: { Origin: "https://test.quizflow.space", "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify({ feature: "comments", messages: [{ role: "user", content: "x" }], as: { teacherUid: "t1", linkId: "L1" } }) }), e);
  assert.equal((await go()).status, 200);
  assert.equal((await go()).status, 200);
  assert.equal((await go()).status, 429);
});

test("AI: «mail» лише для адміністратора, чужий токен і заблокований акаунт не проходять", async () => {
  assert.equal((await ask({ feature: "mail" })).status, 403);
  assert.equal((await ask({ feature: "mail" }, { uid: "adm" })).status, 200);
  assert.equal((await ask({}, { uid: "t3" })).status, 403);            // заблокований
  assert.equal((await ask({}, { token: (await idToken("t1")).replace(/\.[^.]+$/, ".AAAA") })).status, 401);
  assert.equal((await ask({}, { uid: "ghost" })).status, 403);         // без профілю
});

test("AI: помилка провайдера повертає 502 і рахується як помилка, а не як виклик", async () => {
  aiFail = true;
  const r = await ask();
  assert.equal(r.status, 502);
  assert.equal(db.aiUsage[month()].t1.analysis.errors, 1);
  assert.equal(db.aiUsage[month()].t1.analysis.calls, undefined);
});

test("AI: перевірка запиту: невідома функція, порожні й завеликі повідомлення", async () => {
  assert.equal((await ask({ feature: "hack" })).status, 400);
  assert.equal((await ask({ messages: [] })).status, 400);
  assert.equal((await ask({ messages: Array.from({ length: 21 }, () => ({ role: "user", content: "x" })) })).status, 400);
  assert.equal((await ask({ messages: [{ role: "user", content: "x".repeat(24000) }, { role: "user", content: "x".repeat(24000) }, { role: "user", content: "x".repeat(24000) }] })).status, 413);
  const long = await ask({ maxTokens: 999999 });
  assert.equal(aiCalls[0].body.max_tokens, 4000);
  assert.equal(long.status, 200);
});

test("AI: /ai/status для адміністратора не віддає ключів; CORS для тесту лише на /ai", async () => {
  const r = await call("GET", "/ai/status");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.configured, { groq: true, gemini: true });
  assert.ok(!JSON.stringify(r.data).includes("gsk_env"));
  assert.equal((await call("GET", "/ai/status", { uid: "t1" })).status, 403);
  const pre = await worker.fetch(new Request("https://mail.test/status", { method: "OPTIONS", headers: { Origin: "https://test.quizflow.space" } }), env());
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), null);
});

test("AI: /ai/models — лише для адміна, лише текстові активні моделі; помилка провайдера не ламає відповідь", async () => {
  const r = await call("GET", "/ai/models");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.groq.models.map(m => m.id), ["llama-3.3-70b-versatile", "qwen/qwen3-32b"]);
  assert.equal(r.data.groq.models[0].ctx, 131072);
  assert.deepEqual(r.data.gemini.models.map(m => m.id), ["gemini-2.5-flash"]);
  assert.ok(!JSON.stringify(r.data).includes("gsk_env"));
  assert.equal((await call("GET", "/ai/models", { uid: "t1" })).status, 403);
  modelsFail = true;
  const f = await call("GET", "/ai/models");
  assert.equal(f.status, 200);
  assert.equal(f.data.groq.ok, false);
  assert.match(f.data.groq.error, /bad key/);
});

test("AI: дозволи в базі зберігаються без крапки (games_run, tests_view), воркер їх розуміє", async () => {
  db.settings.features = { v: 2, perms: { ai: false }, roles: { r1: { perms: { ai: true } } } };
  assert.equal((await ask()).status, 403);
  db.users.t1.customRoleIds = { r1: true };
  assert.equal((await ask()).status, 200);
  db.users.t1.features = { perms: { ai: false } };
  assert.equal((await ask()).status, 403);
});

const AO = "https://app.quizflow.space";
const lim = { key: "202611_t1_lim_aiPerMonth_50_100", type: "limit", uid: "t1", limitKey: "aiPerMonth", level: 100, used: 50, limit: 50 };
test("Telegram: сигнал про ліміт іде лише активним отримувачам, токен — із секрету воркера", async () => {
  const r = await call("POST", "/telegram/notice", { uid: "t1", body: lim, origin: AO });
  assert.deepEqual(r.data, { ok: true, sent: true });
  assert.equal(tg.length, 1);
  assert.match(tg[0].url, /bot123:tgsecret\/sendMessage/);
  assert.equal(tg[0].body.chat_id, "111");
  assert.match(tg[0].body.text, /Олена досяг ліміту AI-запитів на місяць: 50/);
});
test("Telegram: повтор того ж сигналу ігнорується", async () => {
  await call("POST", "/telegram/notice", { uid: "t1", body: lim, origin: AO });
  const r = await call("POST", "/telegram/notice", { uid: "t1", body: lim, origin: AO });
  assert.equal(r.data.sent, false); assert.equal(tg.length, 1);
});
test("Telegram: про іншого викладача й без входу (limit) — відмова; HTML екранується", async () => {
  assert.equal((await call("POST", "/telegram/notice", { uid: "t2", body: lim, origin: AO })).status, 403);
  assert.equal((await call("POST", "/telegram/notice", { uid: null, body: lim, origin: AO })).status, 403);
  db.users.t1.name = "<b>Хакер</b>";
  await call("POST", "/telegram/notice", { uid: "t1", body: lim, origin: AO });
  assert.ok(!tg[0].body.text.includes("<b>Хакер"));
});
test("Telegram: помилки AI від студента без токена; сміттєві поля відхиляються", async () => {
  const e = { key: "202611_t1_aierr_comments", type: "aierr", uid: "t1", feature: "comments", errors: 5 };
  const r = await call("POST", "/telegram/notice", { uid: null, body: e, origin: "https://test.quizflow.space" });
  assert.equal(r.data.sent, true);
  assert.match(tg[0].body.text, /Часті помилки AI у Викладач: коментарі студентам, 5/);
  assert.equal((await call("POST", "/telegram/notice", { uid: null, body: { ...e, key: "k2", feature: "<x>" }, origin: AO })).status, 400);
  assert.equal((await call("POST", "/telegram/notice", { uid: "t1", body: { ...lim, key: "bad key!" }, origin: AO })).status, 400);
});
test("Telegram: нове звернення — текст береться з bugStatus автора, а не з запиту; чуже чи неіснуюче — відмова", async () => {
  db.bugStatus = { t1: { rep1: { t: "Не зберігається <картинка>", k: "bug", p: "Конструктор", at: 1, s: "new" } } };
  const r = await call("POST", "/telegram/notice", { uid: "t1", body: { key: "rep1", type: "bug", uid: "t1", text: "ПІДРОБКА" }, origin: AO });
  assert.equal(r.data.sent, true);
  assert.match(tg[0].body.text, /QuizFlow · Проблема/);
  assert.match(tg[0].body.text, /Не зберігається &lt;картинка&gt;/);
  assert.match(tg[0].body.text, /Конструктор/);
  assert.ok(!tg[0].body.text.includes("ПІДРОБКА"));
  assert.equal((await call("POST", "/telegram/notice", { uid: "t2", body: { key: "rep1", type: "bug", uid: "t1" }, origin: AO })).status, 403);
  assert.equal((await call("POST", "/telegram/notice", { uid: null, body: { key: "rep1", type: "bug", uid: "t1" }, origin: AO })).status, 403);
  assert.equal((await call("POST", "/telegram/notice", { uid: "t1", body: { key: "nope", type: "bug", uid: "t1" }, origin: AO })).status, 404);
});
test("Telegram: вимкнено або без токена — нічого не надсилаємо", async () => {
  db.settings.telegramBot.enabled = false;
  assert.equal((await call("POST", "/telegram/notice", { uid: "t1", body: lim, origin: AO })).data.sent, false);
  assert.equal(tg.length, 0);
});

test("Telegram API для адмінки: лише адмін, лише дозволені методи, токен не віддається", async () => {
  const me = await call("POST", "/telegram/api", { body: { method: "getMe" }, origin: "https://admin.quizflow.space" });
  assert.equal(me.status, 200);
  assert.equal(me.data.result.username, "qf_bot");
  assert.ok(!JSON.stringify(me.data).includes("tgsecret"));
  assert.equal((await call("POST", "/telegram/api", { uid: "t1", body: { method: "getMe" }, origin: "https://admin.quizflow.space" })).status, 403);
  assert.equal((await call("POST", "/telegram/api", { body: { method: "logOut" }, origin: "https://admin.quizflow.space" })).status, 400);
  const send = await call("POST", "/telegram/api", { body: { method: "sendMessage", params: { chat_id: "111", text: "привіт" } }, origin: "https://admin.quizflow.space" });
  assert.equal(send.status, 200);
  assert.equal(tg.at(-1).body.text, "привіт");
  const bad = await call("POST", "/telegram/api", { body: { method: "getUpdates", params: {} }, origin: "https://admin.quizflow.space" });
  assert.equal(bad.status, 502); assert.equal(bad.data.error, "conflict");
});

const KH = "https://create.kahoot.it/share/minecraft-ai/216bbd85-2759-43c0-b56f-63e2d937e67c";
test("Kahoot: імпорт за посиланням — вибір, кілька, коротка, порядок; опитування й слайди пропускаються", async () => {
  const r = await call("POST", "/import/kahoot", { uid: "t1", body: { url: KH }, origin: "https://app.quizflow.space" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.title, "Minecraft AI: Розумні світи");
  const q = r.data.questions;
  assert.equal(q.length, 6);                                   // 4 з Kahoot + коротка + порядок
  assert.deepEqual(q[0], { type: "single", text: "Що таке Minecraft Education?", options: ["Версія гри для навчання", "Гра тільки для розваг", "Редактор відео", "Соціальна мережа"], correct: [0] });
  assert.equal(q[3].type, "multi");                            // у питанні дві правильні
  assert.deepEqual(q[3].correct.length, 2);
  assert.deepEqual(q[4], { type: "text", text: "Столиця України?", correct: "Київ / Kyiv" });   // теги прибрано
  assert.deepEqual(q[5], { type: "ordering", text: "Розставте за порядком", items: ["Один", "Два", "Три"] });
  assert.equal(r.data.skipped, 3);                             // опитування, слайд, питання з одним варіантом
});
test("Kahoot: потрібен вхід, дозвіл на імпорт, коректне посилання; приватний тест і збої Kahoot — зрозумілі повідомлення", async () => {
  assert.equal((await call("POST", "/import/kahoot", { uid: null, body: { url: KH }, origin: "https://app.quizflow.space" })).status, 401);
  assert.equal((await call("POST", "/import/kahoot", { uid: "t1", body: { url: "https://example.com/x" }, origin: "https://app.quizflow.space" })).status, 400);
  kahootStatus = 404;
  const priv = await call("POST", "/import/kahoot", { uid: "t1", body: { url: KH }, origin: "https://app.quizflow.space" });
  assert.equal(priv.status, 404); assert.match(priv.data.error, /публічн/);
  kahootStatus = 500;
  assert.equal((await call("POST", "/import/kahoot", { uid: "t1", body: { url: KH }, origin: "https://app.quizflow.space" })).status, 502);
  kahootStatus = 200;
  db.settings.features = { v: 2, perms: { tests_import: false } };
  assert.equal((await call("POST", "/import/kahoot", { uid: "t1", body: { url: KH }, origin: "https://app.quizflow.space" })).status, 403);
});

test("AI: основний провайдер впав — відповідає запасний, облік як звичайний виклик", async () => {
  aiFail = "groq";
  const r = await ask();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.provider, "gemini");
  assert.equal(r.data.fallback, true);
  assert.equal(r.data.text, "Відповідь Gemini");
  assert.deepEqual(aiCalls.map(c => c.host), ["api.groq.com", "generativelanguage.googleapis.com"]);
  assert.equal(db.aiUsage[month()].t1.analysis.calls, 1);
  assert.equal(db.aiUsage[month()].t1.analysis.errors, undefined);
  aiFail = "gemini";
  db.settings.ai.featProviders = { analysis: "gemini" };
  const r2 = await ask();
  assert.equal(r2.data.provider, "groq");
  assert.equal(r2.data.fallback, true);
});
test("AI: помилки самого запиту не повторюються іншим провайдером", async () => {
  aiFail = "groq";
  assert.equal((await ask({ feature: "hack" })).status, 400);
  assert.equal(aiCalls.length, 0);
});


// ─── Панель лімітів ──────────────────────────────────────────────────────
test("ліміти: лише для адміністратора", async () => {
  assert.equal((await call("GET", "/limits", { uid: null })).status, 401);
  assert.equal((await call("GET", "/limits", { uid: "t1" })).status, 403);
  const r = await call("GET", "/limits");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.sections.map(x => x.id), ["firebase", "cloudflare", "ai"]);
  assert.ok(!JSON.stringify(r.data).includes("ya29.test") && !JSON.stringify(r.data).includes("gsk_env"), "секрети не віддаються");
});

test("ліміти Firebase: показники з Cloud Monitoring, а без прав — підказка", async () => {
  const fb = (await call("GET", "/limits")).data.sections[0];
  assert.equal(fb.state, "ok");
  const by = Object.fromEntries(fb.items.map(i => [i.key, i]));
  assert.equal(by["fb-storage"].used, 500 * 1024 * 1024);                 // найсвіжіша точка
  assert.equal(by["fb-storage"].limit, 1024 ** 3);
  assert.equal(by["fb-download"].used, 3 * 1024 ** 3);                     // сума за місяць
  assert.equal(by["fb-conns"].used, 42);                                   // пік за добу
  assert.equal(fb.planKey, "blaze");                                       // без вибору — Blaze
  assert.equal(by["fb-conns"].limit, 200000);                              // на Blaze підключень до 200 000, а не 100
  assert.equal(by["fb-storage"].paid, true);
  assert.equal(by["fb-download"].note, "");                                // у межах безкоштовної частини — без вартості
  db.settings.limits = { firebasePlan: "spark" };
  const spark = (await call("GET", "/limits")).data.sections[0];
  assert.equal(spark.planKey, "spark");
  assert.equal(spark.items.find(i => i.key === "fb-conns").limit, 100);    // на Spark — жорсткі 100
  assert.equal(spark.items.find(i => i.key === "fb-storage").paid, false);
  db.settings.limits = undefined;
  mon.fail = 403;
  const noPerm = (await call("GET", "/limits")).data.sections[0];
  assert.equal(noPerm.state, "unconfigured");
  assert.match(noPerm.hint, /Monitoring Viewer/);
  mon.fail = 500;
  assert.equal((await call("GET", "/limits")).data.sections[0].state, "error");
  envOver = { FIREBASE_SERVICE_ACCOUNT: "" };
  assert.equal((await call("GET", "/limits")).data.sections[0].state, "unconfigured");
});

test("ліміти Cloudflare: без секретів — підказка; з ними — запити й KV за день", async () => {
  assert.equal((await call("GET", "/limits")).data.sections[1].state, "unconfigured");
  envOver = { CF_API_TOKEN: "cf_secret", CF_ACCOUNT_ID: "acc1" };
  const cf = (await call("GET", "/limits")).data.sections[1];
  assert.equal(cf.state, "ok");
  const by = Object.fromEntries(cf.items.map(i => [i.key, i]));
  assert.equal(by["cf-requests"].used, 10000); assert.equal(by["cf-requests"].limit, 100000);
  assert.match(by["cf-requests"].note, /12/);
  assert.equal(by["cf-kv-read"].used, 800);
  assert.equal(by["cf-kv-write"].used, 950); assert.equal(by["cf-kv-write"].limit, 1000);
  assert.equal(by["cf-kv-delete"].used, 0);
  assert.ok(!JSON.stringify(cf).includes("cf_secret"));
  cfGql.status = 403;
  const denied = (await call("GET", "/limits")).data.sections[1];
  assert.equal(denied.state, "unconfigured"); assert.match(denied.hint, /Analytics/);
});

test("ліміти AI: воркер веде облік запитів і запам'ятовує заголовки Groq", async () => {
  groqHeaders = { "x-ratelimit-limit-requests": "14400", "x-ratelimit-remaining-requests": "14000", "x-ratelimit-limit-tokens": "6000", "x-ratelimit-remaining-tokens": "5000", "x-ratelimit-reset-requests": "1m30s", "x-ratelimit-reset-tokens": "2.5s" };
  const ask = () => call("POST", "/ai", { uid: "t1", body: { feature: "comments", messages: [{ role: "user", content: "Привіт" }] } });
  assert.equal((await ask()).status, 200);
  await ask();
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(db.aiProv[day].groq.calls, 2); assert.equal(db.aiProv[day].groq.ok, 2); assert.equal(db.aiProv[day].groq.tokens, 84);
  assert.equal(db.aiProv.limits.groq.limitReq, 14400);
  const ai = (await call("GET", "/limits")).data.sections[2];
  assert.equal(ai.state, "ok");
  const by = Object.fromEntries(ai.items.map(i => [i.key, i]));
  assert.equal(by["groq-day"].used, 400); assert.equal(by["groq-day"].limit, 14400);
  assert.equal(by["groq-tpm"].limit, 6000);
  assert.equal(by["groq-calls"].used, 2);
});

test("ліміти AI: відповідь 429 від провайдера рахується окремо", async () => {
  aiStatus429 = true;
  const r = await call("POST", "/ai", { uid: "t1", body: { feature: "comments", messages: [{ role: "user", content: "Привіт" }] } });
  assert.equal(r.status, 200); assert.equal(r.data.fallback, true);       // Groq вичерпано — відповів Gemini
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(db.aiProv[day].groq.r429, 1); assert.equal(db.aiProv[day].groq.err, 1); assert.equal(db.aiProv[day].gemini.ok, 1);
  const item = (await call("GET", "/limits")).data.sections[2].items.find(i => i.key === "groq-calls");
  assert.match(item.note, /429/);
});

test("ліміти AI: без службового ключа відповідь AI працює, облік мовчки вимкнений", async () => {
  envOver = { FIREBASE_SERVICE_ACCOUNT: "" };
  const r = await call("POST", "/ai", { uid: "t1", body: { feature: "comments", messages: [{ role: "user", content: "Привіт" }] } });
  assert.equal(r.status, 200);
  assert.equal(svcWrites.length, 0);
  assert.equal((await call("GET", "/limits")).data.sections[2].state, "unconfigured");
});

test("ліміти Firebase: на Blaze понад безкоштовну частину показується орієнтовна вартість", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === "monitoring.googleapis.com") {
      const metric = u.searchParams.get("filter"), v = /storage\/total_bytes/.test(metric) ? 3 * 1024 ** 3 : /sent_bytes/.test(metric) ? 14 * 1024 ** 3 : 5;
      return Response.json({ timeSeries: [{ points: [{ interval: { endTime: new Date().toISOString() }, value: { int64Value: String(v) } }] }] });
    }
    return orig(url, init);
  };
  try {
    const by = Object.fromEntries((await call("GET", "/limits")).data.sections[0].items.map(i => [i.key, i]));
    assert.match(by["fb-storage"].note, /\$10\.00/);                     // (3 - 1) ГБ x $5
    assert.match(by["fb-download"].note, /\$4\.00/);                     // (14 - 10) ГБ x $1
  } finally { globalThis.fetch = orig; }
});

test("ліміти Firebase: якщо Google не віддав значення сховища, це не нуль, а null з поясненням", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === "monitoring.googleapis.com" && /storage\/total_bytes/.test(u.searchParams.get("filter"))) {
      assert.ok(Date.parse(u.searchParams.get("interval.startTime")) < Date.now() - 2.5 * 864e5, "дивимось не менше ніж за 3 доби");
      return Response.json({});                                              // точок немає
    }
    return orig(url, init);
  };
  try {
    const it = (await call("GET", "/limits")).data.sections[0].items.find(i => i.key === "fb-storage");
    assert.equal(it.used, null);
    assert.match(it.note, /не віддав/);
  } finally { globalThis.fetch = orig; }
});

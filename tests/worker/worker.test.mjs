// Юніт-тести воркера пошти (worker/src): справжня перевірка підпису RS256,
// а Google, база Firebase, Resend і KV — підмінені.  npm run worker
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

let db, sent, kv, resendStatus;
const env = () => ({
  FIREBASE_PROJECT_ID: PROJECT, FIREBASE_DB_URL: DB, SITE_URL: "https://quizflow.space", MAIL_FROM: "QuizFlow <noreply@quizflow.space>",
  ALLOWED_ORIGINS: "https://quizflow.space", RESEND_API_KEY: "re_test", UNSUB_SECRET: "s3cret", FIREBASE_SERVICE_ACCOUNT: SA,
  MAIL_KV: { get: async k => kv.get(k) ?? null, put: async (k, v, opts) => void kv.set(k, v), delete: async k => void kv.delete(k),
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) },
});
beforeEach(() => {
  kv = new Map(); sent = []; resendStatus = 200; google = { tokenCalls: 0, oob: [], jwtOk: null };
  db = {
    users: {
      adm: { role: "admin", name: "Адмін", email: "admin@quizflow.space" },
      t1: { role: "teacher", name: "Олена", email: "olena@example.com" },
      t2: { role: "teacher", name: "Іван", email: "ivan@example.com" },
      t3: { role: "teacher", name: "Блок", email: "b@example.com", blocked: true },
      t4: { role: "teacher", name: "Без пошти" },
    },
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
    if (u.origin === DB) {
      // Мінімальні «правила»: читати може лише власник свого профілю або адмін
      const path = u.pathname.replace(/^\/|\.json$/g, ""), token = u.searchParams.get("auth");
      const uid = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
      const isAdmin = db.users[uid]?.role === "admin";
      if (!isAdmin && path !== `users/${uid}`) return new Response('{"error":"Permission denied"}', { status: 401 });
      return Response.json(path.split("/").reduce((n, k) => n?.[k], db) ?? null);
    }
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
  assert.match(sent[0].html, /Tmp-Pass-2026/);
  assert.match(sent[0].html, /quizflow\.space\/login\?email=oksana%40example\.com/);
  assert.match(sent[0].text, /Пароль: Tmp-Pass-2026/);
  const nopass = await call("POST", "/welcome", { body: { uid: "t1ab12" } });
  assert.equal(nopass.status, 200);
  assert.doesNotMatch(sent[1].html, /Пароль<\/td>/);
  db.users.t1ab12.blocked = true;
  assert.equal((await call("POST", "/welcome", { body: { uid: "t1ab12" } })).status, 409);
  assert.equal((await call("POST", "/welcome", { uid: "t1", body: { uid: "t1ab12" } })).status, 403);
  assert.equal((await call("POST", "/welcome", { body: { uid: "../x" } })).status, 400);
});

test("зміна пароля: лист у нашому дизайні з посиланням на auth-action", async () => {
  const r = await call("POST", "/reset", { uid: "", body: { email: "Olena@Example.com" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(google.jwtOk, true, "JWT підписано службовим ключем");
  assert.deepEqual({ ...google.oob[0], auth: undefined }, { requestType: "PASSWORD_RESET", email: "olena@example.com", returnOobLink: true, targetProjectId: PROJECT, auth: undefined });
  assert.equal(google.oob[0].auth, "Bearer ya29.test");
  assert.deepEqual(sent[0].to, ["olena@example.com"]);
  assert.equal(sent[0].subject, "Зміна пароля QuizFlow");
  assert.match(sent[0].html, /https:\/\/quizflow\.space\/auth-action\?mode=resetPassword&amp;oobCode=CODE-olena&amp;lang=uk/);
  assert.match(sent[0].html, /Ми отримали запит/);
  // Та сама адреса одразу — обмеження частоти; інша адреса — можна
  assert.equal((await call("POST", "/reset", { uid: "", body: { email: "olena@example.com" } })).status, 429);
  assert.equal((await call("POST", "/reset", { uid: "", body: { email: "ivan@example.com" } })).status, 200);
  assert.equal(google.tokenCalls, 1, "токен Google кешується");
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

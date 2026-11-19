// Публікує database.rules.json у Realtime Database через REST (без firebase-tools і сторонніх пакетів).
// Службовий ключ — JSON у змінній FIREBASE_SERVICE_ACCOUNT (секрет репозиторію).
//   node scripts/publish-rules.mjs            — опублікувати й перевірити
//   node scripts/publish-rules.mjs --backup F — перед публікацією зберегти чинні правила у файл F
import { readFileSync, writeFileSync } from "node:fs";
import { createSign } from "node:crypto";

const DB = "https://quizflow-8a978-default-rtdb.europe-west1.firebasedatabase.app";
const FILE = new URL("../../database.rules.json", import.meta.url);

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error("Немає FIREBASE_SERVICE_ACCOUNT"); process.exit(1); }
let sa;
try { sa = JSON.parse(raw); } catch { console.error("FIREBASE_SERVICE_ACCOUNT — не JSON. Вставте весь вміст файлу ключа."); process.exit(1); }
if (!sa.client_email || !sa.private_key) { console.error("У ключі немає client_email або private_key"); process.exit(1); }

const b64 = x => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
async function token(){
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: sa.client_email, aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 600,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
  });
  const jwt = body + "." + createSign("RSA-SHA256").update(body).sign(sa.private_key, "base64url");
  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google не видав токен (${r.status}): ${j.error_description || j.error || ""}`);
  return j.access_token;
}

const strip = s => s.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? "");   // правила можуть містити коментарі
const same = (a, b) => JSON.stringify(JSON.parse(strip(a))) === JSON.stringify(JSON.parse(strip(b)));

const tk = await token();
const url = `${DB}/.settings/rules.json`;
const H = { Authorization: "Bearer " + tk };
const get = async () => { const r = await fetch(url, { headers: H }); const t = await r.text(); if (!r.ok) throw new Error(`Читання правил: ${r.status} ${t.slice(0, 300)}`); return t; };

const local = readFileSync(FILE, "utf8");
JSON.parse(strip(local));   // файл має бути валідним
const before = await get();
const bi = process.argv.indexOf("--backup");
if (bi > 0 && process.argv[bi + 1]) writeFileSync(process.argv[bi + 1], before);
if (same(before, local)) { console.log("Правила в базі вже такі самі — публікувати нічого."); process.exit(0); }

const put = await fetch(url, { method: "PUT", headers: { ...H, "Content-Type": "application/json" }, body: local });
const pt = await put.text();
if (!put.ok) throw new Error(`Публікація: ${put.status} ${pt.slice(0, 500)}`);
if (!same(await get(), local)) throw new Error("Після публікації правила в базі відрізняються від database.rules.json");
console.log("Правила опубліковано й перевірено.");

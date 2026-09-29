// Службовий ключ Firebase (Google service account) → токен доступу OAuth2.
// Потрібен, щоб отримати посилання для зміни пароля, не надсилаючи стандартний
// лист Firebase: accounts:sendOobCode з returnOobLink повертає посилання, а лист
// у дизайні QuizFlow надсилає сам воркер. Ключ — секрет FIREBASE_SERVICE_ACCOUNT
// (увесь JSON, завантажений з консолі Firebase).
import { HttpError } from "./auth.js";

const SCOPE = "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform";
let _tok = null;   // { key, token, exp }

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = s => b64url(new TextEncoder().encode(s));

export function serviceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return null;
  try {
    const sa = typeof env.FIREBASE_SERVICE_ACCOUNT === "string" ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : env.FIREBASE_SERVICE_ACCOUNT;
    return sa?.client_email && sa?.private_key ? sa : null;
  } catch { return null; }
}

async function accessToken(env) {
  const sa = serviceAccount(env);
  if (!sa) throw new HttpError(503, "На воркері не задано FIREBASE_SERVICE_ACCOUNT");
  const now = Math.floor(Date.now() / 1000);
  if (_tok && _tok.key === sa.client_email && _tok.exp - 60 > now) return _tok.token;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  let key;
  try {
    key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch { throw new HttpError(503, "Службовий ключ Firebase пошкоджений — вставте JSON ще раз"); }
  const unsigned = `${b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlStr(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64url(sig)}`,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new HttpError(503, "Google не прийняв службовий ключ: " + (d.error_description || d.error || r.status));
  _tok = { key: sa.client_email, token: d.access_token, exp: now + (Number(d.expires_in) || 3600) };
  return _tok.token;
}

// Посилання для зміни пароля. null — акаунта немає або він вимкнений (про це не кажемо).
export async function passwordResetCode(env, email) {
  const sa = serviceAccount(env);
  const token = await accessToken(env);
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email, returnOobLink: true, targetProjectId: sa.project_id || env.FIREBASE_PROJECT_ID }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = String(d?.error?.message || "");
    if (/EMAIL_NOT_FOUND|USER_DISABLED|USER_NOT_FOUND/.test(m)) return null;
    if (/EXCEED|TOO_MANY/.test(m)) throw new HttpError(429, "Забагато запитів. Спробуйте за кілька хвилин.");
    throw new HttpError(502, "Firebase: " + (m || r.status));
  }
  const code = new URL(d.oobLink).searchParams.get("oobCode");
  if (!code) throw new HttpError(502, "Firebase не повернув посилання");
  return code;
}

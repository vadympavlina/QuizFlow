// Перевірка Firebase ID-токена без SDK: підпис RS256 ключами Google + поля токена.
// Потім — роль у базі через REST з тим самим токеном (правила бази діють як завжди).

const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let _keys = null, _keysAt = 0;

async function googleKeys(force = false) {
  if (!force && _keys && Date.now() - _keysAt < 3600e3) return _keys;
  const r = await fetch(JWK_URL);
  if (!r.ok) throw new HttpError(503, "Не вдалося отримати ключі Google");
  _keys = (await r.json()).keys || [];
  _keysAt = Date.now();
  return _keys;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
const jsonPart = s => JSON.parse(new TextDecoder().decode(b64url(s)));

export async function verifyIdToken(token, projectId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new HttpError(401, "Потрібен вхід");
  let header, claims;
  try { header = jsonPart(parts[0]); claims = jsonPart(parts[1]); } catch { throw new HttpError(401, "Недійсний токен"); }
  if (header.alg !== "RS256" || !header.kid) throw new HttpError(401, "Недійсний токен");
  let jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find(k => k.kid === header.kid);   // ключі змінились
  if (!jwk) throw new HttpError(401, "Недійсний токен");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) throw new HttpError(401, "Недійсний токен");
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw new HttpError(401, "Токен іншого проєкту");
  if (!claims.sub || claims.exp <= now || claims.iat > now + 300) throw new HttpError(401, "Сесія застаріла, увійдіть знову");
  return claims;
}

// Читання з бази від імені користувача (правила бази перевіряють доступ)
export async function dbRead(env, path, idToken) {
  const r = await fetch(`${env.FIREBASE_DB_URL}/${path}.json?auth=${encodeURIComponent(idToken)}`);
  if (r.status === 401 || r.status === 403) throw new HttpError(403, "Немає доступу");
  if (!r.ok) throw new HttpError(502, "База недоступна");
  return r.json();
}

export async function requireAdmin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const claims = await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
  const me = await dbRead(env, `users/${claims.sub}`, token);
  if (!me || me.role !== "admin" || me.blocked === true) throw new HttpError(403, "Лише для адміністратора");
  return { uid: claims.sub, token, me };
}

// ═══════════════════════════════════════════════════════════════════════
// shared/caps.js — можливості й ліміти викладача (адмінка → «Можливості»).
//
// settings/features = { flags:{games,import,export}, limits:{maxTests,maxActiveLinks,aiPerMonth},
//                       roles:{ roleId:{ flags:{…}, limits:{…} } } }
// users/{uid}/features = { flags:{…}, limits:{…} }   — індивідуально для викладача
//
// Пріоритет: індивідуально → ролі викладача → для всіх.
//  • перемикач: якщо хоч одна роль дозволяє — дозволено (найщедріше правило);
//  • ліміт: 0 = без обмежень; серед ролей береться найбільший.
// Адміністраторів не обмежуємо.
// ═══════════════════════════════════════════════════════════════════════
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export const CAP_FLAGS = {
  games:  { label: "Ігри наживо",           desc: "Запуск ігор з телефонами учнів" },
  import: { label: "Імпорт з Excel і CSV",   desc: "Завантаження питань у конструкторі" },
  export: { label: "Експорт результатів",    desc: "Вивантаження спроб і звітів у CSV" },
};
export const CAP_LIMITS = {
  maxTests:       { label: "Тестів",               desc: "Архівні не рахуються",           unit: ["тест", "тести", "тестів"] },
  maxActiveLinks: { label: "Активних посилань",    desc: "Відкритих одночасно",             unit: ["посилання", "посилання", "посилань"] },
  aiPerMonth:     { label: "AI-запитів на місяць", desc: "Разом зі студентами викладача",   unit: ["запит", "запити", "запитів"] },
};
const ids = v => v && typeof v === "object" ? Object.keys(v).filter(k => v[k]) : Array.isArray(v) ? v : [];
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };

// Повертає { flags:{k:bool}, limits:{k:number}, src:{k:"user"|"role"|"all"}, admin }
export function resolveCaps(cfg = {}, userProfile = {}){
  const roleIds = Array.isArray(userProfile.customRoleIds) ? userProfile.customRoleIds : ids(userProfile.customRoleIds).concat(userProfile.customRoleId ? [userProfile.customRoleId] : []);
  const roles = roleIds.map(r => cfg.roles?.[r]).filter(Boolean);
  const own = userProfile.features || {};
  const out = { flags: {}, limits: {}, src: {}, admin: userProfile.role === "admin" };
  Object.keys(CAP_FLAGS).forEach(k => {
    if (typeof own.flags?.[k] === "boolean"){ out.flags[k] = own.flags[k]; out.src[k] = "user"; return; }
    const rv = roles.map(r => r.flags?.[k]).filter(v => typeof v === "boolean");
    if (rv.length){ out.flags[k] = rv.some(Boolean); out.src[k] = "role"; return; }
    out.flags[k] = cfg.flags?.[k] !== false; out.src[k] = "all";
  });
  Object.keys(CAP_LIMITS).forEach(k => {
    const o = num(own.limits?.[k]);
    if (o !== null){ out.limits[k] = o; out.src[k] = "user"; return; }
    const rv = roles.map(r => num(r.limits?.[k])).filter(v => v !== null);
    if (rv.length){ out.limits[k] = rv.includes(0) ? 0 : Math.max(...rv); out.src[k] = "role"; return; }
    out.limits[k] = num(cfg.limits?.[k]) || 0; out.src[k] = "all";
  });
  if (out.admin){ Object.keys(CAP_FLAGS).forEach(k => out.flags[k] = true); Object.keys(CAP_LIMITS).forEach(k => out.limits[k] = 0); }
  return out;
}

export async function loadCaps(db, userProfile){
  let cfg = {};
  try { cfg = (await get(ref(db, "settings/features"))).val() || {}; } catch {}
  return resolveCaps(cfg, userProfile);
}

// Скільки AI-запитів викладач уже зробив цього місяця (облік — shared/ai-usage.js)
export const monthKey = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
export async function aiUsedThisMonth(db, uid){
  try {
    const v = (await get(ref(db, `aiUsage/${monthKey()}/${uid}`))).val() || {};
    return Object.values(v).reduce((s, f) => s + (Number(f?.calls) || 0), 0);
  } catch { return 0; }
}
// Кидає помилку, якщо ліміт AI вичерпано (limit 0 — без обмежень)
export async function assertAiQuota(db, uid, limit){
  if (!limit) return;
  const used = await aiUsedThisMonth(db, uid);
  if (used >= limit) throw Object.assign(new Error(`Ліміт AI-запитів на цей місяць вичерпано (${limit}). Зверніться до адміністратора.`), { code: "qf/ai-quota" });
}
export const pluralUk = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; };

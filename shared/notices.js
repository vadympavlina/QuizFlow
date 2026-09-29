// ═══════════════════════════════════════════════════════════════════════
// shared/notices.js — сигнали для адміністратора (дзвіночок в адмінці + Telegram).
// adminNotices/{ключ}: ключ однозначний (місяць + викладач + подія), тож кожна подія
// фіксується рівно один раз — правила не дають перезаписати наявний сигнал.
// Будь-яка помилка тут тиха: сигнал не повинен ламати саму дію викладача.
// ═══════════════════════════════════════════════════════════════════════
import { ref, get, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const LIMIT_LABEL = { maxTests: "тестів", maxActiveLinks: "активних посилань", aiPerMonth: "AI-запитів на місяць" };
const FEAT_LABEL = { comments: "коментарі студентам", analysis: "розбір помилок", generation: "генерація питань", textcheck: "перевірка відповідей", mail: "листи й розсилки" };
const monthKey = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
const escTg = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function noticeText(n, name){
  const who = name || n.name || "Викладач";
  if (n.type === "limit") return n.level >= 100
    ? `${who} досяг ліміту ${LIMIT_LABEL[n.key] || n.key}: ${n.limit}`
    : `${who} використав ${n.used} з ${n.limit} ${LIMIT_LABEL[n.key] || n.key} (80%)`;
  if (n.type === "aierr") return `Часті помилки AI у ${who}: ${FEAT_LABEL[n.feature] || n.feature}, ${n.errors} помилок цього місяця`;
  return n.text || "Сигнал";
}

async function sendTelegram(db, html){
  try {
    const cfg = (await get(ref(db, "settings/telegramBot"))).val();
    if (!cfg?.enabled || !cfg?.token) return;
    const to = Object.keys(cfg.recipients || {}).filter(id => cfg.recipients[id]);
    await Promise.all(to.map(chat_id => fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text: html, parse_mode: "HTML" }),
    }).catch(() => {})));
  } catch {}
}

// Створює сигнал, якщо його ще немає. data: {type, uid, …}
export async function raiseNotice(db, key, data){
  try {
    let name = data.name || null;
    if (!name){ try { const u = (await get(ref(db, `users/${data.uid}`))).val(); name = [u?.name, u?.surname].filter(Boolean).join(" ") || u?.email || null; } catch {} }
    await set(ref(db, `adminNotices/${key}`), { ...data, name, at: serverTimestamp() });   // уже є — правила відхилять
    sendTelegram(db, `<b>QuizFlow · сигнал</b>\n${escTg(noticeText(data, name))}`);
  } catch {}
}

// Ліміт: 80% — попередження, 100% — досягнуто. current — скільки вже є (до нової дії).
export function limitNotice(db, uid, key, current, limit, name){
  if (!db || !uid || !limit) return;
  const level = current >= limit ? 100 : current + 1 >= Math.ceil(limit * .8) ? 80 : 0;
  if (!level) return;
  const scope = key === "aiPerMonth" ? monthKey() : "all";
  raiseNotice(db, `${scope}_${uid}_lim_${key}_${limit}_${level}`, { type: "limit", uid, key, level, used: Math.min(current + (level < 100 ? 1 : 0), limit), limit, name: name || null });
}

// Помилки AI: сигнал, коли за місяць набирається 5 помилок функції
export function aiErrorNotice(db, uid, feature, errors){
  if (!db || !uid || errors !== 5) return;
  raiseNotice(db, `${monthKey()}_${uid}_aierr_${feature}`, { type: "aierr", uid, feature, errors });
}

// ═══════════════════════════════════════════════════════════════════════
// shared/ai-usage.js — облік звернень до AI (для адмінки → AI налаштування).
// Лічильники: aiUsage/{yyyymm}/{uid викладача}/{функція}/{calls|tokens|errors|last}.
// Пишемо через increment() окремими шляхами: правила дозволяють лише
// збільшувати лічильники, тож навіть сторінка тесту (без входу) може їх оновити.
// Помилка обліку ніколи не заважає самій AI-функції.
// ═══════════════════════════════════════════════════════════════════════
import { ref, update, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export const AI_FEATURES = ["comments", "analysis", "generation", "textcheck"];
const month = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

// Скільки токенів витратила відповідь (Groq — usage, Gemini — usageMetadata)
export function tokensOf(data){
  const n = Number(data?.usage?.total_tokens ?? data?.usageMetadata?.totalTokenCount ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 100000) : 0;
}

export function trackAI(db, uid, feature, { ok = true, tokens = 0 } = {}){
  try {
    if (!db || !uid || !AI_FEATURES.includes(feature)) return;
    const base = `aiUsage/${month()}/${uid}/${feature}`;
    const upd = { [`${base}/last`]: serverTimestamp() };
    if (ok){
      upd[`${base}/calls`] = increment(1);
      if (tokens > 0) upd[`${base}/tokens`] = increment(tokens);
    } else upd[`${base}/errors`] = increment(1);
    update(ref(db), upd).catch(() => {});
  } catch {}
}

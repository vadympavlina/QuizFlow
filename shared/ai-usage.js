// ═══════════════════════════════════════════════════════════════════════
// shared/ai-usage.js — облік звернень до AI (для адмінки → AI налаштування).
// Лічильники: aiUsage/{yyyymm}/{uid викладача}/{функція}/{calls|tokens|errors|last}.
// Пишемо через increment() окремими шляхами: правила дозволяють лише
// збільшувати лічильники, тож навіть сторінка тесту (без входу) може їх оновити.
// Помилка обліку ніколи не заважає самій AI-функції.
// ═══════════════════════════════════════════════════════════════════════
import { ref, get, update, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { aiErrorNotice } from "./notices.js?v=2";

export const AI_FEATURES = ["comments", "analysis", "generation", "textcheck", "mail"];
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
    update(ref(db), upd).then(() => {
      // Часті помилки → сигнал адміністратору (рівно один раз на 5-й помилці за місяць)
      if (!ok) get(ref(db, `${base}/errors`)).then(sn => aiErrorNotice(db, uid, feature, Number(sn.val()) || 0)).catch(() => {});
    }).catch(() => {});
  } catch {}
}

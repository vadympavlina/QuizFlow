// ─── Легкі дані для адмінки ────────────────────────────────────────────
// Адмінці не треба читати всі спроби з копіями питань, щоб порахувати графіки.
// Панель викладача веде компактні дзеркала, які адмін читає замість важких вузлів:
//   attemptLog/{uid}/{attemptId}  = { c: createdAt, s: status, g: grade12, f: finishedAt, l: lastSeen }
//   gameLog/{uid}/{code}          = { p: playedAt, n: гравців, t: назва, q: питань, id: testId }
//   teacherStats/{uid}            = лічильники тестів/посилань/студентів + прапорці готовності
// Нові спроби сторінка тесту дописує в attemptLog сама; тут — звірка (старі дані,
// видалення, пропущені записи). Запускається з app.js у фоні з затримкою.

const MAP = { createdAt: "c", status: "s", grade12: "g", finishedAt: "f", lastSeen: "l" };
const slim = a => {
  const o = {};
  for (const [k, x] of Object.entries(MAP)) {
    const v = a[k];
    if (v === undefined || v === null || v === "") continue;
    if (x === "s") o.s = String(v).slice(0, 20);
    else if (Number.isFinite(Number(v))) o[x] = Number(v);
  }
  return o;
};
const same = (a, b) => {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every(k => a[k] === b[k]);
};

async function commit({ db, ref, update }, upd) {
  const keys = Object.keys(upd);
  for (let i = 0; i < keys.length; i += 400) {
    const part = {};
    keys.slice(i, i + 400).forEach(k => (part[k] = upd[k]));
    await update(ref(db), part);
  }
}

let _running = false;
export async function syncAdminIndex(uid, fb) {
  const { db, ref, get, update } = fb;
  if (_running || !uid) return;
  _running = true;
  try {
    const attempts = window.attempts || [], tests = window.tests || [], links = window.links || [];
    const [logS, siS, stS] = await Promise.all([
      get(ref(db, `attemptLog/${uid}`)), get(ref(db, `teachers/${uid}/students`)), get(ref(db, `teacherStats/${uid}`)),
    ]);
    const log = logS.val() || {}, prev = stS.val() || {}, upd = {};
    const ids = new Set();
    for (const a of attempts) {
      if (!a?.id) continue;
      ids.add(a.id);
      const s = slim(a);
      if (!s.c) continue;   // без дати спроба адмінці не потрібна
      if (!same(log[a.id], s)) upd[`attemptLog/${uid}/${a.id}`] = s;
    }
    for (const id of Object.keys(log)) if (!ids.has(id)) upd[`attemptLog/${uid}/${id}`] = null;

    // Історія ігор: один раз переносимо з gameHistory, далі play-teacher пише сам
    let gameLogReady = prev.gameLogReady === true;
    if (!gameLogReady) {
      const gh = (await get(ref(db, `teachers/${uid}/gameHistory`))).val() || {};
      for (const [code, g] of Object.entries(gh)) {
        if (!g || typeof g !== "object") continue;
        const n = Number(g.playerCount) || (Array.isArray(g.results) ? g.results.length : Object.keys(g.results || {}).length);
        upd[`gameLog/${uid}/${code}`] = { p: Number(g.playedAt) || 0, n, t: String(g.testTitle || "").slice(0, 120), q: Number(g.questionCount) || 0, id: g.testId || null };
      }
      gameLogReady = true;
    }

    const now = Date.now();
    const stats = {
      tests: tests.length,
      activeTests: tests.filter(t => t?.status === "active").length,
      testsLive: tests.filter(t => t && t.status !== "archived").length,
      links: links.length,
      activeLinks: links.filter(l => l && l.status === "active" && !(l.closeAt && l.closeAt <= now)).length,
      students: Object.keys(siS.val() || {}).length,
      logReady: true,
      gameLogReady,
    };
    const statsChanged = Object.entries(stats).some(([k, v]) => prev[k] !== v);
    if (statsChanged) upd[`teacherStats/${uid}`] = { ...stats, updatedAt: now };
    if (Object.keys(upd).length) {
      // Спершу журнали, потім прапорець готовності — інакше адмін побачить неповні дані
      const { [`teacherStats/${uid}`]: st, ...rest } = upd;
      await commit(fb, rest);
      if (st) await update(ref(db), { [`teacherStats/${uid}`]: st });
    }
  } catch (e) {
    console.warn("[admin-index]", e.message);
  } finally {
    _running = false;
  }
}

// ─── Стискання старих спроб ───────────────────────────────────────────
// Старі спроби тримають questionsSnapshot — повну копію питань тесту в кожній
// спробі, і саме через них панель довго вантажиться. Переносимо копію в
// qVersions/{sha} (один запис на однаковий набір питань) і лишаємо в спробі
// лише qVer. Порядок у знімку вже той, що бачив студент, тож qOrder не потрібен:
// attemptQs() поверне ті самі питання. Спершу пишемо версію, потім чистимо спробу.
// Незавершені й свіжі (до доби) спроби не чіпаємо — студент ще може їх оновлювати.
export async function compactAttempts(uid, fb, { qVersionKey, max = 60 } = {}) {
  const { db, ref, update } = fb;
  if (!uid || !qVersionKey) return 0;
  const dayAgo = Date.now() - 864e5;
  const todo = (window.attempts || []).filter(a => a?.id && Array.isArray(a.questionsSnapshot) && a.questionsSnapshot.length
    && !a.qVer && a.status !== "in_progress" && (a.createdAt || 0) < dayAgo).slice(0, max);
  if (!todo.length) return 0;
  const vers = {}, upd = {};
  for (const a of todo) {
    const k = await qVersionKey(a.questionsSnapshot);
    if (!k) return 0;   // браузер не вміє SHA-256 — нічого не чіпаємо
    vers[`teachers/${uid}/qVersions/${k}`] = a.questionsSnapshot;
    upd[`teachers/${uid}/attempts/${a.id}/qVer`] = k;
    upd[`teachers/${uid}/attempts/${a.id}/questionsSnapshot`] = null;
  }
  await update(ref(db), vers);
  await update(ref(db), upd);
  return todo.length;
}

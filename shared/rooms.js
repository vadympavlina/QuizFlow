// ═══════════════════════════════════════════════════════════════════════
// shared/rooms.js — ігри наживо викладача, що йдуть зараз (дашборд, «Онлайн»).
// Список кімнат — teachers/{uid}/liveRooms, стан кожної — публічний rooms/{code}.
// Слухаємо лише status / currentQ / players (не всю кімнату з відповідями).
// ═══════════════════════════════════════════════════════════════════════
const { db, ref, get, onValue } = window._fb;
export const IN_GAME = ["question", "paused", "reveal"];

// Куди вести викладача з кімнати в певному стані
export const roomTarget = r => r.status === "lobby" ? "lobby" : r.status === "leaderboard" ? "podium" : "play-teacher";
export const roomState = r => r.status === "lobby" ? "Лобі відкрите"
  : r.status === "leaderboard" ? "Показуються результати"
  : `${r.status === "paused" ? "Пауза · " : ""}Питання ${r.q + 1}${r.qCount ? ` з ${r.qCount}` : ""}`;

export function watchRooms(uid, onChange){
  const rooms = new Map(), subs = new Map();
  const toMs = v => typeof v === "number" ? v : Number(v) || 0;
  onValue(ref(db, `teachers/${uid}/liveRooms`), snap => {
    const now = Date.now(), keep = new Set();
    Object.entries(snap.val() || {}).forEach(([code, v]) => {
      const created = typeof v === "number" ? v : toMs(v?.createdAt);
      if (now - created > 3 * 3600e3) return;          // старі кімнати прибирає live/setup
      keep.add(code);
      if (subs.has(code)) return;
      const r = { code, created, status: null, q: 0, qCount: 0, title: "", players: [] };
      rooms.set(code, r);
      subs.set(code, [
        onValue(ref(db, `rooms/${code}/status`), s => { r.status = s.val(); onChange(rooms); }),
        onValue(ref(db, `rooms/${code}/currentQ`), s => { r.q = Number(s.val()) || 0; onChange(rooms); }),
        onValue(ref(db, `rooms/${code}/players`), s => {
          r.players = Object.values(s.val() || {}).map(p => p?.nickname || "").filter(Boolean);
          onChange(rooms);
        }),
      ]);
      Promise.all([get(ref(db, `rooms/${code}/testTitle`)), get(ref(db, `rooms/${code}/qCount`))])
        .then(([t, q]) => { r.title = t.val() || ""; r.qCount = Number(q.val()) || 0; onChange(rooms); }).catch(() => {});
    });
    [...subs.keys()].forEach(code => {
      if (keep.has(code)) return;
      subs.get(code).forEach(off => { try { typeof off === "function" && off(); } catch {} });
      subs.delete(code); rooms.delete(code);
    });
    onChange(rooms);
  }, () => {});
  return rooms;
}

// Кімнати, що справді йдуть (без завершених і тих, у кого ще немає стану)
export const liveRooms = rooms => [...rooms.values()].filter(r => r.status && r.status !== "finished").sort((a, b) => b.created - a.created);

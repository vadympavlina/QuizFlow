// Сид для адмінки: 4 викладачі з різною активністю, ігри, звернення, новини
import { rich } from './rich.mjs';
export function admSeed(now){
  const D = 864e5, db = rich(now);
  const base = db.teachers.t1;
  // Ще троє викладачів з різною активністю
  const clone = (k, frac, shift) => {
    const at = {}; Object.entries(base.attempts).forEach(([id, a], i) => { if (i % frac === 0) at[id + k] = { ...a, createdAt: a.createdAt - shift * D, finishedAt: a.finishedAt - shift * D }; });
    return { tests: base.tests, links: base.links, attempts: at, students: {} };
  };
  db.teachers.t2 = clone('b', 2, 3); db.teachers.t3 = clone('c', 3, 10); db.teachers.t4 = { tests: {} };
  const gh = (code, title, days, n, qc) => ({ code, testId: 'T1', testTitle: title, playedAt: now - days * D, playerCount: n, questionCount: qc,
    results: Array.from({ length: n }, (_, i) => ({ nickname: 'Гравець ' + (i + 1), score: 9000 - i * 700, correct: Math.max(1, qc - i) })) });
  base.gameHistory = { '482913': gh('482913', 'Історія: Козацька доба', 0.2, 18, 10), '118277': gh('118277', 'Географія світу', 2, 24, 8), '903311': gh('903311', 'Основи Python', 6, 12, 6), '771100': gh('771100', 'Географія світу', 16, 27, 8) };
  db.teachers.t2.gameHistory = { '550011': gh('550011', 'Основи Python', 1, 9, 6), '550012': gh('550012', 'Основи Python', 9, 15, 6) };
  base.liveRooms = { '664422': true };
  db.rooms = { '664422': { status: 'question', currentQ: 3, testTitle: 'Географія світу', qCount: 8, hostUid: 't1', createdAt: now - 6e5, players: { p1: { nickname: 'Аня' }, p2: { nickname: 'Богдан' }, p3: { nickname: 'Катя' } } } };
  Object.assign(db.users.t1, { email: 'o.koval@quizflow.space', createdAt: now - 90 * D, lastLogin: now - 36e5 });
  Object.assign(db.users.t2, { createdAt: now - 40 * D, lastLogin: now - 2 * D });
  Object.assign(db.users.t3, { createdAt: now - 20 * D, lastLogin: now - 12 * D });
  Object.assign(db.users.t4, { createdAt: now - 3 * D, blocked: true });
  Object.assign(db.users.t5, { email: 'admin@quizflow.space', createdAt: now - 200 * D, lastLogin: now });
  db.bugReports = { r1: { status: 'new', text: 'Не відкривається тест на iPad', createdAt: now - 3 * 36e5, uid: 't2', page: '/tests' },
    r2: { status: 'new', text: 'Помилка при збереженні питання з картинкою', createdAt: now - D, uid: 't3', page: '/constructor' },
    r3: { status: 'resolved', text: 'Сповіщення приходять двічі', createdAt: now - 6 * D, uid: 't1', page: '/notifications' } };
  db.news = { n1: { title: 'Нове: історія ігор', text: 'Тепер результати всіх ігор зберігаються.', createdAt: now - 2 * D, published: true, category: 'update' },
    n2: { title: 'Оновлено аналітику', text: 'Графіки стали зручнішими.', createdAt: now - 9 * D, published: true, category: 'update' } };
  return db;
}

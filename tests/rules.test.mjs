// Автотести правил бази: npx firebase emulators:exec --only database "node tests/rules.test.mjs"
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { ref, get, set, update, push, remove, serverTimestamp } from "firebase/database";
import fs from "fs";

const env = await initializeTestEnvironment({
  projectId: "quizflow-rules",
  database: { host: "127.0.0.1", port: 9000, rules: fs.readFileSync(new URL("../database.rules.json", import.meta.url), "utf8") },
});
const now = Date.now();
await env.withSecurityRulesDisabled(async c => {
  await set(ref(c.database(), "/"), {
    users: {
      adm: { role: "admin", name: "A" },
      t1: { role: "teacher", name: "T1", aiSettings: { aiComments: true } },
      t2: { role: "teacher", name: "T2" },
      bl: { role: "teacher", name: "B", blocked: true },
    },
    invite_tokens: { tok1: { createdAt: 1 }, used1: { used: true } },
    settings: { ai: { groqApiKey: "k" }, telegramBot: { token: "secret" }, navigation: [1] },
    news: { n1: { title: "x" } },
    teachers: {
      t1: {
        tests: { T1: { title: "Test", questions: [1] } },
        links: { L1: { testId: "T1", usedAttempts: 2 } },
        attempts: { A1: { testId: "T1", name: "Іван", surname: "Петренко", createdAt: now }, OLD: { testId: "T1", name: "X", surname: "Y", createdAt: now - 3 * 864e5 } },
        students: { S1: { name: "Іван", surname: "Петренко", attempts: [] } },
        studentIndex: { "петренко_іван": "S1" },
        folders: { f1: { name: "F" } },
      },
      bl: { tests: { B1: { title: "b" } } },
    },
    rooms: { "11112222": { hostUid: "t1", status: "question", currentQ: 0, players: { p1: { nickname: "Ann", active: true, online: true }, off: { nickname: "Z", active: false }, p5: { nickname: "Kim", active: true } } } },
  });
});

const anon = env.unauthenticatedContext().database();
const t1 = env.authenticatedContext("t1").database();
const t2 = env.authenticatedContext("t2").database();
const bl = env.authenticatedContext("bl").database();
const adm = env.authenticatedContext("adm").database();
const nu = env.authenticatedContext("newbie").database();
const nu2 = env.authenticatedContext("newbie2").database();

let pass = 0, fail = 0;
async function t(name, expectOk, fn){
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); pass++; }
  catch (e){ fail++; console.log("✗", name, "—", e.message.split("\n")[0]); }
}
const T = "teachers/t1";

// ── Студент без входу (сторінка тесту) ──
await t("anon read single test", true, () => get(ref(anon, `${T}/tests/T1`)));
await t("anon list tests", false, () => get(ref(anon, `${T}/tests`)));
await t("anon read folders", false, () => get(ref(anon, `${T}/folders`)));
await t("anon write test", false, () => set(ref(anon, `${T}/tests/T1/title`), "hack"));
await t("anon read link", true, () => get(ref(anon, `${T}/links/L1`)));
await t("anon list links", false, () => get(ref(anon, `${T}/links`)));
await t("anon usedAttempts +1", true, () => set(ref(anon, `${T}/links/L1/usedAttempts`), 3));
await t("anon usedAttempts reset", false, () => set(ref(anon, `${T}/links/L1/usedAttempts`), 0));
await t("anon usedAttempts on missing link", false, () => set(ref(anon, `${T}/links/NOPE/usedAttempts`), 1));
await t("anon list attempts", false, () => get(ref(anon, `${T}/attempts`)));
await t("anon read attempt by id", true, () => get(ref(anon, `${T}/attempts/A1/testId`)));
const newA = push(ref(anon, `${T}/attempts`));
await t("anon create attempt", true, () => set(newA, { testId: "T1", name: "Олег", surname: "Сидоренко", createdAt: now, status: "in_progress" }));
await t("anon update fresh attempt", true, () => update(ref(anon, `${T}/attempts/${newA.key}`), { status: "completed", score: 90 }));
await t("anon update old attempt", false, () => update(ref(anon, `${T}/attempts/OLD`), { score: 100 }));
await t("anon change attempt testId", false, () => update(ref(anon, `${T}/attempts/A1`), { testId: "T9" }));
await t("anon delete attempt", false, () => remove(ref(anon, `${T}/attempts/A1`)));
await t("anon overwrite attempt w/o testId", false, () => set(ref(anon, `${T}/attempts/A1`), { score: 1 }));
await t("anon attemptIndex write", true, () => set(ref(anon, `${T}/attemptIndex/T1/сидоренко_олег`), newA.key));
await t("anon attemptIndex read", true, () => get(ref(anon, `${T}/attemptIndex/T1/сидоренко_олег`)));
await t("anon attemptIndex list", false, () => get(ref(anon, `${T}/attemptIndex/T1`)));
await t("anon attemptIndex overwrite live", false, () => set(ref(anon, `${T}/attemptIndex/T1/сидоренко_олег`), "A1"));
await t("anon attemptIndex fake id", false, () => set(ref(anon, `${T}/attemptIndex/T1/x_y`), "NOPE"));
await t("anon list students", false, () => get(ref(anon, `${T}/students`)));
await t("anon studentIndex read", true, () => get(ref(anon, `${T}/studentIndex/петренко_іван`)));
await t("anon student card read", true, () => get(ref(anon, `${T}/students/S1`)));
await t("anon student card update", true, () => update(ref(anon, `${T}/students/S1`), { avgGrade: 10, lastSeen: now }));
await t("anon student card delete", false, () => remove(ref(anon, `${T}/students/S1`)));
const newS = push(ref(anon, `${T}/students`));
await t("anon create student", true, () => set(newS, { name: "Олег", surname: "Сидоренко", id: newS.key }));
await t("anon studentIndex new", true, () => set(ref(anon, `${T}/studentIndex/сидоренко_олег`), newS.key));
await t("anon studentIndex hijack", false, () => set(ref(anon, `${T}/studentIndex/петренко_іван`), newS.key));
await t("anon push notification", true, () => set(push(ref(anon, `${T}/notifications`)), { type: "attempt", ts: now }));
await t("anon read notifications", false, () => get(ref(anon, `${T}/notifications`)));
await t("anon read settings/ai", true, () => get(ref(anon, "settings/ai")));
await t("anon read telegramBot", false, () => get(ref(anon, "settings/telegramBot")));
await t("anon read teacher aiSettings", true, () => get(ref(anon, "users/t1/aiSettings")));
await t("anon read teacher profile", false, () => get(ref(anon, "users/t1")));
await t("anon list users", false, () => get(ref(anon, "users")));
await t("anon read invite token", true, () => get(ref(anon, "invite_tokens/tok1")));
await t("anon list invite tokens", false, () => get(ref(anon, "invite_tokens")));
await t("anon read root", false, () => get(ref(anon, "/")));

// ── Реєстрація ──
await t("register as admin", false, () => set(ref(nu, "users/newbie"), { role: "admin", inviteToken: "tok1" }));
await t("register without token", false, () => set(ref(nu, "users/newbie"), { role: "teacher", blocked: false }));
await t("register with used token", false, () => set(ref(nu, "users/newbie"), { role: "teacher", blocked: false, inviteToken: "used1" }));
await t("register for someone else", false, () => set(ref(nu, "users/zzz"), { role: "teacher", blocked: false, inviteToken: "tok1" }));
await t("register ok", true, () => set(ref(nu, "users/newbie"), { name: "N", role: "teacher", blocked: false, createdAt: now, inviteToken: "tok1" }));
await t("mark token used", true, () => update(ref(nu, "invite_tokens/tok1"), { used: true, usedAt: now, usedBy: "newbie" }));
await t("reuse token", false, () => set(ref(nu2, "users/newbie2"), { role: "teacher", blocked: false, inviteToken: "tok1" }));
await t("new teacher promote self", false, () => update(ref(nu, "users/newbie"), { role: "admin" }));
await t("new teacher unblock self", false, () => update(ref(nu, "users/newbie"), { blocked: false }));

// ── Викладач ──
await t("teacher read own", true, () => get(ref(t1, T)));
await t("teacher write own", true, () => set(ref(t1, `${T}/folders/f2`), { name: "G" }));
await t("teacher delete own attempt", true, () => remove(ref(t1, `${T}/attempts/OLD`)));
await t("teacher read other", false, () => get(ref(t2, T)));
await t("teacher list other tests", false, () => get(ref(t2, `${T}/tests`)));
await t("teacher share test to other", true, () => set(push(ref(t2, `${T}/tests`)), { title: "shared", status: "draft" }));
await t("teacher overwrite other's test", false, () => set(ref(t2, `${T}/tests/T1`), { title: "x" }));
await t("teacher delete other's folder", false, () => remove(ref(t2, `${T}/folders/f1`)));
await t("teacher list users", true, () => get(ref(t1, "users")));
await t("teacher self-promote", false, () => update(ref(t1, "users/t1"), { role: "admin" }));
await t("teacher edit other user", false, () => update(ref(t1, "users/t2"), { blocked: true }));
await t("teacher read nav", true, () => get(ref(t1, "settings/navigation")));
await t("teacher read telegramBot", true, () => get(ref(t1, "settings/telegramBot")));
await t("teacher write settings", false, () => set(ref(t1, "settings/ai/groqApiKey"), "x"));
await t("teacher read news", true, () => get(ref(t1, "news")));
await t("teacher write news", false, () => set(ref(t1, "news/n2"), { title: "x" }));
await t("teacher push bugReport", true, () => set(push(ref(t1, "bugReports")), { text: "bug" }));
await t("teacher read bugReports", false, () => get(ref(t1, "bugReports")));
await t("teacher read adminTasks", false, () => get(ref(t1, "adminTasks")));
await t("teacher list invite tokens", false, () => get(ref(t1, "invite_tokens")));
await t("blocked write own", false, () => set(ref(bl, "teachers/bl/tests/B2"), { title: "x" }));
await t("blocked read users", false, () => get(ref(bl, "users")));
await t("blocked read own profile", true, () => get(ref(bl, "users/bl")));

// ── Адмін ──
await t("admin read all", true, () => get(ref(adm, "teachers")));
await t("admin users write", true, () => update(ref(adm, "users/t2"), { blocked: true }));
await t("admin settings write", true, () => set(ref(adm, "settings/ai/groqApiKey"), "new"));
await t("admin tokens", true, () => set(ref(adm, "invite_tokens/tok2"), { createdAt: now }));
await t("admin tasks", true, () => set(push(ref(adm, "adminTasks")), { title: "x" }));
await t("admin read root", false, () => get(ref(adm, "/")));

// ── Живі ігри ──
const R = "rooms/11112222";
await t("anon read room", true, () => get(ref(anon, R)));
await t("anon list rooms", false, () => get(ref(anon, "rooms")));
await t("anon join", true, () => set(ref(anon, `${R}/players/p2`), { nickname: "Bob", joinedAt: serverTimestamp(), active: true, online: true }));
await t("anon join with score", false, () => set(ref(anon, `${R}/players/p3`), { nickname: "Eve", score: 9999 }));
await t("anon overwrite player", false, () => set(ref(anon, `${R}/players/p1`), { nickname: "Pwn" }));
await t("anon set score", false, () => set(ref(anon, `${R}/players/p1/score`), 9999));
await t("anon online flag", true, () => set(ref(anon, `${R}/players/p1/online`), false));
await t("anon answer", true, () => set(ref(anon, `${R}/answers/0/p1`), { value: 2, answeredAt: serverTimestamp() }));
await t("anon answer forged time", false, () => set(ref(anon, `${R}/answers/0/p2`), { value: 2, answeredAt: now - 60000 }));
await t("anon answer future question", false, () => set(ref(anon, `${R}/answers/3/p2`), { value: 1, answeredAt: serverTimestamp() }));
await t("anon answer with isCorrect", false, () => set(ref(anon, `${R}/answers/0/p2`), { value: 1, isCorrect: true, answeredAt: serverTimestamp() }));
await t("anon answer huge text", false, () => set(ref(anon, `${R}/answers/0/p2`), { value: "x".repeat(500), answeredAt: serverTimestamp() }));
await t("anon answer multi", true, () => set(ref(anon, `${R}/answers/0/p2`), { value: [0, 2], answeredAt: serverTimestamp() }));
await t("anon answer again", false, () => set(ref(anon, `${R}/answers/0/p1`), { value: 3 }));
await t("anon answer with points", false, () => set(ref(anon, `${R}/answers/1/p1`), { value: 1, points: 1000 }));
await t("anon answer for missing player", false, () => set(ref(anon, `${R}/answers/0/ghost`), { value: 1 }));
await t("anon answer kicked player", false, () => set(ref(anon, `${R}/answers/0/off`), { value: 1 }));
await t("anon change status", false, () => set(ref(anon, `${R}/status`), "finished"));
await t("anon create room", false, () => set(ref(anon, "rooms/99990000"), { hostUid: "x" }));
await t("host write ranks", true, () => set(ref(t1, `${R}/ranks/p1`), { r: 1, s: 900, g: 0, n: 2 }));
await t("anon write ranks", false, () => set(ref(anon, `${R}/ranks/p1`), { r: 1, s: 99999 }));
await t("host reveal", true, () => set(ref(t1, `${R}/status`), "reveal"));
await t("anon answer during reveal", false, () => set(ref(anon, `${R}/answers/0/p5`), { value: 1, answeredAt: serverTimestamp() }));
await t("host update room", true, () => update(ref(t1, R), { status: "leaderboard" }));
await t("host write points", true, () => set(ref(t1, `${R}/answers/0/p1/points`), 800));
await t("host kick player", true, () => update(ref(t1, `${R}/players/p2`), { active: false }));
await t("other teacher hijack room", false, () => update(ref(t2, R), { status: "finished" }));
await t("teacher create room as other host", false, () => set(ref(t2, "rooms/33334444"), { hostUid: "t1" }));
await t("teacher create room", true, () => update(ref(t1), { "rooms/33334444": { hostUid: "t1", status: "lobby" }, "teachers/t1/liveRooms/33334444": { createdAt: now } }));
await t("teacher delete dead + own rooms (multi)", true, () => update(ref(t1), { "rooms/55556666": null, "rooms/33334444": null, "teachers/t1/liveRooms/33334444": null }));
await t("blocked teacher create room", false, () => update(ref(bl), { "rooms/77778888": { hostUid: "bl" }, "teachers/bl/liveRooms/77778888": { createdAt: now } }));
await t("teacher delete others room", false, () => remove(ref(t2, R)));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);

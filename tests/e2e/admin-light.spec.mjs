// Адмінка читає легкі дзеркала (attemptLog / gameLog / teacherStats), які веде панель,
// і має показувати рівно ті самі цифри, що й старий повний шлях через усі спроби.
import { test, expect, seed, loginAs, readDb } from "./fixtures.mjs";
import { admSeed } from "./seeds/admin.mjs";

async function adminSnapshot(page) {
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("qf_adm")) localStorage.removeItem(k); });
  await loginAs(page, "t5");
  await page.goto("/admin/stats");
  await page.waitForFunction(() => window._stats && Object.keys(window._stats).length);
  return page.evaluate(() => {
    const sortObj = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
    const at = (window._allAttempts || []).map(x => JSON.stringify([x.teacherId, x.createdAt, x.status, x.grade12, x.finishedAt])).sort();
    const g = (window._allGames || []).map(x => JSON.stringify([x.teacherId, x.code, x.players, x.title, x.playedAt, x.questions])).sort();
    return { stats: sortObj(window._stats), at, g, text: document.querySelector("main")?.innerText };
  });
}

test("адмінка: легкий шлях дає ті самі дані, що й повний", async ({ page, errors }) => {
  await seed(page, admSeed(Date.now()), "t5");
  const heavy = await adminSnapshot(page);

  // Кожен активний викладач заходить у панель — вона заповнює дзеркала
  for (const uid of ["t1", "t2", "t3"]) {
    await loginAs(page, uid);
    await page.goto("/tests");
    await expect.poll(async () => (await readDb(page)).teacherStats?.[uid]?.logReady, { timeout: 20_000 }).toBe(true);
  }
  const db = await readDb(page);
  expect(Object.keys(db.attemptLog.t1)).toHaveLength(Object.keys(db.teachers.t1.attempts).length);
  expect(Object.keys(db.gameLog.t1)).toHaveLength(Object.keys(db.teachers.t1.gameHistory).length);

  const light = await adminSnapshot(page);
  expect(light.stats).toEqual(heavy.stats);
  expect(light.at).toEqual(heavy.at);
  expect(light.g).toEqual(heavy.g);
  expect(light.text).toEqual(heavy.text);
  expect(errors).toEqual([]);
});

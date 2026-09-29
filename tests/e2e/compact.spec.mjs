// Старі спроби з повною копією питань (questionsSnapshot) панель стискає у qVersions.
// Після цього спроба має відкриватися з тими самими питаннями.
import { test, expect, seed, readDb } from "./fixtures.mjs";
import { admSeed } from "./seeds/admin.mjs";

test("стискання старих спроб не змінює перегляд спроби", async ({ page, errors }) => {
  const db = admSeed(Date.now());
  const T = db.teachers.t1, ids = Object.keys(T.attempts);
  // Половина — у переставленому порядку, як бачив студент при перемішуванні
  ids.forEach((id, i) => { const a = T.attempts[id]; const qs = T.tests[a.testId].questions; a.questionsSnapshot = i % 2 ? [...qs].reverse() : qs; });
  await seed(page, db, "t1");

  const pick = [ids[1], ids[2], ids[5]];
  const view = async () => {
    const out = [];
    for (const id of pick) {
      await page.evaluate(id => G.viewAtt(id), id);
      await page.waitForTimeout(400);
      out.push((await page.locator("#m-attempt").innerText()).replace(/\s+/g, " "));
      await page.evaluate(() => closeM("m-attempt"));
    }
    return out;
  };
  await page.goto("/attempts");
  await page.waitForFunction(() => window.G?.viewAtt && (window.attempts || []).length);
  const before = await view();

  await expect.poll(async () => Object.values((await readDb(page)).teachers.t1.attempts).filter(a => a.qVer).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const after = await readDb(page);
  const atts = Object.values(after.teachers.t1.attempts);
  const vers = Object.keys(after.teachers.t1.qVersions || {});
  expect(vers.length).toBeLessThan(atts.filter(a => a.qVer).length);   // однакові набори питань зберігаються один раз
  expect(atts.filter(a => a.qVer && a.questionsSnapshot)).toEqual([]);

  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.G?.viewAtt && (window.attempts || []).length);
  const again = await view();
  expect(again).toEqual(before);
  expect(before.every(t => t.length > 50)).toBe(true);
  expect(errors).toEqual([]);
});

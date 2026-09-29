// Студент проходить тест з питаннями всіх типів; спроба й запис для адмінки зберігаються
import { test, expect, seed, readDb } from "./fixtures.mjs";
import { tseed } from "./seeds/student.mjs";

for (const [label, vp] of [["комп'ютер", { width: 1440, height: 900 }], ["телефон", { width: 390, height: 844 }]]) {
  test(`проходження тесту: ${label}`, async ({ page, errors }) => {
    await page.setViewportSize(vp);
    await seed(page, tseed());
    await page.goto("/test?link=LX&t=t1");
    await page.waitForFunction(() => typeof window.obSkip === "function");
    await page.evaluate(() => obSkip());
    await page.fill("#inputName", "Марія");
    await page.fill("#inputSurname", "Бондар");
    await page.click("#startBtn");
    await page.locator(".choice-item").nth(1).click();
    await page.click("#nextBtn"); await page.locator(".choice-item").nth(0).click(); await page.locator(".choice-item").nth(2).click();
    await page.click("#nextBtn"); await page.fill(".text-answer", "Париж");
    await page.click("#nextBtn"); await page.fill(".text-answer", "56");
    await page.click("#nextBtn"); await page.locator(".match-opt").nth(0).click();
    await page.click("#nextBtn"); await page.locator('.ord-btn[data-mv="1"]').nth(0).click();
    await page.click("#nextBtn");
    await page.click("#nextBtn");
    await page.evaluate(() => window._confirmFinish());

    await expect.poll(async () => {
      const db = await readDb(page);
      return Object.values(db.teachers.t1.attempts || {}).filter(a => a.finishedAt).length;
    }, { timeout: 15_000 }).toBe(1);
    const db = await readDb(page);
    const [id, att] = Object.entries(db.teachers.t1.attempts)[0];
    expect(att.name).toBe("Марія");
    expect(att.qVer, "питання зберігаються версією, а не копією").toBeTruthy();
    expect(att.questionsSnapshot).toBeUndefined();
    const log = db.attemptLog?.t1?.[id];
    expect(log, "запис для адмінки").toBeTruthy();
    expect(log.c).toBeGreaterThan(0);
    expect(log.f).toBe(att.finishedAt);
    expect(log.s).toBe(att.status);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

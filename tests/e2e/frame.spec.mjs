// Дизайн «рамка + картка»: верхня панель лежить на темній рамці, вміст — у великій світлій картці
import { test, expect, seed } from "./fixtures.mjs";
import { rich } from "./seeds/rich.mjs";

const geo = page => page.evaluate(() => {
  const q = document.getElementById("qtb").getBoundingClientRect(), m = document.querySelector(".main").getBoundingClientRect();
  const cs = getComputedStyle(document.querySelector(".main"));
  return { qPos: getComputedStyle(document.getElementById("qtb")).position, qBottom: Math.round(q.bottom), mTop: Math.round(m.top), mRight: Math.round(innerWidth - m.right), radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, frame: getComputedStyle(document.body).backgroundColor, scrollW: document.documentElement.scrollWidth };
});

test("комп'ютер: панель закріплена, вміст у білій картці з радіусом 24px", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");
  for (const pg of ["/", "attempts", "students"]) {
    await page.goto("/" + pg.replace(/^\//, "")); await page.waitForTimeout(1200);
    const g = await geo(page);
    expect(g.qPos, pg).toBe("fixed");
    expect(g.mTop, pg).toBeGreaterThanOrEqual(g.qBottom);           // картка починається під панеллю
    expect(g.mRight, pg).toBe(12);
    expect(g.radius, pg).toBe("24px");
    expect(g.frame, pg).toBe("rgb(238, 242, 251)");   // світле тло сторінки
    expect(g.scrollW, pg).toBeLessThanOrEqual(page.viewportSize().width);
  }
  // Картка анімується разом з меню й панеллю (інакше під час згортання меню видно шви)
  const tr = await page.evaluate(() => { const m = getComputedStyle(document.querySelector(".main")), q = getComputedStyle(document.getElementById("qtb")); return { m: m.transitionProperty + "|" + m.transitionDuration, q: q.transitionProperty + "|" + q.transitionDuration }; });
  expect(tr.m).toContain("margin-left");
  expect(tr.m).toContain("0.32s");
  expect(tr.q).toContain("left");
  expect(tr.q).toContain("0.32s");

  // Після прокрутки панель лишається на місці
  await page.evaluate(() => window.scrollTo(0, 400));
  expect((await page.locator("#qtb").boundingBox()).y).toBe(0);
  expect(errors).toEqual([]);
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("рядок 60px на рамці, під ним картка з верхніми радіусами 26px на всю ширину", async ({ page, errors }) => {
    await seed(page, rich(Date.now()), "t1");
    await page.goto("/tests"); await page.waitForTimeout(1200);
    const g = await geo(page);
    expect(g.qPos).toBe("fixed");
    expect(g.qBottom).toBe(60);
    expect(g.mTop).toBe(60);
    expect(g.mRight).toBe(0);
    expect(g.radius).toBe("26px");
    expect(g.scrollW).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
});

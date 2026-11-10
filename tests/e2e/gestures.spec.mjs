// Жести на телефоні: свайп закриває меню (за відстанню або швидкістю), прокрутка списку — ні
import { test, expect, seed } from "./fixtures.mjs";
import { rich } from "./seeds/rich.mjs";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function touchDrag(page, cdp, from, to, { steps = 8, gap = 16 } = {}) {
  const pt = (x, y) => [{ x, y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(from.x, from.y) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps) });
    if (gap) await page.waitForTimeout(gap);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const isOpen = page => page.evaluate(() => document.documentElement.classList.contains("sb-open"));

async function openDrawer(page) {
  await seed(page, rich(Date.now()), "t1");
  await page.goto("/attempts"); await page.waitForTimeout(1200);
  await page.locator("#qtb-menu").click();
  await expect.poll(() => isOpen(page)).toBe(true);
  await page.waitForTimeout(450);                                    // дочекатись кінця виїзду
}

test("свайп ліворуч далеко — меню закривається; підкладка й меню йдуть за пальцем", async ({ page, errors }) => {
  await openDrawer(page);
  const cdp = await page.context().newCDPSession(page);
  // під час жесту меню зсунуте, а підкладка прозоріша
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 250, y: 300, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 250 - i * 20, y: 300, id: 1 }] }); await page.waitForTimeout(16); }
  const mid = await page.evaluate(() => ({ tx: new DOMMatrix(getComputedStyle(document.getElementById("sidebar")).transform).m41, op: +getComputedStyle(document.getElementById("sb-ov")).opacity }));
  expect(mid.tx).toBeLessThan(-100);                                  // −120 від початку: 1:1 за пальцем
  expect(mid.op).toBeLessThan(0.8);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 60, y: 300, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => isOpen(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("швидкий короткий змах закриває меню (за швидкістю, а не відстанню)", async ({ page, errors }) => {
  await openDrawer(page);
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(page, cdp, { x: 200, y: 300 }, { x: 140, y: 300 }, { steps: 4, gap: 0 });   // 60px без пауз — швидкість не залежить від повільності CI
  await expect.poll(() => isOpen(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("повільний короткий рух повертає меню назад і воно лишається відкритим", async ({ page, errors }) => {
  await openDrawer(page);
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(page, cdp, { x: 200, y: 300 }, { x: 170, y: 300 }, { steps: 6, gap: 60 });  // 30px повільно
  await page.waitForTimeout(450);
  expect(await isOpen(page)).toBe(true);
  expect(await page.evaluate(() => Math.round(new DOMMatrix(getComputedStyle(document.getElementById("sidebar")).transform).m41))).toBe(0);
  expect(errors).toEqual([]);
});

test("вертикальна прокрутка списку пунктів меню не закриває його", async ({ page, errors }) => {
  await openDrawer(page);
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(page, cdp, { x: 150, y: 500 }, { x: 148, y: 300 }, { steps: 8, gap: 16 });
  await page.waitForTimeout(400);
  expect(await isOpen(page)).toBe(true);
  expect(errors).toEqual([]);
});

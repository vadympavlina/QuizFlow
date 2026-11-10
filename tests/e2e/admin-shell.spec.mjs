// Адмінка: той самий каркас, що й у панелі викладача — шлях «Розділ / Сторінка», без дублів заголовків,
// біла картка на світлій рамці, у згорнутому меню без швидких кнопок, свайп закриває меню на телефоні
import { test, expect, seed } from "./fixtures.mjs";
import { admSeed } from "./seeds/admin.mjs";

const ADMIN = ["overview", "stats", "problems", "audit", "teachers", "roles", "features", "invites", "announcements", "mail", "news", "navigation", "ai-settings", "telegram", "cleanup"];

test("кожна сторінка адмінки: шлях «Розділ / Сторінка», видимий заголовок не повторює його", async ({ page, errors }) => {
  await seed(page, admSeed(Date.now()), "t5");
  for (const pg of ADMIN) {
    await page.goto("/admin/" + pg); await page.waitForTimeout(1400);
    const r = await page.evaluate(() => {
      const plain = s => String(s || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, " ").replace(/\s+/g, " ").trim();
      const cur = plain(document.querySelector(".tb-tt b")?.textContent);
      const sec = document.querySelector(".tb-tt small");
      return {
        cur, sec: sec?.textContent.trim(), sep: sec ? getComputedStyle(sec, "::after").content : "",
        shown: [...document.querySelectorAll("#admin-content h1:not(.tb-h1-dup)")].map(h => plain(h.textContent)),
        all: document.querySelectorAll("#admin-content h1").length,
      };
    });
    expect(r.cur, `сторінка на ${pg}`).not.toBe("");
    expect(r.sec, `розділ на ${pg}`).toBeTruthy();
    expect(r.sep, `роздільник на ${pg}`).toContain("/");
    expect(r.all, `заголовок h1 на ${pg}`).toBeGreaterThan(0);
    expect(r.shown.length, `видимий заголовок на ${pg}`).toBeGreaterThan(0);
    for (const h of r.shown) expect(h === r.cur || h.startsWith(r.cur + " "), `заголовок «${h}» повторює «${r.cur}» на ${pg}`).toBe(false);
  }
  expect(errors).toEqual([]);
});

test("каркас: активний пункт білий, картка на світлій рамці, згорнуте меню без швидких кнопок", async ({ page, errors }) => {
  await seed(page, admSeed(Date.now()), "t5");
  await page.goto("/admin/teachers"); await page.waitForTimeout(1400);
  const g = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    on: getComputedStyle(document.querySelector(".asb-item.on")).backgroundColor,
    card: getComputedStyle(document.querySelector(".main")).backgroundColor,
    radius: getComputedStyle(document.querySelector(".main")).borderTopLeftRadius,
    sec: getComputedStyle(document.querySelector(".asb-sec span")).textTransform,
  }));
  expect(g).toEqual({ bg: "rgb(238, 242, 251)", on: "rgb(255, 255, 255)", card: "rgb(255, 255, 255)", radius: "24px", sec: "none" });
  expect(await page.locator(".asb-strip").isVisible()).toBe(true);
  await page.locator("#asb-toggle").click(); await page.waitForTimeout(600);
  expect(await page.locator(".asb-strip").isVisible()).toBe(false);
  await page.locator("#asb-toggle").click(); await page.waitForTimeout(600);
  expect(await page.locator(".asb-strip").isVisible()).toBe(true);
  expect(errors).toEqual([]);
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("сторінки адмінки не ширші за екран, меню закривається свайпом", async ({ page, errors }) => {
    await seed(page, admSeed(Date.now()), "t5");
    for (const pg of ADMIN) {
      await page.goto("/admin/" + pg); await page.waitForTimeout(1300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `ширина ${pg}`).toBeLessThanOrEqual(390);
    }
    await page.goto("/admin/audit"); await page.waitForTimeout(1300);
    await page.locator("#tb-menu").click();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("asb-open"))).toBe(true);
    await page.waitForTimeout(450);
    const cdp = await page.context().newCDPSession(page);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(250, 300) });
    for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(250 - i * 30, 300) }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("asb-open"))).toBe(false);
    expect(errors).toEqual([]);
  });
});

// Меню й верхня смужка: шлях «Розділ / Сторінка», без дубльованих заголовків, кнопка «Новий тест» у меню
import { test, expect, seed } from "./fixtures.mjs";
import { rich } from "./seeds/rich.mjs";

const PANEL = ["/", "tests", "attempts", "links", "analytics", "notifications", "students", "gradebook", "suspicious", "online", "news", "game-history", "profile"];

test("кожна сторінка показує шлях «Розділ / Сторінка», а видимий заголовок не повторює його", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");
  for (const pg of PANEL) {
    await page.goto("/" + pg.replace(/^\//, "")); await page.waitForTimeout(1300);
    const r = await page.evaluate(() => {
      const plain = s => String(s || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, " ").replace(/\s+/g, " ").trim();
      const cur = plain(document.getElementById("qtb-t").textContent);
      const shown = [...document.querySelectorAll(".main h1:not(.qtb-h1-dup)")].map(h => plain(h.textContent));
      return { sec: document.getElementById("qtb-sec").textContent.trim(), cur, shown, sepContent: getComputedStyle(document.getElementById("qtb-sec"), "::after").content };
    });
    expect(r.sec, `розділ на ${pg}`).not.toBe("");
    expect(r.cur, `сторінка на ${pg}`).not.toBe("");
    expect(r.sepContent, `роздільник «/» на ${pg}`).toContain("/");
    for (const h of r.shown) expect(h === r.cur || h.startsWith(r.cur + " "), `видимий заголовок «${h}» повторює «${r.cur}» на ${pg}`).toBe(false);
  }
  expect(errors).toEqual([]);
});

test("заголовок, що відрізняється від назви сторінки, лишається видимим", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");
  await page.goto("/"); await page.waitForTimeout(1300);
  await expect(page.locator(".main h1").first()).toContainText("Добрий");          // привітання на дашборді
  await page.goto("/attempts"); await page.waitForTimeout(1300);
  await expect(page.locator(".main h1").first()).toHaveClass(/qtb-h1-dup/);        // «Спроби» вже є в шляху
  expect(errors).toEqual([]);
});

test("меню: «Новий тест» — на «Тестах» відкриває форму, на інших сторінках веде на неї", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");
  await page.goto("/attempts"); await page.waitForTimeout(1200);
  await page.locator("#sb-new").click();
  await expect(page).toHaveURL(/\/tests(\?|$)/);
  await expect(page.locator("#nt-n")).toBeVisible();                                // форма нового тесту відкрилась

  await page.goto("/tests"); await page.waitForTimeout(1200);
  const url = page.url();
  await page.locator("#sb-new").click();
  await expect(page.locator("#nt-n")).toBeVisible();
  expect(page.url()).toBe(url);                                                     // без переходу
  expect(errors).toEqual([]);
});

test("меню: активний пункт білий, розділи без великих літер, згорнуте меню 68px", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");
  await page.goto("/students"); await page.waitForTimeout(1300);
  const st = await page.evaluate(() => {
    const a = getComputedStyle(document.querySelector("#sidebar .ni.active")), sec = getComputedStyle(document.querySelector("#sidebar .nav-sec span"));
    return { bg: a.backgroundColor, tt: sec.textTransform, w: Math.round(document.getElementById("sidebar").getBoundingClientRect().width) };
  });
  expect(st.bg).toBe("rgb(255, 255, 255)");
  expect(st.tt).toBe("none");
  expect(st.w).toBe(272);
  await page.locator("#sb-toggle").click(); await page.waitForTimeout(600);
  expect(await page.evaluate(() => Math.round(document.getElementById("sidebar").getBoundingClientRect().width))).toBe(68);
  expect(errors).toEqual([]);
});

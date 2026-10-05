// Панель викладача на телефоні: меню висувається, сторінки не ширші за екран,
// а на комп'ютері мобільна шапка не з'являється.
import { test, expect, seed } from "./fixtures.mjs";
import { rich } from "./seeds/rich.mjs";

const PANEL = ["/", "tests", "attempts", "links", "analytics", "notifications", "students", "gradebook", "suspicious", "online", "news", "game-history"];
const OTHER = ["constructor?id=T1", "live", "onboarding"];
const PHONE = { width: 390, height: 844 };

test.describe("телефон", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test("сторінки панелі не ширші за екран, заглушки немає", async ({ page, errors }) => {
    await seed(page, rich(Date.now()), "t1");
    for (const pg of [...PANEL, ...OTHER]) {
      await page.goto("/" + pg.replace(/^\//, ""));
      await page.waitForTimeout(1500);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, `ширина сторінки ${pg}`).toBeLessThanOrEqual(PHONE.width);
      await expect(page.getByText("Мобільна версія недоступна")).toHaveCount(0);
      if (PANEL.includes(pg)) await expect(page.locator("#mtb"), `шапка на ${pg}`).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("меню відкривається кнопкою і закривається підкладкою та Esc", async ({ page, errors }) => {
    await seed(page, rich(Date.now()), "t1");
    await page.goto("/attempts");
    const sb = page.locator("#sidebar");
    await expect(sb).toBeHidden();
    await page.locator("#mtb-menu").click();
    await expect(sb).toBeInViewport();
    await expect(page.locator("#mtb-menu")).toHaveAttribute("aria-expanded", "true");
    await page.mouse.click(PHONE.width - 10, PHONE.height / 2);   // підкладка праворуч від меню
    await expect(sb).toBeHidden();
    await page.locator("#mtb-menu").click();
    await expect(sb).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(sb).toBeHidden();
    // Перехід за пунктом меню
    await page.locator("#mtb-menu").click();
    await sb.locator('a[href="students"]').click();
    await expect(page).toHaveURL(/\/students$/);
    expect(errors).toEqual([]);
  });

  test("студенти: тап по рядку відкриває профіль, «Усі студенти» — закриває", async ({ page, errors }) => {
    await seed(page, rich(Date.now()), "t1");
    await page.goto("/students");
    await page.locator("#students-body tr[data-st-id]").nth(2).click();
    const side = page.locator("#st-side-card");
    await expect(side).toHaveClass(/open/);
    await expect(side.locator(".pf-name")).toBeInViewport();
    await side.locator(".st-back").click();
    await expect(side).not.toHaveClass(/open/);
    expect(errors).toEqual([]);
  });
});

test("комп'ютер: мобільної шапки й кнопки «Усі студенти» не видно", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");
  await page.goto("/students");
  await page.waitForTimeout(1200);
  await expect(page.locator("#mtb")).toBeHidden();
  await expect(page.locator("#sidebar")).toBeInViewport();
  await expect(page.locator(".st-back")).toBeHidden();
  expect(errors).toEqual([]);
});

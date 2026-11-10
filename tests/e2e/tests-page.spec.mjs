// Сторінка «Тести»: тести видно одразу, папки — списком збоку (на телефоні — чіпами)
import { test, expect, seed } from "./fixtures.mjs";
import { rich } from "./seeds/rich.mjs";

const withFolders = () => {
  const d = rich(Date.now()), T = d.teachers.t1.tests, ids = Object.keys(T);
  d.teachers.t1.folders = {
    f1: { id: "f1", name: "Географія", color: "#3B6BF6", createdAt: 1 },
    f2: { id: "f2", name: "Програмування", color: "#14B8A6", createdAt: 2 },
  };
  T[ids[0]].folderId = "f1"; T[ids[1]].folderId = "f2";
  return d;
};

test("з папками: усі тести видно одразу, папка фільтрує список", async ({ page, errors }) => {
  await seed(page, withFolders(), "t1");
  await page.goto("/tests");
  await expect(page.locator(".t-lrow")).toHaveCount(4);                       // без кліків по папках
  await expect(page.locator("#t-rail")).toBeVisible();
  await expect(page.locator('#t-rail [data-id="all"] .t-rr-n')).toHaveText("4");
  await expect(page.locator('#t-rail [data-id="none"] .t-rr-n')).toHaveText("2");  // два тести без папки
  await expect(page.locator(".t-folder-card, .t-recent")).toHaveCount(0);          // великих карток папок більше немає

  await page.locator('#t-rail [data-id="f1"]').click();
  await expect(page).toHaveURL(/folder=f1/);
  await expect(page.locator(".t-lrow")).toHaveCount(1);
  await expect(page.locator('#t-rail [data-id="f1"]')).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Змінити" })).toBeVisible();
  await expect(page.locator("#srch")).toHaveAttribute("placeholder", /Географія/);

  await page.goBack();                                                             // «Назад» повертає до всіх
  await expect(page.locator(".t-lrow")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("список за замовчуванням: рядки з видимими діями, сітка — за перемикачем і запам'ятовується", async ({ page, errors }) => {
  await seed(page, withFolders(), "t1");
  await page.goto("/tests");
  await expect(page.locator(".t-lrow")).toHaveCount(4);
  const row = page.locator(".t-lrow").first();
  await expect(row.getByRole("button", { name: "Посилання" })).toBeVisible();      // дії видно без наведення
  await expect(row.getByRole("button", { name: "Редагувати" })).toBeVisible();
  expect((await row.boundingBox()).height).toBeLessThan(80);                      // один тест — один компактний рядок

  await page.locator('[data-view="grid"]').click();
  await expect(page.locator(".t-quiz-card")).toHaveCount(4);
  await page.reload();
  await expect(page.locator(".t-quiz-card")).toHaveCount(4);                       // вибір сітки збережено
  await page.locator('[data-view="list"]').click();
  await expect(page.locator(".t-lrow")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("без папок: рейки немає, лише список тестів", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");
  await page.goto("/tests?folder=нема");                                           // зайва папка в адресі не ламає сторінку
  await expect(page.locator(".t-lrow")).toHaveCount(4);
  await expect(page.locator("#t-rail")).toBeHidden();
  expect(errors).toEqual([]);
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("папки — чіпи над списком, без горизонтальної прокрутки сторінки", async ({ page, errors }) => {
    await seed(page, withFolders(), "t1");
    await page.goto("/tests"); await page.waitForTimeout(1000);
    const chips = await page.locator(".t-rail-list").evaluate(e => ({ dir: getComputedStyle(e).flexDirection, w: document.documentElement.scrollWidth }));
    expect(chips.dir).toBe("row");
    expect(chips.w).toBeLessThanOrEqual(390);
    await page.locator('#t-rail [data-id="f2"]').click();
    await expect(page.locator(".t-lrow")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});

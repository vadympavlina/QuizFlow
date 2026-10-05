// Топбар панелі викладача (shared/nav.js): дії сторінки — двійники кнопок з data-qtb.
// Натискання в топбарі має спрацьовувати як на оригінальній кнопці, а стан — копіюватися.
import { test, expect, seed } from "./fixtures.mjs";
import { rich } from "./seeds/rich.mjs";

const btn = (page, name) => page.locator("#qtb-extras .qtb-btn", { hasText: name });

test("дії в топбарі відкривають ті самі вікна, що й кнопки сторінки", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");

  await page.goto("/tests");
  await expect(page.locator("#qtb-t")).toHaveText("Тести");
  await expect(page.locator("#t-new-test")).toBeHidden();          // оригінал прихований
  await btn(page, "Новий тест").click();
  await expect(page.locator("#m-test")).toHaveClass(/on/);

  await page.goto("/links");
  await btn(page, "Нове посилання").click();
  await expect(page.locator("#m-link")).toHaveClass(/on/);

  await page.goto("/attempts");
  const dl = page.waitForEvent("download");
  await btn(page, "Експорт CSV").click();
  expect(await dl).toBeTruthy();                                   // файл віддано

  // id лишаються тільки в оригіналах
  for (const pg of ["/", "tests", "notifications", "gradebook"]) {
    await page.goto("/" + pg.replace(/^\//, ""));
    await page.waitForTimeout(800);
    expect(await page.locator("#qtb-extras [id]").count(), pg).toBe(0);
  }
  expect(errors).toEqual([]);
});

test("стан двійників повторює оригінал: disabled, клас, hidden", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");

  // Журнал: експорт неактивний, доки не вибрано групу
  await page.goto("/gradebook");
  await expect(btn(page, "CSV")).toBeDisabled();
  await page.getByText("ІП-21").first().click();
  await expect(btn(page, "CSV")).toBeEnabled();
  await expect(btn(page, "HTML-звіт")).toBeEnabled();

  // Сповіщення: перемикач звуку
  await page.goto("/notifications");
  const snd = page.locator("#qtb-extras .qtb-btn.icon");
  const wasOff = await page.locator("#notif-sound-btn").evaluate(b => b.classList.contains("snd-off"));
  await snd.click();
  await expect(snd).toHaveClass(wasOff ? /^(?!.*snd-off)/ : /snd-off/);

  // Новини: «Прочитати всі» прихована, коли непрочитаних немає
  await page.goto("/news");
  await expect(btn(page, "Прочитати всі")).toBeHidden();
  expect(errors).toEqual([]);
});

// Конструктор тестів: скасувати/повторити, імпорт питань вставленим текстом, перевірка дублікатів
import { test, expect, seed } from "./fixtures.mjs";
import { rich } from "./seeds/rich.mjs";

async function open(page) {
  await seed(page, rich(Date.now()), "t1");
  await page.goto("/constructor?id=T1");
  await expect(page.locator("#ql-list .qi").first()).toBeVisible();
}
const count = page => page.locator("#ql-list .qi").count();

test("скасувати й повторити: додавання питання, видалення й зміна тексту", async ({ page, errors }) => {
  await open(page);
  const n0 = await count(page);
  await expect(page.locator("#undo-btn")).toBeDisabled();

  // зміна тексту питання скасовується кнопкою
  const before = await page.locator("#q-text").innerText();
  await page.locator("#q-text").click();
  await page.keyboard.type(" ДОПИСАНО");
  await page.waitForTimeout(800);
  await expect(page.locator("#undo-btn")).toBeEnabled();
  await page.locator("#undo-btn").click();
  expect((await page.locator("#q-text").innerText()).trim()).toBe(before.trim());
  await page.locator("#redo-btn").click();
  expect(await page.locator("#q-text").innerText()).toContain("ДОПИСАНО");

  // нове питання: Ctrl+Z прибирає, Ctrl+Shift+Z повертає
  await page.locator('[data-act="add-same"], [data-act="next"]').first().waitFor();
  await page.keyboard.press("Alt+n");
  await expect.poll(() => count(page)).toBe(n0 + 1);
  await page.keyboard.press("Control+z");
  await expect.poll(() => count(page)).toBe(n0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => count(page)).toBe(n0 + 1);

  // видалення питання теж скасовується
  await page.locator('[data-act="q-del"]').click();
  await expect.poll(() => count(page)).toBe(n0);
  await page.keyboard.press("Control+z");
  await expect.poll(() => count(page)).toBe(n0 + 1);
  expect(errors).toEqual([]);
});

test("імпорт вставленим текстом: тип визначається з розмітки", async ({ page, errors }) => {
  await open(page);
  const n0 = await count(page);
  await page.locator(".import-btn").click();
  await page.locator('[data-act="im-tab"][data-tab="text"]').click();
  await page.locator("#im-text").fill([
    "1. Яка столиця Франції?", "*Париж", "Лондон", "Берлін", "",
    "Оберіть прості числа", "a) *2", "b) 4", "c) *7", "", 
    "Скільки буде 2+2?", "Відповідь: 4", "",
    "Опишіть причини Першої світової війни",
  ].join("\n"));
  await expect(page.locator("#im-go")).toBeEnabled();
  await expect(page.locator("#im-sum")).toContainText("4 питання");
  await page.locator("#im-go").click();
  await expect.poll(() => count(page)).toBe(n0 + 4);
  const types = await page.evaluate(() => [...document.querySelectorAll("#ql-list .qi .qi-type")].slice(-4).map(e => e.textContent.trim()));
  expect(types).toEqual(["Одна відповідь", "Кілька відповідей", "Число", "Розгорнута відповідь"]);
  // і це теж скасовується одним кроком
  await page.keyboard.press("Control+z");
  await expect.poll(() => count(page)).toBe(n0);
  expect(errors).toEqual([]);
});

test("перевірка якості: однакові питання й однакові варіанти", async ({ page, errors }) => {
  await open(page);
  await page.locator("#ql-list .qi").nth(1).click();
  await page.locator("#q-text").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Яка столиця Франції?");
  await expect(page.locator("#issues")).toContainText("Таке саме питання, як №1");
  await expect(page.locator("#ql-list .qi").nth(1).locator(".qi-warn")).toHaveCount(1);
  // однакові варіанти
  await page.locator('#opts input[data-f="opt"]').nth(0).fill("Париж");
  await page.locator('#opts input[data-f="opt"]').nth(1).fill("париж");
  await expect(page.locator("#q-hint")).toContainText("однакові варіанти");
  expect(errors).toEqual([]);
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  async function openPhone(page) {
    await seed(page, rich(Date.now()), "t1");
    await page.goto("/constructor?id=T1");
    await expect(page.locator("#q-text")).toBeVisible();
  }
  const pt = (x, y) => [{ x, y, id: 1 }];

  test("нижня панель: «1 з N», далі, нове питання; сторінка не ширша за екран", async ({ page, errors }) => {
    await openPhone(page);
    const n0 = await page.evaluate(() => document.querySelectorAll("#ql-list .qi").length);
    await expect(page.locator(".qn-cnt")).toContainText(`1 з ${n0}`);
    const bar = await page.locator(".qnav").boundingBox();
    expect(bar.y + bar.height).toBeGreaterThan(844 - 4);                 // прикріплена знизу
    await page.locator(".qn-m[data-act=next]").click();
    await expect(page.locator(".qn-cnt")).toContainText(`2 з ${n0}`);
    await page.locator(".qn-add").click();
    await expect(page.locator(".qn-cnt")).toContainText(`3 з ${n0 + 1}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });

  test("тип питання — шторка знизу, свайп униз закриває", async ({ page, errors }) => {
    await openPhone(page);
    await page.locator('[data-act="type-menu"]').click();
    const sheet = page.locator(".pop.sheet");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(450);
    const box = await sheet.boundingBox();
    expect(Math.round(box.y + box.height)).toBe(844);
    expect(box.height).toBeGreaterThan(300);                             // шторка показує всі типи, а не тільки заголовок
    const cdp = await page.context().newCDPSession(page);
    const y0 = box.y + 20;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(200, y0) });
    for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(200, y0 + i * 30) }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator(".pop.sheet")).toHaveCount(0);
    // а вибір типу в шторці працює
    await page.locator('[data-act="type-menu"]').click();
    await page.waitForTimeout(450);
    await page.locator('.pop.sheet [data-v="multi"]').click();
    await expect(page.locator(".type-btn .ts")).toContainText("Кілька");
    expect(errors).toEqual([]);
  });

  test("перетягування питання пальцем за ручку змінює порядок; панель закривається свайпом", async ({ page, errors }) => {
    await openPhone(page);
    await page.locator('[data-act="toggle-list"]').click();
    await page.waitForTimeout(450);
    const ids = () => page.evaluate(() => [...document.querySelectorAll("#ql-list .qi")].slice(0, 3).map(e => e.dataset.id));
    const before = await ids();
    const g = await page.locator("#ql-list .qi").nth(0).locator(".qi-grip").boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x, y) });
    for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x, y + i * 9) }); await page.waitForTimeout(20); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(ids).toEqual([before[1], before[0], before[2]]);
    // свайп ліворуч закриває список питань
    await page.waitForTimeout(400);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(240, 600) });
    for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(240 - i * 30, 600) }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => document.body.classList.contains("list-open"))).toBe(false);
    expect(errors).toEqual([]);
  });
});

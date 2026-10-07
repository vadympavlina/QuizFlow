// Профіль викладача: ім'я з історією змін (бачить лише адмін), зміна й скидання пароля
import { test, expect, seed, loginAs, readDb } from "./fixtures.mjs";
import { rich } from "./seeds/rich.mjs";

const db = () => { const d = rich(Date.now()); Object.assign(d.users.t1, { email: "o.koval@school.ua", createdAt: Date.now() - 100 * 864e5 }); return d; };
const authlog = page => page.evaluate(() => JSON.parse(localStorage.getItem("authlog") || "[]"));

test("ім'я: зберігається, оновлює меню і пише історію", async ({ page, errors }) => {
  await seed(page, db(), "t1");
  await page.goto("/tests");
  await page.locator("#sidebar .sb-me").click();                    // з меню — у профіль
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.locator("#qtb-t")).toHaveText("Профіль");
  await expect(page.locator("#pr-name")).toHaveText("Олена Коваль");

  const save = page.locator("#pr-name-btn");
  await expect(save).toBeDisabled();                                  // нічого не змінено
  await page.fill("#pr-surname", "");
  await save.click();
  await expect(page.locator("#pr-name-msg")).toHaveText("Вкажіть прізвище");

  await page.fill("#pr-surname", "коваль-шевчук");
  await save.click();
  await expect(page.locator("#pr-name-msg")).toHaveText("Збережено");
  await expect(page.locator("#pr-name")).toHaveText("Олена Коваль-Шевчук");
  await expect(page.locator("#sb-teacher-name")).toHaveText("Олена Коваль-Шевчук");

  const d = await readDb(page);
  expect(d.users.t1).toMatchObject({ name: "Олена", surname: "Коваль-Шевчук" });
  const h = Object.values(d.nameHistory.t1);
  expect(h).toHaveLength(1);
  expect(h[0]).toMatchObject({ prevName: "Олена", prevSurname: "Коваль", name: "Олена", surname: "Коваль-Шевчук" });
  expect(typeof h[0].at).toBe("number");
  // Самому викладачу історія не показується
  await expect(page.locator("text=Історія імен")).toHaveCount(0);

  // Адмін бачить історію в картці викладача
  await loginAs(page, "t5");
  await page.goto("/admin/teachers?id=t1");
  const box = page.locator("#tp-names-list");
  await expect(box.locator("li")).toHaveCount(1);
  await expect(box).toContainText("Коваль Олена");
  await expect(box).toContainText("Коваль-Шевчук Олена");
  expect(errors).toEqual([]);
});

test("пароль: перевірки, неправильний поточний, успішна зміна", async ({ page, errors }) => {
  await seed(page, db(), "t1");
  await page.goto("/profile");
  const go = () => page.locator("#pr-pass-btn").click(), m = page.locator("#pr-pass-msg");

  await go();
  await expect(m).toHaveText("Введіть поточний пароль");
  await page.fill("#pr-old", "secret1");
  await page.fill("#pr-new", "short1");
  await go();
  await expect(m).toHaveText("Новий пароль має містити щонайменше 8 символів");
  await page.fill("#pr-new", "onlyletters");
  await go();
  await expect(m).toHaveText("Додайте в новий пароль і літери, і цифри");
  await page.fill("#pr-new", "newpass123");
  await page.fill("#pr-new2", "newpass124");
  await go();
  await expect(m).toHaveText("Нові паролі не збігаються");

  await page.fill("#pr-old", "wrong999");
  await page.fill("#pr-new2", "newpass123");
  await go();
  await expect(m).toHaveText("Поточний пароль неправильний");
  expect(await page.evaluate(() => localStorage.getItem("mockPass"))).toBeNull();

  await page.fill("#pr-old", "secret1");
  await go();
  await expect(m).toHaveText("Пароль змінено");
  expect(await page.evaluate(() => localStorage.getItem("mockPass"))).toBe("newpass123");
  await expect(page.locator("#pr-old")).toHaveValue("");
  expect((await authlog(page)).map(x => x[0])).toEqual(["reauth", "reauth", "password"]);
  expect(errors).toEqual([]);
});

test("скидання пароля листом", async ({ page, errors }) => {
  await seed(page, db(), "t1");
  await page.goto("/profile");
  await expect(page.locator("#pr-reset-mail")).toHaveText("o.koval@school.ua");
  await page.locator("#pr-reset-btn").click();
  await expect(page.locator("#pr-sent")).toBeVisible();
  await expect(page.locator("#pr-sent-mail")).toHaveText("o.koval@school.ua");
  const log = await authlog(page);
  expect(log.at(-1)[0]).toBe("reset");
  expect(log.at(-1)[1][0]).toBe("o.koval@school.ua");
  expect(errors).toEqual([]);
});

test("акаунт без email: замість форми пароля — пояснення", async ({ page, errors }) => {
  await seed(page, rich(Date.now()), "t1");
  await page.goto("/profile");
  await expect(page.locator("#pr-pass-none")).toBeVisible();
  await expect(page.locator("#pr-pass-f")).toBeHidden();
  await expect(page.locator("#pr-reset")).toBeHidden();
  expect(errors).toEqual([]);
});

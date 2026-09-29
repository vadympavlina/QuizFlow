// Спільне для всіх тестів: мок Firebase, адреси без .html (як на GitHub Pages),
// збір помилок сторінки й робота з мок-базою в localStorage.
import { test as base, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOCK = path.join(path.dirname(fileURLToPath(import.meta.url)), "mock");

export const test = base.extend({
  context: async ({ context }, use) => {
    // Жодних зовнішніх запитів, крім SDK Firebase — його віддаємо з моку
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, r =>
      /gstatic\.com\/firebasejs/.test(r.request().url()) ? r.fallback() : r.abort());
    await context.route(/gstatic\.com\/firebasejs\/.*\/firebase-(app|auth|database)\.js/, r => {
      const m = r.request().url().match(/firebase-(app|auth|database)\.js/)[1];
      r.fulfill({ path: path.join(MOCK, `${m === "database" ? "db" : m}.js`), contentType: "text/javascript" });
    });
    await context.route(/127\.0\.0\.1:\d+\//, async r => {
      const u = new URL(r.request().url());
      if (/\.[a-z0-9]+$/i.test(u.pathname)) return r.continue();
      const p = u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname + ".html";
      r.fulfill({ response: await r.fetch({ url: u.origin + p + u.search }) });
    });
    await use(context);
  },
  errors: async ({ page }, use) => {
    const errs = [];
    page.on("pageerror", e => errs.push(`${new URL(page.url()).pathname}: ${e.message}`));
    page.on("dialog", d => d.dismiss().catch(() => {}));
    await use(errs);
  },
});

// Покласти базу й «увійти» як uid (порожній uid — без входу)
export async function seed(page, db, uid = "") {
  await page.goto("/404.html");
  await page.evaluate(([db, uid]) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem("mockdb", JSON.stringify(db));
    if (uid) localStorage.setItem("mockUid", uid);
  }, [db, uid]);
}
export async function loginAs(page, uid) {
  await page.evaluate(uid => { localStorage.setItem("mockUid", uid); sessionStorage.clear(); }, uid);
}
export const readDb = page => page.evaluate(() => JSON.parse(localStorage.getItem("mockdb") || "{}"));

export { expect };

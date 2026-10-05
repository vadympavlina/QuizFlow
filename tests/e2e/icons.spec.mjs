// Іконки: у кожної частини сайту свій набір (assets/icons/<група>), файли існують
import { test, expect } from "./fixtures.mjs";
import fs from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const html = fs.readdirSync(ROOT).filter(f => f.endsWith(".html"))
  .concat(fs.readdirSync(new URL("admin/", ROOT)).filter(f => f.endsWith(".html")).map(f => "admin/" + f))
  .concat(fs.readdirSync(new URL("live/", ROOT)).filter(f => f.endsWith(".html")).map(f => "live/" + f));
const group = f => f.startsWith("admin/") ? "admin" : f.startsWith("live/") || f === "play.html" ? "game" : f === "test.html" ? "test" : "teacher";

test("кожна сторінка підключає іконки своєї частини", () => {
  for (const f of html) {
    const s = fs.readFileSync(new URL(f, ROOT), "utf8");
    const hrefs = [...s.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)].map(m => m[1]);
    expect(hrefs, f).toHaveLength(4);
    for (const h of hrefs) expect(h, f).toMatch(new RegExp(`^/assets/icons/${group(f)}/`));
    expect(s, f).not.toContain('rel="icon" href="data:');
  }
});

test("файли іконок і маніфестів віддаються сервером", async ({ request }) => {
  const files = ["/favicon.ico", "/apple-touch-icon.png"];
  for (const g of ["teacher", "admin", "game", "test"]) {
    const base = `/assets/icons/${g}/`;
    files.push(...["favicon.ico", "icon.svg", "apple-touch-icon.png"].map(f => base + f));
    const res = await request.get(base + "site.webmanifest");
    expect(res.status(), base + "site.webmanifest").toBe(200);
    const man = await res.json();
    expect(man.icons.length).toBeGreaterThan(0);
    files.push(...man.icons.map(i => base + i.src.split("?")[0]));
  }
  for (const f of files) {
    const r = await request.get(f);
    expect(r.status(), f).toBe(200);
    expect((await r.body()).length, f).toBeGreaterThan(100);
  }
});

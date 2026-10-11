// Прев'ю посилань (Open Graph): своє для панелі викладача, гри наживо й тесту; в адмінці немає
import { test, expect } from "./fixtures.mjs";
import fs from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const list = dir => fs.readdirSync(new URL(dir || ".", ROOT)).filter(f => f.endsWith(".html")).map(f => (dir || "") + f);
const group = f => f.startsWith("admin/") ? null : f.startsWith("live/") || f === "play.html" ? "game" : f === "test.html" ? "test" : "teacher";
const meta = (s, attr, key) => (s.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`)) || [])[1];

test("кожна сторінка має прев'ю своєї частини, адмінка — без прев'ю", () => {
  for (const f of [...list(), ...list("live/"), ...list("admin/")]) {
    const s = fs.readFileSync(new URL(f, ROOT), "utf8"), g = group(f);
    if (!g){ expect(s, f).not.toContain("og:image"); continue; }
    expect(meta(s, "property", "og:image"), f).toBe(`https://quizflow.space/assets/og/${g}.jpg?v=1`);
    expect(meta(s, "name", "twitter:image"), f).toBe(meta(s, "property", "og:image"));
    expect(meta(s, "name", "twitter:card"), f).toBe("summary_large_image");
    for (const k of ["og:title", "og:description"]) expect((meta(s, "property", k) || "").length, `${f} ${k}`).toBeGreaterThan(10);
  }
});

test("картинки прев'ю віддаються сервером", async ({ request }) => {
  for (const g of ["teacher", "game", "test"]) {
    const r = await request.get(`/assets/og/${g}.jpg`);
    expect(r.status(), g).toBe(200);
    const b = await r.body();
    expect(b[0] === 0xFF && b[1] === 0xD8, `${g}: JPEG`).toBe(true);
    expect(b.length, g).toBeLessThan(300_000);   // месенджери не люблять важкі картинки
  }
});

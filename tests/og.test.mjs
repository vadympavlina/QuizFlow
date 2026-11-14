// Прев'ю посилань: головна має повні мета-теги, а всі картинки assets/og/*.jpg мають розмір 1200×630 і не важчі за 300 КБ
// (WhatsApp не показує важчі). Запуск: cd tests && npm run og:check
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT));

// Розмір JPEG зі службового блоку SOF (без залежностей)
export function jpegSize(buf) {
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8, "це не JPEG");
  for (let i = 2; i < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("у JPEG немає SOF");
}

test("усі картинки assets/og: 1200×630, JPEG, до 300 КБ", () => {
  const files = fs.readdirSync(new URL("assets/og/", ROOT)).filter(f => f.endsWith(".jpg"));
  assert.deepEqual(files.sort(), ["admin.jpg", "game.jpg", "landing.jpg", "teacher.jpg", "test.jpg"]);
  for (const f of files) {
    const buf = read(`assets/og/${f}`);
    assert.deepEqual(jpegSize(buf), { w: 1200, h: 630 }, f);
    assert.ok(buf.length <= 300 * 1024, `${f}: ${Math.round(buf.length / 1024)} КБ`);
  }
});

test("головна: og:image і twitter:image ведуть на landing.jpg зі ?v=, є розміри й опис", () => {
  const html = read("index.html").toString("utf8");
  const meta = (attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];
  const host = "quizflow.space";   // CNAME у цьому репозиторії немає: домен задано в налаштуваннях Pages
  const img = meta("property", "og:image");
  assert.match(img, new RegExp(`^https://${host.replace(/\./g, "\\.")}/assets/og/landing\\.jpg\\?v=\\d+$`));
  assert.equal(meta("name", "twitter:image"), img);
  assert.equal(meta("property", "og:image:width"), "1200");
  assert.equal(meta("property", "og:image:height"), "630");
  assert.equal(meta("name", "twitter:card"), "summary_large_image");
  for (const k of ["og:title", "og:description", "og:image:alt"]) assert.ok(meta("property", k), k);
});

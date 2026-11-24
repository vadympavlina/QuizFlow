// Юридичні сторінки (privacy.html, terms.html): на місці, без незаповнених полів, з контактом і перехресними посиланнями.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const pages = { "privacy.html": "/privacy", "terms.html": "/terms" };

for (const [file, path] of Object.entries(pages)) {
  test(`${file}: заповнена, з контактом і посиланнями`, () => {
    const h = read(file);
    assert.ok(!/\[\[[^\]]+\]\]/.test(h), "лишились незаповнені поля [[…]]");
    assert.match(h, /<html lang="uk">/);
    assert.match(h, new RegExp(`<link rel="canonical" href="https://quizflow\\.space${path}">`));
    assert.equal((h.match(/<h1>/g) || []).length, 1, "має бути один заголовок h1");
    assert.match(h, /href="mailto:[^"@\s]+@[^"@\s]+\.[a-z]{2,}"/i, "потрібна контактна пошта");
    assert.ok(h.includes('href="/privacy"') && h.includes('href="/terms"'), "сторінки посилаються одна на одну");
    assert.ok(!/\p{Extended_Pictographic}/u.test(h), "без емодзі в інтерфейсі");
    assert.match(h, /Редакція від \d{1,2} \S+ \d{4} року/);
  });
}

test("головна сторінка посилається на політику й умови", () => {
  const h = read("index.html");
  assert.ok(h.includes('href="/privacy"') && h.includes('href="/terms"'));
});

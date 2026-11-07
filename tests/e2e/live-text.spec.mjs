// Гра наживо: у текстовому питанні зараховується будь-який із кількох допустимих варіантів
import { test, expect } from "./fixtures.mjs";

test("текстова відповідь: зараховується кожен з варіантів через / | , або", async ({ page, errors }) => {
  await page.goto("/404.html");
  const res = await page.evaluate(async () => {
    const { checkCorrect } = await import("/live/live-core.js?v=5");
    const q = { type: "text" };
    const ok = (correct, v) => checkCorrect(q, correct, v);
    return {
      whole: ok("Київ", "київ"),
      slash1: ok("Київ / м. Київ", "Київ"),
      slash2: ok("Київ / м. Київ", "  М.  КИЇВ "),
      pipe: ok("так | yes", "yes"),
      comma: ok("кіт, кішка", "Кішка"),
      or: ok("HTML або HyperText Markup Language", "html"),
      wrong: ok("Київ / м. Київ", "Львів"),
      empty: ok("Київ / м. Київ", "  "),
    };
  });
  expect(res).toEqual({ whole: true, slash1: true, slash2: true, pipe: true, comma: true, or: true, wrong: false, empty: false });
  expect(errors).toEqual([]);
});

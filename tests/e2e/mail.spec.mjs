// Розсилки й запрошення листом. Воркер пошти підмінено: маршрути відповідають
// як справжній воркер, а HTML листа малює його ж шаблон (worker/src/mail.js).
import { test, expect, seed, readDb } from "./fixtures.mjs";
import { admSeed } from "./seeds/admin.mjs";
import { broadcastEmail } from "../../worker/src/mail.js";

const WORKER = "https://mail.quizflow.test";

async function fakeWorker(page, calls, { configured = true } = {}) {
  await page.context().route(`${WORKER}/**`, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ path, body, auth: req.headers()["authorization"] });
    const json = (d, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(d) });
    if (path === "/status") return json({ ok: true, from: "QuizFlow <noreply@quizflow.space>", configured: { resend: configured, unsubscribe: true, kv: true }, unsubscribed: ["t2"] });
    if (path === "/preview") return json({ ok: true, html: broadcastEmail({ ...body, name: "Олено", unsubUrl: "#" }).html });
    if (path === "/invite") return json({ ok: true, id: "e1", to: body.to });
    if (path === "/broadcast") return json({ ok: true, sent: body.test ? 1 : body.uids.length, failed: 0, skipped: { noEmail: 0, blocked: 0, unsubscribed: 0, missing: 0 } });
    return json({ ok: false, error: "404" }, 404);
  });
}
function mailDb() {
  const db = admSeed(Date.now());
  db.roles = { r1: { name: "Куратор", color: "#059669" } };
  db.users.t1.customRoleIds = { r1: true };
  db.users.t2.lastLogin = Date.now() - 2 * 864e5;
  return db;
}

test("розсилки: налаштування воркера, тест собі, розсилка ролі", async ({ page, errors }) => {
  const calls = [];
  await fakeWorker(page, calls);
  await seed(page, mailDb(), "t5");
  await page.goto("/admin/mail");
  // Воркер ще не задано — екран налаштування
  await page.fill("#st-url", WORKER + "/");
  await page.click('[data-act="setup-check"]');
  await expect(page.locator("#f-subj")).toBeVisible();
  expect((await readDb(page)).settings.mail.workerUrl).toBe(WORKER);
  expect(calls[0].auth).toBe("Bearer mock-token-t5");

  // Усі викладачі: t1, t2 (відписався), t3; t4 заблокований
  await expect(page.locator("#sum")).toContainText("Отримають 2");
  await expect(page.locator("#sum")).toContainText("відписались 1");
  await expect(page.locator("#sum")).toContainText("заблоковані 1");

  await page.fill("#f-subj", "Що нового");
  await page.fill("#f-body", "Привіт!\n\n- **журнал** став швидшим\n- нові ролі");
  await expect(page.frameLocator("#pv-box iframe").locator("body")).toContainText("журнал став швидшим");

  await page.click('[data-act="test"]');
  await expect.poll(() => calls.find(c => c.path === "/broadcast")?.body?.test).toBe(true);

  await page.click('[data-aud="roles"]');
  await page.click('[data-role="r1"]');
  await expect(page.locator("#sum")).toContainText("Отримають 1");
  await expect(page.locator("#f-subj")).toHaveValue("Що нового");   // чернетка не губиться
  await page.click('[data-act="send"]');
  await page.click("#sd-ok");
  await expect(page.locator("#sd-res")).toContainText("Надіслано: 1");
  const sent = calls.filter(c => c.path === "/broadcast" && !c.body.test);
  expect(sent).toHaveLength(1);
  expect(sent[0].body.uids).toEqual(["t1"]);
  expect(sent[0].body.subject).toBe("Що нового");
  const db = await readDb(page);
  expect(Object.values(db.mailLog)[0]).toMatchObject({ subject: "Що нового", sent: 1, audience: "Ролі: Куратор" });
  await page.evaluate(() => closeModal("m-send"));
  await expect(page.locator("#hist")).toContainText("Що нового");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("розсилки: неповністю налаштований воркер не зберігається", async ({ page, errors }) => {
  const calls = [];
  await fakeWorker(page, calls, { configured: false });
  await seed(page, mailDb(), "t5");
  await page.goto("/admin/mail");
  await page.fill("#st-url", WORKER);
  await page.click('[data-act="setup-check"]');
  await expect(page.locator("#st-res")).toContainText("RESEND_API_KEY");
  expect((await readDb(page)).settings?.mail).toBeUndefined();
  expect(errors).toEqual([]);
});

test("запрошення: нове з email надсилається листом, повторне — з рядка", async ({ page, errors }) => {
  const calls = [];
  await fakeWorker(page, calls);
  const db = mailDb();
  db.settings = { ...(db.settings || {}), mail: { workerUrl: WORKER } };
  await seed(page, db, "t5");
  await page.goto("/admin/invites");
  await page.click("#btn-new");
  await page.fill("#nw-note", "Іваненко О.");
  await page.fill("#nw-email", "Ivanenko@Example.com");
  await page.click("#nw-create");
  await expect(page.locator("#nw-mail")).toContainText("Лист надіслано на ivanenko@example.com");
  const inv = calls.find(c => c.path === "/invite");
  expect(inv.body.to).toBe("ivanenko@example.com");
  const tokens = (await readDb(page)).invite_tokens;
  expect(tokens[inv.body.token]).toMatchObject({ sentTo: "ivanenko@example.com", note: "Іваненко О." });
  await page.evaluate(() => closeModal("m-new"));
  await expect(page.locator(".iv-row").first()).toContainText("ivanenko@example.com");

  await page.locator('.iv-row [data-act="send"]').first().click();
  await expect(page.locator("#sd-email")).toHaveValue("ivanenko@example.com");
  await page.fill("#sd-email", "other@example.com");
  await page.click("#sd-ok");
  await expect(page.locator("#m-send")).not.toHaveClass(/on/);
  expect(calls.filter(c => c.path === "/invite").map(c => c.body.to)).toEqual(["ivanenko@example.com", "other@example.com"]);
  expect(errors).toEqual([]);
});

test("запрошення: без воркера поля email і кнопки «Листом» немає", async ({ page, errors }) => {
  await seed(page, mailDb(), "t5");
  await page.goto("/admin/invites");
  await page.click("#btn-new");
  await expect(page.locator("#nw-email")).toBeHidden();
  expect(errors).toEqual([]);
});
